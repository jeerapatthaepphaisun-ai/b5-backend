const pool = require('../db');

// POST /api/orders
const createOrder = async (req, res, next) => {
    console.log("Received cart data:", JSON.stringify(req.body.cart, null, 2)); // Debug log
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
        // Business logic for table name assignment (no changes needed here)
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
                 WHERE mi.id = $1`, 
                [itemInCart.productId || itemInCart.id]
            );

            if (itemResult.rows.length === 0) throw new Error(`Item with ID ${itemInCart.id} not found.`);
            const dbItem = itemResult.rows[0];

            if (dbItem.stock_status === 'out_of_stock') {
                await client.query('ROLLBACK');
                client.release();
                return res.status(409).json({
                    status: 'error', message: 'Item is out of stock.',
                    errorCode: 'OUT_OF_STOCK', errorDetails: { itemId: dbItem.id, itemName: dbItem.name_th }
                });
            }
            
            calculatedSubtotal += parseFloat(itemInCart.price) * itemInCart.quantity;

            // --- ✨✨✨ นี่คือส่วนที่แก้ไข Logic ใหม่ทั้งหมด ✨✨✨ ---
            let selectedOptionsText = { th: '', en: '', km: '', zh: '' };
            if (itemInCart.selected_options && itemInCart.selected_options.length > 0) {
                // เปลี่ยนมา query หา options เฉพาะ ID ที่ส่งมาในตะกร้า
                const optionsQuery = 'SELECT label_th, label_en, label_km, label_zh FROM menu_options WHERE id = ANY($1::uuid[])';
                const optionsResult = await client.query(optionsQuery, [itemInCart.selected_options]);
                
                if (optionsResult.rows.length > 0) {
                    selectedOptionsText.th = optionsResult.rows.map(o => o.label_th).filter(Boolean).join(', ');
                    selectedOptionsText.en = optionsResult.rows.map(o => o.label_en).filter(Boolean).join(', ');
                    selectedOptionsText.km = optionsResult.rows.map(o => o.label_km).filter(Boolean).join(', ');
                    selectedOptionsText.zh = optionsResult.rows.map(o => o.label_zh).filter(Boolean).join(', ');
                }
            }
            // ----------------------------------------------------

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

// GET /api/orders
const getOrdersByStation = async (req, res, next) => {
    try {
        const { station } = req.query;
        if (!station) return res.status(400).json({ status: 'error', message: 'กรุณาระบุ station (kitchen หรือ bar)' });

        const categoriesResult = await pool.query('SELECT name_th FROM categories WHERE station_type = $1', [station]);
        const targetCategories = categoriesResult.rows.map(row => row.name_th);
        if (targetCategories.length === 0) return res.json({ status: 'success', data: [] });

        const query = `SELECT * FROM orders WHERE status IN ('Pending', 'Cooking', 'Preparing') ORDER BY created_at ASC;`;
        const result = await pool.query(query);
        
        const filteredOrders = result.rows.map(order => {
            const relevantItems = order.items.filter(item => targetCategories.includes(item.category_th));
            if (relevantItems.length > 0) return { ...order, items: relevantItems };
            return null;
        }).filter(Boolean);

        res.json({ status: 'success', data: filteredOrders });
    } catch (error) {
        next(error);
    }
};

// POST /api/orders/update-status
const updateOrderStatus = async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { orderId, newStatus, station } = req.body;

        if (newStatus !== 'Serving') {
            const result = await client.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [newStatus, orderId]);
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

// GET /api/kds/orders (ฟังก์ชันใหม่สำหรับ KDS โดยเฉพาะ)
const getKdsOrders = async (req, res, next) => {
    try {
        const { station } = req.query;
        if (!station) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุ station (kitchen หรือ bar)' });
        }

        const categoriesResult = await pool.query('SELECT name_th FROM categories WHERE station_type = $1', [station]);
        const targetCategories = categoriesResult.rows.map(row => row.name_th);

        if (targetCategories.length === 0) {
            return res.json({ status: 'success', data: [] });
        }

        const query = `
            SELECT * FROM orders
            WHERE status IN ('Pending', 'Cooking', 'Preparing')
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query);
        
        const filteredOrders = result.rows.map(order => {
            const relevantItems = order.items.filter(item => targetCategories.includes(item.category_th));
            
            if (relevantItems.length > 0) {
                return { ...order, items: relevantItems };
            }
            return null;
        }).filter(Boolean);

        res.json({ status: 'success', data: filteredOrders });

    } catch (error) {
        next(error);
    }
};

module.exports = {
    createOrder,
    getOrdersByStation,
    updateOrderStatus,
    getKdsOrders
};