// routes/utilityRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const utilityController = require('../controllers/utilityController');
const { authenticateToken } = require('../middleware/auth');

// Setup multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload-image', authenticateToken('admin'), upload.single('menuImage'), utilityController.uploadImage);

// Endpoint นี้ไม่ต้องมีการยืนยันตัวตน (authenticateToken) เพราะเราต้องการให้ UptimeRobot เข้าถึงได้
router.get('/health', utilityController.healthCheck);

module.exports = router;