/**
 * Pure alert builders shared by the alert service and the 60-day generator,
 * so historical and live alerts have exactly the same shape.
 */

/** critical = out of stock, high = at/below minimum. */
function lowStockSeverity(currentQuantity) {
  return currentQuantity <= 0 ? 'critical' : 'high';
}

function buildLowStockAlert(ingredient, currentQuantity, now) {
  const outOfStock = currentQuantity <= 0;
  return {
    type: 'LOW_STOCK',
    status: 'ACTIVE',
    severity: lowStockSeverity(currentQuantity),
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    currentQuantity,
    reorderPoint: ingredient.reorderPoint,
    unit: ingredient.unit,
    message: outOfStock ? `${ingredient.name} is out of stock.` : `${ingredient.name} is running low.`,
    createdAt: new Date(now).toISOString(),
  };
}

function resolution(reason, now) {
  return { status: 'RESOLVED', resolvedAt: new Date(now).toISOString(), resolution: reason };
}

module.exports = { lowStockSeverity, buildLowStockAlert, resolution };
