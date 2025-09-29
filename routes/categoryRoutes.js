// routes/categoryRoutes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const categoryController = require('../controllers/categoryController');
const { authenticateToken } = require('../middleware/auth');
// ✨ 1. เปลี่ยนไปใช้ apiLimiter ตัวกลาง
const { apiLimiter } = require('../middleware/rateLimiter');

// Validation rules for category
const categoryValidation = [
    body('name_th', 'กรุณาระบุชื่อหมวดหมู่ (ไทย)').notEmpty().trim(),
    body('sort_order', 'กรุณาระบุลำดับเป็นตัวเลข').isNumeric(),
    body('name_en').optional().trim()
];

// --- Define Routes ---
router.get('/', categoryController.getAllCategories);

router.get('/by-station', authenticateToken('kitchen', 'bar', 'admin'), categoryController.getCategoriesByStation);

// ✨ 2. ใช้ apiLimiter ที่ import มา
router.post('/', authenticateToken('admin'), apiLimiter, categoryValidation, categoryController.createCategory);

router.put('/reorder', authenticateToken('admin'), apiLimiter, categoryController.reorderCategories);

router.put('/:id', authenticateToken('admin'), apiLimiter, categoryValidation, categoryController.updateCategory);

router.delete('/:id', authenticateToken('admin'), apiLimiter, categoryController.deleteCategory);

module.exports = router;