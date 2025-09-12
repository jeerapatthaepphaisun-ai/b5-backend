const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

const userValidation = [
    body('username').notEmpty().withMessage('Username is required'),
    body('role').isIn(['admin', 'cashier', 'kitchen', 'bar']).withMessage('Invalid role specified')
];

const passwordValidation = body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long');
const optionalPasswordValidation = body('password').optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters long');

router.get('/', authenticateToken('admin'), userController.getAllUsers);
router.post('/', authenticateToken('admin'), [...userValidation, passwordValidation], userController.createUser);
router.put('/:id', authenticateToken('admin'), [...userValidation, optionalPasswordValidation], userController.updateUser);
router.delete('/:id', authenticateToken('admin'), userController.deleteUser);

module.exports = router;