/**
 * Order use cases - the order pipeline:
 *
 *   1. Normalize   legacy { menuItemId, quantity } or canonical { channel, item_id, qty, modifiers }
 *                  into one internal shape (400 / 404 on bad input).
 *   2. Recipes     recipe x quantity (+ modifiers), summed per ingredient
 *                  (two pizzas on separate lines share the dough requirement).
 *   3. Check stock FEFO plan for every ingredient. If ANY ingredient is short,
 *                  reject with 409 and change nothing.
 *   4. Deduct      apply all batch changes at once.
 *   5. Save        the order with gross total, channel fee and net total.
 *   6. Movements   one `sale` movement per ingredient (audit trail).
 *   7. Alerts      LOW_STOCK + PREDICTED_RUNOUT checks for the ingredients used.
 *
 * The dashboard needs no update step: it is calculated from orders and movements.
 * Steps 1, 2, 3, 5 and 6 are pure functions in orderRules.js, shared with the
 * 60-day generator and the rush simulator.
 */

const menuRepository = require('../repositories/menuRepository');
const inventoryRepository = require('../repositories/inventoryRepository');
const orderRepository = require('../repositories/orderRepository');
const movementRepository = require('../repositories/movementRepository');
const alertService = require('./alertService');
const orderRules = require('./orderRules');
const clock = require('../utils/clock');
const { isBusinessDate } = require('../utils/timezone');
const AppError = require('../utils/AppError');

/**
 * Orders are processed one at a time so two requests can't both pass the
 * stock check and then both subtract the same stock. With a real database
 * this would be a transaction with row locks instead.
 */
let queue = Promise.resolve();
function runExclusive(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

async function getAllOrders() {
  return orderRepository.findAll();
}

/** GET /api/orders with optional ?date= ?from= ?to= ?channel= ?limit= ?offset= */
async function findOrders(query = {}) {
  const { date, from, to, channel } = query;
  for (const [name, value] of Object.entries({ date, from, to })) {
    if (value !== undefined && !isBusinessDate(value)) {
      throw new AppError(400, 'INVALID_DATE', `${name} must be a date like 2026-10-07.`);
    }
  }
  if (channel !== undefined && !orderRules.CHANNELS.includes(channel)) {
    throw new AppError(400, 'INVALID_CHANNEL', `channel must be one of: ${orderRules.CHANNELS.join(', ')}`);
  }
  const limit = parsePaging(query.limit, 100, 'limit', 1, 1000);
  const offset = parsePaging(query.offset, 0, 'offset', 0, Infinity);
  const result = await orderRepository.find({ date, from, to, channel }, { limit, offset });
  return { ...result, limit, offset };
}

function parsePaging(value, fallback, name, min, max) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError(400, 'VALIDATION_ERROR', `${name} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

async function getOrderById(id) {
  const order = await orderRepository.findById(id);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', `Order ${id} was not found.`);
  return order;
}

async function createOrder(body) {
  // Validate the shape before queueing (400s don't need to wait for other orders).
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'items must be a non-empty array.');
  }
  return runExclusive(() => processOrder(body));
}

async function processOrder(body) {
  const now = clock.now();

  // Step 1: normalize (needs the menu to resolve item ids/keys and modifiers).
  const { channel, lines } = orderRules.normalizeOrder(body, await menuRepository.findAll());

  // Step 2: total required amount per ingredient.
  const required = orderRules.computeRequirements(lines);

  // Step 3: plan FEFO consumption and check stock BEFORE changing anything.
  const ingredients = await inventoryRepository.findByIds([...required.keys()]);
  const { plans, shortages } = orderRules.planRequirements(required, ingredients, now);
  if (shortages.length > 0) {
    const names = shortages.map((s) => s.ingredientName).join(', ');
    throw new AppError(409, 'INSUFFICIENT_INVENTORY', `Not enough inventory to fulfill this order: ${names}.`, {
      shortages,
    });
  }

  // Step 4: apply every batch change together.
  await inventoryRepository.setBatchQuantities(
    plans.flatMap(({ ingredient, plan }) =>
      plan.allocations.map((a) => ({ ingredientId: ingredient.id, batchId: a.batchId, quantity: a.remaining }))
    )
  );

  // Step 5: save the order (prices, channel fee, net).
  const order = await orderRepository.create(orderRules.buildOrderRecord({ channel, lines, plans, now }));

  // Step 6: audit trail - one sale movement per ingredient, with the balance after the sale.
  const updated = new Map((await inventoryRepository.findByIds([...required.keys()])).map((i) => [i.id, i]));
  const movements = await movementRepository.createMany(plans.map(({ ingredient, amount }) =>
    orderRules.buildMovement({ ingredient: updated.get(ingredient.id), change: -amount, reason: 'sale', now, orderId: order.id })));

  // Step 7: alerts.
  const alerts = await alertService.checkStockAlerts([...required.keys()], { now });
  return { order, movements, alertsCreated: alerts.created, alertsResolved: alerts.resolved };
}

const { persistent } = require('../data/persistence');
module.exports = {
  getAllOrders: persistent(getAllOrders),
  findOrders: persistent(findOrders),
  getOrderById: persistent(getOrderById),
  createOrder: persistent(createOrder),
};
