// =================================================================
// --- การตั้งค่าเริ่มต้น (Boilerplate & Setup) ---
// =================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { formatInTimeZone } = require('date-fns-tz');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*'
}));
app.use(express.json());

// =================================================================
// --- การเชื่อมต่อฐานข้อมูล (Database Connection) ---
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

// =================================================================
// --- API Endpoints ---
// =================================================================

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

app.get('/api/all-tables', async (req, res) => {
    try {
        const result = await pool.query('SELECT name FROM tables ORDER BY sort_order ASC, name ASC');
        const tableNames = result.rows.map(row => row.name);
        res.json({ status: 'success', data: tableNames });
    } catch (error) {
        console.error('Error fetching all table names:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table names.' });
    }
});

app.get('/api/menu', async (req, res) => {
    try {
        const menuQuery = `
            SELECT mi.*, c.name_th as category_th, c.name_en as category_en
            FROM menu_items mi
            LEFT JOIN categories c ON mi.category_id = c.id
            ORDER BY c.sort_order ASC, mi.name_th ASC;
        `;
        const menuResult = await pool.query(menuQuery);
        let menuData = menuResult.rows;

        const optionsResult = await pool.query('SELECT * FROM menu_options;');
        const optionsMap = optionsResult.rows.reduce((map, row) => {
            const { option_set_id, id, label_th, label_en, price_add } = row;
            if (!map[option_set_id]) map[option_set_id] = [];
            map[option_set_id].push({ option_id: id, label_th, label_en, price_add: parseFloat(price_add) });
            return map;
        }, {});

        const menuOptionsLinkResult = await pool.query('SELECT * FROM menu_item_option_sets;');
        const menuOptionsLink = menuOptionsLinkResult.rows.reduce((map, row) => {
            if (!map[row.menu_item_id]) map[row.menu_item_id] = [];
            map[row.menu_item_id].push(row.option_set_id);
            return map;
        }, {});
        
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

        if (tableNumber) {
            const tableStatusResult = await pool.query('SELECT status FROM tables WHERE name = $1', [tableNumber]);

            if (tableStatusResult.rowCount === 0) {
                return res.status(404).json({ status: 'error', message: 'ไม่พบโต๊ะที่ระบุ' });
            }

            const currentStatus = tableStatusResult.rows[0].status;
            if (currentStatus === 'Billing') {
                return res.status(403).json({ status: 'error', message: 'โต๊ะนี้กำลังรอชำระเงิน ไม่สามารถสั่งอาหารเพิ่มได้' });
            }
            
            if (currentStatus === 'Available') {
                await pool.query('UPDATE tables SET status = $1 WHERE name = $2', ['Occupied', tableNumber]);
            }
        }

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

app.post('/api/request-bill', async (req, res) => {
    try {
        const { tableName } = req.body;
        if (!tableName) return res.status(400).json({ status: 'error', message: 'ไม่พบชื่อโต๊ะ' });
        
        await pool.query('UPDATE tables SET status = $1 WHERE name = $2', ['Billing', tableName]);
        
        res.json({ status: 'success', message: 'เรียกเก็บเงินสำเร็จ' });
    } catch (error) {
        console.error('Failed to request bill:', error);
        res.status(500).json({ status: 'error', message: 'Failed to request bill.' });
    }
});

app.get('/api/table-status/:tableName', async (req, res) => {
    try {
        const { tableName } = req.params;
        const query = `
            SELECT 
                status, 
                json_agg(
                    json_build_object(
                        'items', items,
                        'created_at', created_at
                    ) ORDER BY created_at
                ) as orders_in_status
            FROM orders
            WHERE table_name = $1 AND status != 'Paid'
            GROUP BY status;
        `;
        const result = await pool.query(query, [tableName]);

        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Failed to fetch table status:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table status.' });
    }
});

app.get('/api/dashboard-data', authenticateToken('admin'), async (req, res) => {
    try {
        await pool.query("SET TimeZone = 'Asia/Bangkok';");
        
        const timeZone = 'Asia/Bangkok';
        const today = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
        
        const { startDate = today, endDate = today } = req.query;

        const ordersQuery = `
            SELECT *, created_at AT TIME ZONE 'Asia/Bangkok' as local_created_at FROM orders 
            WHERE status = 'Paid' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
        `;
        const ordersResult = await pool.query(ordersQuery, [startDate, endDate]);
        const paidOrders = ordersResult.rows;

        const totalSales = paidOrders.reduce((sum, order) => sum + parseFloat(order.subtotal), 0);
        const totalDiscount = paidOrders.reduce((sum, order) => sum + parseFloat(order.discount_amount), 0);
        const totalOrders = paidOrders.length;
        const netRevenue = paidOrders.reduce((sum, order) => sum + parseFloat(order.total), 0);
        const averageOrderValue = totalOrders > 0 ? netRevenue / totalOrders : 0;

        const salesByDay = paidOrders.reduce((acc, order) => {
            const date = new Date(order.local_created_at).toISOString().slice(0, 10);
            acc[date] = (acc[date] || 0) + parseFloat(order.total);
            return acc;
        }, {});
        
        const salesByHour = Array(24).fill(0);
        paidOrders.forEach(order => {
            const hour = new Date(order.local_created_at).getHours();
            salesByHour[hour] += parseFloat(order.total);
        });

        const topItemsQuery = `
            SELECT 
                item.name_th as name,
                SUM((item.quantity)::int) as quantity
            FROM 
                orders, 
                jsonb_to_recordset(orders.items) as item(id text, name_th text, quantity int, price numeric)
            WHERE 
                orders.status = 'Paid' AND (orders.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
            GROUP BY item.name_th ORDER BY quantity DESC LIMIT 5;
        `;
        const topItemsResult = await pool.query(topItemsQuery, [startDate, endDate]);

        const salesByCategoryQuery = `
            SELECT 
                c.name_th as category_name,
                SUM(item.price * item.quantity) as total_sales
            FROM 
                orders,
                jsonb_to_recordset(orders.items) as item(id uuid, name_th text, quantity int, price numeric),
                menu_items mi, categories c
            WHERE 
                orders.status = 'Paid' AND (orders.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
                AND item.id = mi.id AND mi.category_id = c.id
            GROUP BY c.name_th ORDER BY total_sales DESC;
        `;
        const salesByCategoryResult = await pool.query(salesByCategoryQuery, [startDate, endDate]);
        const salesByCategory = salesByCategoryResult.rows.reduce((acc, row) => {
            acc[row.category_name] = parseFloat(row.total_sales);
            return acc;
        }, {});

        res.json({
            status: 'success',
            data: {
                kpis: {
                    totalSales,
                    netRevenue,
                    averageOrderValue,
                    totalOrders,
                    totalDiscount,
                },
                salesByDay,
                salesByHour,
                topSellingItems: topItemsResult.rows,
                salesByCategory
            }
        });
    } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch dashboard data.' });
    }
});

// ... (All other endpoints for categories, menu-items, users, kitchen, cashier remain the same) ...

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

app.put('/api/categories/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name_th, name_en, sort_order } = req.body;
        const result = await pool.query(
            'UPDATE categories SET name_th = $1, name_en = $2, sort_order = $3 WHERE id = $4 RETURNING *',
            [name_th, name_en, sort_order, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Category not found.' });
        }
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update category.' });
    }
});

app.delete('/api/categories/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Category not found.' });
        }
        res.json({ status: 'success', message: 'Category deleted successfully.' });
    } catch (error) {
        console.error('Error deleting category:', error);
        if (error.code === '23503') { 
            return res.status(400).json({ status: 'error', message: 'Cannot delete this category because it is currently in use by a menu item.' });
        }
        res.status(500).json({ status: 'error', message: 'Failed to delete category.' });
    }
});

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

