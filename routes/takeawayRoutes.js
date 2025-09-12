// routes/takeawayRoutes.js
const express = require('express');
const router = express.Router();
const takeawayController = require('../controllers/takeawayController');
const { authenticateToken } = require('../middleware/auth');

// กำหนดเส้นทาง GET / 
// ซึ่งเมื่อรวมกับ prefix ใน server.js จะกลายเป็น /api/takeaway-orders
router.get('/', authenticateToken('cashier', 'admin'), takeawayController.getTakeawayOrders);

module.exports = router;