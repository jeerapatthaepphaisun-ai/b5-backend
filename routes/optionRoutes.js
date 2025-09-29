// routes/optionRoutes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator'); // ✨ 1. Import 'body'
const optionController = require('../controllers/optionController');
const { authenticateToken } = require('../middleware/auth');
// ✨ 2. Import apiLimiter
const { apiLimiter } = require('../middleware/rateLimiter');

// Protect all routes in this file with Auth and Rate Limiter
router.use(authenticateToken('admin'));
router.use(apiLimiter);


// --- Validation Rules ---
const optionSetValidation = [
    body('name_th').notEmpty().withMessage('Option set name (TH) is required.'),
];
const optionValidation = [
    body('option_set_id').isUUID().withMessage('A valid option_set_id is required.'),
    body('label_th').notEmpty().withMessage('Option label (TH) is required.'),
    body('price_add').isFloat({min: 0}).withMessage('Price must be a non-negative number.'),
];


// --- Routes for Option Sets ---
router.get('/sets', optionController.getAllOptionSets);
// ✨ 3. เพิ่ม Validation
router.post('/sets', optionSetValidation, optionController.createOptionSet);
router.put('/sets/:id', optionSetValidation, optionController.updateOptionSet);
router.delete('/sets/:id', optionController.deleteOptionSet);


// --- Routes for individual Options ---
// ✨ 3. เพิ่ม Validation
router.post('/', optionValidation, optionController.createOption);
router.put('/:id', optionValidation, optionController.updateOption);
router.delete('/:id', optionController.deleteOption);


module.exports = router;