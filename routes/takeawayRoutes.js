// routes/takeawayRoutes.js
const express = require('express');
const router = express.Router();
const takeawayController = require('../controllers/takeawayController');
const { authenticateToken } = require('../middleware/auth');

// GET /api/takeaway-orders - สำหรับ Cashier POS
router.get('/', authenticateToken('cashier', 'admin'), takeawayController.getTakeawayOrders);

// POST /api/takeaway-orders/clear - สำหรับ Cashier POS
router.post('/clear', authenticateToken('cashier', 'admin'), takeawayController.clearTakeawayOrder);

// GET /api/takeaway-orders/next-bar-number - สำหรับ Bar POS (เนื่องจากเป็น Logic คล้ายกันจึงจัด Route ไว้ด้วยกัน)
router.get('/next-bar-number', authenticateToken('bar', 'admin'), takeawayController.getNextBarNumber);

module.exports = router;