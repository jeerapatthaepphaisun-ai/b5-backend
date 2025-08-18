// 1. นำเข้า Library ที่จำเป็น
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { zonedTimeToUtc, utcToZonedTime, format } = require('date-fns-tz');

// 2. ตั้งค่า Express Server
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// 3. ใช้ Middleware
app.use(cors());
app.use(express.json());

// 4. ตั้งค่าส่วนกลาง (Global Configuration)
const spreadsheetId = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw';
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');

// ---- Authentication Config ----
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// ---- End Authentication Config ----


// ===============================================
//         WebSocket Server Setup
// ===============================================
const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(data) {
    const message = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    }
}

wss.on('connection', (ws) => {
    console.log('A client connected (KDS or POS)');
    clients.add(ws);
    ws.on('close', () => {
        console.log('A client disconnected');
        clients.delete(ws);
    });
    ws.on('error', (error) => console.error('WebSocket error:', error));
});

// ===============================================
//               API Endpoints
// ===============================================

app.get('/', (req, res) => {
  res.status(200).send('B5 Restaurant Backend is running!');
});


// ===============================================
//         Authentication API
// ===============================================
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            
            const payload = { 
                username: username,
                role: 'admin'
            };

            const token = jwt.sign(
                payload, 
                JWT_SECRET, 
                { expiresIn: '8h' }
            );
            
            res.json({ 
                status: 'success', 
                message: 'Login successful!', 
                token: token 
            });

        } else {
            res.status(401).json({ status: 'error', message: 'Username หรือ Password ไม่ถูกต้อง' });
        }
    } catch (error) {
        console.error('Login API Error:', error);
        res.status(500).json({ status: 'error', message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
//         Authentication Middleware
// ===============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.sendStatus(401); 
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.sendStatus(403);
        }
        
        req.user = user;
        next(); 
    });
}


// --- Admin Panel API Endpoints ---

app.post('/api/menu-items', authenticateToken, async (req, res) => {
    const { 
        name_th, name_en, desc_th, desc_en, price, 
        category_th, category_en, image_url 
    } = req.body;

    if (!name_th || !price || !category_th) {
        return res.status(400).json({ status: 'error', message: 'Missing required fields: name_th, price, category_th' });
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const newId = `food-${Date.now()}`;
        const newRow = [
            newId, name_th, name_en || '', desc_th || '', desc_en || '',
            price, category_th, category_en || '', '', 'in_stock', image_url || ''
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Food Menu!A:K',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRow] },
        });

        res.status(201).json({ status: 'success', message: 'Menu item created successfully!', data: { id: newId } });

    } catch (error) {
        console.error('API /api/menu-items error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create menu item.' });
    }
});

app.put('/api/menu-items/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const updatedData = req.body;

    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const getRows = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Food Menu!A:K',
        });

        const rows = getRows.data.values;
        const rowIndex = rows.findIndex(row => row[0] === id);

        if (rowIndex === -1) {
            return res.status(404).json({ status: 'error', message: 'Menu item not found' });
        }

        const rowToUpdate = rowIndex + 1;
        const newRowData = [
            id,
            updatedData.name_th || rows[rowIndex][1],
            updatedData.name_en || rows[rowIndex][2],
            updatedData.desc_th || rows[rowIndex][3],
            updatedData.desc_en || rows[rowIndex][4],
            updatedData.price || rows[rowIndex][5],
            updatedData.category_th || rows[rowIndex][6],
            updatedData.category_en || rows[rowIndex][7],
            updatedData.options_id !== undefined ? updatedData.options_id : rows[rowIndex][8],
            updatedData.stock_status || rows[rowIndex][9],
            updatedData.image_url !== undefined ? updatedData.image_url : rows[rowIndex][10],
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Food Menu!A${rowToUpdate}:K${rowToUpdate}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRowData] },
        });

        res.status(200).json({ status: 'success', message: 'Menu item updated successfully!' });

    } catch (error) {
        console.error(`API /api/menu-items/${id} error:`, error);
        res.status(500).json({ status: 'error', message: 'Failed to update menu item.' });
    }
});

