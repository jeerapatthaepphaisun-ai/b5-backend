// --- การตั้งค่าเริ่มต้น ---
require('dotenv').config(); // สำหรับอ่านค่าจากไฟล์ .env
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws'); // <<< หมายเหตุ: ส่วนนี้จะถูกลบออกในอนาคตเมื่อใช้ Supabase Realtime เต็มรูปแบบ
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg'); // ไลบรารีสำหรับเชื่อมต่อ PostgreSQL

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- การเชื่อมต่อฐานข้อมูล (Supabase) ---
const dbHost = process.env.SUPABASE_DB_HOST;
const dbKey = process.env.SUPABASE_DB_KEY;
const connectionString = `postgresql://postgres:${dbKey}@${dbHost}:6543/postgres`;

const pool = new Pool({
  connectionString,
});

// --- WebSocket (จะถูกแทนที่ด้วย Supabase Realtime) ---
const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
}
wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', (error) => console.error('WebSocket Error:', error));
});


// --- Authentication Middleware & Config ---
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware สำหรับตรวจสอบ Token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}


// =================================================================
// --- API Endpoints ---
// =================================================================

app.get('/', (req, res) => res.status(200).send('B5 Restaurant Backend is running with Supabase!'));

// --- Login API ---
// [อัปเกรด] เปลี่ยนมาตรวจสอบข้อมูลจากตาราง users
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ status: 'error', message: 'กรุณากรอก Username และ Password' });
        }
        
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (user) {
            // ใช้ bcrypt.compare เพื่อเทียบรหัสผ่านที่ hash ไว้
            // const match = await bcrypt.compare(password, user.password_hash);
            // หมายเหตุ: เนื่องจากเรายังไม่มีระบบสร้าง hash ตอนย้ายข้อมูล ขออนุญาตเทียบรหัสผ่านตรงๆ ไปก่อน
            const match = (password === user.password_hash); 
            
            if (match) {
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
        console.error('Login API Error:', error);
        res.status(500).json({ status: 'error', message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});


// --- Menu & Options APIs ---
// [อัปเกรด] ดึงข้อมูลจากตาราง menu_items และ menu_options
app.get('/api/menu', async (req, res) => {
    try {
        const menuQuery = `
            SELECT mi.*, c.name_th as category_th, c.name_en as category_en
            FROM menu_items mi
            LEFT JOIN categories c ON mi.category_id = c.id
            ORDER BY c.name_th, mi.name_th;
        `;
        const optionsQuery = 'SELECT * FROM menu_options;';

        const [menuResult, optionsResult] = await Promise.all([
            pool.query(menuQuery),
            pool.query(optionsQuery)
        ]);

        const menuRows = menuResult.rows;
        const optionRows = optionsResult.rows;

        // ส่วนนี้เป็นการจัดกลุ่ม Options คล้ายโค้ดเดิม
        const optionsMap = optionRows.reduce((map, row) => {
            const { option_set_id, id, label_th, label_en, price_add } = row;
            if (!map[option_set_id]) map[option_set_id] = [];
            map[option_set_id].push({ option_id: id, label_th, label_en, price_add: parseFloat(price_add) });
            return map;
        }, {});

        // เราต้องดึงข้อมูลการเชื่อมโยง menu กับ options set มาอีกที
        const menuOptionsLinkResult = await pool.query('SELECT * FROM menu_item_option_sets');
        const menuOptionsLink = menuOptionsLinkResult.rows.reduce((map, row) => {
            if (!map[row.menu_item_id]) map[row.menu_item_id] = [];
            map[row.menu_item_id].push(row.option_set_id);
            return map;
        }, {});
        
        const menuData = menuRows.map(item => {
            const optionSetIds = menuOptionsLink[item.id] || [];
            item.option_groups = optionSetIds.reduce((groups, id) => {
                if (optionsMap[id]) {
                    groups[id] = optionsMap[id];
                }
                return groups;
            }, {});
            return item;
        });

        res.json({ status: 'success', data: menuData });
    } catch (error) {
        console.error('Error fetching menu with options:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch menu.' });
    }
});

app.post('/api/menu-items', authenticateToken, async (req, res) => {
    try {
        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status } = req.body;
        if (!name_th || !price || !category_id) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }
        const query = `
            INSERT INTO menu_items (name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id;
        `;
        const values = [name_th, price, category_id, name_en || null, desc_th || null, desc_en || null, image_url || null, stock_status || 'in_stock'];
        const result = await pool.query(query, values);

        res.status(201).json({ status: 'success', message: 'เพิ่มเมนูสำเร็จ!', data: { id: result.rows[0].id } });
    } catch (error) {
        console.error('Failed to create menu item:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create menu item.' });
    }
});

