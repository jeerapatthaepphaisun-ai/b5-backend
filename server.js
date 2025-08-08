// 1. นำเข้า Library ที่จำเป็น
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

// 2. ตั้งค่า Express Server
const app = express();
const PORT = process.env.PORT || 3000;

// 3. ใช้ Middleware
app.use(cors());
app.use(express.json());

// ===============================================
//               API Endpoints
// ===============================================

/**
 * Endpoint สำหรับดึงข้อมูลเมนูอาหารทั้งหมด
 */
app.get('/api/menu', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const spreadsheetId = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw'; // <== วาง ID ของคุณ

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

/**
 * Endpoint สำหรับรับและบันทึกคำสั่งซื้อใหม่
 */
app.post('/api/orders', async (req, res) => {
    const { cart, total, tableNumber } = req.body;
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const spreadsheetId = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw'; // <== วาง ID ของคุณ

        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        const itemsJsonString = JSON.stringify(cart);
        const newRow = [ timestamp, tableNumber || 'N/A', itemsJsonString, total, 'Pending' ];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Orders!A:E',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRow] },
        });

        res.status(201).json({ status: 'success', message: 'Order created successfully!' });
    } catch (error) {
        console.error('API /orders error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create order.' });
    }
});

/**
 * Endpoint สำหรับให้ KDS ดึงข้อมูลออเดอร์
 */
app.get('/api/get-orders', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: 'https://www.googleapis.com/auth/spreadsheets', // <== แก้ไข
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const spreadsheetId = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw'; // <== วาง ID ของคุณ

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:E',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.json({ status: 'success', data: [] });
        }

        rows.shift();
        const headers = ['timestamp', 'table', 'items', 'total', 'status'];
        
        const orders = rows.map((row, index) => {
            const order = {};
            headers.forEach((header, i) => {
                order[header] = row[i];
            });
            order.rowNumber = index + 2;
            try {
                const itemsArray = JSON.parse(order.items);
                order.items = itemsArray.map(item => 
                    `${item.name_th} (ตัวเลือก: ${item.selected_options_text_th}) x${item.quantity}`
                ).join('\n');
            } catch(e) { /* Do nothing if not JSON */ }
            return order;
        });

        const pendingOrders = orders.filter(order => order.status && order.status.toLowerCase() !== 'completed' && order.status.toLowerCase() !== 'paid');
        res.json({ status: 'success', data: pendingOrders });

    } catch (error) {
        console.error('API /get-orders error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch orders.' });
    }
});

/**
 * Endpoint สำหรับอัปเดตสถานะออเดอร์
 */
app.post('/api/update-status', async (req, res) => {
    const { rowNumber, newStatus } = req.body;
    if (!rowNumber || !newStatus) {
        return res.status(400).json({ status: 'error', message: 'Missing rowNumber or newStatus' });
    }
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const spreadsheetId = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw'; // <== วาง ID ของคุณ

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Orders!E${rowNumber}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[newStatus]] },
        });

        res.json({ status: 'success', message: `Order at row ${rowNumber} updated to ${newStatus}` });
    } catch (error) {
        console.error('API /update-status error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update status.' });
    }
});

/**
 * Endpoint สำหรับให้ POS/Cashier ดึงสถานะโต๊ะ
 */
app.get('/api/tables', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: 'https://www.googleapis.com/auth/spreadsheets', // <== แก้ไข
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const spreadsheetId = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw'; // <== วาง ID ของคุณ

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:E',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.json({ status: 'success', data: {} });
        }

        rows.shift();
        const headers = ['timestamp', 'table', 'items', 'total', 'status'];
        const orders = rows.map((row, index) => {
            const order = {};
            headers.forEach((header, i) => {
                order[header] = row[i];
            });
            try {
                order.items = JSON.parse(order.items);
            } catch(e) {
                order.items = [{ name_th: order.items, name_en: order.items, price: order.total, quantity: 1, selected_options_text_th: '', selected_options_text_en: '' }];
            }
            return order;
        });

        const activeOrders = orders.filter(order => 
            order.status && order.status.toLowerCase() !== 'paid'
        );

        const tablesData = {};
        activeOrders.forEach(order => {
            const tableName = order.table;
            if (!tablesData[tableName]) {
                tablesData[tableName] = {
                    tableName: tableName,
                    orders: [], total: 0, status: 'occupied'
                };
            }
            tablesData[tableName].orders.push(...order.items);
        });

        for(const tableName in tablesData) {
            tablesData[tableName].total = tablesData[tableName].orders.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        }

        res.json({ status: 'success', data: tablesData });
    } catch (error) {
        console.error('API /tables error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch table statuses.' });
    }
});

/**
 * Endpoint สำหรับเคลียร์โต๊ะ (อัปเดตสถานะเป็น Paid)
 */
app.post('/api/clear-table', async (req, res) => {
    const { tableName } = req.body;
    if (!tableName) {
        return res.status(400).json({ status: 'error', message: 'Missing tableName' });
    }
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const spreadsheetId = '1Sz1XVvVdRajIM2R-UQNv29fejHHFizp2vbegwGFNIDw'; // <== วาง ID ของคุณ

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:E',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(404).json({ status: 'error', message: 'No orders found' });
        }

        rows.shift();
        const requests = [];
        
        rows.forEach((row, index) => {
            const currentTable = row[1];
            const currentStatus = row[4];
            if (currentTable === tableName && currentStatus && currentStatus.toLowerCase() !== 'paid') {
                requests.push({
                    range: `Orders!E${index + 2}`,
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
        }
        
        res.json({ status: 'success', message: `Table ${tableName} cleared successfully.` });
    } catch (error) {
        console.error('API /clear-table error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to clear table.' });
    }
});

// 5. เริ่มการทำงานของ Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});