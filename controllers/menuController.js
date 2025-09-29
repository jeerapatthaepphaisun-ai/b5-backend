// controllers/menuController.js
const pool = require('../db');
const { validationResult } = require('express-validator');

// ✨ --- START: สร้างฟังก์ชัน Helper กลาง --- ✨
// ฟังก์ชันนี้จะรับผิดชอบการดึงข้อมูลเมนูพร้อมตัวเลือกเสริมทั้งหมดใน Query เดียว
const fetchMenuItemsWithDetails = async (baseQuery, queryParams) => {
    const menuQuery = `
        SELECT
            mi.*,
            c.name_th as category_th,
            c.name_en as category_en,
            COALESCE(
                (SELECT json_agg(
                    json_build_object(
                        'option_set_id', os.id,
                        'option_set_name_th', os.name_th,
                        'option_set_name_en', os.name_en,
                        'options', COALESCE((
                            SELECT json_agg(
                                json_build_object(
                                    'option_id', mo.id,
                                    'label_th', mo.label_th,
                                    'label_en', mo.label_en,
                                    'label_km', mo.label_km,
                                    'label_zh', mo.label_zh,
                                    'price_add', mo.price_add
                                ) ORDER BY mo.created_at
                            )
                            FROM menu_options mo WHERE mo.option_set_id = os.id
                        ), '[]'::json)
                    ) ORDER BY os.created_at
                )
                FROM menu_item_option_sets mios
                JOIN option_sets os ON mios.option_set_id = os.id
                WHERE mios.menu_item_id = mi.id
            ), '[]'::json) as option_groups
        ${baseQuery}
        GROUP BY mi.id, c.name_th, c.name_en, c.sort_order
        ORDER BY c.sort_order ASC, mi.sort_order ASC, mi.name_th ASC
    `;

    const menuResult = await pool.query(menuQuery, queryParams);
    return menuResult.rows;
};
// ✨ --- END: สร้างฟังก์ชัน Helper กลาง --- ✨


// GET /api/menu
const getMenu = async (req, res, next) => {
    try {
        const { category, search, page = 1, limit = 1000 } = req.query;

        let baseQuery = `
            FROM menu_items mi
            LEFT JOIN categories c ON mi.category_id = c.id
        `;
        let whereClauses = ["mi.category_id IS NOT NULL"];
        let queryParams = [];

        if (category && category !== 'all') {
            queryParams.push(category);
            whereClauses.push(`c.id = $${queryParams.length}`);
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
        
        baseQuery += ` LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;

        const menuItems = await fetchMenuItemsWithDetails(baseQuery, queryParams);

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

const getBarMenu = async (req, res, next) => {
    try {
        const { search } = req.query;
        let queryParams = ['bar'];
        let whereClauses = ["c.station_type = $1", "mi.category_id IS NOT NULL"];

        if (search) {
            queryParams.push(`%${search}%`);
            whereClauses.push(`(mi.name_th ILIKE $${queryParams.length} OR mi.name_en ILIKE $${queryParams.length})`);
        }

        const baseQuery = `
            FROM menu_items mi
            JOIN categories c ON mi.category_id = c.id
            WHERE ${whereClauses.join(' AND ')}
        `;

        const menuItems = await fetchMenuItemsWithDetails(baseQuery, queryParams);

        res.json({
            status: 'success',
            data: {
                items: menuItems
            }
        });

    } catch (error) {
        next(error);
    }
};

const createMenuItem = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name_th, price, category_id, name_en, desc_th, desc_en, name_km, name_zh, desc_km, desc_zh, image_url, stock_status, discount_percentage, current_stock, manage_stock } = req.body;
        
        const query = `
            INSERT INTO menu_items (name_th, price, category_id, name_en, desc_th, desc_en, name_km, name_zh, desc_km, desc_zh, image_url, stock_status, discount_percentage, current_stock, manage_stock)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, name_km, name_zh, desc_km, desc_zh, image_url, stock_status || 'in_stock', discount_percentage || 0, current_stock || 0, manage_stock || false];
        const result = await pool.query(query, values);
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

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

const updateMenuItem = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { name_th, price, category_id, name_en, desc_th, desc_en, name_km, name_zh, desc_km, desc_zh, image_url, stock_status, discount_percentage, current_stock, manage_stock } = req.body;

        let finalStockStatus = stock_status;
        if (manage_stock && current_stock > 0) finalStockStatus = 'in_stock';
        
        const query = `
            UPDATE menu_items
            SET name_th = $1, price = $2, category_id = $3, name_en = $4, desc_th = $5, desc_en = $6, 
                name_km = $7, name_zh = $8, desc_km = $9, desc_zh = $10, 
                image_url = $11, stock_status = $12, discount_percentage = $13, current_stock = $14, manage_stock = $15
            WHERE id = $16 RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, name_km, name_zh, desc_km, desc_zh, image_url, finalStockStatus, discount_percentage, current_stock, manage_stock, id];
        const result = await pool.query(query, values);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

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

        req.broadcast({
            type: 'stockUpdate',
            payload: [{
                id: result.rows[0].id,
                current_stock: result.rows[0].current_stock,
                stock_status: result.rows[0].stock_status
            }]
        });

        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const getStockAlerts = async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, name_th, current_stock FROM menu_items 
             WHERE manage_stock = true AND stock_status = 'in_stock' AND current_stock < 10 
             ORDER BY current_stock ASC`
        );
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
};

const getOptionSetsForMenuItem = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT option_set_id FROM menu_item_option_sets WHERE menu_item_id = $1',
            [id]
        );
        const selectedIds = result.rows.map(row => row.option_set_id);
        res.json({ status: 'success', data: selectedIds });
    } catch (error) {
        next(error);
    }
};

const updateOptionSetsForMenuItem = async (req, res, next) => {
    const { id } = req.params;
    const { optionSetIds } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM menu_item_option_sets WHERE menu_item_id = $1', [id]);

        if (optionSetIds && optionSetIds.length > 0) {
            const insertPromises = optionSetIds.map(setId => {
                return client.query(
                    'INSERT INTO menu_item_option_sets (menu_item_id, option_set_id) VALUES ($1, $2)',
                    [id, setId]
                );
            });
            await Promise.all(insertPromises);
        }

        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Menu item options updated successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
};

module.exports = {
    getMenu,
    getBarMenu,
    createMenuItem,
    getMenuItemById,
    reorderMenuItems,
    updateMenuItem,
    deleteMenuItem,
    getStockItems,
    updateItemStock,
    getStockAlerts,
    getOptionSetsForMenuItem,
    updateOptionSetsForMenuItem
};