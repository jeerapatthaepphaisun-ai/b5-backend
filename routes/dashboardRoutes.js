// routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/auth');
// ✨ 1. Import apiLimiter
const { apiLimiter } = require('../middleware/rateLimiter');

// ✨ 2. ใช้ .use() เพื่อให้ apiLimiter ทำงานกับทุก Route ในไฟล์นี้
router.use(apiLimiter);

router.get('/', authenticateToken('admin'), dashboardController.getDashboardData);
router.get('/kds', authenticateToken('admin'), dashboardController.getKdsDashboardData);

module.exports = router;