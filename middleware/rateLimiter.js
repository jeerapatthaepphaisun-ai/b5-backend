// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Limiter ทั่วไปสำหรับ API ส่วนใหญ่
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 นาที
    max: 100, // จำกัดให้แต่ละ IP สามารถยิง API ได้ 100 ครั้งใน 15 นาที
    message: { status: 'error', message: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Limiter ที่เข้มงวดกว่าสำหรับส่วนที่ละเอียดอ่อน (เช่น Login ที่มีอยู่แล้ว)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 นาที
    max: 10, // พยายาม Login ได้ 10 ครั้งใน 15 นาที
    message: { status: 'error', message: 'Too many login attempts, please try again after 15 minutes' },
});


module.exports = {
    apiLimiter,
    loginLimiter
};