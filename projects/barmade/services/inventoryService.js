/**
 * Inventory use cases: listing stock with calculated totals/status, and restocking.
 */

const inventoryRepository = require('../repositories/inventoryRepository');
const alertService = require('./alertService');
const rules = require('./stockRules');
const clock = require('../utils/clock');
const { isValidDate, toLocalISO } = require('../utils/dates');
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

async function getIngredientById(id) {
  const ingredient = await inventoryRepository.findById(id);
  if (!ingredient) {
    throw new AppError(404, 'INGREDIENT_NOT_FOUND', `Ingredient ${id} was not found.`);
  }
  return toIngredientView(ingredient, clock.now());
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

/**
 * Add a new batch to an ingredient.
 * Afterwards, re-runs alert checks: a LOW_STOCK alert may now be resolved,
 * and the new batch may itself be expiring soon.
 */
async function restock(body) {
  const now = clock.now();
  const { ingredientId, quantity, arrived, expires } = validateRestock(body, now);

  const ingredient = await inventoryRepository.findById(ingredientId);
  if (!ingredient) {
    throw new AppError(404, 'INGREDIENT_NOT_FOUND', `Ingredient ${ingredientId} was not found.`);
  }

  const batch = {
    batchId: nextId(ingredient.batchPrefix, ingredient.batches.map((b) => b.batchId)),
    quantity,
    arrivedAt: toLocalISO(arrived),
    expiresAt: toLocalISO(expires),
  };
  const updated = await inventoryRepository.addBatch(ingredientId, batch);

  // Runs the expiration scan plus a low-stock check across all ingredients.
  const { created, resolved } = await alertService.checkExpirations();

  return {
    batch: { ...batch, status: rules.getBatchStatus(batch, now) },
    ingredient: toIngredientView(updated, now),
    alerts: { created, resolved },
  };
}

module.exports = { getAllInventory, getIngredientById, restock, toIngredientView };
