// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

// Validation rules for creating a user (username is required)
const createUserValidation = [
    body('username').notEmpty().withMessage('Username is required'),
    body('role').isIn(['admin', 'cashier', 'kitchen', 'bar']).withMessage('Invalid role specified')
];

// Validation rules for updating a user (username is not required)
const updateUserValidation = [
    body('role').isIn(['admin', 'cashier', 'kitchen', 'bar']).withMessage('Invalid role specified')
];

// --- เพิ่ม Regex สำหรับตรวจสอบรหัสผ่าน ---
const passwordComplexityRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const passwordErrorMessage = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว, ประกอบด้วยตัวพิมพ์เล็ก, พิมพ์ใหญ่, ตัวเลข, และอักขระพิเศษ (@$!%*?&)';

// Validation for a required password (for creating users)
const passwordValidation = body('password')
    .isLength({ min: 8 }).withMessage('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร')
    .matches(passwordComplexityRegex).withMessage(passwordErrorMessage);

// Validation for an optional password (for updating users)
const optionalPasswordValidation = body('password')
    .optional({ checkFalsy: true }) // .optional() ทำให้ field นี้ไม่จำเป็นต้องมีค่า
    .isLength({ min: 8 }).withMessage('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร')
    .matches(passwordComplexityRegex).withMessage(passwordErrorMessage);

// --- Define Routes ---

// GET all users
router.get('/', authenticateToken('admin'), userController.getAllUsers);

// POST a new user (uses createUserValidation)
router.post('/', authenticateToken('admin'), [...createUserValidation, passwordValidation], userController.createUser);

// PUT (update) a user by ID (uses updateUserValidation)
router.put('/:id', authenticateToken('admin'), [...updateUserValidation, optionalPasswordValidation], userController.updateUser);

// DELETE a user by ID
router.delete('/:id', authenticateToken('admin'), userController.deleteUser);

module.exports = router;