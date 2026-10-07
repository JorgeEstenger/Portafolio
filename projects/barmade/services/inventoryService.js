/**
 * Inventory use cases: listing stock with calculated totals/status, and every
 * kind of stock change. Each change also writes inventory movements:
 *
 *   restock / delivery  -> delivery        (+)
 *   waste               -> waste           (-)
 *   spoilage            -> spoilage        (-)
 *   stock count         -> manual_count    (+/-)
 *   bookkeeping fix     -> correction      (+/-)
 *   prep (dough, ...)   -> prep_production (+) and prep_usage (-) of the raw inputs
 *   orders              -> sale            (-)  (see orderService.js)
 */

const inventoryRepository = require('../repositories/inventoryRepository');
const movementRepository = require('../repositories/movementRepository');
const alertService = require('./alertService');
const rules = require('./stockRules');
const orderRules = require('./orderRules');
const clock = require('../utils/clock');
const { isValidDate } = require('../utils/dates');
const { businessDate, addDays, zonedToUtc, isBusinessDate } = require('../utils/timezone');
const { toBaseUnit, round } = require('../utils/units');
const { nextId } = require('../utils/ids');
const AppError = require('../utils/AppError');

/**
 * Add calculated fields to an ingredient:
 *   totalQuantity   - usable (non-expired) stock
 *   expiredQuantity - stock in expired batches, not usable
 *   status          - IN_STOCK / LOW_STOCK / OUT_OF_STOCK
 * Batches are sorted in FEFO order and each gets its own status.
 */
function toIngredientView(ingredient, now, { includeBatches = true } = {}) {
  const totalQuantity = rules.getUsableQuantity(ingredient.batches, now);
  const { batchPrefix, batches, ...fields } = ingredient;

  const view = {
    ...fields,
    totalQuantity,
    expiredQuantity: rules.getExpiredQuantity(batches, now),
    status: rules.getStockStatus(totalQuantity, ingredient.reorderPoint),
  };

  if (includeBatches) {
    view.batches = [...batches]
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))
      .map((batch) => ({ ...batch, status: rules.getBatchStatus(batch, now) }));
  }
  return view;
}

/** All ingredients with totals and status. Optional ?status= filter. */
async function getAllInventory({ status } = {}) {
  if (status !== undefined && !Object.values(rules.STOCK_STATUS).includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', `status must be one of: ${Object.values(rules.STOCK_STATUS).join(', ')}`);
  }
  const now = clock.now();
  const ingredients = (await inventoryRepository.findAll()).map((i) => toIngredientView(i, now));
  return status ? ingredients.filter((i) => i.status === status) : ingredients;
}

/** Accepts an ID ("ING-002") or a key ("mozzarella"). */
async function findIngredient(id) {
  const ingredient = typeof id === 'string' && id.trim() !== '' ? await inventoryRepository.findById(id) : null;
  if (!ingredient) {
    throw new AppError(404, 'INGREDIENT_NOT_FOUND', `Ingredient ${id} was not found.`);
  }
  return ingredient;
}

async function getIngredientById(id) {
  return toIngredientView(await findIngredient(id), clock.now());
}

/** Save movements for the given (ingredient, change) pairs, using the ingredient's state after the change. */
async function recordMovements(entries, now) {
  const ids = [...new Set(entries.map((e) => e.ingredientId))];
  const current = new Map((await inventoryRepository.findByIds(ids)).map((i) => [i.id, i]));
  return movementRepository.createMany(entries.map(({ ingredientId, ...rest }) =>
    orderRules.buildMovement({ ingredient: current.get(ingredientId), now, ...rest })));
}

/** Validate a restock request body. Throws AppError(400) on the first problem. */
function validateRestock(body, now) {
  const { ingredientId, quantity, arrivedAt, expiresAt } = body || {};

  if (typeof ingredientId !== 'string' || ingredientId.trim() === '') {
    throw new AppError(400, 'VALIDATION_ERROR', 'ingredientId is required.');
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'INVALID_QUANTITY', 'quantity must be a number greater than 0.');
  }
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') {
    throw new AppError(400, 'MISSING_EXPIRATION_DATE', 'expiresAt is required.');
  }
  if (!isValidDate(expiresAt)) {
    throw new AppError(400, 'INVALID_DATE', 'expiresAt must be a valid date, e.g. "2026-10-13T23:59:59".');
  }
  if (arrivedAt !== undefined && !isValidDate(arrivedAt)) {
    throw new AppError(400, 'INVALID_DATE', 'arrivedAt must be a valid date, e.g. "2026-10-06T08:00:00".');
  }

  const arrived = arrivedAt !== undefined ? new Date(arrivedAt) : now;
  const expires = new Date(expiresAt);

  if (expires <= arrived) {
    throw new AppError(400, 'INVALID_DATE', 'expiresAt must be after arrivedAt.');
  }
  if (expires <= now) {
    throw new AppError(400, 'EXPIRED_INVENTORY', 'Cannot restock a batch that is already expired.');
  }
  return { ingredientId, quantity, arrived, expires };
}

