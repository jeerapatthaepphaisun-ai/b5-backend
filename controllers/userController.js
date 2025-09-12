const pool = require('../db');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');

const SALT_ROUNDS = 10;

// GET /api/users
const getAllUsers = async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, username, role, full_name FROM users ORDER BY username');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
};

// POST /api/users
const createUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { username, password, role, full_name } = req.body;
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, role, full_name) VALUES ($1, $2, $3, $4) RETURNING id, username, role, full_name',
            [username, password_hash, role, full_name]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// PUT /api/users/:id
const updateUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { role, password, full_name } = req.body;

        let query = 'UPDATE users SET role = $1, full_name = $2';
        const queryParams = [role, full_name, id];

        if (password && password.trim() !== '') {
            const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
            query += ', password_hash = $4 WHERE id = $5 RETURNING id';
            queryParams.splice(2, 0, password_hash); // Insert hash at index 2
            queryParams[4] = id; // id is now the 5th parameter
        } else {
            query += ' WHERE id = $3 RETURNING id';
        }

        const result = await pool.query(query, queryParams);
         if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'User not found.' });
        res.json({ status: 'success', message: 'User updated successfully.' });
    } catch (error) {
        next(error);
    }
};

// DELETE /api/users/:id
const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'User not found.' });
        res.json({ status: 'success', message: 'User deleted successfully.' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAllUsers,
    createUser,
    updateUser,
    deleteUser
};