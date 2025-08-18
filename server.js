/**
 * B5 Restaurant Backend Server (v3 - Truly Complete)
 * เซิร์ฟเวอร์สำหรับจัดการระบบร้านอาหาร B5
 * รวมทุกฟังก์ชันจากไฟล์ต้นฉบับและปรับปรุงโครงสร้างใหม่
 */

// 1. นำเข้า Library ที่จำเป็น
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

// ===============================================
//           การตั้งค่า (Configuration)
// ===============================================

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SPREADSHEET_ID = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw';

// --- Authentication & Security Configuration ---
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');

if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD || !process.env.GOOGLE_CREDENTIALS) {
    console.warn('คำเตือน: Environment variables ที่จำเป็น (JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, GOOGLE_CREDENTIALS) ยังไม่ได้ตั้งค่า!');
}

/**
 * Helper Function: สร้าง Client สำหรับ Google Sheets เพื่อลดโค้ดซ้ำซ้อน
 */
async function getGoogleSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

// ===============================================
//            WebSocket Server Setup
// ===============================================
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
    console.log('Client connected via WebSocket');
    clients.add(ws);
    ws.on('close', () => {
        console.log('Client disconnected');
        clients.delete(ws);
    });
    ws.on('error', (error) => console.error('WebSocket Error:', error));
});


// ===============================================
//        Middleware สำหรับยืนยันตัวตน (JWT)
// ===============================================
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

// ===============================================
//               API Endpoints
// ===============================================

app.get('/', (req, res) => res.status(200).send('B5 Restaurant Backend is running!'));

// --- Authentication API ---
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const payload = { username, role: 'admin' };
            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
            res.json({ status: 'success', message: 'Login successful!', token });
        } else {
            res.status(401).json({ status: 'error', message: 'Username หรือ Password ไม่ถูกต้อง' });
        }
    } catch (error) {
        console.error('Login API Error:', error);
        res.status(500).json({ status: 'error', message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// --- Admin Panel: Menu Management APIs ---
app.post('/api/menu-items', authenticateToken, async (req, res) => {
    try {
        const { name_th, price, category_th, name_en, desc_th, desc_en, image_url } = req.body;
        if (!name_th || !price || !category_th) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }
        const sheets = await getGoogleSheetsClient();
        const newId = `food-${Date.now()}`;
        const newRow = [newId, name_th, name_en || '', desc_th || '', desc_en || '', price, category_th, '', '', 'in_stock', image_url || ''];
        await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'Food Menu!A:K', valueInputOption: 'USER_ENTERED', resource: { values: [newRow] } });
        res.status(201).json({ status: 'success', message: 'Menu item created successfully!', data: { id: newId } });
    } catch (error) {
        console.error('API Error /api/menu-items (POST):', error);
        res.status(500).json({ status: 'error', message: 'Failed to create menu item.' });
    }
});

