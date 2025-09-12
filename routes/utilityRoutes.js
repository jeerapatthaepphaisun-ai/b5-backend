const express = require('express');
const router = express.Router();
const multer = require('multer');
const utilityController = require('../controllers/utilityController');
const { authenticateToken } = require('../middleware/auth');

// Setup multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload-image', authenticateToken('admin'), upload.single('menuImage'), utilityController.uploadImage);

module.exports = router;