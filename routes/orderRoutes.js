const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, decodeTokenOptional } = require('../middleware/auth');

// POST /api/orders
router.post('/', decodeTokenOptional, orderController.createOrder);

// GET /api/orders (For KDS)
router.get('/', authenticateToken('kitchen', 'bar', 'admin'), orderController.getOrdersByStation);

// POST /api/orders/update-status
router.post('/update-status', authenticateToken('kitchen', 'bar', 'admin'), orderController.updateOrderStatus);

module.exports = router;