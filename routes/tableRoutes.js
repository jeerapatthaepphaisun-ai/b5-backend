const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const tableController = require('../controllers/tableController');
const { authenticateToken } = require('../middleware/auth');

// Cashier-facing routes
router.get('/', authenticateToken('cashier', 'admin'), tableController.getTableData);
router.post('/clear', authenticateToken('cashier', 'admin'), tableController.clearTable);
router.post('/apply-discount', authenticateToken('cashier', 'admin'), tableController.applyDiscount);

// Admin-facing table management routes
router.get('/management', authenticateToken('admin'), tableController.getAllTablesForManagement);
router.post('/management', authenticateToken('admin'), [
    body('name').notEmpty().withMessage('Table name is required')
], tableController.createTable);
// ... (add routes for reorder, update, delete here)

module.exports = router;