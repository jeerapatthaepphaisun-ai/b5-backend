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

// Validation for a required password (for creating users)
const passwordValidation = body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long');

// Validation for an optional password (for updating users)
const optionalPasswordValidation = body('password').optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters long');

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