// =================================================================
// --- Boilerplate & Setup ---
// =================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// =================================================================
// --- Database Connection ---
// =================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 0,
  connectionTimeoutMillis: 0,
});

// =================================================================
// --- Middleware & Configs ---
// =================================================================
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware for Token and Role Authentication (Upgraded Version)
function authenticateToken(...allowedRoles) {
    return function(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token == null) return res.sendStatus(401); // Unauthenticated

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.sendStatus(403); // Forbidden (invalid token)

            // Admin can access any protected API
            if (user.role === 'admin') {
                req.user = user;
                return next();
            }

            // Check if the user's role is in the list of allowed roles
            if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
                return res.sendStatus(403); // Forbidden (insufficient permissions)
            }

            req.user = user;
            next();
        });
    }
}

// =================================================================
// --- API Endpoints ---
// =================================================================

// --- Public Endpoints ---
app.get('/', (req, res) => res.status(200).send('B5 Restaurant Backend is running with Supabase!'));

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ status: 'error', message: 'กรุณากรอก Username และ Password' });
        
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (user) {
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

app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Failed to fetch categories:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch categories.' });
    }
});

app.get('/api/menu', async (req, res) => {
    try {
        // Step 1: Fetch main menu items and categories
        const menuQuery = `
            SELECT mi.*, c.name_th as category_th, c.name_en as category_en
            FROM menu_items mi
            LEFT JOIN categories c ON mi.category_id = c.id
            ORDER BY c.sort_order ASC, mi.name_th ASC;
        `;
        const menuResult = await pool.query(menuQuery);
        let menuData = menuResult.rows;

        // Step 2: Fetch all options
        const optionsResult = await pool.query('SELECT * FROM menu_options;');
        const optionsMap = optionsResult.rows.reduce((map, row) => {
            const { option_set_id, id, label_th, label_en, price_add } = row;
            if (!map[option_set_id]) map[option_set_id] = [];
            map[option_set_id].push({ option_id: id, label_th, label_en, price_add: parseFloat(price_add) });
            return map;
        }, {});

        // Step 3: Fetch the link data
        const menuOptionsLinkResult = await pool.query('SELECT * FROM menu_item_option_sets;');
        const menuOptionsLink = menuOptionsLinkResult.rows.reduce((map, row) => {
            if (!map[row.menu_item_id]) map[row.menu_item_id] = [];
            map[row.menu_item_id].push(row.option_set_id);
            return map;
        }, {});

        // Step 4: Assemble options into each menu item
        menuData = menuData.map(item => {
            const optionSetIds = menuOptionsLink[item.id] || [];
            item.option_groups = optionSetIds.reduce((groups, id) => {
                if (optionsMap[id]) groups[id] = optionsMap[id];
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

app.post('/api/orders', async (req, res) => {
    try {
        const { cart, total, tableNumber, specialRequest, subtotal, discountPercentage, discountAmount } = req.body;
        const query = `
            INSERT INTO orders (table_name, items, subtotal, discount_percentage, discount_amount, total, special_request, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending') RETURNING *;
        `;
        const values = [tableNumber || 'N/A', JSON.stringify(cart), subtotal, discountPercentage || 0, discountAmount || 0, total, specialRequest || ''];
        const result = await pool.query(query, values);
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Failed to create order:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create order.' });
    }
});


// --- Admin Endpoints ---
app.post('/api/menu-items', authenticateToken('admin'), async (req, res) => {
    try {
        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status } = req.body;
        if (!name_th || !price || !category_id) return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        
        const query = `
            INSERT INTO menu_items (name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status || 'in_stock'];
        const result = await pool.query(query, values);
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Failed to create menu item:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create menu item.' });
    }
});

app.put('/api/menu-items/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status } = req.body;
        const query = `
            UPDATE menu_items 
            SET name_th = $1, price = $2, category_id = $3, name_en = $4, desc_th = $5, desc_en = $6, image_url = $7, stock_status = $8
            WHERE id = $9 RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, id];
        const result = await pool.query(query, values);
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Failed to update menu item:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update menu item.' });
    }
});

app.post('/api/update-stock', authenticateToken('admin'), async (req, res) => {
    try {
        const { itemId, stockStatus } = req.body;
        const result = await pool.query(
            'UPDATE menu_items SET stock_status = $1 WHERE id = $2 RETURNING *',
            [stockStatus, itemId]
        );
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Failed to update stock status:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update stock status.' });
    }
});

app.post('/api/categories', authenticateToken('admin'), async (req, res) => {
    try {
        const { name_th, name_en, sort_order } = req.body;
        const result = await pool.query(
            'INSERT INTO categories (name_th, name_en, sort_order) VALUES ($1, $2, $3) RETURNING *',
            [name_th, name_en, sort_order]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Failed to create category:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create category.' });
    }
});

app.get('/api/dashboard-data', authenticateToken('admin'), async (req, res) => {
    try {
        const { date } = req.query; // format: YYYY-MM-DD
        if (!date) return res.status(400).json({ status: 'error', message: 'Date query parameter is required.' });
        
        const query = "SELECT * FROM orders WHERE created_at::date = $1 AND status = 'Paid'";
        const result = await pool.query(query, [date]);
        
        const paidOrders = result.rows;
        const totalSales = paidOrders.reduce((sum, order) => sum + parseFloat(order.total), 0);
        const totalDiscount = paidOrders.reduce((sum, order) => sum + parseFloat(order.discount_amount), 0);
        
        res.json({
            status: 'success',
            data: {
                date: date,
                totalSales: totalSales,
                totalDiscount: totalDiscount,
                totalOrders: paidOrders.length,
                orders: paidOrders
            }
        });
    } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch dashboard data.' });
    }
});


// --- Kitchen Endpoints ---
app.get('/api/get-orders', authenticateToken('kitchen'), async (req, res) => {
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

app.post('/api/update-status', authenticateToken('kitchen'), async (req, res) => {
    try {
        const { orderId, newStatus } = req.body;
        const result = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [newStatus, orderId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Failed to update status:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update status.' });
    }
});

// --- Cashier Endpoints ---
app.get('/api/tables', authenticateToken('cashier'), async (req, res) => {
    try {
        const query = `
            SELECT 
                table_name, 
                json_agg(items ORDER BY created_at) as all_items, 
                SUM(subtotal) as subtotal,
                SUM(discount_amount) as discount_amount,
                SUM(total) as total,
                MAX(CASE WHEN status = 'Billing' THEN 1 ELSE 0 END) as is_billing
            FROM orders
            WHERE status != 'Paid'
            GROUP BY table_name;
        `;
        const result = await pool.query(query);
        const tablesData = result.rows.reduce((acc, row) => {
            acc[row.table_name] = {
                tableName: row.table_name,
                orders: row.all_items.flat(),
                status: row.is_billing ? 'Billing' : 'Occupied',
                subtotal: parseFloat(row.subtotal),
                discountAmount: parseFloat(row.discount_amount),
                total: parseFloat(row.total),
            };
            return acc;
        }, {});
        res.json({ status: 'success', data: tablesData });
    } catch (error) {
        console.error('Failed to fetch table statuses:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table statuses.' });
    }
});

app.post('/api/clear-table', authenticateToken('cashier'), async (req, res) => {
    try {
        const { tableName } = req.body;
        await pool.query("UPDATE orders SET status = 'Paid' WHERE table_name = $1 AND status != 'Paid'", [tableName]);
        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        console.error('Failed to clear table:', error);
        res.status(500).json({ status: 'error', message: 'Failed to clear table.' });
    }
});


// =================================================================
// --- Server Start ---
// =================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});