/**
 * Pure order rules: the steps of the order pipeline that don't need a database.
 *
 *   normalizeOrder      request body (legacy or canonical shape) -> one internal shape
 *   computeRequirements recipe x quantity (+ modifiers), summed per ingredient
 *   planRequirements    FEFO plan per ingredient + list of shortages
 *   priceOrder          line totals, gross, channel fee, net
 *   buildOrderRecord    the stored order
 *   buildMovement       one inventory movement record
 *
 * The live order service (services/orderService.js) AND the 60-day generator
 * (data/demo/generator.js) both call these functions, so historical and live
 * orders are calculated in exactly the same way.
 */

const config = require('../config');
const rules = require('./stockRules');
const { MODIFIERS } = require('../data/demo/catalog');
const { businessDate } = require('../utils/timezone');
const AppError = require('../utils/AppError');

const CHANNELS = ['dine_in', 'takeout', 'website', 'uber_eats', 'doordash', 'barmade'];
const DEFAULT_CHANNEL = 'dine_in';

const roundMoney = (n) => Math.round(n * 100) / 100;

const feeRate = (channel) => config.channels[channel] || 0;

/** Find a menu item by its ID ("MENU-001") or key ("pizza_margherita"). */
const findMenuItem = (menu, idOrKey) => menu.find((m) => m.id === idOrKey || (m.key && m.key === idOrKey));

const modifierId = (m) => (typeof m === 'string' ? m : m && m.id);

/**
 * Accepts both request shapes and returns
 *   { channel, lines: [{ menuItem, quantity, modifiers: [modifier] }] }
 *
 * Legacy:    { "items": [{ "menuItemId": "MENU-001", "quantity": 2 }] }            (channel defaults to dine_in)
 * Canonical: { "channel": "uber_eats", "items": [{ "item_id": "pizza_margherita", "qty": 2, "modifiers": ["extra_cheese"] }] }
 *
 * All 400 checks run before any 404 lookups, as before.
 */
