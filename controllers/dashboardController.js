const pool = require('../db');
const { formatInTimeZone } = require('date-fns-tz');

// GET /api/dashboard
const getDashboardData = async (req, res, next) => {
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
        
        // This CTE part remains complex, but is now isolated here
        const baseExpandedItemsCTE = `
            WITH expanded_items AS (
                SELECT item ->> 'id' as cleaned_id, (item ->> 'price')::numeric as price, (item ->> 'quantity')::int as quantity
                FROM orders, jsonb_array_elements(orders.items) as item
                WHERE orders.status = 'Paid' AND (orders.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1 AND $2
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
};

// GET /api/dashboard/kds
const getKdsDashboardData = async (req, res, next) => {
    try {
        const timeZone = 'Asia/Bangkok';
        const queryDate = req.query.date || formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');

        const summaryQuery = `
            WITH DailyPaidOrders AS (
                SELECT * FROM orders
                WHERE status = 'Paid' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = $1
            ), ExpandedItems AS (
                SELECT dpo.id as order_id, item.category_th, (item.price * item.quantity) as item_total_price, c.station_type
                FROM DailyPaidOrders dpo, jsonb_to_recordset(dpo.items) as item(category_th text, price numeric, quantity int)
                JOIN categories c ON item.category_th = c.name_th
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
                    kitchen: { orderCount: parseInt(summaryData.kitchen_order_count, 10), totalSales: parseFloat(summaryData.kitchen_total_sales) },
                    bar: { orderCount: parseInt(summaryData.bar_order_count, 10), totalSales: parseFloat(summaryData.bar_total_sales) }
                },
                discountedOrders: discountedOrdersResult.rows
            }
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDashboardData,
    getKdsDashboardData,
};