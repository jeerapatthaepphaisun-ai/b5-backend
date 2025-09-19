// =================================================================
// --- การตั้งค่าเริ่มต้น (Boilerplate & Setup) ---
// =================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// =================================================================
// --- Middleware & Configs ---
// =================================================================

// ✨ --- START: ส่วนที่แก้ไข CORS ให้รองรับทุก URL --- ✨
const allowedOrigins = [
  process.env.FRONTEND_CASHIER_URL,
  process.env.FRONTEND_MENU_URL,
  process.env.FRONTEND_KDS_URL,
  process.env.FRONTEND_ADMIN_URL,
  process.env.FRONTEND_CAFE_URL,
  'http://localhost:5173',            // สำหรับตอนพัฒนาด้วย Vite
  'http://127.0.0.1:5500',            // สำหรับตอนเปิดด้วย Live Server
].filter(Boolean); // .filter(Boolean) จะช่วยกรองค่าที่อาจจะยังไม่ได้ตั้ง ออกไป

app.use(cors({
  origin: function (origin, callback) {
    // อนุญาตถ้า origin อยู่ในลิสต์ allowedOrigins หรือถ้าไม่มี origin (เช่น Postman, Mobile App)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error(`Origin '${origin}' not allowed by CORS`));
    }
  },
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type,Authorization"
}));
// ✨ --- END: ส่วนที่แก้ไข CORS --- ✨


app.use(express.json());

// Trust proxy for deployment environments like Render.com
app.set('trust proxy', 1);

// Supabase Setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// WebSocket Server Setup & Broadcast Function
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  console.log('Client connected via WebSocket');
  ws.on('close', () => console.log('Client disconnected'));
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}
// ทำให้ broadcast function ใช้ได้ในไฟล์อื่นผ่าน req object
app.use((req, res, next) => {
    req.broadcast = broadcast;
    req.supabase = supabase;
    next();
});

// =================================================================
// --- นำเข้า Routes (Import Routes) ---
// =================================================================
const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const tableRoutes = require('./routes/tableRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const utilityRoutes = require('./routes/utilityRoutes');
const takeawayRoutes = require('./routes/takeawayRoutes');
const optionRoutes = require('./routes/optionRoutes');

// =================================================================
// --- ลงทะเบียน Routes (Use Routes) ---
// =================================================================
app.get('/', (req, res) => res.status(200).send('Tonnam Cafe Backend is running!'));

app.use('/api', authRoutes); // สำหรับ /login
app.use('/api/categories', categoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/utils', utilityRoutes); // สำหรับ /upload-image และอื่นๆ
app.use('/api/takeaway-orders', takeawayRoutes);
app.use('/api/options', optionRoutes);

// =================================================================
// --- Error Handler ---
// =================================================================
function errorHandler(err, req, res, next) {
  console.error('An error occurred:', err.stack);

  if (err.code === '23505') { // Unique violation in PostgreSQL
    return res.status(409).json({ status: 'error', message: 'ข้อมูลนี้มีอยู่ในระบบแล้ว' });
  }
  if (err.code === '23503') { // Foreign key violation
    return res.status(400).json({ status: 'error', message: 'ไม่สามารถลบข้อมูลนี้ได้ เนื่องจากมีการใช้งานอยู่ที่อื่น' });
  }

  res.status(500).json({
    status: 'error',
    message: 'เกิดข้อผิดพลาดบางอย่างในระบบ'
  });
}

app.use(errorHandler);

// =================================================================
// --- Server Start ---
// =================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Tonnam Cafe Backend is running on port ${PORT}`);
});