/**
 * Alert use cases: low-stock, run-out and expiration checks, and listing alerts.
 *
 * Alerts have a lifecycle:
 *   ACTIVE   - the problem currently exists
 *   RESOLVED - the problem went away (restocked, batch used up, ...)
 *
 * Duplicate rule: there is at most ONE active alert per
 *   - LOW_STOCK:        ingredient
 *   - PREDICTED_RUNOUT: ingredient
 *   - EXPIRING_SOON:    batch
 *   - EXPIRED:          batch
 *
 * Severity: critical (out of stock), high (at/below minimum, expired),
 * warning (predicted run-out, expiring soon).
 */

const alertRepository = require('../repositories/alertRepository');
const inventoryRepository = require('../repositories/inventoryRepository');
const forecastService = require('./forecastService');
const rules = require('./stockRules');
const { buildLowStockAlert, resolution } = require('./alertRules');
const clock = require('../utils/clock');
const { formatQuantity } = require('../utils/units');
const AppError = require('../utils/AppError');

const ALERT_TYPES = ['LOW_STOCK', 'PREDICTED_RUNOUT', 'EXPIRING_SOON', 'EXPIRED'];
const ALERT_STATUSES = ['ACTIVE', 'RESOLVED'];
const SEVERITY_RANK = { critical: 0, high: 1, warning: 2, info: 3 };

/**
 * Response view: stored (camelCase) fields plus the snake_case names used by
 * the dashboard endpoints. Nothing is removed, so existing clients keep working.
 */
function toAlertView(alert) {
  const quantity = alert.currentQuantity ?? alert.quantity;
  return {
    ...alert,
    ingredient_id: alert.ingredientId,
    ingredient: alert.ingredientName,
    current_stock: quantity,
    minimum_stock: alert.reorderPoint ?? null,
    created_at: alert.createdAt,
    display: quantity === undefined ? undefined : { current_stock: formatQuantity(quantity, alert.unit) },
  };
}

/** GET /api/alerts - optional ?type= and ?status= filters. Newest first. */
async function getAlerts({ type, status } = {}) {
  if (type !== undefined && !ALERT_TYPES.includes(type)) {
    throw new AppError(400, 'INVALID_ALERT_TYPE', `type must be one of: ${ALERT_TYPES.join(', ')}`);
  }
  if (status !== undefined && !ALERT_STATUSES.includes(status)) {
    throw new AppError(400, 'INVALID_ALERT_STATUS', `status must be one of: ${ALERT_STATUSES.join(', ')}`);
  }
  const alerts = await alertRepository.find({ type, status });
  return alerts
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id.localeCompare(a.id))
    .map(toAlertView);
}

/** Active alerts, most severe first (used by the dashboard). */
async function getActiveAlerts() {
  const alerts = await alertRepository.find({ status: 'ACTIVE' });
  return alerts
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || new Date(b.createdAt) - new Date(a.createdAt))
    .map(toAlertView);
}

async function resolveAlert(alert, reason, now) {
  return alertRepository.update(alert.id, resolution(reason, now));
}

/**
 * Compare usable stock to the reorder point (minimum stock) for the given
 * ingredients (or all ingredients if none given).
 *   - total <= reorderPoint and no active alert -> create LOW_STOCK alert
 *   - total >  reorderPoint and an active alert -> resolve it
 */
async function checkLowStock(ingredientIds, { now = clock.now() } = {}) {
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
      created.push(await alertRepository.create(buildLowStockAlert(ingredient, currentQuantity, now)));
    } else if (isLow && existing && existing.currentQuantity !== currentQuantity) {
      // Keep the active alert's number current instead of creating a duplicate.
      await alertRepository.update(existing.id, {
        currentQuantity,
        severity: buildLowStockAlert(ingredient, currentQuantity, now).severity,
        updatedAt: now.toISOString(),
      });
    } else if (!isLow && existing) {
      resolved.push(await resolveAlert(existing, 'Stock is back above the reorder point.', now));
    }
  }

  return { created: created.map(toAlertView), resolved: resolved.map(toAlertView) };
}

