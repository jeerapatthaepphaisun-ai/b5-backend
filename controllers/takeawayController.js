// controllers/takeawayController.js
const pool = require('../db');

// GET /api/takeaway-orders
const getTakeawayOrders = async (req, res, next) => {
    try {
        const query = `
            SELECT 
                table_name,
                status,
                json_agg(
                    json_build_object(
                        'items', items, 
                        'subtotal', subtotal, 
                        'discount_amount', discount_amount, 
                        'total', total, 
                        'discount_percentage', discount_percentage
                    ) 
                    ORDER BY created_at
                ) as orders_data
            FROM orders 
            WHERE 
                (table_name LIKE 'Takeaway-%' OR table_name LIKE 'Bar-%') 
                AND status != 'Paid' 
            GROUP BY table_name, status
            ORDER BY table_name ASC;
        `;
        const result = await pool.query(query);

        // จัดรูปแบบข้อมูลให้เหมือนกับข้อมูลโต๊ะ เพื่อให้ Frontend ใช้งานได้ง่าย
        const occupiedTakeaways = result.rows.reduce((acc, row) => {
            const subtotal = row.orders_data.reduce((sum, order) => sum + parseFloat(order.subtotal), 0);
            const discountAmount = row.orders_data.reduce((sum, order) => sum + parseFloat(order.discount_amount), 0);
            const total = row.orders_data.reduce((sum, order) => sum + parseFloat(order.total), 0);
            const discountPercentage = row.orders_data[0]?.discount_percentage || 0;

            acc[row.table_name] = {
                tableName: row.table_name,
                orders: row.orders_data.flatMap(order => order.items),
                status: row.status,
                subtotal: subtotal,
                discountAmount: discountAmount,
                total: total,
                discountPercentage: discountPercentage
            };
            return acc;
        }, {});
        
        res.json({ status: 'success', data: { occupiedTakeaways } });
    } catch (error) {
        next(error);
    }
};

// POST /api/takeaway-orders/clear
const clearTakeawayOrder = async (req, res, next) => {
    try {
        const { takeawayId } = req.body; // e.g., "Takeaway-1"
        if (!takeawayId) {
            return res.status(400).json({ status: 'error', message: 'Takeaway ID is required.' });
        }

        await pool.query(
            "UPDATE orders SET status = 'Paid' WHERE table_name = $1 AND status != 'Paid'",
            [takeawayId]
        );
        
        req.broadcast({ type: 'takeawayCleared', takeawayId: takeawayId });

        res.json({ status: 'success', message: `Order ${takeawayId} cleared successfully.` });
    } catch (error) {
        next(error);
    }
};

// GET /api/next-bar-number
const getNextBarNumber = async (req, res, next) => {
    try {
        await pool.query("SET TimeZone = 'Asia/Bangkok';");
        const query = `
            SELECT table_name 
            FROM orders 
            WHERE table_name LIKE 'Bar-%' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE 
            ORDER BY created_at DESC 
            LIMIT 1;
        `;
        const result = await pool.query(query);
        
        let nextNumber = 1;
        if (result.rows.length > 0) {
            const lastNumber = parseInt(result.rows[0].table_name.split('-')[1] || '0', 10);
            nextNumber = lastNumber + 1;
        }

        res.json({ status: 'success', nextNumber: nextNumber });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTakeawayOrders,
    clearTakeawayOrder,
    getNextBarNumber
};