// --- Orders API ---
app.post('/api/orders', async (req, res) => {
    try {
        const { cart, total, tableNumber, specialRequest, subtotal, discountPercentage, discountAmount } = req.body;
        
        const query = `
            INSERT INTO orders (table_name, items, subtotal, discount_percentage, discount_amount, total, special_request, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
            RETURNING *;
        `;
        
        const values = [
            tableNumber || 'N/A',
            JSON.stringify(cart), // แปลง Array/Object เป็น JSON string ก่อนเก็บ
            subtotal,
            discountPercentage || 0,
            discountAmount || 0,
            total,
            specialRequest || ''
        ];

        const result = await pool.query(query, values);
        const newOrder = result.rows[0];

        // [อัปเกรด] Supabase Realtime จะทำงานแทนส่วนนี้ในอนาคต
        broadcast({ 
            type: 'NEW_ORDER', 
            payload: { 
                id: newOrder.id, 
                timestamp: newOrder.created_at, 
                table: newOrder.table_name, 
                items: newOrder.items, // ข้อมูล items เป็น JSON อยู่แล้ว
                special_request: newOrder.special_request, 
                status: newOrder.status 
            } 
        });

        res.status(201).json({ status: 'success', message: 'Order created successfully!', data: newOrder });
    } catch (error) {
        console.error('Failed to create order:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create order.' });
    }
});


// --- KDS & POS APIs ---
app.get('/api/get-orders', async (req, res) => {
    try {
        const query = `
            SELECT * FROM orders 
            WHERE status IN ('Pending', 'Cooking', 'Serving', 'Preparing')
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query);
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Failed to fetch orders:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch orders.' });
    }
});

app.post('/api/update-status', async (req, res) => {
    try {
        const { orderId, newStatus } = req.body; // เปลี่ยนจาก rowNumber เป็น orderId
        if (!orderId || !newStatus) return res.status(400).json({ status: 'error', message: 'Missing orderId or newStatus' });
        
        const query = 'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *;';
        const result = await pool.query(query, [newStatus, orderId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        
        // [อัปเกรด] Supabase Realtime จะทำงานแทนส่วนนี้
        broadcast({ type: 'STATUS_UPDATE', payload: { orderId, newStatus } });
        res.json({ status: 'success', message: `Order status updated`, data: result.rows[0] });
    } catch (error) {
        console.error('Failed to update status:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update status.' });
    }
});


// --- Table Management APIs for Cashier ---
app.get('/api/tables', async (req, res) => {
    try {
        const query = `
            SELECT 
                table_name, 
                json_agg(items) as all_items, 
                SUM(subtotal) as subtotal,
                SUM(discount_amount) as discount_amount,
                SUM(total) as total,
                MAX(CASE WHEN status = 'Billing' THEN 1 ELSE 0 END) as is_billing
            FROM orders
            WHERE status != 'Paid'
            GROUP BY table_name;
        `;
        const result = await pool.query(query);

        // จัดรูปแบบข้อมูลให้เหมือนของเดิม
        const tablesData = result.rows.reduce((acc, row) => {
            const orders = row.all_items.flat();
            acc[row.table_name] = {
                tableName: row.table_name,
                orders: orders,
                status: row.is_billing ? 'Billing' : 'Occupied',
                subtotal: parseFloat(row.subtotal),
                discountAmount: parseFloat(row.discount_amount),
                total: parseFloat(row.total),
                discountPercentage: (parseFloat(row.discount_amount) / parseFloat(row.subtotal)) * 100 || 0
            };
            return acc;
        }, {});
        
        res.json({ status: 'success', data: tablesData });
    } catch (error) {
        console.error('Failed to fetch table statuses:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table statuses.' });
    }
});

app.post('/api/clear-table', authenticateToken, async (req, res) => {
    try {
        const { tableName } = req.body;
        if (!tableName) return res.status(400).json({ status: 'error', message: 'Missing tableName' });

        const query = `
            UPDATE orders 
            SET status = 'Paid' 
            WHERE table_name = $1 AND status != 'Paid';
        `;
        await pool.query(query, [tableName]);

        // [อัปเกรด] Supabase Realtime จะทำงานแทนส่วนนี้
        broadcast({ type: 'TABLE_CLEARED', payload: { tableName } });
        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        console.error('Failed to clear table:', error);
        res.status(500).json({ status: 'error', message: 'Failed to clear table.' });
    }
});


// --- เริ่มการทำงานของ Server ---
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});