/**
 * PREDICTED_RUNOUT: stock is not expected to last until the next delivery,
 * based on average daily usage over the last 14 days (see forecastRules.js).
 * Ingredients with no recent usage history are never flagged.
 */
async function checkRunout(ingredientIds, { now = clock.now() } = {}) {
  const { analyses } = await forecastService.analyzeAll({ now, ingredientIds });
  const activeAlerts = await alertRepository.find({ type: 'PREDICTED_RUNOUT', status: 'ACTIVE' });
  const created = [];
  const resolved = [];

  for (const a of analyses) {
    const existing = activeAlerts.find((alert) => alert.ingredientId === a.ingredient_id);
    const atRisk = a.status === 'RUNOUT_RISK' && a.current_stock > 0;
    const fields = {
      currentQuantity: a.current_stock,
      unit: a.unit,
      averageDailyUsage: a.average_daily_usage,
      daysRemaining: a.days_remaining,
      predictedRunoutDate: a.predicted_runout_date,
      nextDeliveryDate: a.next_delivery_date,
      usageUntilNextDelivery: a.usage_until_next_delivery,
      // snake_case copies, matching GET /api/recommendations
      average_daily_usage: a.average_daily_usage,
      days_remaining: a.days_remaining,
      predicted_runout_date: a.predicted_runout_date,
      next_delivery_date: a.next_delivery_date,
    };

    if (atRisk && !existing) {
      created.push(await alertRepository.create({
        type: 'PREDICTED_RUNOUT',
        status: 'ACTIVE',
        severity: 'warning',
        ingredientId: a.ingredient_id,
        ingredientName: a.ingredient,
        reorderPoint: a.minimum_stock,
        ...fields,
        message: `${a.ingredient} is expected to run out on ${a.predicted_runout_date}, before the next delivery (${a.next_delivery_date}).`,
        createdAt: now.toISOString(),
      }));
    } else if (atRisk && existing && existing.currentQuantity !== a.current_stock) {
      await alertRepository.update(existing.id, { ...fields, updatedAt: now.toISOString() });
    } else if (!atRisk && existing) {
      resolved.push(await resolveAlert(existing, 'Stock is now expected to last until the next delivery.', now));
    }
  }
  return { created: created.map(toAlertView), resolved: resolved.map(toAlertView) };
}

/** LOW_STOCK + PREDICTED_RUNOUT checks together (run after every stock change). */
async function checkStockAlerts(ingredientIds, options = {}) {
  const low = await checkLowStock(ingredientIds, options);
  const runout = await checkRunout(ingredientIds, options);
  return { created: [...low.created, ...runout.created], resolved: [...low.resolved, ...runout.resolved] };
}

/**
 * Scan every batch that still has quantity:
 *   - already expired          -> EXPIRED alert (and resolve its EXPIRING_SOON alert)
 *   - expires within 48 hours  -> EXPIRING_SOON alert
 * Active expiration alerts whose batch has been used up are resolved.
 *
 * Because expired stock no longer counts as usable, the stock checks are run too.
 */
async function checkExpirations({ now = clock.now() } = {}) {
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
        createdAt: now.toISOString(),
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
              severity: 'high',
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
              severity: 'warning',
              ...base,
              message: `${ingredient.name} expires soon.`,
            })
          );
        } else if (expiringAlert.quantity !== batch.quantity) {
          await alertRepository.update(expiringAlert.id, { quantity: batch.quantity, updatedAt: now.toISOString() });
        }
      }
    }
  }

  const stock = await checkStockAlerts(undefined, { now });

  return {
    checkedAt: now.toISOString(),
    created: [...created.map(toAlertView), ...stock.created],
    resolved: [...resolved.map(toAlertView), ...stock.resolved],
  };
}

const { persistent } = require('../data/persistence');
module.exports = {
  ALERT_TYPES, toAlertView,
  getAlerts: persistent(getAlerts),
  getActiveAlerts: persistent(getActiveAlerts),
  checkLowStock: persistent(checkLowStock),
  checkRunout: persistent(checkRunout),
  checkStockAlerts: persistent(checkStockAlerts),
  checkExpirations: persistent(checkExpirations),
};
