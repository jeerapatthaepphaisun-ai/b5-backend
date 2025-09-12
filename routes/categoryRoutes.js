// routes/categoryRoutes.js
const express = require('express');
const router = express.Router(); // สร้าง Router ขึ้นมา
const { body } = require('express-validator');

// --- นำเข้า "พ่อครัว" ที่เราสร้างไว้ ---
const categoryController = require('../controllers/categoryController');

// --- นำเข้า "ผู้ช่วย" ที่เราจะสร้างในอนาคต (ตอนนี้ใส่ไว้ก่อน) ---
// หมายเหตุ: เรายังไม่ได้ย้าย authenticateToken มา, แต่เราจะทำในรอบถัดไป
// ตอนนี้ให้คอมเมนต์ไว้ก่อน หรือถ้าคุณทำขั้นตอนย้าย middleware แล้ว ก็เอาคอมเมนต์ออกได้เลย
const { authenticateToken } = require('../middleware/auth');
const apiLimiter = require('express-rate-limit')({ // rateLimit สำหรับไฟล์นี้
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'คุณส่งคำขอมากเกินไป กรุณารอสักครู่',
    standardHeaders: true,
    legacyHeaders: false,
});


// --- กำหนดเส้นทางในเมนู ---

// ถ้ามีคนเรียก GET มาที่ / จะให้พ่อครัว getAllCategories ทำงาน
router.get('/', categoryController.getAllCategories);

// ถ้ามีคนเรียก POST มาที่ / จะให้ authenticateToken ตรวจก่อน แล้วค่อยให้พ่อครัว createCategory ทำงาน
router.post('/',
    authenticateToken('admin'),
    apiLimiter,
    [
        body('name_th', 'กรุณาระบุชื่อหมวดหมู่ (ไทย)').notEmpty().trim(),
        body('sort_order', 'กรุณาระบุลำดับเป็นตัวเลข').isNumeric(),
        body('name_en').optional().trim()
    ],
    categoryController.createCategory
);

router.put('/reorder', authenticateToken('admin'), apiLimiter, categoryController.reorderCategories);

router.put('/:id',
    authenticateToken('admin'),
    apiLimiter,
    [
        body('name_th', 'กรุณาระบุชื่อหมวดหมู่ (ไทย)').notEmpty().trim(),
        body('sort_order', 'กรุณาระบุลำดับเป็นตัวเลข').isNumeric(),
        body('name_en').optional().trim()
    ],
    categoryController.updateCategory
);

router.delete('/:id', authenticateToken('admin'), apiLimiter, categoryController.deleteCategory);

// บรรทัดสำคัญ: ส่งออกเมนูนี้เพื่อให้ server.js รู้จัก
module.exports = router;