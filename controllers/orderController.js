// controllers/orderController.js

const pool = require('../db');

// --- ฟังก์ชัน Helper กลางสำหรับดึงออเดอร์ตาม Station ---
const getFilteredOrdersByStation = async (station) => {
    if (!station) {
        throw new Error('กรุณาระบุ station (kitchen หรือ bar)');
    }

    // ดึงชื่อหมวดหมู่ที่ตรงกับ station ที่ระบุ
    const categoriesResult = await pool.query('SELECT name_th FROM categories WHERE station_type = $1', [station]);
    const targetCategories = categoriesResult.rows.map(row => row.name_th);

    if (targetCategories.length === 0) {
        return []; // ถ้าไม่มีหมวดหมู่สำหรับ station นี้ ก็ return ค่าว่างไปเลย
    }

    // ดึงออเดอร์ที่ยังไม่เสร็จทั้งหมด
    const query = `SELECT * FROM orders WHERE status IN ('Pending', 'Cooking', 'Preparing') ORDER BY created_at ASC;`;
    const result = await pool.query(query);
    
    // กรองเฉพาะรายการอาหารที่เกี่ยวข้องกับ station นี้ในแต่ละออเดอร์
    const filteredOrders = result.rows.map(order => {
        const relevantItems = order.items.filter(item => targetCategories.includes(item.category_th));
        
        // ถ้ามีรายการที่เกี่ยวข้องอย่างน้อย 1 รายการ ให้ return ออเดอร์นั้นไป
        if (relevantItems.length > 0) {
            return { ...order, items: relevantItems };
        }
        return null;
    }).filter(Boolean); // .filter(Boolean) เพื่อตัดออเดอร์ที่เป็น null ออกไป

    return filteredOrders;
};


