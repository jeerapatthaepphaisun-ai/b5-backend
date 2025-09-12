// controllers/takeawayController.js
const pool = require('../db');

const getTakeawayOrders = async (req, res, next) => {
    try {
        // TODO: เขียน Logic ดึงข้อมูล Takeaway ที่ยังไม่จ่ายเงินจริงๆ ที่นี่
        // สำหรับตอนนี้ ให้ส่งข้อมูลว่างไปก่อนเพื่อให้ Frontend ทำงานได้
        const mockData = []; 
        res.json({ status: 'success', data: mockData });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTakeawayOrders,
};