/**
 * POST /api/simulate/rush - a burst of realistic dinner orders.
 *
 * Every order is created with orderService.createOrder(), exactly like an order
 * POSTed to /api/orders: same normalization, recipes, FEFO deduction, movements
 * and alerts. Inventory is never changed directly here.
 *
 * Rushes are deterministic: rush #1 after a demo reset always produces the same
 * orders, rush #2 the same second batch, and so on.
 */

const orderService = require('./orderService');
const inventoryService = require('./inventoryService');
const { createOrderRequest } = require('../data/demo/orderFactory');
const { CHANNELS } = require('./orderRules');
const config = require('../config');
const { createRandom } = require('../utils/random');
const { formatQuantity, round } = require('../utils/units');
const AppError = require('../utils/AppError');

let rushCount = 0;
const resetRushCounter = () => { rushCount = 0; };

async function stockSnapshot() {
  const inventory = await inventoryService.getAllInventory();
  return new Map(inventory.map((i) => [i.id, i]));
}

/** body: { orders?: 1-100 (default 20-50, random), channel?: force one channel } */
async function simulateRush(body = {}) {
  const { orders: requested, channel } = body || {};
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1 || requested > 100)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'orders must be a whole number between 1 and 100.');
  }
  if (channel !== undefined && !CHANNELS.includes(channel)) {
    throw new AppError(400, 'INVALID_CHANNEL', `channel must be one of: ${CHANNELS.join(', ')}`);
  }

  rushCount += 1;
  const rng = createRandom(config.demo.seed, `rush-${rushCount}`);
  const count = requested ?? rng.int(20, 50);
  const before = await stockSnapshot();

  const created = [];
  const rejected = [];
  let movementCount = 0;
  const newAlerts = [];

  for (let i = 0; i < count; i++) {
    const request = createOrderRequest(rng, { daypart: 'dinner', channel });
    try {
      const result = await orderService.createOrder(request);
      created.push(result.order);
      movementCount += result.movements.length;
      newAlerts.push(...result.alertsCreated);
    } catch (err) {
      if (!(err instanceof AppError) || err.statusCode !== 409) throw err;
      // Out of something: the order is refused, exactly as a real order would be.
      rejected.push({ request, reason: err.message });
    }
  }

  const after = await stockSnapshot();
  const sum = (field) => round(created.reduce((s, o) => s + o[field], 0), 2);
  const changes = [...after.values()]
    .map((a) => ({ ing: a, before: before.get(a.id).totalQuantity, after: a.totalQuantity }))
    .filter((c) => c.before !== c.after)
    .map(({ ing, before: b, after: a }) => ({
      ingredient_id: ing.id,
      ingredient: ing.name,
      before: b,
      after: a,
      change: round(a - b, 2),
      unit: ing.unit,
      status: ing.status,
      display: `${formatQuantity(b, ing.unit)} -> ${formatQuantity(a, ing.unit)}`,
    }))
    .sort((x, y) => x.after / (x.before || 1) - y.after / (y.before || 1));

  return {
    rush_number: rushCount,
    orders_created: created.length,
    orders_rejected: rejected.length,
    items_sold: created.reduce((s, o) => s + o.items.reduce((n, i) => n + i.quantity, 0), 0),
    gross_revenue: sum('gross_total'),
    channel_fees: sum('channel_fee'),
    net_revenue: sum('net_total'),
    inventory_movements_created: movementCount,
    new_alerts: newAlerts.length,
    alerts_created: newAlerts,
    low_stock_now: [...after.values()].filter((i) => i.status !== 'IN_STOCK').map((i) => i.name),
    first_order_id: created.length ? created[0].id : null,
    last_order_id: created.length ? created[created.length - 1].id : null,
    inventory_changes: changes,
    rejected,
  };
}

module.exports = { simulateRush, resetRushCounter };