app.delete('/api/menu-items/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const getRows = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Food Menu!A:A', 
        });

        const rows = getRows.data.values;
        if (!rows) {
             return res.status(404).json({ status: 'error', message: 'Menu sheet is empty or not found' });
        }
        
        const rowIndex = rows.findIndex(row => row && row[0] === id);

        if (rowIndex === -1) {
            return res.status(404).json({ status: 'error', message: 'Menu item not found' });
        }

        const sheetMetadata = await sheets.spreadsheets.get({
            spreadsheetId,
        });
        const sheet = sheetMetadata.data.sheets.find(s => s.properties.title === 'Food Menu');
        if (!sheet) {
            return res.status(404).json({ status: 'error', message: 'Sheet "Food Menu" not found' });
        }
        const sheetId = sheet.properties.sheetId;

        const request = {
            deleteDimension: {
                range: {
                    sheetId: sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1
                }
            }
        };

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
                requests: [request]
            }
        });

        res.status(200).json({ status: 'success', message: 'Menu item deleted successfully!' });

    } catch (error) {
        console.error(`API DELETE /api/menu-items/${id} error:`, error);
        res.status(500).json({ status: 'error', message: 'Failed to delete menu item.' });
    }
});


// ===============================================
//         Dashboard API (เวอร์ชันปรับปรุงใหม่)
// ===============================================
app.get('/api/dashboard-data', authenticateToken, async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const ordersResponse = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: 'Orders!A:G' 
        });
        const orderRows = ordersResponse.data.values || [];
        if (orderRows.length <= 1) {
            return res.json({ status: 'success', data: {} });
        }

        // --- ส่วนที่เพิ่มเข้ามา: การรับ startDate และ endDate ---
        const { startDate: startDateQuery, endDate: endDateQuery } = req.query;
        let startDate, endDate;

        if (startDateQuery && endDateQuery) {
            // ใช้ช่วงวันที่จาก query ถ้ามี
            startDate = new Date(startDateQuery + 'T00:00:00');
            endDate = new Date(endDateQuery + 'T23:59:59');
        } else {
            // ถ้าไม่มี ให้ใช้เป็น "วันนี้"
            const now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        }

        // Helper function สำหรับแปลงวันที่ (พ.ศ.) ให้ถูกต้อง
        const parseThaiDate = (thaiDateStr) => {
            if (!thaiDateStr || !thaiDateStr.includes(' ')) return null;
            try {
                const [datePart, timePart] = thaiDateStr.split(' ');
                const [day, month, year] = datePart.split('/').map(Number);
                const [hours, minutes, seconds] = timePart.split(':').map(Number);
                // แปลง พ.ศ. เป็น ค.ศ. (-543) และ เดือนใน JS เริ่มที่ 0 (-1)
                return new Date(year - 543, month - 1, day, hours, minutes, seconds);
            } catch (e) {
                return null;
            }
        };

        // กรองออเดอร์ตามเงื่อนไข (Paid และอยู่ในช่วงวันที่)
        const paidOrdersInRange = orderRows.slice(1).filter(row => {
            if (!row || row.length < 6 || row[5]?.toLowerCase() !== 'paid') {
                return false;
            }
            const orderDate = parseThaiDate(row[0]);
            return orderDate && orderDate >= startDate && orderDate <= endDate;
        });

        // --- ส่วนที่เพิ่มเข้ามา: การคำนวณ KPI ที่หลากหลายขึ้น ---
        let totalSales = 0;
        const totalOrders = paidOrdersInRange.length;
        const itemSales = {};
        const salesByCategory = {};
        const salesByDay = {};
        const salesByHour = Array(24).fill(0);

        paidOrdersInRange.forEach(row => {
            try {
                const orderDate = parseThaiDate(row[0]);
                const items = JSON.parse(row[2]);
                let subtotal = 0;

                items.forEach(item => {
                    const itemTotal = (item.price || 0) * (item.quantity || 1);
                    subtotal += itemTotal;
                    
                    const itemName = item.name_th || 'Unknown';
                    itemSales[itemName] = (itemSales[itemName] || 0) + item.quantity;

                    // KPI ใหม่: ยอดขายตามหมวดหมู่
                    const categoryName = item.category_th || 'Uncategorized';
                    salesByCategory[categoryName] = (salesByCategory[categoryName] || 0) + itemTotal;
                });
                totalSales += subtotal;

                if (orderDate) {
                    //- สำหรับกราฟยอดขายรายชั่วโมง
                    const hour = orderDate.getHours();
                    salesByHour[hour] += subtotal;

                    //- สำหรับกราฟแนวโน้มยอดขายรายวัน
                    const dayKey = orderDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
                    salesByDay[dayKey] = (salesByDay[dayKey] || 0) + subtotal;
                }
            } catch(e) { /* ข้ามรายการที่ข้อมูลผิดพลาด */ }
        });
        
        const totalDiscount = paidOrdersInRange.reduce((sum, row) => sum + (parseFloat(row[6]) || 0), 0);
        const netRevenue = totalSales - totalDiscount;
        // KPI ใหม่: ยอดขายเฉลี่ยต่อบิล
        const averageOrderValue = totalOrders > 0 ? netRevenue / totalOrders : 0; 
        
        const topSellingItems = Object.entries(itemSales)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, quantity]) => ({ name, quantity }));

        // จัดเรียงข้อมูล Sales by Day ตามวันที่
        const sortedSalesByDay = Object.fromEntries(
            Object.entries(salesByDay).sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
        );

        // ส่งข้อมูลทั้งหมดกลับไป
        const dashboardData = {
            kpis: {
                totalSales,
                totalDiscount,
                netRevenue,
                totalOrders,
                averageOrderValue, // KPI ใหม่
            },
            topSellingItems,
            salesByCategory,     // ข้อมูลใหม่
            salesByDay: sortedSalesByDay, // ข้อมูลใหม่
            salesByHour,
        };
        
        res.json({ status: 'success', data: dashboardData });

    } catch (error) {
        console.error('--- [CRITICAL ERROR] in dashboard API: ---', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch dashboard data.' });
    }
});


