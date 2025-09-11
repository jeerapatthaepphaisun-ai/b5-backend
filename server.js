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
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: "*",
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type,Authorization"
}));
app.use(express.json());

// Trust proxy for Render.com's environment
app.set('trust proxy', 1);

// Supabase & Multer Setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

// WebSocket Server Setup
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

// Rate Limiter for Login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'คุณพยายามล็อกอินมากเกินไป กรุณาลองใหม่อีกครั้งใน 15 นาที',
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	message: 'คุณส่งคำขอมากเกินไป กรุณารอสักครู่',
	standardHeaders: true,
	legacyHeaders: false,
});


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

// =================================================================
// --- API Endpoints ---
// =================================================================

app.get('/', (req, res) => res.status(200).send('Tonnam Cafe Backend is running with Supabase!'));

app.post('/api/login', loginLimiter, async (req, res, next) => {
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
        next(error);
    }
});

app.get('/api/categories', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC');
        res.json({ status: 'success', data: result.rows });
    } catch(error) {
        next(error);
    }
});

app.get('/api/all-tables', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT name FROM tables ORDER BY sort_order ASC, name ASC');
        const tableNames = result.rows.map(row => row.name);
        res.json({ status: 'success', data: tableNames });
    } catch (error) {
        next(error);
    }
});

app.get('/api/menu', async (req, res, next) => {
    try {
        const { category, search, page = 1, limit = 1000 } = req.query;

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
            ORDER BY c.sort_order ASC, mi.sort_order ASC, mi.name_th ASC
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
        next(error);
    }
});

app.get('/api/cafe-menu', async (req, res, next) => {
    try {
        const { category, search } = req.query;

        let queryParams = ['bar'];
        let whereClauses = ["c.station_type = $1"];

        if (category) {
            queryParams.push(category);
            whereClauses.push(`c.id = $${queryParams.length}`);
        }

        if (search) {
            queryParams.push(`%${search}%`);
            whereClauses.push(`(mi.name_th ILIKE $${queryParams.length} OR mi.name_en ILIKE $${queryParams.length})`);
        }

        const query = `
            SELECT mi.*, c.name_th as category_th, c.name_en as category_en
            FROM menu_items mi
            JOIN categories c ON mi.category_id = c.id
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY mi.sort_order ASC, mi.name_th ASC;
        `;
        const result = await pool.query(query, queryParams);

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
        next(error);
    }
});

