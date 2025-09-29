// utils/calculationHelpers.js
function calculateOrderTotals(ordersData) {
    const VAT_RATE = parseFloat(process.env.VAT_RATE) || 0.07;

    const subtotal = ordersData.reduce((sum, order) => sum + parseFloat(order.subtotal), 0);
    const discountAmount = ordersData.reduce((sum, order) => sum + parseFloat(order.discount_amount), 0);
    const totalAfterDiscount = subtotal - discountAmount;
    const vatAmount = totalAfterDiscount * VAT_RATE;
    const grandTotal = totalAfterDiscount + vatAmount;
    const discountPercentage = ordersData[0]?.discount_percentage || 0;

    return {
        subtotal,
        discountAmount,
        vatAmount,
        grandTotal,
        discountPercentage,
        orders: ordersData.flatMap(order => order.items)
    };
}

module.exports = { calculateOrderTotals };