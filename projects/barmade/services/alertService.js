/**
 * Alert use cases: low-stock and expiration checks, and listing alerts.
 *
 * Alerts have a lifecycle:
 *   ACTIVE   - the problem currently exists
 *   RESOLVED - the problem went away (restocked, batch used up, ...)
 *
 * Duplicate rule: there is at most ONE active alert per
 *   - LOW_STOCK:      ingredient
 *   - EXPIRING_SOON:  batch
 *   - EXPIRED:        batch
 */

const alertRepository = require('../repositories/alertRepository');
const inventoryRepository = require('../repositories/inventoryRepository');
const rules = require('./stockRules');
const clock = require('../utils/clock');
const { toLocalISO } = require('../utils/dates');
const AppError = require('../utils/AppError');

const ALERT_TYPES = ['LOW_STOCK', 'EXPIRING_SOON', 'EXPIRED'];
const ALERT_STATUSES = ['ACTIVE', 'RESOLVED'];

/** GET /api/alerts - optional ?type= and ?status= filters. Newest first. */
async function getAlerts({ type, status } = {}) {
  if (type !== undefined && !ALERT_TYPES.includes(type)) {
    throw new AppError(400, 'INVALID_ALERT_TYPE', `type must be one of: ${ALERT_TYPES.join(', ')}`);
  }
  if (status !== undefined && !ALERT_STATUSES.includes(status)) {
    throw new AppError(400, 'INVALID_ALERT_STATUS', `status must be one of: ${ALERT_STATUSES.join(', ')}`);
  }
  const alerts = await alertRepository.find({ type, status });
  return alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id.localeCompare(a.id));
}

async function resolveAlert(alert, reason, now) {
  return alertRepository.update(alert.id, {
    status: 'RESOLVED',
    resolvedAt: toLocalISO(now),
    resolution: reason,
  });
}

/**
 * Compare usable stock to the reorder point for the given ingredients
 * (or all ingredients if none given).
 *   - total <= reorderPoint and no active alert -> create LOW_STOCK alert
 *   - total >  reorderPoint and an active alert -> resolve it
 */
async function checkLowStock(ingredientIds) {
  const now = clock.now();
  const ingredients = ingredientIds
    ? await inventoryRepository.findByIds(ingredientIds)
    : await inventoryRepository.findAll();
  const activeAlerts = await alertRepository.find({ type: 'LOW_STOCK', status: 'ACTIVE' });

  const created = [];
  const resolved = [];

  for (const ingredient of ingredients) {
    const currentQuantity = rules.getUsableQuantity(ingredient.batches, now);
    const existing = activeAlerts.find((a) => a.ingredientId === ingredient.id);
    const isLow = currentQuantity <= ingredient.reorderPoint;

    if (isLow && !existing) {
      const outOfStock = currentQuantity <= 0;
      created.push(
        await alertRepository.create({
          type: 'LOW_STOCK',
          status: 'ACTIVE',
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          currentQuantity,
          reorderPoint: ingredient.reorderPoint,
          unit: ingredient.unit,
          message: outOfStock
            ? `${ingredient.name} is out of stock.`
            : `${ingredient.name} is running low.`,
          createdAt: toLocalISO(now),
        })
      );
    } else if (isLow && existing && existing.currentQuantity !== currentQuantity) {
      // Keep the active alert's number current instead of creating a duplicate.
      await alertRepository.update(existing.id, { currentQuantity, updatedAt: toLocalISO(now) });
    } else if (!isLow && existing) {
      resolved.push(await resolveAlert(existing, 'Stock is back above the reorder point.', now));
    }
  }

  return { created, resolved };
}

/**
 * Scan every batch that still has quantity:
 *   - already expired          -> EXPIRED alert (and resolve its EXPIRING_SOON alert)
 *   - expires within 48 hours  -> EXPIRING_SOON alert
 * Active expiration alerts whose batch has been used up are resolved.
 *
 * Because expired stock no longer counts as usable, a low-stock check is run too.
 */
async function checkExpirations() {
  const now = clock.now();
  const ingredients = await inventoryRepository.findAll();
  const active = [
    ...(await alertRepository.find({ type: 'EXPIRING_SOON', status: 'ACTIVE' })),
    ...(await alertRepository.find({ type: 'EXPIRED', status: 'ACTIVE' })),
  ];
  const findActive = (type, batchId) => active.find((a) => a.type === type && a.batchId === batchId);

  const created = [];
  const resolved = [];

  for (const ingredient of ingredients) {
    for (const batch of ingredient.batches) {
      const expiringAlert = findActive('EXPIRING_SOON', batch.batchId);
      const expiredAlert = findActive('EXPIRED', batch.batchId);
      const base = {
        status: 'ACTIVE',
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        batchId: batch.batchId,
        quantity: batch.quantity,
        unit: ingredient.unit,
        expiresAt: batch.expiresAt,
        createdAt: toLocalISO(now),
      };

      if (batch.quantity <= 0) {
        // Batch is empty: nothing left to expire.
        for (const alert of [expiringAlert, expiredAlert].filter(Boolean)) {
          resolved.push(await resolveAlert(alert, 'Batch has been fully used.', now));
        }
      } else if (rules.isExpired(batch, now)) {
        if (expiringAlert) {
          resolved.push(await resolveAlert(expiringAlert, 'Batch has now expired.', now));
        }
        if (!expiredAlert) {
          created.push(
            await alertRepository.create({
              type: 'EXPIRED',
              ...base,
              message: `${ingredient.name} batch ${batch.batchId} has expired. Discard it - it will not be used for orders.`,
            })
          );
        }
      } else if (rules.isExpiringSoon(batch, now)) {
        if (!expiringAlert) {
          created.push(
            await alertRepository.create({
              type: 'EXPIRING_SOON',
              ...base,
              message: `${ingredient.name} expires soon.`,
            })
          );
        } else if (expiringAlert.quantity !== batch.quantity) {
          await alertRepository.update(expiringAlert.id, { quantity: batch.quantity, updatedAt: toLocalISO(now) });
        }
      }
    }
  }

  const lowStock = await checkLowStock();

  return {
    checkedAt: toLocalISO(now),
    created: [...created, ...lowStock.created],
    resolved: [...resolved, ...lowStock.resolved],
  };
}

const { persistent } = require('../data/persistence');
module.exports = {
  ALERT_TYPES, getAlerts: persistent(getAlerts),
  checkLowStock: persistent(checkLowStock),
  checkExpirations: persistent(checkExpirations),
};