function normalizeOrder(body, menu) {
  const items = body && body.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'items must be a non-empty array.');
  }
  const channel = body.channel === undefined || body.channel === null ? DEFAULT_CHANNEL : body.channel;
  if (!CHANNELS.includes(channel)) {
    throw new AppError(400, 'INVALID_CHANNEL', `channel must be one of: ${CHANNELS.join(', ')}`);
  }

  const parsed = items.map((item, index) => {
    const id = item && (item.item_id ?? item.menuItemId ?? item.menu_item_id);
    if (typeof id !== 'string' || id.trim() === '') {
      throw new AppError(400, 'VALIDATION_ERROR', `items[${index}].menuItemId (or item_id) is required.`);
    }
    const quantity = item.qty ?? item.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(400, 'INVALID_QUANTITY', `items[${index}].quantity must be a whole number greater than 0.`);
    }
    const modifiers = item.modifiers === undefined ? [] : item.modifiers;
    if (!Array.isArray(modifiers) || modifiers.some((m) => typeof modifierId(m) !== 'string')) {
      throw new AppError(400, 'INVALID_MODIFIER', `items[${index}].modifiers must be an array of modifier ids.`);
    }
    return { id, quantity, modifierIds: [...new Set(modifiers.map(modifierId))], index };
  });

  const lines = parsed.map(({ id, quantity, modifierIds, index }) => {
    const menuItem = findMenuItem(menu, id);
    if (!menuItem) throw new AppError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${id} was not found.`);

    const modifiers = modifierIds.map((mid) => {
      const modifier = MODIFIERS[mid];
      if (!modifier || !(menuItem.modifierIds || []).includes(mid)) {
        const allowed = (menuItem.modifierIds || []).join(', ') || 'none';
        throw new AppError(400, 'INVALID_MODIFIER', `items[${index}]: modifier "${mid}" is not available for ${menuItem.name} (allowed: ${allowed}).`);
      }
      return modifier;
    });
    const removed = modifiers.flatMap((m) => m.remove || []);
    if (modifiers.some((m) => (m.add || []).some((a) => removed.includes(a.ingredientId)))) {
      throw new AppError(400, 'INVALID_MODIFIER', `items[${index}]: modifiers ${modifierIds.join(' + ')} contradict each other.`);
    }
    return { menuItem, quantity, modifiers };
  });

  return { channel, lines };
}

/** Ingredient amounts for ONE serving of a menu item with modifiers applied. */
function servingRecipe(menuItem, modifiers = []) {
  const removed = new Set(modifiers.flatMap((m) => m.remove || []));
  const perServing = new Map();
  const add = (ingredientId, quantity) => perServing.set(ingredientId, (perServing.get(ingredientId) || 0) + quantity);
  for (const line of menuItem.ingredients) {
    if (!removed.has(line.ingredientId)) add(line.ingredientId, line.quantity);
  }
  for (const modifier of modifiers) {
    for (const extra of modifier.add || []) add(extra.ingredientId, extra.quantity);
  }
  return perServing;
}

/**
 * Total required amount per ingredient for all lines:
 * recipe quantity x quantity sold, summed across lines (two pizzas on
 * separate lines share the dough requirement).
 */
function computeRequirements(lines) {
  const required = new Map();
  for (const { menuItem, quantity, modifiers } of lines) {
    for (const [ingredientId, perServing] of servingRecipe(menuItem, modifiers)) {
      required.set(ingredientId, (required.get(ingredientId) || 0) + perServing * quantity);
    }
  }
  return required;
}

/**
 * FEFO plan for every required ingredient. Nothing is modified.
 * ingredients: array (or Map id -> ingredient) holding the batches.
 */
function planRequirements(required, ingredients, now) {
  const byId = ingredients instanceof Map ? ingredients : new Map(ingredients.map((i) => [i.id, i]));
  const plans = [];
  const shortages = [];

  for (const [ingredientId, amount] of required) {
    const ingredient = byId.get(ingredientId);
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
        reason: plan.available + expiredQuantity >= amount ? 'EXPIRED_STOCK_NOT_USABLE' : 'INSUFFICIENT_STOCK',
      });
    }
    plans.push({ ingredient, amount, plan });
  }
  return { plans, shortages };
}

/** Prices every line (menu price + modifier prices) and applies the channel fee. */
function priceOrder(lines, channel) {
  const items = lines.map(({ menuItem, quantity, modifiers }) => {
    const unitPrice = roundMoney(menuItem.price + modifiers.reduce((sum, m) => sum + m.price, 0));
    return {
      menuItemId: menuItem.id,
      item_id: menuItem.key || menuItem.id,
      name: menuItem.name,
      quantity,
      modifiers: modifiers.map((m) => m.id),
      unitPrice,
      lineTotal: roundMoney(unitPrice * quantity),
    };
  });
  const gross = roundMoney(items.reduce((sum, i) => sum + i.lineTotal, 0));
  const rate = feeRate(channel);
  const fee = roundMoney(gross * rate);
  return { items, gross, rate, fee, net: roundMoney(gross - fee) };
}

/**
 * The stored order. `total` and `createdAt` are kept for backward
 * compatibility (total = gross_total, createdAt = placed_at).
 */
function buildOrderRecord({ channel, lines, plans, now, date }) {
  const pricing = priceOrder(lines, channel);
  const placedAt = new Date(now).toISOString();
  return {
    status: 'COMPLETED',
    channel,
    placed_at: placedAt,
    business_date: date || businessDate(now),
    createdAt: placedAt,
    items: pricing.items,
    total: pricing.gross,
    gross_total: pricing.gross,
    channel_fee_rate: pricing.rate,
    channel_fee: pricing.fee,
    net_total: pricing.net,
    consumed: plans.map(({ ingredient, amount, plan }) => ({
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      quantity: amount,
      batches: plan.allocations.map((a) => ({ batchId: a.batchId, quantity: a.take })),
    })),
  };
}

/** Positive change = stock came in, negative = stock left. */
const MOVEMENT_REASONS = ['sale', 'delivery', 'waste', 'spoilage', 'manual_count', 'correction', 'prep_production', 'prep_usage'];

/** Total stock on hand (all batches, including expired ones not yet discarded). */
const onHand = (ingredient) => ingredient.batches.reduce((sum, b) => sum + b.quantity, 0);

function buildMovement({ ingredient, change, reason, now, date, orderId = null, batchId = null, note = null }) {
  return {
    ingredient_id: ingredient.id,
    ingredient: ingredient.name,
    change,
    unit: ingredient.unit,
    reason,
    order_id: orderId,
    batch_id: batchId,
    timestamp: new Date(now).toISOString(),
    business_date: date || businessDate(now),
    balance_after: onHand(ingredient),
    note,
  };
}

module.exports = {
  CHANNELS, DEFAULT_CHANNEL, MOVEMENT_REASONS, roundMoney, feeRate, findMenuItem, normalizeOrder,
  servingRecipe, computeRequirements, planRequirements, priceOrder, buildOrderRecord, buildMovement, onHand,
};
