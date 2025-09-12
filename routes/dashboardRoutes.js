const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken('admin'), dashboardController.getDashboardData);
router.get('/kds', authenticateToken('admin'), dashboardController.getKdsDashboardData);

module.exports = router;