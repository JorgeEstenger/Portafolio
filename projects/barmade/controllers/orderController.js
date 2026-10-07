/**
 * Order HTTP handlers.
 */

const orderService = require('../services/orderService');

// GET /api/orders
async function getOrders(req, res) {
  const orders = await orderService.getAllOrders();
  res.status(200).json({ count: orders.length, data: orders });
}

// POST /api/orders
async function createOrder(req, res) {
  const { order, alertsCreated } = await orderService.createOrder(req.body);
  res.status(201).json({
    message: `Order ${order.id} created.`,
    data: order,
    consumed: order.consumed,
    alertsCreated,
  });
}

module.exports = { getOrders, createOrder };