// POST /api/orders
const createOrder = async (req, res, next) => {
    console.log("Received cart data:", JSON.stringify(req.body.cart, null, 2));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET TimeZone = 'Asia/Bangkok';");

        const { cart, tableNumber, specialRequest, isTakeaway, orderSource, discountPercentage = 0 } = req.body;
        if (!cart || cart.length === 0) return res.status(400).json({ status: 'error', message: 'Cart is empty' });
        
        let discountedByUser = null;
        if (discountPercentage > 0) {
            if (!req.user) return res.status(401).send('Unauthorized: A login is required to apply discounts.');
            discountedByUser = req.user.username;
        }

        let finalTableName;
        if (orderSource === 'bar') {
            const lastBarOrderQuery = `SELECT table_name FROM orders WHERE table_name LIKE 'Bar-%' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE ORDER BY created_at DESC LIMIT 1;`;
            const lastBarResult = await client.query(lastBarOrderQuery);
            let nextNumber = 1;
            if (lastBarResult.rows.length > 0) {
                const lastNumber = parseInt(lastBarResult.rows[0].table_name.split('-')[1] || '0', 10);
                nextNumber = lastNumber + 1;
            }
            finalTableName = `Bar-${nextNumber}`;
        } else if (tableNumber) {
            finalTableName = tableNumber;
            const tableStatusResult = await client.query('SELECT status FROM tables WHERE name = $1', [finalTableName]);
            if (tableStatusResult.rowCount > 0 && tableStatusResult.rows[0].status === 'Available' && !isTakeaway) {
                await client.query('UPDATE tables SET status = $1 WHERE name = $2', ['Occupied', finalTableName]);
            }
        } else if (isTakeaway) {
            const lastTakeawayQuery = `SELECT table_name FROM orders WHERE table_name LIKE 'Takeaway-%' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE ORDER BY created_at DESC LIMIT 1;`;
            const lastTakeawayResult = await client.query(lastTakeawayQuery);
            let nextNumber = 1;
            if (lastTakeawayResult.rows.length > 0) {
                const lastNumber = parseInt(lastTakeawayResult.rows[0].table_name.split('-')[1] || '0', 10);
                nextNumber = lastNumber + 1;
            }
            finalTableName = `Takeaway-${nextNumber}`;
        } else {
             return res.status(400).json({ status: 'error', message: 'Table number or order type is required.' });
        }
        
        let calculatedSubtotal = 0;
        const updatedStockItems = [];
        const finalCartForStorage = []; 

        for (const itemInCart of cart) {
            const itemResult = await client.query(
                `SELECT mi.*, c.name_th as category_th, c.name_en as category_en, c.name_km as category_km, c.name_zh as category_zh 
                 FROM menu_items mi
                 LEFT JOIN categories c ON mi.category_id = c.id
                 WHERE mi.id = $1
                 FOR UPDATE OF mi`,
                [itemInCart.productId || itemInCart.id]
            );

            if (itemResult.rows.length === 0) throw new Error(`Item with ID ${itemInCart.id} not found.`);
            const dbItem = itemResult.rows[0];

            if (dbItem.manage_stock && dbItem.current_stock < itemInCart.quantity) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(409).json({
                    status: 'error',
                    message: `สินค้า '${dbItem.name_th}' มีสต็อกไม่เพียงพอ (เหลือ ${dbItem.current_stock} ชิ้น)`,
                    errorCode: 'OUT_OF_STOCK',
                    errorDetails: { itemId: dbItem.id, itemName: dbItem.name_th, stock: dbItem.current_stock }
                });
            }
            
            calculatedSubtotal += parseFloat(itemInCart.price) * itemInCart.quantity;

            let selectedOptionsText = { th: '', en: '', km: '', zh: '' };
            if (itemInCart.selected_options && itemInCart.selected_options.length > 0) {
                const optionIds = itemInCart.selected_options.map(opt => typeof opt === 'object' ? opt.id : opt);
                const optionsQuery = 'SELECT label_th, label_en, label_km, label_zh FROM menu_options WHERE id = ANY($1::uuid[])';
                const optionsResult = await client.query(optionsQuery, [optionIds]);
                
                if (optionsResult.rows.length > 0) {
                    selectedOptionsText.th = optionsResult.rows.map(o => o.label_th).filter(Boolean).join(', ');
                    selectedOptionsText.en = optionsResult.rows.map(o => o.label_en).filter(Boolean).join(', ');
                    selectedOptionsText.km = optionsResult.rows.map(o => o.label_km).filter(Boolean).join(', ');
                    selectedOptionsText.zh = optionsResult.rows.map(o => o.label_zh).filter(Boolean).join(', ');
                }
            }

            const fullItemData = {
                id: dbItem.id,
                name_th: dbItem.name_th, name_en: dbItem.name_en, name_km: dbItem.name_km, name_zh: dbItem.name_zh,
                category_th: dbItem.category_th, category_en: dbItem.category_en, category_km: dbItem.category_km, category_zh: dbItem.category_zh,
                price: parseFloat(itemInCart.price),
                quantity: itemInCart.quantity,
                selected_options: itemInCart.selected_options || [],
                selected_options_text_th: selectedOptionsText.th,
                selected_options_text_en: selectedOptionsText.en,
                selected_options_text_km: selectedOptionsText.km,
                selected_options_text_zh: selectedOptionsText.zh,
            };
            
            finalCartForStorage.push(fullItemData);

            if (dbItem.manage_stock) {
                const newStock = dbItem.current_stock - itemInCart.quantity;
                await client.query(`UPDATE menu_items SET current_stock = $1 WHERE id = $2`, [newStock, dbItem.id]);
                updatedStockItems.push({
                    id: dbItem.id, current_stock: newStock, stock_status: newStock > 0 ? 'in_stock' : 'out_of_stock'
                });
            }
        }
        await client.query(`UPDATE menu_items SET stock_status = 'out_of_stock' WHERE manage_stock = true AND current_stock <= 0`);

        const subtotal = calculatedSubtotal;
        const discountAmount = subtotal * (discountPercentage / 100);
        const finalTotal = subtotal - discountAmount;

        const query = `INSERT INTO orders (table_name, items, subtotal, discount_percentage, discount_amount, total, special_request, status, is_takeaway, discount_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;`;
        const values = [finalTableName, JSON.stringify(finalCartForStorage), subtotal, discountPercentage, discountAmount, finalTotal, specialRequest || '', 'Pending', isTakeaway, discountedByUser];
        const result = await client.query(query, values);

        await client.query('COMMIT');
        
        const newOrder = result.rows[0];
        req.broadcast({ type: 'newOrder', order: newOrder });
        if (updatedStockItems.length > 0) {
            req.broadcast({ type: 'stockUpdate', payload: updatedStockItems });
        }
        res.status(201).json({ status: 'success', data: newOrder });

    } catch (error) {
        await client.query('ROLLBACK');
        return next(error);
    } finally {
        if (client.release) client.release();
    }
};