/** Add a batch + a positive movement, then re-run alert checks. */
async function receiveStock(ingredient, { quantity, arrived, expires, reason, note }, now) {
  const batch = {
    batchId: nextId(ingredient.batchPrefix, ingredient.batches.map((b) => b.batchId)),
    quantity,
    arrivedAt: new Date(arrived).toISOString(),
    expiresAt: new Date(expires).toISOString(),
  };
  const updated = await inventoryRepository.addBatch(ingredient.id, batch);
  const [movement] = await recordMovements([{ ingredientId: ingredient.id, change: quantity, reason, batchId: batch.batchId, note }], now);

  // Runs the expiration scan plus low-stock / run-out checks across all ingredients.
  const { created, resolved } = await alertService.checkExpirations({ now });

  return {
    batch: { ...batch, status: rules.getBatchStatus(batch, now) },
    ingredient: toIngredientView(updated, now),
    movement,
    alerts: { created, resolved },
  };
}

/**
 * POST /api/inventory/restock (original endpoint, unchanged body):
 * { ingredientId, quantity, arrivedAt?, expiresAt }
 */
async function restock(body) {
  const now = clock.now();
  const { ingredientId, quantity, arrived, expires } = validateRestock(body, now);
  const ingredient = await findIngredient(ingredientId);
  return receiveStock(ingredient, { quantity, arrived, expires, reason: 'delivery', note: body.note || null }, now);
}

const positiveNumber = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new AppError(400, 'INVALID_QUANTITY', `${name} must be a number greater than 0.`);
  }
  return value;
};

/** Default expiry: shelf life from today, end of day in the restaurant timezone. */
function defaultExpiry(ingredient, now) {
  if (!ingredient.shelfLifeDays) {
    throw new AppError(400, 'MISSING_EXPIRATION_DATE', `expires_at is required for ${ingredient.name}.`);
  }
  return zonedToUtc(addDays(businessDate(now), ingredient.shelfLifeDays), '23:59:59');
}

/**
 * POST /api/inventory/delivery
 * { ingredient_id, quantity, unit?, expires_at?, supplier?, note? }
 * `unit` may differ from the stored unit (e.g. 20 kg of mozzarella -> 20000 g).
 * expires_at defaults to the ingredient's shelf life.
 */
async function recordDelivery(body = {}) {
  const now = clock.now();
  const ingredient = await findIngredient(body.ingredient_id ?? body.ingredientId);
  const quantity = round(toBaseUnit(positiveNumber(body.quantity, 'quantity'), body.unit, ingredient.unit), 3);
  let expires;
  if (body.expires_at !== undefined) {
    const value = isBusinessDate(body.expires_at) ? zonedToUtc(body.expires_at, '23:59:59') : body.expires_at;
    if (!isValidDate(value)) throw new AppError(400, 'INVALID_DATE', 'expires_at must be a valid date, e.g. "2026-10-20".');
    expires = new Date(value);
    if (expires <= now) throw new AppError(400, 'EXPIRED_INVENTORY', 'Cannot receive a batch that is already expired.');
  } else {
    expires = defaultExpiry(ingredient, now);
  }
  const supplier = body.supplier || ingredient.supplier;
  const note = body.note || (supplier ? `Delivery from ${supplier}` : null);
  return receiveStock(ingredient, { quantity, arrived: now, expires, reason: 'delivery', note }, now);
}

/** Batches to take `amount` from: a named batch, or expired batches first (spoilage) then FEFO. */
function planRemoval(ingredient, amount, now, { batchId, includeExpired }) {
  let candidates;
  if (batchId) {
    candidates = ingredient.batches.filter((b) => b.batchId === batchId);
    if (candidates.length === 0) throw new AppError(404, 'BATCH_NOT_FOUND', `Batch ${batchId} was not found for ${ingredient.name}.`);
  } else {
    const expired = includeExpired ? ingredient.batches.filter((b) => b.quantity > 0 && rules.isExpired(b, now)) : [];
    const byExpiry = (a, b) => new Date(a.expiresAt) - new Date(b.expiresAt);
    candidates = [...expired.sort(byExpiry), ...rules.getUsableBatches(ingredient.batches, now).sort(byExpiry)];
  }
  const available = candidates.reduce((sum, b) => sum + b.quantity, 0);
  if (available < amount) {
    throw new AppError(409, 'INSUFFICIENT_INVENTORY', `Only ${available} ${ingredient.unit} of ${ingredient.name} available to remove.`, {
      shortages: [{ ingredientId: ingredient.id, ingredientName: ingredient.name, unit: ingredient.unit, required: amount, available }],
    });
  }
  const changes = [];
  let remaining = amount;
  for (const batch of candidates) {
    if (remaining <= 0) break;
    const takeNow = Math.min(batch.quantity, remaining);
    changes.push({ ingredientId: ingredient.id, batchId: batch.batchId, quantity: batch.quantity - takeNow });
    remaining -= takeNow;
  }
  return changes;
}

