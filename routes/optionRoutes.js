const express = require('express');
const router = express.Router();
const optionController = require('../controllers/optionController');
const { authenticateToken } = require('../middleware/auth');

// All routes in this file are protected and require admin access
router.use(authenticateToken('admin'));

// Routes for Option Sets
router.get('/sets', optionController.getAllOptionSets);
router.post('/sets', optionController.createOptionSet);
router.put('/sets/:id', optionController.updateOptionSet);
router.delete('/sets/:id', optionController.deleteOptionSet);

// Routes for individual Options
router.post('/', optionController.createOption);
router.put('/:id', optionController.updateOption);
router.delete('/:id', optionController.deleteOption);

module.exports = router;