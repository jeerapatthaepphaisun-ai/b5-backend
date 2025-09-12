const pool = require('../db');

// POST /api/orders
const createOrder = async (req, res, next) => {
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
        // Logic for determining table name (Bar-X, Takeaway-X, etc.)
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
        
        // Logic for calculating totals and updating stock
        let calculatedSubtotal = 0;
        for (const item of cart) {
            const itemResult = await client.query('SELECT price, stock_status, name_th FROM menu_items WHERE id = $1', [item.productId || item.id]);
            if (itemResult.rows.length === 0) throw new Error(`Item with ID ${item.id} not found.`);
            if (itemResult.rows[0].stock_status === 'out_of_stock') throw new Error(`Item "${itemResult.rows[0].name_th}" is out of stock.`);
            calculatedSubtotal += parseFloat(item.price) * item.quantity;
            if (item.productId || item.id) {
                await client.query(`UPDATE menu_items SET current_stock = GREATEST(0, current_stock - $1) WHERE id = $2 AND manage_stock = true`,[item.quantity, item.productId || item.id]);
            }
        }
        await client.query(`UPDATE menu_items SET stock_status = 'out_of_stock' WHERE manage_stock = true AND current_stock <= 0`);

        const subtotal = calculatedSubtotal;
        const discountAmount = subtotal * (discountPercentage / 100);
        const finalTotal = subtotal - discountAmount;

        const query = `INSERT INTO orders (table_name, items, subtotal, discount_percentage, discount_amount, total, special_request, status, is_takeaway, discount_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;`;
        const values = [finalTableName, JSON.stringify(cart), subtotal, discountPercentage, discountAmount, finalTotal, specialRequest || '', 'Pending', isTakeaway, discountedByUser];
        const result = await client.query(query, values);

        await client.query('COMMIT');
        const newOrder = result.rows[0];
        req.broadcast({ type: 'newOrder', order: newOrder });
        res.status(201).json({ status: 'success', data: newOrder });

    } catch (error) {
        await client.query('ROLLBACK');
        return next(error);
    } finally {
        client.release();
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

        // Simplified logic for non-serving status
        if (newStatus !== 'Serving') {
            const result = await client.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [newStatus, orderId]);
            if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Order not found' });
            req.broadcast({ type: 'orderStatusUpdate', order: result.rows[0] });
            await client.query('COMMIT');
            return res.json({ status: 'success', data: result.rows[0] });
        }

        // Logic for 'Serving' status and station completion
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

module.exports = {
    createOrder,
    getOrdersByStation,
    updateOrderStatus
};