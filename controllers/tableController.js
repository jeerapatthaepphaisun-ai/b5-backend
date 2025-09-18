const pool = require('../db');
const { validationResult } = require('express-validator');

// GET /api/tables (for cashier view)
const getTableData = async (req, res, next) => {
    try {
        const query = `
            SELECT t.name as table_name, t.status as table_status, o.orders_data
            FROM tables t
            LEFT JOIN (
                SELECT table_name, json_agg(json_build_object('items', items, 'subtotal', subtotal, 'discount_amount', discount_amount, 'total', total, 'discount_percentage', discount_percentage) ORDER BY created_at) as orders_data
                FROM orders WHERE status != 'Paid' GROUP BY table_name
            ) o ON t.name = o.table_name
            ORDER BY t.sort_order ASC, t.name ASC;
        `;
        const result = await pool.query(query);

        // Processing logic to aggregate data for occupied tables
        const allTableNames = result.rows.map(r => r.table_name);
        const occupiedTablesData = result.rows.reduce((acc, row) => {
            if (row.orders_data) {
                const subtotal = row.orders_data.reduce((sum, order) => sum + parseFloat(order.subtotal), 0);
                const discountAmount = row.orders_data.reduce((sum, order) => sum + parseFloat(order.discount_amount), 0);
                const totalAfterDiscount = row.orders_data.reduce((sum, order) => sum + parseFloat(order.total), 0);
                const discountPercentage = row.orders_data[0]?.discount_percentage || 0;

                // --- ✨ ส่วนที่เพิ่มเข้ามาเพื่อคำนวณ VAT ---
                const VAT_RATE = 0.07; // 7% VAT
                const finalTotalWithVAT = totalAfterDiscount * (1 + VAT_RATE);
                // ------------------------------------------

                acc[row.table_name] = {
                    tableName: row.table_name,
                    orders: row.orders_data.flatMap(order => order.items),
                    status: row.table_status,
                    subtotal: subtotal,
                    discountAmount: discountAmount,
                    total: finalTotalWithVAT, // ✨ แก้ไขให้ใช้ยอดสุทธิที่รวม VAT แล้ว
                    discountPercentage: discountPercentage
                };
            }
            return acc;
        }, {});

        res.json({ status: 'success', data: { allTables: allTableNames, occupiedTables: occupiedTablesData } });
    } catch (error) {
        next(error);
    }
};

// POST /api/tables/clear
const clearTable = async (req, res, next) => {
    try {
        const { tableName } = req.body;
        await pool.query("UPDATE orders SET status = 'Paid' WHERE table_name = $1 AND status != 'Paid'", [tableName]);
        await pool.query("UPDATE tables SET status = 'Available' WHERE name = $1", [tableName]);
        req.broadcast({ type: 'tableCleared', tableName });
        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        next(error);
    }
};

// POST /api/tables/apply-discount
const applyDiscount = async (req, res, next) => {
    try {
        const { tableName, discountPercentage } = req.body;
        const discountedByUser = req.user.username;
        const ordersResult = await pool.query("SELECT id, subtotal FROM orders WHERE table_name = $1 AND status != 'Paid'",[tableName]);
        if (ordersResult.rowCount === 0) return res.status(404).json({ status: 'error', message: 'No active orders for this table.' });
        
        for (const order of ordersResult.rows) {
            const subtotal = parseFloat(order.subtotal);
            const discountAmount = subtotal * (discountPercentage / 100);
            const newTotal = subtotal - discountAmount;
            await pool.query('UPDATE orders SET discount_percentage = $1, discount_amount = $2, total = $3, discount_by = $4 WHERE id = $5', [discountPercentage, discountAmount, newTotal, discountedByUser, order.id]);
        }
        req.broadcast({ type: 'discountApplied', tableName });
        res.json({ status: 'success', message: `Discount of ${discountPercentage}% applied.` });
    } catch (error) {
        next(error);
    }
};

// GET /api/tables/management (for admin setup)
const getAllTablesForManagement = async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, name, sort_order FROM tables ORDER BY sort_order ASC, name ASC');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
};

// POST /api/tables/management
const createTable = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { name, sort_order } = req.body;
        const result = await pool.query('INSERT INTO tables (name, sort_order) VALUES ($1, $2) RETURNING *', [name, sort_order || 99]);
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// GET /api/tables/status/:tableName
const getTableStatus = async (req, res, next) => {
    try {
        const { tableName } = req.params;
        const result = await pool.query(
            "SELECT * FROM orders WHERE table_name = $1 AND status != 'Paid' ORDER BY created_at DESC",
            [tableName]
        );
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
};

// POST /api/tables/request-bill
const requestBill = async (req, res, next) => {
    try {
        const { tableName } = req.body;
        if (!tableName) {
            return res.status(400).json({ status: 'error', message: 'Table name is required.' });
        }
        
        await pool.query(
            "UPDATE tables SET status = 'Billing' WHERE name = $1",
            [tableName]
        );
        
        req.broadcast({ type: 'tableStatusUpdate', payload: { tableName, newStatus: 'Billing' } });

        res.json({ status: 'success', message: `Table ${tableName} status updated to Billing.` });
    } catch (error) {
        next(error);
    }
};

const reorderTables = async (req, res, next) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ status: 'error', message: 'Invalid order data provided.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatePromises = order.map((id, index) => {
            return client.query('UPDATE tables SET sort_order = $1 WHERE id = $2', [index, id]);
        });
        await Promise.all(updatePromises);
        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Tables reordered successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
};

const updateTable = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, sort_order } = req.body;
        const result = await pool.query(
            'UPDATE tables SET name = $1, sort_order = $2 WHERE id = $3 RETURNING *',
            [name, sort_order, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Table not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteTable = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM tables WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Table not found.' });
        res.json({ status: 'success', message: 'Table deleted successfully.' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTableData,
    clearTable,
    applyDiscount,
    getAllTablesForManagement,
    createTable,
    getTableStatus,
    requestBill,
    reorderTables,
    updateTable,
    deleteTable
};