// ===============================================
//         Discount API
// ===============================================
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
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        const newRow = [tableName, percentage, timestamp];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Discounts!A:C',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRow] },
        });

        broadcast({
            type: 'DISCOUNT_APPLIED',
            payload: { tableName: tableName }
        });

        res.json({ status: 'success', message: `Discount of ${percentage}% applied to table ${tableName}` });

    } catch (error) {
        console.error('API /apply-discount error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to apply discount.' });
    }
});


// --- Customer, KDS, and POS API Endpoints ---
app.post('/api/orders', async (req, res) => {
    const { cart, total, tableNumber, specialRequest } = req.body;
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        const itemsJsonString = JSON.stringify(cart);
        const newRow = [ timestamp, tableNumber || 'N/A', itemsJsonString, total, specialRequest || '', 'Pending' ];

        const appendResult = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Orders!A:F',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRow] },
        });

        const updatedRange = appendResult.data.updates.updatedRange;
        const newRowNumber = parseInt(updatedRange.match(/\d+$/)[0], 10);
        broadcast({
            type: 'NEW_ORDER',
            payload: {
                rowNumber: newRowNumber,
                timestamp: newRow[0],
                table: newRow[1],
                items: cart,
                special_request: newRow[4],
                status: newRow[5],
            }
        });

        res.status(201).json({ status: 'success', message: 'Order created successfully!' });
    } catch (error) {
        console.error('API /orders error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create order.' });
    }
});

app.get('/api/get-orders', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:F',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.json({ status: 'success', data: [] });
        }

        rows.shift();
        
        const pendingOrders = rows.map((row, index) => {
            const status = row[5] || 'Pending';
            if (status.toLowerCase() === 'completed' || status.toLowerCase() === 'paid' || status.toLowerCase() === 'billing') {
                return null;
            }

            let itemsArray = [];
            try {
                itemsArray = JSON.parse(row[2]);
            } catch (e) { /* ignore */ }

            return {
                rowNumber: index + 2,
                timestamp: row[0],
                table: row[1],
                items: itemsArray,
                total: parseFloat(row[3]) || 0,
                special_request: row[4],
                status: status,
            };
        }).filter(order => order !== null);

        res.json({ status: 'success', data: pendingOrders });

    } catch (error) {
        console.error('API /get-orders error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch orders.' });
    }
});


