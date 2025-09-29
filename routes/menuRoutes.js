// routes/menuRoutes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const menuController = require('../controllers/menuController');
const { authenticateToken } = require('../middleware/auth');
// ✨ 1. Import apiLimiter
const { apiLimiter } = require('../middleware/rateLimiter');

// Validation middleware for creating/updating menu items
const menuItemValidation = [
    body('name_th').notEmpty().withMessage('กรุณากรอกชื่อเมนู'),
    body('price').isFloat({ gt: 0 }).withMessage('ราคาต้องเป็นตัวเลขและมากกว่า 0'),
    body('category_id').notEmpty().withMessage('กรุณาเลือกหมวดหมู่'),
    body('manage_stock').isBoolean().withMessage('กรุณาระบุสถานะการจัดการสต็อก'),
    body('current_stock').isInt({ min: 0 }).withMessage('สต็อกต้องเป็นเลขจำนวนเต็ม 0 หรือมากกว่า')
];

// --- Public Routes (GET) ---
router.get('/', menuController.getMenu);
router.get('/bar', menuController.getBarMenu);

// --- Admin Routes (Protected by Auth and Rate Limiter) ---
router.get('/stock-alerts', authenticateToken('admin'), menuController.getStockAlerts);

router.post('/items', authenticateToken('admin'), apiLimiter, menuItemValidation, menuController.createMenuItem);

router.get('/items/:id', authenticateToken('admin'), menuController.getMenuItemById);

router.put('/items/reorder', authenticateToken('admin'), apiLimiter, menuController.reorderMenuItems);

router.put('/items/:id', authenticateToken('admin'), apiLimiter, menuItemValidation, menuController.updateMenuItem);

router.delete('/items/:id', authenticateToken('admin'), apiLimiter, menuController.deleteMenuItem);

router.get('/items/:id/option-sets', authenticateToken('admin'), menuController.getOptionSetsForMenuItem);

router.put('/items/:id/option-sets', authenticateToken('admin'), apiLimiter, menuController.updateOptionSetsForMenuItem);

router.get('/stock-items', authenticateToken('admin'), menuController.getStockItems);

router.put('/update-item-stock/:id', authenticateToken('admin'), apiLimiter, [
    body('current_stock').isNumeric().withMessage('Current stock must be a number.')
], menuController.updateItemStock);

module.exports = router;