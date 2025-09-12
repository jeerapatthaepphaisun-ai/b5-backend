// controllers/categoryController.js
const pool = require('../db'); // เรียกใช้การเชื่อมต่อ DB จากไฟล์ที่เราสร้าง
const { validationResult } = require('express-validator');

//  logika pro získání všech kategorií
const getAllCategories = async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC');
        res.json({ status: 'success', data: result.rows });
    } catch(error) {
        next(error);
    }
};

// logika pro vytvoření nové kategorie
const createCategory = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { name_th, name_en, sort_order } = req.body;
        const result = await pool.query(
            'INSERT INTO categories (name_th, name_en, sort_order) VALUES ($1, $2, $3) RETURNING *',
            [name_th, name_en, sort_order]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// logika pro změnu pořadí kategorií
const reorderCategories = async (req, res, next) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ status: 'error', message: 'Invalid order data provided.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatePromises = order.map((id, index) => {
            return client.query('UPDATE categories SET sort_order = $1 WHERE id = $2', [index, id]);
        });
        await Promise.all(updatePromises);
        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Categories reordered successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
};

// logika pro aktualizaci kategorie
const updateCategory = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { id } = req.params;
        const { name_th, name_en, sort_order } = req.body;
        const result = await pool.query(
            'UPDATE categories SET name_th = $1, name_en = $2, sort_order = $3 WHERE id = $4 RETURNING *',
            [name_th, name_en, sort_order, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Category not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// logika pro smazání kategorie
const deleteCategory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Category not found.' });
        res.json({ status: 'success', message: 'Category deleted successfully.' });
    } catch (error) {
        next(error);
    }
};

// บรรทัดสำคัญ: ส่งออกทุกฟังก์ชันเพื่อให้ไฟล์อื่นเรียกใช้ได้
module.exports = {
    getAllCategories,
    createCategory,
    reorderCategories,
    updateCategory,
    deleteCategory
};