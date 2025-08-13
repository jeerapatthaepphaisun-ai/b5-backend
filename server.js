// 1. นำเข้า Library ที่จำเป็น
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

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
    console.log('KDS client connected');
    clients.add(ws);
    ws.on('close', () => {
        console.log('KDS client disconnected');
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

/**
 * Endpoint สำหรับเพิ่มเมนูอาหารใหม่
 */
app.post('/api/menu-items', async (req, res) => {
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
            newId,
            name_th,
            name_en || '',
            desc_th || '',
            desc_en || '',
            price,
            category_th,
            category_en || '',
            '', // options_id
            'in_stock', // stock_status
            image_url || ''
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
            } catch (e) { /* ignore if not valid JSON */ }

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
app.get('/api/tables', async (req, res) => {
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
            return res.json({ status: 'success', data: {} });
        }

        rows.shift();
        const headers = ['timestamp', 'table', 'items', 'total', 'special_request', 'status'];
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
        
        activeOrders.forEach(order => {
            const tableName = order.table;
            if (tablesData[tableName] && order.status && order.status.toLowerCase() === 'billing') {
                tablesData[tableName].status = 'billing';
            }
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
        }
        
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
                } catch(e) {
                    // Do nothing
                }
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