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
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws'); // New: WebSocket

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: "*",
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type,Authorization"
}));
app.use(express.json());

// Supabase & Multer Setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

// New: WebSocket Server Setup
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


// =================================================================
// --- การเชื่อมต่อฐานข้อมูล (Database Connection) ---
// =================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: 'db.ayqtdyhbzllolrewvxcw.supabase.co',
});

// =================================================================
// --- Middleware & Configs ---
// =================================================================
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

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

app.get('/', (req, res) => res.status(200).send('Tonnam Cafe Backend is running with Supabase!'));

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ status: 'error', message: 'กรุณากรอก Username และ Password' });
        
        const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        const user = result.rows[0];

        if (user) {
            const match = await bcrypt.compare(password, user.password_hash);
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
        const { category, search, page = 1, limit = 20 } = req.query;

        let baseQuery = `
            FROM menu_items mi
            LEFT JOIN categories c ON mi.category_id = c.id
        `;
        let whereClauses = [];
        let queryParams = [];

        if (category && category !== 'all') {
            queryParams.push(category);
            whereClauses.push(`mi.category_id = $${queryParams.length}`);
        }

        if (search) {
            queryParams.push(`%${search}%`);
            whereClauses.push(`(mi.name_th ILIKE $${queryParams.length} OR mi.name_en ILIKE $${queryParams.length})`);
        }

        if (whereClauses.length > 0) {
            baseQuery += ' WHERE ' + whereClauses.join(' AND ');
        }

        const totalResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, queryParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

        const offset = (page - 1) * limit;
        queryParams.push(limit);
        queryParams.push(offset);
        
        const menuQuery = `
            SELECT mi.*, c.name_th as category_th, c.name_en as category_en
            ${baseQuery}
            ORDER BY c.sort_order ASC, mi.is_recommended DESC, mi.name_th ASC
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length};
        `;
        
        const menuResult = await pool.query(menuQuery, queryParams);
        let menuItems = menuResult.rows;

        if (menuItems.length > 0) {
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
            
            menuItems = menuItems.map(item => {
                const optionSetIds = menuOptionsLink[item.id] || [];
                item.option_groups = optionSetIds.reduce((groups, id) => {
                    if (optionsMap[id]) groups[id] = optionsMap[id];
                    return groups;
                }, {});
                return item;
            });
        }
        
        res.json({
            status: 'success',
            data: {
                items: menuItems,
                totalItems,
                totalPages,
                currentPage: parseInt(page, 10)
            }
        });
    } catch (error) {
        console.error('Error fetching paginated menu:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch menu.' });
    }
});

app.get('/api/cafe-menu', async (req, res) => {
    try {
        const query = `
            SELECT mi.*, c.name_th as category_th, c.name_en as category_en
            FROM menu_items mi
            JOIN categories c ON mi.category_id = c.id
            WHERE c.station_type = 'bar'
            ORDER BY c.sort_order ASC, mi.is_recommended DESC, mi.name_th ASC;
        `;
        const result = await pool.query(query);
        
        let menuItems = result.rows;
        if (menuItems.length > 0) {
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
            
            menuItems = menuItems.map(item => {
                const optionSetIds = menuOptionsLink[item.id] || [];
                item.option_groups = optionSetIds.reduce((groups, id) => {
                    if (optionsMap[id]) groups[id] = optionsMap[id];
                    return groups;
                }, {});
                return item;
            });
        }

        res.json({
            status: 'success',
            data: {
                items: menuItems
            }
        });

    } catch (error) {
        console.error('Error fetching cafe menu:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch cafe menu.' });
    }
});