/**
 * POST /api/inventory/waste
 * { ingredient_id, quantity, unit?, reason?: "waste" | "spoilage", batch_id?, note? }
 * Waste comes out FEFO; spoilage takes expired batches first (that's what gets thrown out).
 */
async function recordWaste(body = {}) {
  const now = clock.now();
  const reason = body.reason || 'waste';
  if (!['waste', 'spoilage'].includes(reason)) {
    throw new AppError(400, 'INVALID_REASON', 'reason must be "waste" or "spoilage".');
  }
  const ingredient = await findIngredient(body.ingredient_id ?? body.ingredientId);
  const amount = round(toBaseUnit(positiveNumber(body.quantity, 'quantity'), body.unit, ingredient.unit), 3);
  const changes = planRemoval(ingredient, amount, now, { batchId: body.batch_id, includeExpired: reason === 'spoilage' });
  await inventoryRepository.setBatchQuantities(changes);
  const movements = await recordMovements([{
    ingredientId: ingredient.id, change: -amount, reason,
    batchId: changes.length === 1 ? changes[0].batchId : null, note: body.note || null,
  }], now);
  const alerts = await alertService.checkStockAlerts([ingredient.id], { now });
  return { ingredient: toIngredientView(await inventoryRepository.findById(ingredient.id), now), movements, alerts };
}

/**
 * POST /api/inventory/adjustments
 *   { ingredient_id, reason: "manual_count", counted_quantity, unit?, note? } - physical count
 *   { ingredient_id, reason: "correction", change, unit?, note? }            - bookkeeping fix (+/-)
 * Increases go into the newest usable batch; decreases come out FEFO.
 */
async function adjustStock(body = {}) {
  const now = clock.now();
  const { reason } = body;
  if (!['manual_count', 'correction'].includes(reason)) {
    throw new AppError(400, 'INVALID_REASON', 'reason must be "manual_count" or "correction".');
  }
  const ingredient = await findIngredient(body.ingredient_id ?? body.ingredientId);
  const system = rules.getUsableQuantity(ingredient.batches, now);

  let change;
  if (reason === 'manual_count') {
    const counted = body.counted_quantity;
    if (typeof counted !== 'number' || !Number.isFinite(counted) || counted < 0) {
      throw new AppError(400, 'INVALID_QUANTITY', 'counted_quantity must be a number >= 0.');
    }
    change = round(toBaseUnit(counted, body.unit, ingredient.unit) - system, 3);
  } else {
    if (typeof body.change !== 'number' || !Number.isFinite(body.change) || body.change === 0) {
      throw new AppError(400, 'INVALID_QUANTITY', 'change must be a non-zero number.');
    }
    change = round(toBaseUnit(body.change, body.unit, ingredient.unit), 3);
  }

  let batchId = null;
  if (change > 0) {
    const newest = rules.getUsableBatches(ingredient.batches, now).sort((a, b) => new Date(b.expiresAt) - new Date(a.expiresAt))[0];
    if (newest) {
      await inventoryRepository.setBatchQuantities([{ ingredientId: ingredient.id, batchId: newest.batchId, quantity: newest.quantity + change }]);
      batchId = newest.batchId;
    } else {
      const batch = { batchId: nextId(ingredient.batchPrefix, ingredient.batches.map((b) => b.batchId)), quantity: change, arrivedAt: new Date(now).toISOString(), expiresAt: new Date(defaultExpiry(ingredient, now)).toISOString() };
      await inventoryRepository.addBatch(ingredient.id, batch);
      batchId = batch.batchId;
    }
  } else if (change < 0) {
    await inventoryRepository.setBatchQuantities(planRemoval(ingredient, -change, now, { includeExpired: false }));
  }

  const note = body.note || (reason === 'manual_count' ? `Counted ${system + change} ${ingredient.unit}, system showed ${system}` : null);
  const movements = change === 0 ? [] : await recordMovements([{ ingredientId: ingredient.id, change, reason, batchId, note }], now);
  const alerts = await alertService.checkStockAlerts([ingredient.id], { now });
  return {
    system_quantity: system,
    change,
    ingredient: toIngredientView(await inventoryRepository.findById(ingredient.id), now),
    movements,
    alerts,
  };
}

