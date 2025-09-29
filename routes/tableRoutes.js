// routes/tableRoutes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const tableController = require('../controllers/tableController');
const { authenticateToken } = require('../middleware/auth');
// ✨ 1. Import apiLimiter
const { apiLimiter } = require('../middleware/rateLimiter');

// --- Routes for Customer Menu (No Limiter Needed) ---
router.get('/status/:tableName', tableController.getTableStatus);
router.post('/request-bill', tableController.requestBill);


// --- Routes for Cashier POS (Protected) ---
router.get('/', authenticateToken('cashier', 'admin'), tableController.getTableData);

// ✨ 2. เพิ่ม apiLimiter
router.post('/clear', authenticateToken('cashier', 'admin'), apiLimiter, tableController.clearTable);

// ✨ 2. เพิ่ม apiLimiter
router.post('/apply-discount', authenticateToken('cashier', 'admin'), apiLimiter, tableController.applyDiscount);


// --- Routes for Admin Panel (Table Management - Protected) ---
router.get('/management', authenticateToken('admin'), tableController.getAllTablesForManagement);

// ✨ 2. เพิ่ม apiLimiter
router.post('/management', authenticateToken('admin'), apiLimiter, [
    body('name').notEmpty().withMessage('Table name is required')
], tableController.createTable);

// ✨ 2. เพิ่ม apiLimiter
router.put('/management/reorder', authenticateToken('admin'), apiLimiter, tableController.reorderTables);

// ✨ 2. เพิ่ม apiLimiter
router.put('/management/:id', authenticateToken('admin'), apiLimiter, tableController.updateTable);

// ✨ 2. เพิ่ม apiLimiter
router.delete('/management/:id', authenticateToken('admin'), apiLimiter, tableController.deleteTable);


module.exports = router;