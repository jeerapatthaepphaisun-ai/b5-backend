const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const tableController = require('../controllers/tableController');
const { authenticateToken } = require('../middleware/auth');

// --- Routes for Customer Menu ---
// GET /api/tables/status/:tableName - ให้ลูกค้าดูสถานะออเดอร์ของโต๊ะตัวเอง
router.get('/status/:tableName', tableController.getTableStatus);

// POST /api/tables/request-bill - ให้ลูกค้ากดเรียกเก็บเงิน
router.post('/request-bill', tableController.requestBill);


// --- Routes for Cashier POS ---
// GET /api/tables/ - หน้าหลักแคชเชียร์ ดูสถานะโต๊ะทั้งหมด
router.get('/', authenticateToken('cashier', 'admin'), tableController.getTableData);

// POST /api/tables/clear - เคลียร์โต๊ะหลังชำระเงิน
router.post('/clear', authenticateToken('cashier', 'admin'), tableController.clearTable);

// POST /api/tables/apply-discount - ใช้ส่วนลดกับโต๊ะ
router.post('/apply-discount', authenticateToken('cashier', 'admin'), tableController.applyDiscount);


// --- Routes for Admin Panel (Table Management) ---
// GET /api/tables/management - ดึงข้อมูลโต๊ะทั้งหมดสำหรับหน้าจัดการ
router.get('/management', authenticateToken('admin'), tableController.getAllTablesForManagement);

// POST /api/tables/management - สร้างโต๊ะใหม่
router.post('/management', authenticateToken('admin'), [
    body('name').notEmpty().withMessage('Table name is required')
], tableController.createTable);

// TODO: Add routes for reorder, update, delete for table management here.
// router.put('/management/reorder', authenticateToken('admin'), tableController.reorderTables);
// router.put('/management/:id', authenticateToken('admin'), tableController.updateTable);
// router.delete('/management/:id', authenticateToken('admin'), tableController.deleteTable);


module.exports = router;