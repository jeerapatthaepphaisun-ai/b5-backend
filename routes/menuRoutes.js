const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const menuController = require('../controllers/menuController');
const { authenticateToken } = require('../middleware/auth');

// Validation middleware for creating/updating menu items
const menuItemValidation = [
    body('name_th').notEmpty().withMessage('กรุณากรอกชื่อเมนู'),
    body('price').isFloat({ gt: 0 }).withMessage('ราคาต้องเป็นตัวเลขและมากกว่า 0'),
    body('category_id').notEmpty().withMessage('กรุณาเลือกหมวดหมู่'),
    body('manage_stock').isBoolean().withMessage('กรุณาระบุสถานะการจัดการสต็อก'),
    body('current_stock').isInt({ min: 0 }).withMessage('สต็อกต้องเป็นเลขจำนวนเต็ม 0 หรือมากกว่า')
];

// GET /api/menu (Public facing menu)
router.get('/', menuController.getMenu);

// POST /api/menu/items (Create new menu item)
router.post('/items', authenticateToken('admin'), menuItemValidation, menuController.createMenuItem);

// GET /api/menu/items/:id (Get single menu item for editing)
router.get('/items/:id', authenticateToken('admin'), menuController.getMenuItemById);

// PUT /api/menu/items/reorder
router.put('/items/reorder', authenticateToken('admin'), menuController.reorderMenuItems);

// PUT /api/menu/items/:id (Update a menu item)
router.put('/items/:id', authenticateToken('admin'), menuItemValidation, menuController.updateMenuItem);

// DELETE /api/menu/items/:id (Delete a menu item)
router.delete('/items/:id', authenticateToken('admin'), menuController.deleteMenuItem);

// GET /api/menu/stock-items
router.get('/stock-items', authenticateToken('admin'), menuController.getStockItems);

// PUT /api/menu/update-item-stock/:id
router.put('/update-item-stock/:id', authenticateToken('admin'), [
    body('current_stock').isNumeric().withMessage('Current stock must be a number.')
], menuController.updateItemStock);

module.exports = router;