app.post('/api/orders', decodeTokenOptional, async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET TimeZone = 'Asia/Bangkok';");

        const { cart, tableNumber, specialRequest, isTakeaway, orderSource, discountPercentage = 0 } = req.body;

        if (!cart || cart.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Cart is empty' });
        }

        let discountedByUser = null;
        if (discountPercentage > 0) {
            if (!req.user) {
                return res.status(401).send('Unauthorized: A login is required to apply discounts.');
            }
            discountedByUser = req.user.username;
        }

        let finalTableName;
        if (orderSource === 'bar') {
            const lastBarOrderQuery = `
                SELECT table_name FROM orders
                WHERE table_name LIKE 'Bar-%' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE
                ORDER BY created_at DESC LIMIT 1;`;
            const lastBarResult = await client.query(lastBarOrderQuery);
            let nextNumber = 1;
            if (lastBarResult.rows.length > 0) {
                const lastBarName = lastBarResult.rows[0].table_name;
                const lastNumber = parseInt(lastBarName.split('-')[1] || '0', 10);
                nextNumber = lastNumber + 1;
            }
            finalTableName = `Bar-${nextNumber}`;
        } else if (tableNumber) {
            finalTableName = tableNumber;
            const tableStatusResult = await client.query('SELECT status FROM tables WHERE name = $1', [finalTableName]);
            if (tableStatusResult.rowCount === 0) {
                return res.status(404).json({ status: 'error', message: 'ไม่พบโต๊ะที่ระบุ' });
            }
            if (tableStatusResult.rows[0].status === 'Available' && !isTakeaway) {
                await client.query('UPDATE tables SET status = $1 WHERE name = $2', ['Occupied', finalTableName]);
            }
        } else if (isTakeaway) {
            const lastTakeawayQuery = `
                SELECT table_name FROM orders
                WHERE table_name LIKE 'Takeaway-%' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE
                ORDER BY created_at DESC LIMIT 1;`;
            const lastTakeawayResult = await client.query(lastTakeawayQuery);
            let nextNumber = 1;
            if (lastTakeawayResult.rows.length > 0) {
                const lastTakeawayName = lastTakeawayResult.rows[0].table_name;
                const lastNumber = parseInt(lastTakeawayName.split('-')[1] || '0', 10);
                nextNumber = lastNumber + 1;
            }
            finalTableName = `Takeaway-${nextNumber}`;
        } else {
             return res.status(400).json({ status: 'error', message: 'Table number or order type is required.' });
        }

        let calculatedSubtotal = 0;
        const processedCartForDb = [];
        for (const item of cart) {
            const itemResult = await client.query('SELECT price, stock_status, name_th FROM menu_items WHERE id = $1', [item.productId || item.id]);
            if (itemResult.rows.length === 0) throw new Error(`Item with ID ${item.id} not found.`);
            if (itemResult.rows[0].stock_status === 'out_of_stock') throw new Error(`Item "${itemResult.rows[0].name_th}" is out of stock.`);

            const basePrice = parseFloat(item.price);
            calculatedSubtotal += basePrice * item.quantity;
            processedCartForDb.push(item);

            if (item.productId || item.id) {
                await client.query(
                    `UPDATE menu_items SET current_stock = GREATEST(0, current_stock - $1) WHERE id = $2 AND manage_stock = true`,
                    [item.quantity, item.productId || item.id]
                );
            }
        }

        await client.query(`UPDATE menu_items SET stock_status = 'out_of_stock' WHERE manage_stock = true AND current_stock <= 0`);

        const subtotal = calculatedSubtotal;
        const discountAmount = subtotal * (discountPercentage / 100);
        const finalTotal = subtotal - discountAmount;
        const finalStatus = 'Pending';

        const query = `
            INSERT INTO orders (table_name, items, subtotal, discount_percentage, discount_amount, total, special_request, status, is_takeaway, discount_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
        `;
        const values = [finalTableName, JSON.stringify(processedCartForDb), subtotal, discountPercentage, discountAmount, finalTotal, specialRequest || '', finalStatus, isTakeaway, discountedByUser];
        const result = await client.query(query, values);

        await client.query('COMMIT');
        const newOrder = result.rows[0];
        broadcast({ type: 'newOrder', order: newOrder });
        res.status(201).json({ status: 'success', data: newOrder });

    } catch (error) {
        await client.query('ROLLBACK');
        return next(error);
    } finally {
        client.release();
    }
});

