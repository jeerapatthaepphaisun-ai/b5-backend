// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');
// ✨ 1. Import apiLimiter
const { apiLimiter } = require('../middleware/rateLimiter');

const createUserValidation = [
    body('username').notEmpty().withMessage('Username is required'),
    body('role').isIn(['admin', 'cashier', 'kitchen', 'bar']).withMessage('Invalid role specified')
];

const updateUserValidation = [
    body('role').isIn(['admin', 'cashier', 'kitchen', 'bar']).withMessage('Invalid role specified')
];

const passwordComplexityRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const passwordErrorMessage = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว, ประกอบด้วยตัวพิมพ์เล็ก, พิมพ์ใหญ่, ตัวเลข, และอักขระพิเศษ (@$!%*?&)';

const passwordValidation = body('password')
    .isLength({ min: 8 }).withMessage('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร')
    .matches(passwordComplexityRegex).withMessage(passwordErrorMessage);

const optionalPasswordValidation = body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: 8 }).withMessage('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร')
    .matches(passwordComplexityRegex).withMessage(passwordErrorMessage);


// --- Define Routes ---
router.get('/', authenticateToken('admin'), userController.getAllUsers);

// ✨ 2. เพิ่ม apiLimiter
router.post('/', authenticateToken('admin'), apiLimiter, [...createUserValidation, passwordValidation], userController.createUser);

// ✨ 2. เพิ่ม apiLimiter
router.put('/:id', authenticateToken('admin'), apiLimiter, [...updateUserValidation, optionalPasswordValidation], userController.updateUser);

// ✨ 2. เพิ่ม apiLimiter
router.delete('/:id', authenticateToken('admin'), apiLimiter, userController.deleteUser);

module.exports = router;