app.get('/api/menu-items/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM menu_items WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        }
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Error fetching menu item:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch menu item.' });
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

app.delete('/api/menu-items/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        }
        res.json({ status: 'success', message: 'Menu item deleted successfully.' });
    } catch (error) {
        console.error('Error deleting menu item:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete menu item.' });
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

app.get('/api/users', authenticateToken('admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, role FROM users ORDER BY username');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch users.' });
    }
});

app.post('/api/users', authenticateToken('admin'), async (req, res) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ status: 'error', message: 'Username, password, and role are required.' });
        }
        const password_hash = password; 
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
            [username, password_hash, role]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Error creating user:', error);
        if (error.code === '23505') {
            return res.status(409).json({ status: 'error', message: 'This username is already taken.' });
        }
        res.status(500).json({ status: 'error', message: 'Failed to create user.' });
    }
});

app.put('/api/users/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { role, password } = req.body;
        if (password) {
            const password_hash = password;
            await pool.query('UPDATE users SET role = $1, password_hash = $2 WHERE id = $3', [role, password_hash, id]);
        } else {
            await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
        }
        res.json({ status: 'success', message: 'User updated successfully.' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update user.' });
    }
});

app.delete('/api/users/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'User not found.' });
        }
        res.json({ status: 'success', message: 'User deleted successfully.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete user.' });
    }
});