app.post('/api/request-bill', apiLimiter, async (req, res, next) => {
    try {
        const { tableName } = req.body;
        if (!tableName) return res.status(400).json({ status: 'error', message: 'ไม่พบชื่อโต๊ะ' });

        await pool.query('UPDATE tables SET status = $1 WHERE name = $2', ['Billing', tableName]);

        res.json({ status: 'success', message: 'เรียกเก็บเงินสำเร็จ' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/table-status/:tableName', async (req, res, next) => {
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
        next(error);
    }
});

app.post('/api/upload-image', authenticateToken('admin'), apiLimiter, upload.single('menuImage'), async (req, res, next) => {
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

        if (uploadError) throw new Error(uploadError.message);

        const { data: urlData } = supabase.storage.from('menu-images').getPublicUrl(fileName);

        res.json({
            status: 'success',
            message: 'Image uploaded successfully.',
            data: { imageUrl: urlData.publicUrl }
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/stock-alerts', authenticateToken('admin'), async (req, res, next) => {
    try {
        const LOW_STOCK_THRESHOLD = 5;
        const query = `
            SELECT id, name_th, current_stock
            FROM menu_items
            WHERE manage_stock = true AND current_stock <= $1
            ORDER BY current_stock ASC;
        `;
        const result = await pool.query(query, [LOW_STOCK_THRESHOLD]);
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
});

app.get('/api/dashboard-data', authenticateToken('admin'), async (req, res, next) => {
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
                    item ->> 'id' as cleaned_id,
                    (item ->> 'price')::numeric as price,
                    (item ->> 'quantity')::int as quantity
                FROM
                    orders,
                    jsonb_array_elements(orders.items) as item
                WHERE
                    orders.status = 'Paid' AND (orders.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
            )
        `;
        const topItemsQuery = (station) => `${baseExpandedItemsCTE} SELECT mi.name_th as name, SUM(ei.quantity) as quantity FROM expanded_items ei JOIN menu_items mi ON ei.cleaned_id::uuid = mi.id JOIN categories c ON mi.category_id = c.id WHERE c.station_type = $3 GROUP BY mi.name_th ORDER BY quantity DESC LIMIT 5;`;
        const salesByCategoryQuery = (station) => `${baseExpandedItemsCTE} SELECT c.name_th as category_name, SUM(ei.price * ei.quantity) as total_sales FROM expanded_items ei JOIN menu_items mi ON ei.cleaned_id::uuid = mi.id JOIN categories c ON mi.category_id = c.id WHERE c.station_type = $3 GROUP BY c.name_th ORDER BY total_sales DESC;`;

        const [topKitchenItemsResult, topBarItemsResult, salesByKitchenCategoryResult, salesByBarCategoryResult] = await Promise.all([
            pool.query(topItemsQuery('kitchen'), [startDate, endDate, 'kitchen']),
            pool.query(topItemsQuery('bar'), [startDate, endDate, 'bar']),
            pool.query(salesByCategoryQuery('kitchen'), [startDate, endDate, 'kitchen']),
            pool.query(salesByCategoryQuery('bar'), [startDate, endDate, 'bar'])
        ]);

        const salesByKitchenCategory = salesByKitchenCategoryResult.rows.reduce((acc, row) => { acc[row.category_name] = parseFloat(row.total_sales); return acc; }, {});
        const salesByBarCategory = salesByBarCategoryResult.rows.reduce((acc, row) => { acc[row.category_name] = parseFloat(row.total_sales); return acc; }, {});

        res.json({
            status: 'success',
            data: {
                kpis: { totalSales, netRevenue, averageOrderValue, totalOrders, totalDiscount },
                salesByDay, salesByHour,
                topSellingItems: { kitchen: topKitchenItemsResult.rows, bar: topBarItemsResult.rows },
                salesByCategory: { kitchen: salesByKitchenCategory, bar: salesByBarCategory }
            }
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/categories', authenticateToken('admin'), apiLimiter,
    [
        body('name_th', 'กรุณาระบุชื่อหมวดหมู่ (ไทย)').notEmpty().trim(),
        body('sort_order', 'กรุณาระบุลำดับเป็นตัวเลข').isNumeric(),
        body('name_en').optional().trim()
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { name_th, name_en, sort_order } = req.body;
        const result = await pool.query(
            'INSERT INTO categories (name_th, name_en, sort_order) VALUES ($1, $2, $3) RETURNING *',
            [name_th, name_en, sort_order]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.put('/api/categories/reorder', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ status: 'error', message: 'Invalid order data provided.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatePromises = order.map((id, index) => {
            return client.query('UPDATE categories SET sort_order = $1 WHERE id = $2', [index, id]);
        });
        await Promise.all(updatePromises);
        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Categories reordered successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});


app.put('/api/categories/:id', authenticateToken('admin'), apiLimiter,
    [
        body('name_th', 'กรุณาระบุชื่อหมวดหมู่ (ไทย)').notEmpty().trim(),
        body('sort_order', 'กรุณาระบุลำดับเป็นตัวเลข').isNumeric(),
        body('name_en').optional().trim()
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { id } = req.params;
        const { name_th, name_en, sort_order } = req.body;
        const result = await pool.query(
            'UPDATE categories SET name_th = $1, name_en = $2, sort_order = $3 WHERE id = $4 RETURNING *',
            [name_th, name_en, sort_order, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Category not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/categories/:id', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Category not found.' });
        res.json({ status: 'success', message: 'Category deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

app.post('/api/menu-items', authenticateToken('admin'), apiLimiter,
    [
        body('name_th').notEmpty().withMessage('กรุณากรอกชื่อเมนู'),
        body('price').isFloat({ gt: 0 }).withMessage('ราคาต้องเป็นตัวเลขและมากกว่า 0'),
        body('category_id').notEmpty().withMessage('กรุณาเลือกหมวดหมู่'),
        body('manage_stock').isBoolean().withMessage('กรุณาระบุสถานะการจัดการสต็อก'),
        body('current_stock').isInt({ min: 0 }).withMessage('สต็อกต้องเป็นเลขจำนวนเต็ม 0 หรือมากกว่า')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, current_stock, manage_stock } = req.body;

        let isRecommendedStatus = false;
        if (category_id) {
            const categoryResult = await pool.query('SELECT name_th FROM categories WHERE id = $1', [category_id]);
            if (categoryResult.rows.length > 0 && categoryResult.rows[0].name_th === 'เมนูแนะนำ') {
                isRecommendedStatus = true;
            }
        }

        const query = `
            INSERT INTO menu_items (name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, is_recommended, current_stock, manage_stock)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status || 'in_stock', discount_percentage || 0, isRecommendedStatus, current_stock || 0, manage_stock || false];
        const result = await pool.query(query, values);
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.get('/api/menu-items/:id', authenticateToken('admin'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM menu_items WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.put('/api/menu-items/reorder', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ status: 'error', message: 'Invalid order data provided.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatePromises = order.map((id, index) => {
            return client.query('UPDATE menu_items SET sort_order = $1 WHERE id = $2', [index, id]);
        });
        await Promise.all(updatePromises);
        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Menu items reordered successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

// --- API for Updating a Single Menu Item's Sort Order ---
app.put('/api/menu-items/:id/sort-order', authenticateToken('admin'), apiLimiter,
    [
        body('sort_order').isNumeric().withMessage('Sort order must be a number.')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { sort_order } = req.body;

        const result = await pool.query(
            'UPDATE menu_items SET sort_order = $1 WHERE id = $2 RETURNING id, sort_order',
            [sort_order, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        }
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.put('/api/menu-items/:id', authenticateToken('admin'), apiLimiter,
    [
        body('name_th').notEmpty().withMessage('กรุณากรอกชื่อเมนู'),
        body('price').isFloat({ gt: 0 }).withMessage('ราคาต้องเป็นตัวเลขและมากกว่า 0'),
        body('category_id').notEmpty().withMessage('กรุณาเลือกหมวดหมู่'),
        body('manage_stock').isBoolean().withMessage('กรุณาระบุสถานะการจัดการสต็อก'),
        body('current_stock').isInt({ min: 0 }).withMessage('สต็อกต้องเป็นเลขจำนวนเต็ม 0 หรือมากกว่า')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { name_th, price, category_id, name_en, desc_th, desc_en, image_url, stock_status, discount_percentage, current_stock, manage_stock } = req.body;

        let finalStockStatus = stock_status;
        if (manage_stock && current_stock > 0) finalStockStatus = 'in_stock';

        let isRecommendedStatus = false;
        if (category_id) {
            const categoryResult = await pool.query('SELECT name_th FROM categories WHERE id = $1', [category_id]);
            if (categoryResult.rows.length > 0 && categoryResult.rows[0].name_th === 'เมนูแนะนำ') isRecommendedStatus = true;
        }

        const query = `
            UPDATE menu_items
            SET name_th = $1, price = $2, category_id = $3, name_en = $4, desc_th = $5, desc_en = $6, image_url = $7, stock_status = $8, discount_percentage = $9, is_recommended = $10, current_stock = $11, manage_stock = $12
            WHERE id = $13 RETURNING *;
        `;
        const values = [name_th, price, category_id, name_en, desc_th, desc_en, image_url, finalStockStatus, discount_percentage, isRecommendedStatus, current_stock, manage_stock, id];
        const result = await pool.query(query, values);
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/menu-items/:id', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        res.json({ status: 'success', message: 'Menu item deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

app.post('/api/update-stock', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    try {
        const { itemId, stockStatus } = req.body;
        const result = await pool.query(
            'UPDATE menu_items SET stock_status = $1 WHERE id = $2 RETURNING *',
            [stockStatus, itemId]
        );
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.get('/api/users', authenticateToken('admin'), async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, username, role, full_name FROM users ORDER BY username');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/users', authenticateToken('admin'), apiLimiter,
    [
        body('username').notEmpty().withMessage('Username is required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
        body('role').isIn(['admin', 'cashier', 'kitchen', 'bar']).withMessage('Invalid role specified')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { username, password, role, full_name } = req.body;
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, role, full_name) VALUES ($1, $2, $3, $4) RETURNING id, username, role, full_name',
            [username, password_hash, role, full_name]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.put('/api/users/:id', authenticateToken('admin'), apiLimiter,
    [
        body('role').isIn(['admin', 'cashier', 'kitchen', 'bar']).withMessage('Invalid role specified'),
        body('password').optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { role, password, full_name } = req.body;

        let query = 'UPDATE users SET role = $1, full_name = $2';
        const queryParams = [role, full_name, id];

        if (password && password.trim() !== '') {
            const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
            query += ', password_hash = $4 WHERE id = $5 RETURNING id';
            queryParams.splice(2, 0, password_hash);
            queryParams[4] = id;
        } else {
            query += ' WHERE id = $3 RETURNING id';
        }

        await pool.query(query, queryParams);
        res.json({ status: 'success', message: 'User updated successfully.' });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/users/:id', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'User not found.' });
        res.json({ status: 'success', message: 'User deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/get-orders', authenticateToken('kitchen', 'bar', 'admin'), async (req, res, next) => {
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

    } catch (error) {
        next(error);
    }
});

app.post('/api/update-status', authenticateToken('kitchen', 'bar', 'admin'), apiLimiter, async (req, res, next) => {
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
            broadcast({ type: 'orderStatusUpdate', order: result.rows[0] });
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
            broadcast({ type: 'orderStatusUpdate', order: finalResult.rows[0] });
            return res.json({ status: 'success', data: finalResult.rows[0] });
        }

        await client.query('COMMIT');
        broadcast({ type: 'orderStatusUpdate', order: updatedOrder });
        res.json({ status: 'success', data: updatedOrder });

    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

app.get('/api/tables', authenticateToken('cashier', 'admin'), async (req, res, next) => {
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
        next(error);
    }
});

app.post('/api/clear-table', authenticateToken('cashier', 'admin'), apiLimiter, async (req, res, next) => {
    try {
        const { tableName } = req.body;
        await pool.query("UPDATE orders SET status = 'Paid' WHERE table_name = $1 AND status != 'Paid'", [tableName]);
        await pool.query("UPDATE tables SET status = 'Available' WHERE name = $1", [tableName]);

        broadcast({ type: 'tableCleared', tableName });
        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        next(error);
    }
});

app.post('/api/apply-discount', authenticateToken('cashier', 'admin'), apiLimiter, async (req, res, next) => {
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

        const discountedByUser = req.user.username;

        for (const order of ordersResult.rows) {
            const subtotal = parseFloat(order.subtotal);
            const discountAmount = subtotal * (discountPercentage / 100);
            const newTotal = subtotal - discountAmount;

            await pool.query(
                'UPDATE orders SET discount_percentage = $1, discount_amount = $2, total = $3, discount_by = $4 WHERE id = $5',
                [discountPercentage, discountAmount, newTotal, discountedByUser, order.id]
            );
        }

        broadcast({ type: 'discountApplied', tableName });
        res.json({ status: 'success', message: `Discount of ${discountPercentage}% applied to table ${tableName}.` });
    } catch (error) {
        next(error);
    }
});

app.get('/api/takeaway-orders', authenticateToken('cashier', 'admin'), async (req, res, next) => {
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
            WHERE (table_name LIKE 'Takeaway-%' OR table_name LIKE 'Bar-%') AND status != 'Paid'
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
        next(error);
    }
});

app.post('/api/clear-takeaway', authenticateToken('cashier', 'admin'), apiLimiter, async (req, res, next) => {
    try {
        const { tableName } = req.body;
        if (!tableName || (!tableName.startsWith('Takeaway-') && !tableName.startsWith('Bar-'))) {
            return res.status(400).json({ status: 'error', message: 'Invalid order name.' });
        }
        await pool.query("UPDATE orders SET status = 'Paid' WHERE table_name = $1 AND status != 'Paid'", [tableName]);
        broadcast({ type: 'takeawayCleared', tableName });
        res.json({ status: 'success', message: `Order ${tableName} cleared.` });
    } catch (error) {
        next(error);
    }
});

app.get('/api/tables-management', authenticateToken('admin'), async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, name, sort_order FROM tables ORDER BY sort_order ASC, name ASC');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/tables', authenticateToken('admin'), apiLimiter,
    [
        body('name').notEmpty().withMessage('Table name is required')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, sort_order } = req.body;
        const result = await pool.query(
            'INSERT INTO tables (name, sort_order) VALUES ($1, $2) RETURNING *',
            [name, sort_order || 99]
        );
        res.status(201).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.put('/api/tables/reorder', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ status: 'error', message: 'Invalid order data provided.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatePromises = order.map((id, index) => {
            return client.query('UPDATE tables SET sort_order = $1 WHERE id = $2', [index, id]);
        });
        await Promise.all(updatePromises);
        await client.query('COMMIT');
        res.json({ status: 'success', message: 'Tables reordered successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

app.put('/api/tables/:id', authenticateToken('admin'), apiLimiter,
    [
        body('name').notEmpty().withMessage('Table name is required')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { name, sort_order } = req.body;
        const result = await pool.query(
            'UPDATE tables SET name = $1, sort_order = $2 WHERE id = $3 RETURNING *',
            [name, sort_order || 99, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Table not found.' });
        }
        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/tables/:id', authenticateToken('admin'), apiLimiter, async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM tables WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Table not found.' });
        }

        res.json({ status: 'success', message: 'Table deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/bar-categories', async (req, res, next) => {
    try {
        const query = `
            SELECT id, name_th, name_en
            FROM categories
            WHERE station_type = 'bar'
            ORDER BY sort_order ASC`;
        const result = await pool.query(query);
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
});

app.get('/api/categories-by-station', authenticateToken('kitchen', 'bar', 'admin'), async (req, res, next) => {
    try {
        const { station } = req.query;
        if (!station) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุ station' });
        }
        const categoriesResult = await pool.query('SELECT name_th FROM categories WHERE station_type = $1', [station]);
        const targetCategories = categoriesResult.rows.map(row => row.name_th);
        res.json({ status: 'success', data: targetCategories });
    } catch (error) {
        next(error);
    }
});

app.get('/api/stock-items', authenticateToken('admin'), async (req, res, next) => {
    try {
        const query = `
            SELECT id, name_th, current_stock
            FROM menu_items
            WHERE manage_stock = true
            ORDER BY name_th ASC;
        `;
        const result = await pool.query(query);
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        next(error);
    }
});

app.put('/api/update-item-stock/:id', authenticateToken('admin'), apiLimiter,
    [
        body('current_stock').isNumeric().withMessage('Current stock must be a number.')
    ],
    async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { current_stock } = req.body;

        const newStock = parseInt(current_stock, 10);
        const newStatus = newStock > 0 ? 'in_stock' : 'out_of_stock';

        const result = await pool.query(
            'UPDATE menu_items SET current_stock = $1, stock_status = $2 WHERE id = $3 RETURNING id, name_th, current_stock, stock_status',
            [newStock, newStatus, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: 'Menu item not found.' });
        }

        res.json({ status: 'success', data: result.rows[0] });

    } catch (error) {
        next(error);
    }
});

app.get('/api/dashboard-kds', authenticateToken('admin'), async (req, res, next) => {
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
            SELECT id, table_name, discount_percentage, discount_amount, total, discount_by
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
        next(error);
    }
});


app.get('/api/next-bar-number', authenticateToken('bar', 'admin', 'cashier'), async (req, res, next) => {
    try {
        await pool.query("SET TimeZone = 'Asia/Bangkok';");
        const query = `
            SELECT table_name FROM orders
            WHERE table_name LIKE 'Bar-%' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE
            ORDER BY created_at DESC
            LIMIT 1;
        `;
        const result = await pool.query(query);

        let nextNumber = 1;
        if (result.rows.length > 0) {
            const lastNumber = parseInt(result.rows[0].table_name.split('-')[1] || '0', 10);
            nextNumber = lastNumber + 1;
        }
        res.json({ status: 'success', nextNumber });
    } catch (error) {
        next(error);
    }
});


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