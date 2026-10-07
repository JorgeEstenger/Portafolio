/**
 * Pure business rules for stock: batch status, usable quantities, stock
 * status and FEFO planning.
 *
 * No I/O here - every function takes data in and returns a result. That makes
 * the rules easy to unit test and shareable by every service.
 */

const { HOUR_MS } = require('../utils/dates');

/** A batch is "expiring soon" when it expires within this window. */
const EXPIRING_SOON_WINDOW_MS = 48 * HOUR_MS;

const BATCH_STATUS = {
  FRESH: 'FRESH',
  EXPIRING_SOON: 'EXPIRING_SOON',
  EXPIRED: 'EXPIRED',
  DEPLETED: 'DEPLETED',
};

const STOCK_STATUS = {
  IN_STOCK: 'IN_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
};

const isExpired = (batch, now) => new Date(batch.expiresAt) <= now;

const isExpiringSoon = (batch, now) =>
  !isExpired(batch, now) && new Date(batch.expiresAt) - now <= EXPIRING_SOON_WINDOW_MS;

/** Status of a single batch at time `now`. */
function getBatchStatus(batch, now) {
  if (batch.quantity <= 0) return BATCH_STATUS.DEPLETED;
  if (isExpired(batch, now)) return BATCH_STATUS.EXPIRED;
  if (isExpiringSoon(batch, now)) return BATCH_STATUS.EXPIRING_SOON;
  return BATCH_STATUS.FRESH;
}

/** Batches that may be used to fulfill orders: not expired, quantity > 0. */
function getUsableBatches(batches, now) {
  return batches.filter((b) => b.quantity > 0 && !isExpired(b, now));
}

const sumQuantity = (batches) => batches.reduce((sum, b) => sum + b.quantity, 0);

/** Total quantity that can actually be sold (excludes expired batches). */
function getUsableQuantity(batches, now) {
  return sumQuantity(getUsableBatches(batches, now));
}

/** Quantity sitting in expired batches (should be discarded). */
function getExpiredQuantity(batches, now) {
  return sumQuantity(batches.filter((b) => b.quantity > 0 && isExpired(b, now)));
}

/** IN_STOCK / LOW_STOCK / OUT_OF_STOCK from a total and reorder point. */
function getStockStatus(totalQuantity, reorderPoint) {
  if (totalQuantity <= 0) return STOCK_STATUS.OUT_OF_STOCK;
  if (totalQuantity <= reorderPoint) return STOCK_STATUS.LOW_STOCK;
  return STOCK_STATUS.IN_STOCK;
}

/**
 * FEFO (First Expired, First Out) consumption plan.
 *
 * Sorts usable batches by expiration date (soonest first; ties broken by
 * arrival date) and takes from each until `required` is covered.
 * Nothing is modified - the caller decides whether to apply the plan.
 *
 * @returns {{ fulfilled: boolean, available: number, allocations: Array<{batchId, take, remaining}> }}
 */
function planFefoConsumption(batches, required, now) {
  const ordered = getUsableBatches(batches, now).sort(
    (a, b) =>
      new Date(a.expiresAt) - new Date(b.expiresAt) ||
      new Date(a.arrivedAt) - new Date(b.arrivedAt)
  );

  const available = sumQuantity(ordered);
  const allocations = [];
  let stillNeeded = required;

  for (const batch of ordered) {
    if (stillNeeded <= 0) break;
    const take = Math.min(batch.quantity, stillNeeded);
    allocations.push({ batchId: batch.batchId, take, remaining: batch.quantity - take });
    stillNeeded -= take;
  }

  return { fulfilled: stillNeeded <= 0, available, allocations };
}

module.exports = {
  EXPIRING_SOON_WINDOW_MS,
  BATCH_STATUS,
  STOCK_STATUS,
  isExpired,
  isExpiringSoon,
  getBatchStatus,
  getUsableBatches,
  getUsableQuantity,
  getExpiredQuantity,
  getStockStatus,
  planFefoConsumption,
};
