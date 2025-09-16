const pool = require('../db');

// --- Option Set Management ---

// GET /api/options/sets
const getAllOptionSets = async (req, res, next) => {
    try {
        const query = `
            SELECT
                os.id,
                os.name_th,
                os.name_en,
                os.name_km,
                os.name_zh,
                COALESCE(json_agg(
                    json_build_object(
                        'id', o.id,
                        'label_th', o.label_th,
                        'label_en', o.label_en,
                        'label_km', o.label_km,
                        'label_zh', o.label_zh,
                        'price_add', o.price_add
                    ) ORDER BY o.created_at
                ) FILTER (WHERE o.id IS NOT NULL), '[]') as options
            FROM option_sets os
            LEFT JOIN menu_options o ON os.id = o.option_set_id
            GROUP BY os.id
            ORDER BY os.created_at;
        `;
        const result = await pool.query(query);
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
};

// POST /api/options/sets
const createOptionSet = async (req, res, next) => {
    try {
        const { name_th, name_en, name_km, name_zh } = req.body;
        const result = await pool.query(
            'INSERT INTO option_sets (name_th, name_en, name_km, name_zh) VALUES ($1, $2, $3, $4) RETURNING *',
            [name_th, name_en, name_km, name_zh]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// PUT /api/options/sets/:id
const updateOptionSet = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name_th, name_en, name_km, name_zh } = req.body;
        const result = await pool.query(
            'UPDATE option_sets SET name_th = $1, name_en = $2, name_km = $3, name_zh = $4 WHERE id = $5 RETURNING *',
            [name_th, name_en, name_km, name_zh, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Option set not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// DELETE /api/options/sets/:id
const deleteOptionSet = async (req, res, next) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Delete all options within the set first
        await client.query('DELETE FROM menu_options WHERE option_set_id = $1', [id]);
        // Then delete the set itself
        const result = await client.query('DELETE FROM option_sets WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            throw new Error('Option set not found.');
        }
        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Option set and its options deleted successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.message === 'Option set not found.') {
            return res.status(404).json({ status: 'error', message: error.message });
        }
        next(error);
    } finally {
        client.release();
    }
};

// --- Menu Option Management ---

// POST /api/options
const createOption = async (req, res, next) => {
    try {
        const { option_set_id, label_th, label_en, label_km, label_zh, price_add } = req.body;
        const result = await pool.query(
            'INSERT INTO menu_options (option_set_id, label_th, label_en, label_km, label_zh, price_add) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [option_set_id, label_th, label_en, label_km, label_zh, price_add || 0]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// PUT /api/options/:id
const updateOption = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { label_th, label_en, label_km, label_zh, price_add } = req.body;
        const result = await pool.query(
            'UPDATE menu_options SET label_th = $1, label_en = $2, label_km = $3, label_zh = $4, price_add = $5 WHERE id = $6 RETURNING *',
            [label_th, label_en, label_km, label_zh, price_add, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Option not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// DELETE /api/options/:id
const deleteOption = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM menu_options WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Option not found.' });
        res.json({ status: 'success', message: 'Option deleted successfully.' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAllOptionSets,
    createOptionSet,
    updateOptionSet,
    deleteOptionSet,
    createOption,
    updateOption,
    deleteOption
};