const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const rateLimit = require('express-rate-limit');

const JWT_SECRET = process.env.JWT_SECRET;

// Rate Limiter for Login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'คุณพยายามล็อกอินมากเกินไป กรุณาลองใหม่อีกครั้งใน 15 นาที',
    standardHeaders: true,
    legacyHeaders: false,
});

const login = async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ status: 'error', message: 'กรุณากรอก Username และ Password' });
        }

        // --- จุดที่แก้ไข ---
        // เปลี่ยนจาก SELECT * เป็นการระบุคอลัมน์ที่ต้องการโดยตรง
        // เพื่อแก้ปัญหา 500 Internal Server Error และเพิ่มความปลอดภัย
        const result = await pool.query(
            'SELECT username, role, password_hash FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );
        const user = result.rows[0];

        if (user) {
            const match = await bcrypt.compare(password, user.password_hash);
            if (match) {
                // ตรวจสอบ Role ที่มีสิทธิ์เข้าใช้งานระบบ Cashier
                if (user.role !== 'admin' && user.role !== 'cashier') {
                    return res.status(403).json({ status: 'error', message: 'คุณไม่มีสิทธิ์เข้าใช้งานระบบนี้' });
                }
                
                const payload = { username: user.username, role: user.role };
                const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
                res.json({ status: 'success', message: 'Login successful!', token });
            } else {
                res.status(401).json({ status: 'error', message: 'Username หรือ Password ไม่ถูกต้อง' });
            }
        } else {
            res.status(401).json({ status: 'error', message: 'Username หรือ Password ไม่ถูกต้อง' });
        }
    } catch (error) {
        next(error); // ส่ง error ไปให้ error handler จัดการ
    }
};

module.exports = {
    login,
    loginLimiter
};