app.get('/api/get-orders', authenticateToken('kitchen'), async (req, res) => {
    try {
        const query = `
            SELECT * FROM orders 
            WHERE status IN ('Pending', 'Cooking', 'Preparing')
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

app.get('/api/tables', authenticateToken('cashier'), async (req, res) => {
    try {
        const query = `
            SELECT 
                t.name as table_name,
                t.status as table_status,
                o.orders_data
            FROM 
                tables t
            LEFT JOIN (
                SELECT
                    table_name,
                    json_agg(json_build_object(
                        'items', items,
                        'subtotal', subtotal,
                        'discount_amount', discount_amount,
                        'total', total,
                        'discount_percentage', discount_percentage
                    ) ORDER BY created_at) as orders_data
                FROM orders
                WHERE status != 'Paid'
                GROUP BY table_name
            ) o ON t.name = o.table_name
            ORDER BY t.sort_order ASC, t.name ASC;
        `;
        const result = await pool.query(query);

        const allTableNames = result.rows.map(r => r.table_name);
        const occupiedTablesData = result.rows.reduce((acc, row) => {
            if (row.orders_data) {
                const subtotal = row.orders_data.reduce((sum, order) => sum + parseFloat(order.subtotal), 0);
                const discountAmount = row.orders_data.reduce((sum, order) => sum + parseFloat(order.discount_amount), 0);
                const total = row.orders_data.reduce((sum, order) => sum + parseFloat(order.total), 0);
                const discountPercentage = row.orders_data[0]?.discount_percentage || 0;
                
                acc[row.table_name] = {
                    tableName: row.table_name,
                    orders: row.orders_data.flatMap(order => order.items),
                    status: row.table_status,
                    subtotal: subtotal,
                    discountAmount: discountAmount,
                    total: total,
                    discountPercentage: discountPercentage
                };
            }
            return acc;
        }, {});
        
        res.json({ status: 'success', data: { allTables: allTableNames, occupiedTables: occupiedTablesData } });

    } catch (error) {
        console.error('Failed to fetch table statuses:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table statuses.' });
    }
});

app.post('/api/clear-table', authenticateToken('cashier'), async (req, res) => {
    try {
        const { tableName } = req.body;
        await pool.query("UPDATE orders SET status = 'Paid' WHERE table_name = $1 AND status != 'Paid'", [tableName]);
        await pool.query("UPDATE tables SET status = 'Available' WHERE name = $1", [tableName]);
        
        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        console.error('Failed to clear table:', error);
        res.status(500).json({ status: 'error', message: 'Failed to clear table.' });
    }
});

app.post('/api/apply-discount', authenticateToken('cashier'), async (req, res) => {
    try {
        const { tableName, discountPercentage } = req.body;
        if (!tableName || discountPercentage === undefined) {
            return res.status(400).json({ status: 'error', message: 'Table name and discount percentage are required.' });
        }
    
        const ordersResult = await pool.query(
            "SELECT id, subtotal FROM orders WHERE table_name = $1 AND status != 'Paid'", 
            [tableName]
        );
    
        if (ordersResult.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'No active orders found for this table.' });
        }
    
        for (const order of ordersResult.rows) {
            const subtotal = parseFloat(order.subtotal);
            const discountAmount = subtotal * (discountPercentage / 100);
            const newTotal = subtotal - discountAmount;
    
            await pool.query(
                'UPDATE orders SET discount_percentage = $1, discount_amount = $2, total = $3 WHERE id = $4',
                [discountPercentage, discountAmount, newTotal, order.id]
            );
        }
    
        res.json({ status: 'success', message: `Discount of ${discountPercentage}% applied to table ${tableName}.` });
    } catch (error) {
        console.error('Error applying discount:', error);
        res.status(500).json({ status: 'error', message: 'Failed to apply discount.' });
    }
});

// =================================================================
// --- Server Start ---
// =================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});