app.post('/api/update-status', async (req, res) => {
    const { rowNumber, newStatus } = req.body;
    if (!rowNumber || !newStatus) {
        return res.status(400).json({ status: 'error', message: 'Missing rowNumber or newStatus' });
    }
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Orders!F${rowNumber}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[newStatus]] },
        });
        
        broadcast({
            type: 'STATUS_UPDATE',
            payload: {
                rowNumber: rowNumber,
                newStatus: newStatus
            }
        });

        res.json({ status: 'success', message: `Order at row ${rowNumber} updated to ${newStatus}` });
    } catch (error) {
        console.error('API /update-status error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update status.' });
    }
});

app.get('/api/menu', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const [menuResponse, optionsResponse] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId, range: 'Food Menu!A:K' }),
            sheets.spreadsheets.values.get({ spreadsheetId, range: 'Food Options!A:D' })
        ]);

        const menuRows = menuResponse.data.values;
        const optionRows = optionsResponse.data.values;

        if (!menuRows || menuRows.length <= 1) {
            return res.json({ status: 'success', data: [] });
        }

        menuRows.shift();
        if(optionRows) optionRows.shift();
        
        const optionsMap = {};
        if(optionRows){
            optionRows.forEach(row => {
                const optionSetId = row[0];
                if (!optionsMap[optionSetId]) optionsMap[optionSetId] = [];
                optionsMap[optionSetId].push({
                    label_th: row[1],
                    label_en: row[2],
                    price_add: parseFloat(row[3]) || 0
                });
            });
        }

        const headers = ['id', 'name_th', 'name_en', 'desc_th', 'desc_en', 'price', 'category_th', 'category_en', 'options_id', 'stock_status', 'image_url'];
        const menuData = menuRows.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index];
            });
            const optionIds = obj.options_id ? obj.options_id.split(',') : [];
            obj.option_groups = {};
            optionIds.forEach(id => {
                if (optionsMap[id]) {
                    obj.option_groups[id] = optionsMap[id];
                }
            });
            return obj;
        });

        res.json({ status: 'success', data: menuData });
    } catch (error) {
        console.error('API /menu error: ' + error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch menu.' });
    }
});

app.get('/api/all-tables', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Tables!A2:A',
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json({ status: 'success', data: [] });
        }

        const tableNames = rows.flat();
        res.json({ status: 'success', data: tableNames });

    } catch (error) {
        console.error('API /api/all-tables error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table list.' });
    }
});

app.get('/api/tables', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const [ordersResponse, discountsResponse] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId, range: 'Orders!A:F' }),
            sheets.spreadsheets.values.get({ spreadsheetId, range: 'Discounts!A:B' })
        ]);

        const orderRows = ordersResponse.data.values || [];
        const discountRows = discountsResponse.data.values || [];

        const discountsMap = {};
        if (discountRows.length > 1) {
            discountRows.slice(1).forEach(row => {
                if (row && row[0]) {
                    discountsMap[row[0]] = parseFloat(row[1]) || 0;
                }
            });
        }

        if (orderRows.length <= 1) {
            return res.json({ status: 'success', data: {} });
        }
        
        const activeOrders = orderRows.slice(1).filter(row => {
            return row && row.length >= 6 && row[5] && row[5].toLowerCase() !== 'paid';
        }).map(row => {
            let items;
            try { 
                items = JSON.parse(row[2]); 
            } catch (e) { 
                items = [{ name_th: row[2] || 'Unknown Item', price: parseFloat(row[3]) || 0, quantity: 1 }]; 
            }
            return { table: row[1], items: items, status: row[5] };
        });

        const tablesData = {};
        activeOrders.forEach(order => {
            if (!order.table) return;
            if (!tablesData[order.table]) {
                tablesData[order.table] = { tableName: order.table, orders: [], status: 'occupied' };
            }
            tablesData[order.table].orders.push(...order.items);
        });

        for (const tableName in tablesData) {
            const subtotal = tablesData[tableName].orders.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
            const discountPercentage = discountsMap[tableName] || 0;
            const discountAmount = subtotal * (discountPercentage / 100);
            const total = subtotal - discountAmount;

            tablesData[tableName].subtotal = subtotal;
            tablesData[tableName].discountPercentage = discountPercentage;
            tablesData[tableName].discountAmount = discountAmount;
            tablesData[tableName].total = total;
            
            if (activeOrders.some(o => o.table === tableName && o.status && o.status.toLowerCase() === 'billing')) {
                 tablesData[tableName].status = 'billing';
            }
        }

        res.json({ status: 'success', data: tablesData });

    } catch (error) {
        console.error('API /tables error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table statuses.' });
    }
});

