const pool = require('../db');
const { validationResult } = require('express-validator');

// GET /api/menu
const getMenu = async (req, res, next) => {
    try {
        const { category, search, page = 1, limit = 1000 } = req.query;

        let baseQuery = `
            FROM menu_items mi
            LEFT JOIN categories c ON mi.category_id = c.id
        `;
        let whereClauses = [];
        let queryParams = [];

        if (category && category !== 'all') {
            queryParams.push(category);
            whereClauses.push(`mi.category_id = $${queryParams.length}`);
        }

        if (search) {
            queryParams.push(`%${search}%`);
            whereClauses.push(`(mi.name_th ILIKE $${queryParams.length} OR mi.name_en ILIKE $${queryParams.length})`);
        }

        if (whereClauses.length > 0) {
            baseQuery += ' WHERE ' + whereClauses.join(' AND ');
        }

        const totalResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, queryParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

        const offset = (page - 1) * limit;
        queryParams.push(limit);
        queryParams.push(offset);

        const menuQuery = `
            SELECT mi.*, c.name_th as category_th, c.name_en as category_en
            ${baseQuery}
            ORDER BY c.sort_order ASC, mi.sort_order ASC, mi.name_th ASC
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length};
        `;

        const menuResult = await pool.query(menuQuery, queryParams);
        let menuItems = menuResult.rows;

        // Code to attach options remains the same as original...
        if (menuItems.length > 0) {
            const optionsResult = await pool.query('SELECT * FROM menu_options;');
            const optionsMap = optionsResult.rows.reduce((map, row) => {
                const { option_set_id, id, label_th, label_en, price_add } = row;
                if (!map[option_set_id]) map[option_set_id] = [];
                map[option_set_id].push({ option_id: id, label_th, label_en, price_add: parseFloat(price_add) });
                return map;
            }, {});

            const menuOptionsLinkResult = await pool.query('SELECT * FROM menu_item_option_sets;');
            const menuOptionsLink = menuOptionsLinkResult.rows.reduce((map, row) => {
                if (!map[row.menu_item_id]) map[row.menu_item_id] = [];
                map[row.menu_item_id].push(row.option_set_id);
                return map;
            }, {});

            menuItems = menuItems.map(item => {
                const optionSetIds = menuOptionsLink[item.id] || [];
                item.option_groups = optionSetIds.reduce((groups, id) => {
                    if (optionsMap[id]) groups[id] = optionsMap[id];
                    return groups;
                }, {});
                return item;
            });
        }

        res.json({
            status: 'success',
            data: {
                items: menuItems,
                totalItems,
                totalPages,
                currentPage: parseInt(page, 10)
            }
        });
    } catch (error) {
        next(error);
    }
};

// POST /api/menu-items
const createMenuItem = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, current_stock, manage_stock } = req.body;
        
        const query = `
            INSERT INTO menu_items (name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, current_stock, manage_stock)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status || 'in_stock', discount_percentage || 0, current_stock || 0, manage_stock || false];
        const result = await pool.query(query, values);
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// GET /api/menu-items/:id
const getMenuItemById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM menu_items WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// PUT /api/menu-items/reorder
const reorderMenuItems = async (req, res, next) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ status: 'error', message: 'Invalid order data provided.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatePromises = order.map((id, index) => {
            return client.query('UPDATE menu_items SET sort_order = $1 WHERE id = $2', [index, id]);
        });
        await Promise.all(updatePromises);
        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Menu items reordered successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
};

// PUT /api/menu-items/:id
const updateMenuItem = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, current_stock, manage_stock } = req.body;

        let finalStockStatus = stock_status;
        if (manage_stock && current_stock > 0) finalStockStatus = 'in_stock';
        
        const query = `
            UPDATE menu_items
            SET name_th = $1, price = $2, category_id = $3, name_en = $4, desc_th = $5, desc_en = $6, image_url = $7, stock_status = $8, discount_percentage = $9, current_stock = $10, manage_stock = $11
            WHERE id = $12 RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, finalStockStatus, discount_percentage, current_stock, manage_stock, id];
        const result = await pool.query(query, values);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// DELETE /api/menu-items/:id
const deleteMenuItem = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        res.json({ status: 'success', message: 'Menu item deleted successfully.' });
    } catch (error) {
        next(error);
    }
};

// GET /api/stock-items
const getStockItems = async (req, res, next) => {
    try {
        const query = `
            SELECT id, name_th, current_stock
            FROM menu_items
            WHERE manage_stock = true
            ORDER BY name_th ASC;
        `;
        const result = await pool.query(query);
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
};

// PUT /api/update-item-stock/:id
const updateItemStock = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { current_stock } = req.body;

        const newStock = parseInt(current_stock, 10);
        const newStatus = newStock > 0 ? 'in_stock' : 'out_of_stock';

        const result = await pool.query(
            'UPDATE menu_items SET current_stock = $1, stock_status = $2 WHERE id = $3 RETURNING id, name_th, current_stock, stock_status',
            [newStock, newStatus, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        }

        // --- ✨ ส่วนที่เพิ่มเข้ามาใหม่ ---
        // Broadcast การอัปเดตสต็อก
        req.broadcast({
            type: 'stockUpdate',
            payload: [{
                id: result.rows[0].id,
                current_stock: result.rows[0].current_stock,
                stock_status: result.rows[0].stock_status
            }]
        });
        // --- จบส่วนที่เพิ่มเข้ามาใหม่ ---

        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};


module.exports = {
    getMenu,
    createMenuItem,
    getMenuItemById,
    reorderMenuItems,
    updateMenuItem,
    deleteMenuItem,
    getStockItems,
    updateItemStock
};