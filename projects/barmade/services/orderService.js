/**
 * Order use cases.
 *
 * Creating an order:
 *   1. Validate the request body.
 *   2. Look up every menu item (404 if one doesn't exist).
 *   3. Multiply each recipe ingredient by the ordered quantity and add up
 *      the totals per ingredient (two pizzas on separate lines share dough).
 *   4. Build a FEFO plan for every ingredient. If ANY ingredient is short,
 *      reject with 409 and change nothing.
 *   5. Apply all batch changes at once, save the order, run low-stock checks.
 */

const menuRepository = require('../repositories/menuRepository');
const inventoryRepository = require('../repositories/inventoryRepository');
const orderRepository = require('../repositories/orderRepository');
const alertService = require('./alertService');
const rules = require('./stockRules');
const clock = require('../utils/clock');
const { toLocalISO } = require('../utils/dates');
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

const roundMoney = (n) => Math.round(n * 100) / 100;

async function getAllOrders() {
  return orderRepository.findAll();
}

function validateOrderBody(body) {
  const items = body && body.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'items must be a non-empty array.');
  }
  items.forEach((item, index) => {
    if (!item || typeof item.menuItemId !== 'string' || item.menuItemId.trim() === '') {
      throw new AppError(400, 'VALIDATION_ERROR', `items[${index}].menuItemId is required.`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError(400, 'INVALID_QUANTITY', `items[${index}].quantity must be a whole number greater than 0.`);
    }
  });
  return items;
}

async function createOrder(body) {
  const items = validateOrderBody(body);
  return runExclusive(() => processOrder(items));
}

async function processOrder(items) {
  const now = clock.now();

  // Step 2: resolve menu items.
  const lines = [];
  for (const item of items) {
    const menuItem = await menuRepository.findById(item.menuItemId);
    if (!menuItem) {
      throw new AppError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${item.menuItemId} was not found.`);
    }
    lines.push({ menuItem, quantity: item.quantity });
  }

  // Step 3: total required amount per ingredient.
  const required = new Map();
  for (const { menuItem, quantity } of lines) {
    for (const recipeLine of menuItem.ingredients) {
      const current = required.get(recipeLine.ingredientId) || 0;
      required.set(recipeLine.ingredientId, current + recipeLine.quantity * quantity);
    }
  }

  // Step 4: plan FEFO consumption and check stock BEFORE changing anything.
  const ingredients = await inventoryRepository.findByIds([...required.keys()]);
  const plans = [];
  const shortages = [];

  for (const [ingredientId, amount] of required) {
    const ingredient = ingredients.find((i) => i.id === ingredientId);
    if (!ingredient) {
      // A recipe points at an ingredient that doesn't exist: a data problem, not a client error.
      throw new AppError(500, 'RECIPE_DATA_ERROR', `Recipe references unknown ingredient ${ingredientId}.`);
    }

    const plan = rules.planFefoConsumption(ingredient.batches, amount, now);
    if (!plan.fulfilled) {
      const expiredQuantity = rules.getExpiredQuantity(ingredient.batches, now);
      shortages.push({
        ingredientId,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        required: amount,
        available: plan.available,
        missing: amount - plan.available,
        expiredQuantity,
        reason:
          plan.available + expiredQuantity >= amount
            ? 'EXPIRED_STOCK_NOT_USABLE'
            : 'INSUFFICIENT_STOCK',
      });
    }
    plans.push({ ingredient, amount, plan });
  }

  if (shortages.length > 0) {
    const names = shortages.map((s) => s.ingredientName).join(', ');
    throw new AppError(409, 'INSUFFICIENT_INVENTORY', `Not enough inventory to fulfill this order: ${names}.`, {
      shortages,
    });
  }

  // Step 5: apply every batch change together.
  await inventoryRepository.setBatchQuantities(
    plans.flatMap(({ ingredient, plan }) =>
      plan.allocations.map((a) => ({ ingredientId: ingredient.id, batchId: a.batchId, quantity: a.remaining }))
    )
  );

  const orderItems = lines.map(({ menuItem, quantity }) => ({
    menuItemId: menuItem.id,
    name: menuItem.name,
    quantity,
    unitPrice: menuItem.price,
    lineTotal: roundMoney(menuItem.price * quantity),
  }));

  const order = await orderRepository.create({
    status: 'COMPLETED',
    createdAt: toLocalISO(now),
    items: orderItems,
    total: roundMoney(orderItems.reduce((sum, i) => sum + i.lineTotal, 0)),
    consumed: plans.map(({ ingredient, amount, plan }) => ({
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      quantity: amount,
      batches: plan.allocations.map((a) => ({ batchId: a.batchId, quantity: a.take })),
    })),
  });

  const alerts = await alertService.checkLowStock([...required.keys()]);
  return { order, alertsCreated: alerts.created };
}

module.exports = { getAllOrders, createOrder };