app.post('/api/clear-table', async (req, res) => {
    const { tableName } = req.body;
    if (!tableName) {
        return res.status(400).json({ status: 'error', message: 'Missing tableName' });
    }
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:G',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(404).json({ status: 'error', message: 'No orders found' });
        }

        rows.shift();
        const requests = [];
        
        rows.forEach((row, index) => {
            const currentTable = row[1];
            const currentStatus = row[5];
            if (currentTable === tableName && currentStatus && currentStatus.toLowerCase() !== 'paid') {
                requests.push({
                    range: `Orders!F${index + 2}`,
                    values: [['Paid']]
                });
            }
        });
        
        if (requests.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: requests
                }
            });
            
            broadcast({
                type: 'TABLE_CLEARED',
                payload: { tableName: tableName }
            });
        }
        
        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Discounts!A:C',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[tableName, 0, timestamp]] },
        });

        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        console.error('API /clear-table error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to clear table.' });
    }
});

app.post('/api/request-bill', async (req, res) => {
    const { tableName } = req.body;
    if (!tableName) {
        return res.status(400).json({ status: 'error', message: 'Missing tableName' });
    }
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:F',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(404).json({ status: 'error', message: 'No orders found' });
        }

        rows.shift();
        const requests = [];
        
        rows.forEach((row, index) => {
            const currentTable = row[1];
            const currentStatus = row[5];
            if (currentTable === tableName && currentStatus && currentStatus.toLowerCase() !== 'paid' && currentStatus.toLowerCase() !== 'billing') {
                requests.push({
                    range: `Orders!F${index + 2}`,
                    values: [['Billing']]
                });
            }
        });
        
        if (requests.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: requests
                }
            });
            
            broadcast({
                type: 'BILL_REQUESTED',
                payload: { tableName: tableName }
            });
        }
        
        res.json({ status: 'success', message: `Table ${tableName} requested for billing.` });
    } catch (error) {
        console.error('API /request-bill error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to request bill.' });
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Food Menu!G2:H',
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json({ status: 'success', data: [] });
        }
        
        const uniqueCategories = [];
        const seenCategories = new Set();

        rows.forEach(row => {
            const category_th = row[0];
            const category_en = row[1];
            if (category_th && !seenCategories.has(category_th)) {
                seenCategories.add(category_th);
                uniqueCategories.push({ category_th, category_en });
            }
        });

        res.json({ status: 'success', data: uniqueCategories });

    } catch (error) {
        console.error('API /categories error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch categories.' });
    }
});

app.get('/api/order-status', async (req, res) => {
    const { table } = req.query;
    if (!table) {
        return res.status(400).json({ status: 'error', message: 'Table number is required' });
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:F',
        });
        
        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.json({ status: 'success', data: [] });
        }
        
        rows.shift();

        const activeOrders = rows
            .map((row, index) => ({
                rowNumber: index + 2,
                timestamp: row[0],
                tableName: row[1],
                itemsJson: row[2],
                status: row[5]
            }))
            .filter(order => 
                order.tableName === table &&
                order.status &&
                order.status.toLowerCase() !== 'paid' &&
                order.status.toLowerCase() !== 'completed'
            );

        if (activeOrders.length > 0) {
            const ordersWithDetails = activeOrders.map(order => {
                let items = [];
                try {
                    items = JSON.parse(order.itemsJson);
                } catch(e) { /* Do nothing */ }
                return {
                    id: order.rowNumber,
                    timestamp: order.timestamp,
                    items: items,
                    status: order.status
                };
            });
            res.json({ status: 'success', data: ordersWithDetails });
        } else {
            res.json({ status: 'success', data: [] });
        }

    } catch (error) {
        console.error('API /order-status error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch order status.' });
    }
});


// 5. เริ่มการทำงานของ Server
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});