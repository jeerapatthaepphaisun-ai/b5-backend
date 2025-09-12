// db.js
const { Pool } = require('pg');
require('dotenv').config(); // ต้องมีบรรทัดนี้เพื่ออ่าน .env

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;