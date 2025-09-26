// db.js
const { Pool } = require('pg');
require('dotenv').config(); // ต้องมีบรรทัดนี้เพื่ออ่าน .env

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  
  // เพิ่ม 2 บรรทัดนี้เข้าไปเพื่อแก้ปัญหา Connection Timeout
  connectionTimeoutMillis: 30000, // เพิ่มเวลารอเชื่อมต่อเป็น 30 วินาที
  idleTimeoutMillis: 60000,       // Connection ที่ไม่ได้ใช้จะถูกตัดใน 60 วินาที
});

module.exports = pool;