const getOrdersByStation = async (req, res, next) => {
    try {
        const { station } = req.query;
        const filteredOrders = await getFilteredOrdersByStation(station);
        res.json({ status: 'success', data: filteredOrders });
    } catch (error) {
        if (error.message.includes('กรุณาระบุ station')) {
            return res.status(400).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

const updateOrderStatus = async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { orderId, newStatus, station } = req.body;

        if (newStatus !== 'Serving') {
            let updateQuery = 'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *';
            const queryParams = [newStatus, orderId];

            if (newStatus === 'Cooking' && station) {
                updateQuery = 'UPDATE orders SET status = $1, completed_stations = completed_stations - $3 WHERE id = $2 RETURNING *';
                queryParams.push(station);
            }
            
            const result = await client.query(updateQuery, queryParams);
            
            if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Order not found' });
            req.broadcast({ type: 'orderStatusUpdate', order: result.rows[0] });
            await client.query('COMMIT');
            return res.json({ status: 'success', data: result.rows[0] });
        }

        const updateStationResult = await client.query(`UPDATE orders SET completed_stations = completed_stations || $1::jsonb WHERE id = $2 AND NOT completed_stations @> $1::jsonb RETURNING *`, [JSON.stringify(station), orderId]);
        if (updateStationResult.rowCount === 0) {
            const currentOrder = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
            await client.query('COMMIT');
            return res.json({ status: 'success', data: currentOrder.rows[0] });
        }

        const updatedOrder = updateStationResult.rows[0];
        const itemCategories = updatedOrder.items.map(item => item.category_th);
        const categoriesResult = await client.query('SELECT DISTINCT station_type FROM categories WHERE name_th = ANY($1::text[])', [itemCategories]);
        const requiredStations = categoriesResult.rows.map(row => row.station_type);
        const allStationsCompleted = requiredStations.every(reqStation => updatedOrder.completed_stations.includes(reqStation));

        if (allStationsCompleted) {
            const finalResult = await client.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', ['Serving', orderId]);
            req.broadcast({ type: 'orderStatusUpdate', order: finalResult.rows[0] });
            await client.query('COMMIT');
            return res.json({ status: 'success', data: finalResult.rows[0] });
        }

        req.broadcast({ type: 'orderStatusUpdate', order: updatedOrder });
        await client.query('COMMIT');
        res.json({ status: 'success', data: updatedOrder });

    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
};

const getKdsOrders = async (req, res, next) => {
    try {
        const { station } = req.query;
        const filteredOrders = await getFilteredOrdersByStation(station);
        res.json({ status: 'success', data: filteredOrders });
    } catch (error) {
        if (error.message.includes('กรุณาระบุ station')) {
            return res.status(400).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

const undoPayment = async (req, res, next) => {
    const { tableName } = req.body;
    if (!tableName) {
        return res.status(400).json({ status: 'error', message: 'Table name is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const recentPaidOrdersResult = await client.query(
            `SELECT id FROM orders 
             WHERE table_name = $1 AND status = 'Paid' 
             AND updated_at >= NOW() - INTERVAL '2 minutes'
             ORDER BY updated_at DESC`,
            [tableName]
        );

        if (recentPaidOrdersResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ status: 'error', message: 'No recent paid order found for this table to undo.' });
        }
        
        const orderIdsToUndo = recentPaidOrdersResult.rows.map(row => row.id);

        await client.query(
            "UPDATE orders SET status = 'Serving', updated_at = NOW() WHERE id = ANY($1::uuid[])",
            [orderIdsToUndo]
        );

        if (!tableName.startsWith('Takeaway-') && !tableName.startsWith('Bar-')) {
             await client.query(
                "UPDATE tables SET status = 'Occupied' WHERE name = $1",
                [tableName]
            );
        }

        await client.query('COMMIT');

        req.broadcast({ type: 'paymentUndone', tableName: tableName });

        res.json({ status: 'success', message: `Payment for table ${tableName} has been undone.` });

    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
};

module.exports = {
    createOrder,
    getOrdersByStation,
    updateOrderStatus,
    getKdsOrders,
    undoPayment
};