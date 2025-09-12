// middleware/auth.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(...allowedRoles) {
    return function(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token == null) return res.sendStatus(401);

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.sendStatus(403);

            if (user.role === 'admin') {
                req.user = user;
                return next();
            }

            if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
                return res.sendStatus(403);
            }

            req.user = user;
            next();
        });
    }
}

function decodeTokenOptional(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) {
            req.user = user;
        }
        next();
    });
}

// ส่งออกฟังก์ชันเพื่อให้ไฟล์อื่นเรียกใช้ได้
module.exports = {
    authenticateToken,
    decodeTokenOptional
};