/**
 * POST /api/inventory/prep  { ingredient_id, batches?: 1 }
 * Makes prep batches (e.g. 40 dough balls) from raw ingredients, FEFO.
 */
async function prepBatch(body = {}) {
  const now = clock.now();
  const ingredient = await findIngredient(body.ingredient_id ?? body.ingredientId);
  if (!ingredient.prepRecipe) {
    throw new AppError(400, 'NOT_A_PREP_ITEM', `${ingredient.name} is not made in-house.`);
  }
  const count = body.batches === undefined ? 1 : body.batches;
  if (!Number.isInteger(count) || count <= 0 || count > 20) {
    throw new AppError(400, 'INVALID_QUANTITY', 'batches must be a whole number between 1 and 20.');
  }
  const required = new Map(ingredient.prepRecipe.inputs.map((i) => [i.ingredientId, i.quantity * count]));
  const inputs = await inventoryRepository.findByIds([...required.keys()]);
  const { plans, shortages } = orderRules.planRequirements(required, inputs, now);
  if (shortages.length) {
    throw new AppError(409, 'INSUFFICIENT_INVENTORY', `Not enough inventory to prep ${ingredient.name}: ${shortages.map((s) => s.ingredientName).join(', ')}.`, { shortages });
  }
  await inventoryRepository.setBatchQuantities(plans.flatMap(({ ingredient: raw, plan }) =>
    plan.allocations.map((a) => ({ ingredientId: raw.id, batchId: a.batchId, quantity: a.remaining }))));

  const quantity = ingredient.prepRecipe.yield * count;
  const batch = {
    batchId: nextId(ingredient.batchPrefix, ingredient.batches.map((b) => b.batchId)),
    quantity,
    arrivedAt: new Date(now).toISOString(),
    expiresAt: new Date(defaultExpiry(ingredient, now)).toISOString(),
  };
  await inventoryRepository.addBatch(ingredient.id, batch);
  const movements = await recordMovements([
    ...plans.map(({ ingredient: raw, amount }) => ({ ingredientId: raw.id, change: -amount, reason: 'prep_usage', note: `Used for ${ingredient.name} batch ${batch.batchId}` })),
    { ingredientId: ingredient.id, change: quantity, reason: 'prep_production', batchId: batch.batchId, note: `${count} x ${ingredient.prepRecipe.yield} ${ingredient.unit}` },
  ], now);
  const alerts = await alertService.checkStockAlerts([ingredient.id, ...required.keys()], { now });
  return { batch, ingredient: toIngredientView(await inventoryRepository.findById(ingredient.id), now), movements, alerts };
}

/** GET /api/inventory/movements */
async function getMovements(query = {}) {
  const { reason, order_id: orderId, date, from, to } = query;
  if (reason !== undefined && !orderRules.MOVEMENT_REASONS.includes(reason)) {
    throw new AppError(400, 'INVALID_REASON', `reason must be one of: ${orderRules.MOVEMENT_REASONS.join(', ')}`);
  }
  for (const [name, value] of Object.entries({ date, from, to })) {
    if (value !== undefined && !isBusinessDate(value)) throw new AppError(400, 'INVALID_DATE', `${name} must be a date like 2026-10-07.`);
  }
  let ingredientId;
  const ingredientParam = query.ingredient_id ?? query.ingredientId;
  if (ingredientParam !== undefined) ingredientId = (await findIngredient(ingredientParam)).id;

  const limit = Number(query.limit ?? 100);
  const offset = Number(query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'limit must be 1-1000 and offset >= 0.');
  }
  const result = await movementRepository.find({ ingredientId, reason, orderId, date, from, to }, { limit, offset });
  return {
    count: result.data.length,
    total: result.total,
    limit,
    offset,
    totals_by_reason: result.byReason,
    data: result.data,
  };
}

const { persistent } = require('../data/persistence');
module.exports = {
  getAllInventory: persistent(getAllInventory),
  getIngredientById: persistent(getIngredientById),
  restock: persistent(restock),
  recordDelivery: persistent(recordDelivery),
  recordWaste: persistent(recordWaste),
  adjustStock: persistent(adjustStock),
  prepBatch: persistent(prepBatch),
  getMovements: persistent(getMovements),
  toIngredientView,
};