app.put('/api/menu-items/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updatedData = req.body;
        const sheets = await getGoogleSheetsClient();
        const getRows = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Food Menu!A:K' });
        const rows = getRows.data.values;
        if (!rows) return res.status(404).json({ status: 'error', message: 'Menu sheet not found.' });
        const rowIndex = rows.findIndex(row => row && row[0] === id);
        if (rowIndex === -1) return res.status(404).json({ status: 'error', message: 'Menu item not found' });
        const rowToUpdate = rowIndex + 1;
        const existingRow = rows[rowIndex];
        const newRowData = [id, updatedData.name_th || existingRow[1], updatedData.name_en || existingRow[2], updatedData.desc_th || existingRow[3], updatedData.desc_en || existingRow[4], updatedData.price || existingRow[5], updatedData.category_th || existingRow[6], updatedData.category_en || existingRow[7], updatedData.options_id !== undefined ? updatedData.options_id : existingRow[8], updatedData.stock_status || existingRow[9], updatedData.image_url !== undefined ? updatedData.image_url : existingRow[10]];
        await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `Food Menu!A${rowToUpdate}:K${rowToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [newRowData] } });
        res.status(200).json({ status: 'success', message: 'Menu item updated successfully!' });
    } catch (error) {
        console.error(`API Error /api/menu-items/:id (PUT):`, error);
        res.status(500).json({ status: 'error', message: 'Failed to update menu item.' });
    }
});

app.delete('/api/menu-items/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const sheets = await getGoogleSheetsClient();
        const getRows = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Food Menu!A:A' });
        const rows = getRows.data.values;
        if (!rows) return res.status(404).json({ status: 'error', message: 'Menu sheet not found.' });
        const rowIndex = rows.findIndex(row => row && row[0] === id);
        if (rowIndex === -1) return res.status(404).json({ status: 'error', message: 'Menu item not found' });
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheet = sheetMetadata.data.sheets.find(s => s.properties.title === 'Food Menu');
        if (!sheet) return res.status(404).json({ status: 'error', message: 'Sheet "Food Menu" not found' });
        const request = { deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } };
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { requests: [request] } });
        res.status(200).json({ status: 'success', message: 'Menu item deleted successfully!' });
    } catch (error) {
        console.error(`API Error /api/menu-items/:id (DELETE):`, error);
        res.status(500).json({ status: 'error', message: 'Failed to delete menu item.' });
    }
});

// --- Dashboard API (เวอร์ชันปรับปรุงล่าสุด) ---
app.get('/api/dashboard-data', authenticateToken, async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const ordersResponse = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Orders!A:G' });
        const orderRows = ordersResponse.data.values || [];
        if (orderRows.length <= 1) return res.json({ status: 'success', data: {} });

        const { startDate: startDateQuery, endDate: endDateQuery } = req.query;
        let startDate, endDate;
        if (startDateQuery && endDateQuery) {
            startDate = new Date(startDateQuery + 'T00:00:00');
            endDate = new Date(endDateQuery + 'T23:59:59');
        } else {
            const now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        }

        const parseThaiDate = (thaiDateStr) => {
            if (!thaiDateStr || !thaiDateStr.includes(' ')) return null;
            try {
                const [datePart, timePart] = thaiDateStr.split(' ');
                const [day, month, year] = datePart.split('/').map(Number);
                const [hours, minutes, seconds] = timePart.split(':').map(Number);
                return new Date(year - 543, month - 1, day, hours, minutes, seconds);
            } catch { return null; }
        };

        const paidOrdersInRange = orderRows.slice(1).filter(row => {
            if (!row || row.length < 6 || row[5]?.toLowerCase() !== 'paid') return false;
            const orderDate = parseThaiDate(row[0]);
            return orderDate && orderDate >= startDate && orderDate <= endDate;
        });

        let totalSales = 0, totalOrders = paidOrdersInRange.length;
        const itemSales = {}, salesByCategory = {}, salesByDay = {}, salesByHour = Array(24).fill(0);

        paidOrdersInRange.forEach(row => {
            try {
                const orderDate = parseThaiDate(row[0]);
                const items = JSON.parse(row[2]);
                let subtotal = 0;
                items.forEach(item => {
                    const itemTotal = (item.price || 0) * (item.quantity || 1);
                    subtotal += itemTotal;
                    itemSales[item.name_th || 'Unknown'] = (itemSales[item.name_th || 'Unknown'] || 0) + item.quantity;
                    salesByCategory[item.category_th || 'Uncategorized'] = (salesByCategory[item.category_th || 'Uncategorized'] || 0) + itemTotal;
                });
                totalSales += subtotal;
                if (orderDate) {
                    salesByHour[orderDate.getHours()] += subtotal;
                    const dayKey = orderDate.toISOString().split('T')[0];
                    salesByDay[dayKey] = (salesByDay[dayKey] || 0) + subtotal;
                }
            } catch {}
        });
        
        const totalDiscount = paidOrdersInRange.reduce((sum, row) => sum + (parseFloat(row[6]) || 0), 0);
        const netRevenue = totalSales - totalDiscount;
        const averageOrderValue = totalOrders > 0 ? netRevenue / totalOrders : 0; 
        const topSellingItems = Object.entries(itemSales).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, quantity]) => ({ name, quantity }));
        const sortedSalesByDay = Object.fromEntries(Object.entries(salesByDay).sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB)));

        res.json({ status: 'success', data: { kpis: { totalSales, totalDiscount, netRevenue, totalOrders, averageOrderValue }, topSellingItems, salesByCategory, salesByDay: sortedSalesByDay, salesByHour } });
    } catch (error) {
        console.error('API Error /api/dashboard-data (GET):', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch dashboard data.' });
    }
});

// --- Customer, KDS, and POS APIs ---
app.get('/api/menu', async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const [menuResponse, optionsResponse] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Food Menu!A:K' }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Food Options!A:D' })
        ]);
        const menuRows = menuResponse.data.values || [];
        const optionRows = optionsResponse.data.values || [];
        if (menuRows.length <= 1) return res.json({ status: 'success', data: [] });

        const menuHeaders = menuRows.shift();
        if(optionRows.length > 0) optionRows.shift();
        
        const optionsMap = optionRows.reduce((map, row) => {
            const [optionSetId, label_th, label_en, price_add] = row;
            if (!map[optionSetId]) map[optionSetId] = [];
            map[optionSetId].push({ label_th, label_en, price_add: parseFloat(price_add) || 0 });
            return map;
        }, {});

        const menuData = menuRows.map(row => {
            const item = {};
            menuHeaders.forEach((header, index) => item[header] = row[index]);
            const optionIds = item.options_id ? item.options_id.split(',') : [];
            item.option_groups = optionIds.reduce((groups, id) => {
                if (optionsMap[id]) groups[id] = optionsMap[id];
                return groups;
            }, {});
            return item;
        });
        res.json({ status: 'success', data: menuData });
    } catch (error) {
        console.error('API Error /api/menu (GET):', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch menu.' });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { cart, total, tableNumber, specialRequest } = req.body;
        const sheets = await getGoogleSheetsClient();
        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        const newRow = [timestamp, tableNumber || 'N/A', JSON.stringify(cart), total, specialRequest || '', 'Pending', ''];
        const appendResult = await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'Orders!A:G', valueInputOption: 'USER_ENTERED', resource: { values: [newRow] } });
        const newRowNumber = parseInt(appendResult.data.updates.updatedRange.match(/\d+$/)[0], 10);
        broadcast({ type: 'NEW_ORDER', payload: { rowNumber: newRowNumber, timestamp: newRow[0], table: newRow[1], items: cart, special_request: newRow[4], status: newRow[5] } });
        res.status(201).json({ status: 'success', message: 'Order created successfully!' });
    } catch (error) {
        console.error('API Error /api/orders (POST):', error);
        res.status(500).json({ status: 'error', message: 'Failed to create order.' });
    }
});

app.get('/api/get-orders', async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Orders!A:F' });
        const rows = response.data.values || [];
        if (rows.length <= 1) return res.json({ status: 'success', data: [] });
        const activeStatuses = new Set(['pending', 'cooking', 'serving']);
        const pendingOrders = rows.slice(1).map((row, index) => {
            const status = (row[5] || 'Pending').toLowerCase();
            if (!activeStatuses.has(status)) return null;
            let items = [];
            try { items = JSON.parse(row[2]); } catch {}
            return { rowNumber: index + 2, timestamp: row[0], table: row[1], items, total: parseFloat(row[3]) || 0, special_request: row[4], status: row[5] };
        }).filter(Boolean);
        res.json({ status: 'success', data: pendingOrders });
    } catch (error) {
        console.error('API Error /api/get-orders (GET):', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch orders.' });
    }
});

app.post('/api/update-status', async (req, res) => {
    try {
        const { rowNumber, newStatus } = req.body;
        if (!rowNumber || !newStatus) return res.status(400).json({ status: 'error', message: 'Missing rowNumber or newStatus' });
        const sheets = await getGoogleSheetsClient();
        await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `Orders!F${rowNumber}`, valueInputOption: 'USER_ENTERED', resource: { values: [[newStatus]] } });
        broadcast({ type: 'STATUS_UPDATE', payload: { rowNumber, newStatus } });
        res.json({ status: 'success', message: `Order status updated` });
    } catch (error) {
        console.error('API Error /api/update-status (POST):', error);
        res.status(500).json({ status: 'error', message: 'Failed to update status.' });
    }
});

app.get('/api/tables', async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const [ordersResponse, discountsResponse] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Orders!A:F' }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Discounts!A:B' })
        ]);
        const orderRows = ordersResponse.data.values || [];
        const discountRows = discountsResponse.data.values || [];
        const discountsMap = discountRows.slice(1).reduce((map, row) => {
            if (row && row[0]) map[row[0]] = parseFloat(row[1]) || 0;
            return map;
        }, {});
        if (orderRows.length <= 1) return res.json({ status: 'success', data: {} });
        
        const activeOrders = orderRows.slice(1).filter(row => row && row.length >= 6 && row[5]?.toLowerCase() !== 'paid');
        const tablesData = {};
        activeOrders.forEach(row => {
            const table = row[1];
            if (!table) return;
            if (!tablesData[table]) tablesData[table] = { tableName: table, orders: [], status: 'occupied' };
            let items = [];
            try { items = JSON.parse(row[2]); } catch {}
            tablesData[table].orders.push(...items);
            if (row[5]?.toLowerCase() === 'billing') tablesData[table].status = 'billing';
        });

        for (const tableName in tablesData) {
            const subtotal = tablesData[tableName].orders.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
            const discountPercentage = discountsMap[tableName] || 0;
            const discountAmount = subtotal * (discountPercentage / 100);
            tablesData[tableName] = { ...tablesData[tableName], subtotal, discountPercentage, discountAmount, total: subtotal - discountAmount };
        }
        res.json({ status: 'success', data: tablesData });
    } catch (error) {
        console.error('API Error /api/tables (GET):', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table statuses.' });
    }
});

app.get('/api/all-tables', async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Tables!A2:A' });
        const rows = response.data.values;
        if (!rows || rows.length === 0) return res.json({ status: 'success', data: [] });
        res.json({ status: 'success', data: rows.flat() });
    } catch (error) {
        console.error('API Error /api/all-tables (GET):', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table list.' });
    }
});

app.post('/api/clear-table', async (req, res) => {
    try {
        const { tableName } = req.body;
        if (!tableName) return res.status(400).json({ status: 'error', message: 'Missing tableName' });
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Orders!B:F' });
        const rows = response.data.values || [];
        if (rows.length <= 1) return res.status(404).json({ status: 'error', message: 'No orders found' });

        const requests = rows.slice(1).map((row, index) => {
            if (row[0] === tableName && row[4]?.toLowerCase() !== 'paid') {
                return { range: `Orders!F${index + 2}`, values: [['Paid']] };
            }
        }).filter(Boolean);
        
        if (requests.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { valueInputOption: 'USER_ENTERED', data: requests } });
        }
        
        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'Discounts!A:C', valueInputOption: 'USER_ENTERED', resource: { values: [[tableName, 0, timestamp]] } });
        
        broadcast({ type: 'TABLE_CLEARED', payload: { tableName } });
        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        console.error('API Error /api/clear-table (POST):', error);
        res.status(500).json({ status: 'error', message: 'Failed to clear table.' });
    }
});

app.post('/api/request-bill', async (req, res) => {
    try {
        const { tableName } = req.body;
        if (!tableName) return res.status(400).json({ status: 'error', message: 'Missing tableName' });
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Orders!B:F' });
        const rows = response.data.values || [];
        if (rows.length <= 1) return res.status(404).json({ status: 'error', message: 'No orders found' });

        const requests = rows.slice(1).map((row, index) => {
            if (row[0] === tableName && row[4] && row[4].toLowerCase() !== 'paid' && row[4].toLowerCase() !== 'billing') {
                return { range: `Orders!F${index + 2}`, values: [['Billing']] };
            }
        }).filter(Boolean);
        
        if (requests.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { valueInputOption: 'USER_ENTERED', data: requests } });
            broadcast({ type: 'BILL_REQUESTED', payload: { tableName } });
        }
        res.json({ status: 'success', message: `Table ${tableName} requested for billing.` });
    } catch (error) {
        console.error('API Error /api/request-bill (POST):', error);
        res.status(500).json({ status: 'error', message: 'Failed to request bill.' });
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Food Menu!G2:H' });
        const rows = response.data.values || [];
        if (rows.length === 0) return res.json({ status: 'success', data: [] });
        
        const uniqueCategories = [];
        const seenCategories = new Set();
        rows.forEach(row => {
            const [category_th, category_en] = row;
            if (category_th && !seenCategories.has(category_th)) {
                seenCategories.add(category_th);
                uniqueCategories.push({ category_th, category_en });
            }
        });
        res.json({ status: 'success', data: uniqueCategories });
    } catch (error) {
        console.error('API Error /api/categories (GET):', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch categories.' });
    }
});

app.get('/api/order-status', async (req, res) => {
    try {
        const { table } = req.query;
        if (!table) return res.status(400).json({ status: 'error', message: 'Table number is required' });
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Orders!A:F' });
        const rows = response.data.values || [];
        if (rows.length <= 1) return res.json({ status: 'success', data: [] });

        const activeStatuses = new Set(['paid', 'completed']);
        const activeOrders = rows.slice(1).map((row, index) => {
            if (row[1] !== table || activeStatuses.has(row[5]?.toLowerCase())) return null;
            let items = [];
            try { items = JSON.parse(row[2]); } catch {}
            return { id: index + 2, timestamp: row[0], items, status: row[5] };
        }).filter(Boolean);
        res.json({ status: 'success', data: activeOrders });
    } catch (error) {
        console.error('API Error /api/order-status (GET):', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch order status.' });
    }
});

app.post('/api/apply-discount', authenticateToken, async (req, res) => { 
    const { tableName, discountPercentage } = req.body;
    if (!tableName || discountPercentage === undefined) {
        return res.status(400).json({ status: 'error', message: 'Missing tableName or discountPercentage' });
    }
    const percentage = parseFloat(discountPercentage);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
        return res.status(400).json({ status: 'error', message: 'Invalid percentage value' });
    }
    try {
        const sheets = await getGoogleSheetsClient();
        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        const newRow = [tableName, percentage, timestamp];
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Discounts!A:C',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRow] },
        });
        broadcast({ type: 'DISCOUNT_APPLIED', payload: { tableName } });
        res.json({ status: 'success', message: `Discount of ${percentage}% applied to table ${tableName}` });
    } catch (error) {
        console.error('API /apply-discount error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to apply discount.' });
    }
});

// ===============================================
//                Server Start
// ===============================================
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});