const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

const categoryController = require('../controllers/categoryController');
const { authenticateToken } = require('../middleware/auth');

// Define rate limiter for these specific routes
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'คุณส่งคำขอมากเกินไป กรุณารอสักครู่',
    standardHeaders: true,
    legacyHeaders: false,
});

// Validation rules for category
const categoryValidation = [
    body('name_th', 'กรุณาระบุชื่อหมวดหมู่ (ไทย)').notEmpty().trim(),
    body('sort_order', 'กรุณาระบุลำดับเป็นตัวเลข').isNumeric(),
    body('name_en').optional().trim()
];

// --- Define Routes ---

// GET /api/categories - Public route, no auth needed
router.get('/', categoryController.getAllCategories);

// GET /api/categories/by-station - For KDS, requires auth (Route ที่เพิ่มเข้ามาใหม่)
router.get('/by-station', authenticateToken('kitchen', 'bar', 'admin'), categoryController.getCategoriesByStation);

// POST /api/categories - Admin only
router.post('/', authenticateToken('admin'), apiLimiter, categoryValidation, categoryController.createCategory);

// PUT /api/categories/reorder - Admin only
router.put('/reorder', authenticateToken('admin'), apiLimiter, categoryController.reorderCategories);

// PUT /api/categories/:id - Admin only
router.put('/:id', authenticateToken('admin'), apiLimiter, categoryValidation, categoryController.updateCategory);

// DELETE /api/categories/:id - Admin only
router.delete('/:id', authenticateToken('admin'), apiLimiter, categoryController.deleteCategory);

module.exports = router;