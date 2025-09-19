const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, decodeTokenOptional } = require('../middleware/auth');

// POST /api/orders (สร้างออเดอร์ใหม่)
router.post('/', decodeTokenOptional, orderController.createOrder);

// POST /api/orders/update-status (อัปเดตสถานะ)
router.post('/update-status', authenticateToken('kitchen', 'bar', 'admin'), orderController.updateOrderStatus);

// GET /api/orders (เส้นทางเก่าสำหรับ KDS)
router.get('/', authenticateToken('kitchen', 'bar', 'admin'), orderController.getOrdersByStation);

// GET /api/orders/kds (เส้นทางใหม่สำหรับ KDS)
router.get('/kds', authenticateToken('kitchen', 'bar', 'admin'), orderController.getKdsOrders);

// POST /api/orders/undo-payment (Route ใหม่สำหรับ Undo)
router.post('/undo-payment', authenticateToken('cashier', 'admin'), orderController.undoPayment);

module.exports = router;