app.post('/api/orders', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET TimeZone = 'Asia/Bangkok';"); // ตั้งค่า Timezone

        const { cart, tableNumber, specialRequest, isTakeaway, orderSource } = req.body;
        
        if (!cart || cart.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Cart is empty' });
        }

        let finalTableName;

        // --- START: LOGIC การรันเลข Takeaway ใหม่ ---
        if (orderSource === 'bar') {
            // ค้นหาเลข Takeaway ล่าสุดของวันนี้
            const lastTakeawayQuery = `
                SELECT table_name FROM orders 
                WHERE table_name LIKE 'Takeaway-%' 
                AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE 
                ORDER BY created_at DESC 
                LIMIT 1;
            `;
            const lastTakeawayResult = await client.query(lastTakeawayQuery);
            
            let nextNumber = 1;
            if (lastTakeawayResult.rows.length > 0) {
                const lastTakeawayName = lastTakeawayResult.rows[0].table_name;
                const lastNumber = parseInt(lastTakeawayName.split('-')[1] || '0', 10);
                nextNumber = lastNumber + 1;
            }
            finalTableName = `Takeaway-${nextNumber}`;
        // --- END: LOGIC การรันเลข Takeaway ใหม่ ---

        } else if (isTakeaway && !tableNumber) {
            finalTableName = `Takeaway-${Math.floor(1000 + Math.random() * 9000)}`; 
        } else if (tableNumber) {
            finalTableName = tableNumber;
        } else {
            return res.status(400).json({ status: 'error', message: 'Table number is required for dine-in orders.' });
        }
        
        if (tableNumber) {
             const tableStatusResult = await client.query('SELECT status FROM tables WHERE name = $1', [tableNumber]);
            if (tableStatusResult.rowCount === 0) {
                return res.status(404).json({ status: 'error', message: 'ไม่พบโต๊ะที่ระบุ' });
            }
            if (tableStatusResult.rows[0].status === 'Available') {
                 await client.query('UPDATE tables SET status = $1 WHERE name = $2', ['Occupied', tableNumber]);
            }
        }

        let calculatedSubtotal = 0;
        const processedCartForDb = [];

        for (const item of cart) {
            const itemResult = await client.query('SELECT price, discount_percentage, stock_status, name_th FROM menu_items WHERE id = $1', [item.id]);
            
            if (itemResult.rows.length === 0) {
                throw new Error(`Item with ID ${item.id} not found.`);
            }
            if (itemResult.rows[0].stock_status === 'out_of_stock') {
                throw new Error(`Item "${itemResult.rows[0].name_th}" is out of stock.`);
            }

            const dbItem = itemResult.rows[0];
            const basePrice = parseFloat(dbItem.price);
            const discountPercentage = parseFloat(dbItem.discount_percentage || 0);
            const priceAfterDiscount = basePrice - (basePrice * (discountPercentage / 100));
            
            let optionsPrice = 0;
            if (item.selected_options && Array.isArray(item.selected_options)) {
                for (const option of item.selected_options) {
                    const optionResult = await client.query('SELECT price_add FROM menu_options WHERE id = $1', [option.option_id]);
                    if (optionResult.rows.length > 0) {
                        optionsPrice += parseFloat(optionResult.rows[0].price_add);
                    }
                }
            }
            const finalItemPrice = priceAfterDiscount + optionsPrice;

            calculatedSubtotal += finalItemPrice * item.quantity;
            
            processedCartForDb.push({
                unique_id: item.uniqueId,
                name_th: item.name_th,
                name_en: item.name_en,
                category_th: item.category_th,
                quantity: item.quantity,
                price: finalItemPrice,
                selected_options_text_th: item.selected_options_text_th,
                selected_options_text_en: item.selected_options_text_en,
            });
            
            if (item.id) { // Ensure item.id exists before running stock updates
                await client.query(
                    `UPDATE menu_items SET current_stock = GREATEST(0, current_stock - $1) WHERE id = $2`, 
                    [item.quantity, item.id]
                );
                await client.query(
                    `UPDATE menu_items SET stock_status = 'out_of_stock' WHERE id = $1 AND manage_stock = true AND current_stock <= 0`, 
                    [item.id]
                );
            }
        }
        
        const finalTotal = calculatedSubtotal;
        
        const query = `
            INSERT INTO orders (table_name, items, subtotal, discount_percentage, discount_amount, total, special_request, status, is_takeaway)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8) RETURNING *;
        `;
        const values = [
            finalTableName, 
            JSON.stringify(processedCartForDb), 
            calculatedSubtotal, 
            0, 
            0, 
            finalTotal, 
            specialRequest || '',
            true // Orders from Bar POS are always considered takeaway
        ];
        const result = await client.query(query, values);
        
        await client.query('COMMIT');
        
        const newOrder = result.rows[0];
        broadcast({
            type: 'newOrder',
            order: newOrder
        });

        res.status(201).json({ status: 'success', data: newOrder });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to create order:', error);
        res.status(500).json({ status: 'error', message: `Failed to create order: ${error.message}` });
    } finally {
        client.release();
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

app.post('/api/upload-image', authenticateToken('admin'), upload.single('menuImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
        }

        const file = req.file;
        const fileExt = file.originalname.split('.').pop();
        const fileName = `menu-${Date.now()}.${fileExt}`;

        const { data, error: uploadError } = await supabase.storage
            .from('menu-images')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: false,
            });

        if (uploadError) {
            throw new Error(uploadError.message);
        }

        const { data: urlData } = supabase.storage
            .from('menu-images')
            .getPublicUrl(fileName);

        res.json({
            status: 'success',
            message: 'Image uploaded successfully.',
            data: { imageUrl: urlData.publicUrl }
        });

    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to upload image.' });
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
        
        const baseExpandedItemsCTE = `
            WITH expanded_items AS (
                SELECT 
                    substring(item.id from 1 for 36)::uuid as cleaned_id,
                    item.price,
                    item.quantity
                FROM 
                    orders,
                    jsonb_to_recordset(orders.items) as item(id text, price numeric, quantity int)
                WHERE 
                    orders.status = 'Paid' AND (orders.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
            )
        `;

        const topItemsQuery = (station) => `
            ${baseExpandedItemsCTE}
            SELECT 
                mi.name_th as name,
                SUM(ei.quantity) as quantity
            FROM expanded_items ei
            JOIN menu_items mi ON ei.cleaned_id = mi.id
            JOIN categories c ON mi.category_id = c.id
            WHERE c.station_type = $3
            GROUP BY mi.name_th ORDER BY quantity DESC LIMIT 5;
        `;

        const salesByCategoryQuery = (station) => `
            ${baseExpandedItemsCTE}
            SELECT 
                c.name_th as category_name,
                SUM(ei.price * ei.quantity) as total_sales
            FROM expanded_items ei
            JOIN menu_items mi ON ei.cleaned_id = mi.id
            JOIN categories c ON mi.category_id = c.id
            WHERE c.station_type = $3
            GROUP BY c.name_th ORDER BY total_sales DESC;
        `;

        const [
            topKitchenItemsResult,
            topBarItemsResult,
            salesByKitchenCategoryResult,
            salesByBarCategoryResult
        ] = await Promise.all([
            pool.query(topItemsQuery('kitchen'), [startDate, endDate, 'kitchen']),
            pool.query(topItemsQuery('bar'), [startDate, endDate, 'bar']),
            pool.query(salesByCategoryQuery('kitchen'), [startDate, endDate, 'kitchen']),
            pool.query(salesByCategoryQuery('bar'), [startDate, endDate, 'bar'])
        ]);
        
        const salesByKitchenCategory = salesByKitchenCategoryResult.rows.reduce((acc, row) => {
            acc[row.category_name] = parseFloat(row.total_sales);
            return acc;
        }, {});
        const salesByBarCategory = salesByBarCategoryResult.rows.reduce((acc, row) => {
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
                topSellingItems: {
                    kitchen: topKitchenItemsResult.rows,
                    bar: topBarItemsResult.rows
                },
                salesByCategory: {
                    kitchen: salesByKitchenCategory,
                    bar: salesByBarCategory
                }
            }
        });
    } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch dashboard data.' });
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
        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, current_stock } = req.body;
        if (!name_th || !price || !category_id) return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        
        let isRecommendedStatus = false;
        if (category_id) {
            const categoryResult = await pool.query('SELECT name_th FROM categories WHERE id = $1', [category_id]);
            if (categoryResult.rows.length > 0 && categoryResult.rows[0].name_th === 'เมนูแนะนำ') {
                isRecommendedStatus = true;
            }
        }
        
        const query = `
            INSERT INTO menu_items (name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, is_recommended, current_stock)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status || 'in_stock', discount_percentage || 0, isRecommendedStatus, current_stock || 0];
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
        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, current_stock } = req.body;
        
        let isRecommendedStatus = false;
        if (category_id) {
            const categoryResult = await pool.query('SELECT name_th FROM categories WHERE id = $1', [category_id]);
            if (categoryResult.rows.length > 0 && categoryResult.rows[0].name_th === 'เมนูแนะนำ') {
                isRecommendedStatus = true;
            }
        }
        
        const query = `
            UPDATE menu_items 
            SET name_th = $1, price = $2, category_id = $3, name_en = $4, desc_th = $5, desc_en = $6, image_url = $7, stock_status = $8, discount_percentage = $9, is_recommended = $10, current_stock = $11
            WHERE id = $12 RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, isRecommendedStatus, current_stock, id];
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
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS); 
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
        
        if (password && password.trim() !== '') {
            const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
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


app.get('/api/get-orders', authenticateToken('kitchen', 'bar', 'admin'), async (req, res) => {
    try {
        const { station } = req.query; 
        if (!station) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุ station (kitchen หรือ bar)' });
        }

        const categoriesResult = await pool.query('SELECT name_th FROM categories WHERE station_type = $1', [station]);
        const targetCategories = categoriesResult.rows.map(row => row.name_th);

        if (targetCategories.length === 0) {
            return res.json({ status: 'success', data: [] }); 
        }

        const query = `
            SELECT * FROM orders 
            WHERE status IN ('Pending', 'Cooking', 'Preparing')
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query);
        let orders = result.rows;

        const filteredOrders = orders.map(order => {
            const relevantItems = order.items.filter(item => 
                targetCategories.includes(item.category_th)
            );

            if (relevantItems.length > 0) {
                return { ...order, items: relevantItems };
            }
            return null;
        }).filter(Boolean); 

        res.json({ status: 'success', data: filteredOrders });

    } catch (error)
    {
        console.error('Failed to fetch orders:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch orders.' });
    }
});

app.post('/api/update-status', authenticateToken('kitchen', 'bar', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); 

        const { orderId, newStatus, station } = req.body;

        if (newStatus !== 'Serving') {
            const result = await client.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [newStatus, orderId]);
            await client.query('COMMIT'); 
            if (result.rowCount === 0) {
                return res.status(404).json({ status: 'error', message: 'Order not found' });
            }
            return res.json({ status: 'success', data: result.rows[0] });
        }
        
        const updateStationResult = await client.query(
            `UPDATE orders 
             SET completed_stations = completed_stations || $1::jsonb 
             WHERE id = $2 AND NOT completed_stations @> $1::jsonb 
             RETURNING *`,
            [JSON.stringify(station), orderId]
        );
        
        if (updateStationResult.rowCount === 0) {
             const currentOrder = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
             if(currentOrder.rowCount === 0) throw new Error('Order not found');
             await client.query('COMMIT');
             return res.json({ status: 'success', data: currentOrder.rows[0] });
        }

        const updatedOrder = updateStationResult.rows[0];
        const orderItems = updatedOrder.items;
        const itemCategories = orderItems.map(item => item.category_th);
        
        const categoriesResult = await client.query(
            'SELECT DISTINCT station_type FROM categories WHERE name_th = ANY($1::text[])',
            [itemCategories]
        );
        const requiredStations = categoriesResult.rows.map(row => row.station_type);

        const allStationsCompleted = requiredStations.every(reqStation => 
            updatedOrder.completed_stations.includes(reqStation)
        );

        if (allStationsCompleted) {
            const finalResult = await client.query(
                'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
                ['Serving', orderId]
            );
            await client.query('COMMIT'); 
            return res.json({ status: 'success', data: finalResult.rows[0] });
        }

        await client.query('COMMIT'); 
        res.json({ status: 'success', data: updatedOrder });

    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error('Failed to update status:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update status.' });
    } finally {
        client.release(); 
    }
});

app.get('/api/tables', authenticateToken('cashier', 'admin'), async (req, res) => {
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

app.post('/api/clear-table', authenticateToken('cashier', 'admin'), async (req, res) => {
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

app.post('/api/apply-discount', authenticateToken('cashier', 'admin'), async (req, res) => {
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

app.get('/api/takeaway-orders', authenticateToken('cashier', 'admin'), async (req, res) => {
    try {
        const query = `
            SELECT 
                table_name,
                json_agg(
                    json_build_object(
                        'items', items,
                        'subtotal', subtotal,
                        'discount_amount', discount_amount,
                        'total', total,
                        'discount_percentage', discount_percentage
                    ) ORDER BY created_at
                ) as orders_data
            FROM orders
            WHERE table_name LIKE 'Takeaway-%' AND status != 'Paid'
            GROUP BY table_name
            ORDER BY table_name;
        `;
        const result = await pool.query(query);
        
        const processedData = result.rows.map(group => {
            const subtotal = group.orders_data.reduce((sum, order) => sum + parseFloat(order.subtotal), 0);
            const discountAmount = group.orders_data.reduce((sum, order) => sum + parseFloat(order.discount_amount), 0);
            const total = group.orders_data.reduce((sum, order) => sum + parseFloat(order.total), 0);
            const discountPercentage = group.orders_data[0]?.discount_percentage || 0;

            return {
                table_name: group.table_name,
                all_items: group.orders_data.flatMap(order => order.items),
                subtotal,
                discountAmount,
                grand_total: total,
                discountPercentage
            };
        });

        res.json({ status: 'success', data: processedData });
    } catch (error) {
        console.error('Failed to fetch takeaway orders:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch takeaway orders.' });
    }
});

app.post('/api/clear-takeaway', authenticateToken('cashier', 'admin'), async (req, res) => {
    try {
        const { tableName } = req.body;
        if (!tableName || (!tableName.startsWith('Takeaway-') && !tableName.startsWith('Bar-'))) {
            return res.status(400).json({ status: 'error', message: 'Invalid order name.' });
        }
        await pool.query("UPDATE orders SET status = 'Paid' WHERE table_name = $1 AND status != 'Paid'", [tableName]);
        res.json({ status: 'success', message: `Order ${tableName} cleared.` });
    } catch (error) {
        console.error('Failed to clear takeaway order:', error);
        res.status(500).json({ status: 'error', message: 'Failed to clear takeaway order.' });
    }
});

app.get('/api/tables-management', authenticateToken('admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, sort_order FROM tables ORDER BY sort_order ASC, name ASC');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error('Error fetching tables for management:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch tables.' });
    }
});

app.post('/api/tables', authenticateToken('admin'), async (req, res) => {
    try {
        const { name, sort_order } = req.body;
        if (!name) {
            return res.status(400).json({ status: 'error', message: 'Table name is required.' });
        }
        const result = await pool.query(
            'INSERT INTO tables (name, sort_order) VALUES ($1, $2) RETURNING *',
            [name, sort_order || 99]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Error creating table:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create table.' });
    }
});

app.delete('/api/tables/:id', authenticateToken('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM tables WHERE id = $1', [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Table not found.' });
        }
        
        res.json({ status: 'success', message: 'Table deleted successfully.' });
    } catch (error) {
        if (error.code === '23503') { 
            return res.status(400).json({ status: 'error', message: 'Cannot delete this table because it is currently in use by an order.' });
        }
        console.error('Error deleting table:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete table.' });
    }
});

app.get('/api/categories-by-station', authenticateToken('kitchen', 'bar', 'admin'), async (req, res) => {
    try {
        const { station } = req.query;
        if (!station) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุ station' });
        }
        const categoriesResult = await pool.query('SELECT name_th FROM categories WHERE station_type = $1', [station]);
        const targetCategories = categoriesResult.rows.map(row => row.name_th);
        res.json({ status: 'success', data: targetCategories });
    } catch (error) {
        console.error('Failed to fetch categories by station:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch categories.' });
    }
});

app.get('/api/dashboard-kds', authenticateToken('admin'), async (req, res) => {
    try {
        const timeZone = 'Asia/Bangkok';
        const queryDate = req.query.date || formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');

        const summaryQuery = `
            WITH DailyPaidOrders AS (
                SELECT *
                FROM orders
                WHERE status = 'Paid' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = $1
            ),
            ExpandedItems AS (
                SELECT
                    dpo.id as order_id,
                    item.category_th,
                    (item.price * item.quantity) as item_total_price,
                    c.station_type
                FROM
                    DailyPaidOrders dpo,
                    jsonb_to_recordset(dpo.items) as item(category_th text, price numeric, quantity int)
                JOIN
                    categories c ON item.category_th = c.name_th
            )
            SELECT
                (SELECT COUNT(*) FROM DailyPaidOrders) as total_orders_count,
                (SELECT COALESCE(SUM(total), 0) FROM DailyPaidOrders) as net_revenue,
                COUNT(DISTINCT order_id) FILTER (WHERE station_type = 'kitchen') as kitchen_order_count,
                COALESCE(SUM(item_total_price) FILTER (WHERE station_type = 'kitchen'), 0) as kitchen_total_sales,
                COUNT(DISTINCT order_id) FILTER (WHERE station_type = 'bar') as bar_order_count,
                COALESCE(SUM(item_total_price) FILTER (WHERE station_type = 'bar'), 0) as bar_total_sales
            FROM ExpandedItems;
        `;
        
        const summaryResult = await pool.query(summaryQuery, [queryDate]);
        const summaryData = summaryResult.rows[0];

        const discountedOrdersQuery = `
            SELECT id, table_name, discount_percentage, discount_amount, total
            FROM orders
            WHERE status = 'Paid' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = $1 AND discount_amount > 0
            ORDER BY created_at DESC;
        `;
        const discountedOrdersResult = await pool.query(discountedOrdersQuery, [queryDate]);

        res.json({
            status: 'success',
            data: {
                summaryDate: queryDate,
                totalOrders: parseInt(summaryData.total_orders_count, 10),
                netRevenue: parseFloat(summaryData.net_revenue),
                stationSummary: {
                    kitchen: {
                        orderCount: parseInt(summaryData.kitchen_order_count, 10),
                        totalSales: parseFloat(summaryData.kitchen_total_sales)
                    },
                    bar: {
                        orderCount: parseInt(summaryData.bar_order_count, 10),
                        totalSales: parseFloat(summaryData.bar_total_sales)
                    }
                },
                discountedOrders: discountedOrdersResult.rows
            }
        });

    } catch (error) {
        console.error('Failed to fetch KDS dashboard data:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch KDS dashboard data.' });
    }
});

// =================================================================
// --- Server Start ---
// =================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Tonnam Cafe Backend is running on port ${PORT}`);
});