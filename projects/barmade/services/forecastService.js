/**
 * Forecasts and recommendations built from the inventory movement history:
 *   GET /api/inventory/forecast  - per-ingredient usage, days of cover, run-out date
 *   GET /api/recommendations     - run-out risks, overstock, specials to promote
 *   GET /api/restock             - weekly purchase suggestions + tomorrow's prep plan
 *
 * All formulas live in forecastRules.js (pure functions).
 */

const inventoryRepository = require('../repositories/inventoryRepository');
const movementRepository = require('../repositories/movementRepository');
const orderRepository = require('../repositories/orderRepository');
const menuRepository = require('../repositories/menuRepository');
const forecastRules = require('./forecastRules');
const rules = require('./stockRules');
const config = require('../config');
const clock = require('../utils/clock');
const { businessDate, addDays } = require('../utils/timezone');
const { formatQuantity } = require('../utils/units');
const AppError = require('../utils/AppError');

const USAGE_REASONS = ['sale', 'prep_usage', 'waste'];
const COVER_STATUSES = ['OK', 'RUNOUT_RISK', 'OVERSTOCK', 'NO_RECENT_USAGE'];

/** Usage window = the last N complete business days (today is still in progress). */
function usageWindow(today) {
  const days = config.forecast.usageWindowDays;
  return { from: addDays(today, -days), to: addDays(today, -1), days, reasons: USAGE_REASONS };
}

/** Analyze every ingredient (or only `ingredientIds`). */
async function analyzeAll({ now = clock.now(), ingredientIds } = {}) {
  const today = businessDate(now);
  const window = usageWindow(today);
  const consumed = await movementRepository.sumConsumption(window);
  const ingredients = ingredientIds
    ? await inventoryRepository.findByIds(ingredientIds)
    : await inventoryRepository.findAll();
  const analyses = ingredients.map((ingredient) => forecastRules.analyzeIngredient({
    ingredient,
    currentStock: rules.getUsableQuantity(ingredient.batches, now),
    avgDailyUsage: (consumed.get(ingredient.id) || 0) / window.days,
    today,
    now,
  }));
  return { now, today, window, ingredients, analyses };
}

const header = ({ now, today, window }) => ({
  as_of: now.toISOString(),
  business_date: today,
  usage_window: { from: window.from, to: window.to, days: window.days, reasons: window.reasons },
});

/** GET /api/inventory/forecast (optional ?status=RUNOUT_RISK|OVERSTOCK|OK|NO_RECENT_USAGE) */
async function getForecast({ status } = {}) {
  if (status !== undefined && !COVER_STATUSES.includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', `status must be one of: ${COVER_STATUSES.join(', ')}`);
  }
  const result = await analyzeAll();
  const data = status ? result.analyses.filter((a) => a.status === status) : result.analyses;
  return { ...header(result), count: data.length, data };
}

/** GET /api/recommendations */
async function getRecommendations() {
  const result = await analyzeAll();
  const { analyses, ingredients, window } = result;
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const runout = analyses
    .filter((a) => a.status === 'RUNOUT_RISK' || a.stock_status !== 'IN_STOCK')
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
    .map((a) => ({
      type: 'PREDICTED_RUNOUT',
      ...a,
      severity: a.stock_status === 'OUT_OF_STOCK' ? 'critical' : a.stock_status === 'LOW_STOCK' ? 'high' : 'warning',
      message: a.next_delivery_date
        ? `${a.ingredient}: ${a.display.current_stock} left, about ${formatQuantity(a.usage_until_next_delivery, a.unit)} needed before the next delivery on ${a.next_delivery_date}.`
        : `${a.ingredient}: ${a.display.current_stock} left.`,
    }));

  const overstock = analyses.filter((a) => a.status === 'OVERSTOCK').map((a) => ({
    ingredient_id: a.ingredient_id,
    ingredient: a.ingredient,
    current_stock: a.current_stock,
    unit: a.unit,
    average_daily_usage: a.average_daily_usage,
    days_of_cover: a.days_of_cover,
    target_days: a.target_days,
    status: 'OVERSTOCK',
    display: a.display,
  }));

  const sold = new Map();
  for (const order of await orderRepository.findSummaries({ from: window.from, to: window.to })) {
    for (const item of order.items) sold.set(item.menuItemId, (sold.get(item.menuItemId) || 0) + item.quantity);
  }
  const blocked = new Set(runout.map((a) => a.ingredient_id));
  const menu = await menuRepository.findAll();
  const specials = analyses.filter((a) => a.status === 'OVERSTOCK').map((analysis) =>
    forecastRules.recommendSpecials({ analysis, menu, ingredientsById: byId, blockedIngredientIds: blocked, soldByItem: sold }));

  return { ...header(result), runout, overstock, specials };
}

/** GET /api/restock - weekly order suggestions for purchased items + prep plan for prep items. */
async function getRestock() {
  const result = await analyzeAll();
  const byId = new Map(result.ingredients.map((i) => [i.id, i]));

  const orders = result.analyses
    .filter((a) => a.kind !== 'prep')
    .map((a) => forecastRules.restockLine(a, byId.get(a.ingredient_id)))
    .sort((a, b) => (b.status === 'RUNOUT_RISK') - (a.status === 'RUNOUT_RISK') || b.suggested_packs - a.suggested_packs);

  const prepPlan = result.analyses.filter((a) => a.kind === 'prep').map((a) => {
    const ingredient = byId.get(a.ingredient_id);
    const { yield: batchYield, inputs } = ingredient.prepRecipe;
    const need = Math.max(0, a.average_daily_usage + ingredient.reorderPoint - a.current_stock);
    const batches = Math.ceil(need / batchYield);
    return {
      ingredient_id: a.ingredient_id,
      ingredient: a.ingredient,
      unit: a.unit,
      current_stock: a.current_stock,
      average_daily_usage: a.average_daily_usage,
      suggested_batches: batches,
      batch_yield: batchYield,
      inputs: inputs.map((input) => ({
        ingredient_id: input.ingredientId,
        ingredient: byId.get(input.ingredientId).name,
        quantity: input.quantity * batches,
        unit: byId.get(input.ingredientId).unit,
      })),
      formula: `${a.average_daily_usage} daily usage + ${ingredient.reorderPoint} minimum - ${a.current_stock} on hand -> ${batches} batch(es) of ${batchYield}`,
    };
  });

  const toOrder = orders.filter((o) => o.suggested_packs > 0);
  return {
    ...header(result),
    horizon_days: config.forecast.restockHorizonDays,
    safety_stock_days: config.forecast.safetyStockDays,
    summary: { ingredients_to_order: toOrder.length, total_packs: toOrder.reduce((s, o) => s + o.suggested_packs, 0) },
    data: orders,
    prep_plan: prepPlan,
  };
}

const { persistent } = require('../data/persistence');
module.exports = {
  USAGE_REASONS,
  analyzeAll,
  getForecast: persistent(getForecast),
  getRecommendations: persistent(getRecommendations),
  getRestock: persistent(getRestock),
};
