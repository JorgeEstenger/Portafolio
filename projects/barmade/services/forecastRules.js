/**
 * Pure, explainable forecasting rules. Plain arithmetic - no AI.
 *
 *   average daily usage  = units consumed (sale + prep_usage + waste) in the last
 *                          N complete business days / N            (N = 14 by default)
 *   days remaining       = current stock / average daily usage    (= days of cover)
 *   run-out risk         = stock < usage expected before the next delivery arrives
 *   overstock            = days of cover > target days x overstock factor (1.75)
 *   restock order        = expected usage over the horizon + safety stock - current stock,
 *                          rounded up to whole packs
 */

const config = require('../config');
const { addDays, weekdayOf, zonedParts } = require('../utils/timezone');
const { formatQuantity, round } = require('../utils/units');

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Share of today's service still to come (0 before... 1 at opening, 0 after closing). */
function remainingServiceFraction(now) {
  const p = zonedParts(now);
  const current = p.hour * 60 + p.minute;
  const open = minutesOf(config.restaurant.opensAt);
  const close = minutesOf(config.restaurant.closesAt);
  return Math.min(1, Math.max(0, (close - current) / (close - open)));
}

/**
 * Next business date when this ingredient is replenished.
 * Deliveries (and prep) happen before opening, so today only counts if we haven't opened yet.
 */
function nextReplenishmentDate(ingredient, today, now) {
  const days = ingredient.deliveryDays;
  if (!Array.isArray(days) || days.length === 0) return null;
  const beforeOpening = remainingServiceFraction(now) >= 1;
  for (let k = beforeOpening ? 0 : 1; k <= 7; k++) {
    const date = addDays(today, k);
    if (days.includes(weekdayOf(date))) return date;
  }
  return null;
}

/** Service days between now and the morning of `date` (today's remaining share + full days in between). */
function serviceDaysUntil(date, today, now) {
  if (!date) return null;
  let total = 0;
  for (let d = today; d < date; d = addDays(d, 1)) total += d === today ? remainingServiceFraction(now) : 1;
  return total;
}

/** Date the stock runs out if usage continues at the average rate (null if no usage). */
function predictRunoutDate(stock, avgDailyUsage, today, now) {
  if (!(avgDailyUsage > 0)) return null;
  let remaining = stock - avgDailyUsage * remainingServiceFraction(now);
  let date = today;
  for (let k = 0; remaining > 0 && k < 366; k++) {
    date = addDays(date, 1);
    remaining -= avgDailyUsage;
  }
  return remaining > 0 ? null : date;
}

/** Full stock analysis for one ingredient. Quantities are in the ingredient's base unit. */
function analyzeIngredient({ ingredient, currentStock, avgDailyUsage, today, now }) {
  const avg = round(avgDailyUsage, 2);
  const cover = avg > 0 ? round(currentStock / avg, 1) : null;
  const nextDate = nextReplenishmentDate(ingredient, today, now);
  const daysUntil = serviceDaysUntil(nextDate, today, now);
  const usageUntilNext = daysUntil === null ? null : round(avg * daysUntil, 0);
  const targetDays = ingredient.targetDays ?? null;

  let stockStatus = 'IN_STOCK';
  if (currentStock <= 0) stockStatus = 'OUT_OF_STOCK';
  else if (currentStock <= ingredient.reorderPoint) stockStatus = 'LOW_STOCK';

  const runoutRisk = avg > 0 && usageUntilNext !== null && currentStock < usageUntilNext;
  const overstock = cover !== null && targetDays !== null && cover > targetDays * config.forecast.overstockFactor;

  let coverStatus = 'OK';
  if (avg <= 0) coverStatus = currentStock > 0 ? 'NO_RECENT_USAGE' : 'OK';
  else if (runoutRisk) coverStatus = 'RUNOUT_RISK';
  else if (overstock) coverStatus = 'OVERSTOCK';

  return {
    ingredient_id: ingredient.id,
    ingredient: ingredient.name,
    kind: ingredient.kind || 'purchased',
    unit: ingredient.unit,
    current_stock: currentStock,
    minimum_stock: ingredient.reorderPoint,
    average_daily_usage: avg,
    days_remaining: cover,
    days_of_cover: cover,
    target_days: targetDays,
    predicted_runout_date: predictRunoutDate(currentStock, avg, today, now),
    next_delivery_date: nextDate,
    usage_until_next_delivery: usageUntilNext,
    stock_status: stockStatus,
    status: coverStatus,
    display: {
      current_stock: formatQuantity(currentStock, ingredient.unit),
      average_daily_usage: `${formatQuantity(avg, ingredient.unit)}/day`,
    },
  };
}

/** Suggested purchase for one ingredient (weekly horizon, capped at shelf life). */
function restockLine(analysis, ingredient) {
  const horizon = Math.min(config.forecast.restockHorizonDays, ingredient.shelfLifeDays || Infinity);
  const avg = analysis.average_daily_usage;
  const expected = round(avg * horizon, 0);
  const safety = round(avg * config.forecast.safetyStockDays, 0);
  const shortfall = Math.max(0, expected + safety - analysis.current_stock);
  const packSize = ingredient.packSize || 1;
  const packs = Math.ceil(shortfall / packSize);
  const unit = ingredient.unit;
  return {
    ingredient_id: ingredient.id,
    ingredient: ingredient.name,
    supplier: ingredient.supplier || null,
    unit,
    current_stock: analysis.current_stock,
    average_daily_usage: avg,
    horizon_days: horizon,
    expected_usage: expected,
    safety_stock: safety,
    suggested_order: packs * packSize,
    suggested_packs: packs,
    pack: ingredient.packLabel || null,
    next_delivery_date: analysis.next_delivery_date,
    status: analysis.status,
    formula: `${expected} expected + ${safety} safety - ${analysis.current_stock} on hand = ${round(shortfall, 0)} ${unit} -> ${packs} pack(s)`,
    display: {
      current_stock: formatQuantity(analysis.current_stock, unit),
      expected_usage: formatQuantity(expected, unit),
      safety_stock: formatQuantity(safety, unit),
      suggested_order: formatQuantity(packs * packSize, unit),
    },
  };
}

/**
 * Per-serving use of every ingredient, following prep items down to their raw
 * inputs too (a pizza uses dough, and dough uses flour).
 */
function expandRecipe(menuItem, ingredientsById) {
  const usage = new Map();
  const add = (id, quantity, depth) => {
    usage.set(id, (usage.get(id) || 0) + quantity);
    const ingredient = ingredientsById.get(id);
    if (ingredient && ingredient.prepRecipe && depth < 3) {
      for (const input of ingredient.prepRecipe.inputs) {
        add(input.ingredientId, (quantity * input.quantity) / ingredient.prepRecipe.yield, depth + 1);
      }
    }
  };
  for (const line of menuItem.ingredients) add(line.ingredientId, line.quantity, 0);
  return usage;
}

/**
 * Specials for one overstocked ingredient: dishes that use it, ranked by how
 * much of it one serving uses, then by recent popularity. Dishes that need an
 * ingredient that is low / at risk are skipped - you can't promote what you can't make.
 */
function recommendSpecials({ analysis, menu, ingredientsById, blockedIngredientIds, soldByItem }) {
  const candidates = [];
  const excluded = [];
  for (const item of menu) {
    const usage = expandRecipe(item, ingredientsById);
    const perServing = usage.get(analysis.ingredient_id);
    if (!perServing) continue;
    const blockers = item.ingredients.map((l) => l.ingredientId).filter((id) => blockedIngredientIds.has(id));
    if (blockers.length) {
      excluded.push({ item_id: item.key || item.id, name: item.name, reason: `needs ${blockers.map((id) => ingredientsById.get(id).name).join(', ')} (low stock)` });
      continue;
    }
    candidates.push({
      item_id: item.key || item.id,
      menuItemId: item.id,
      name: item.name,
      uses_per_serving: round(perServing, 1),
      unit: analysis.unit,
      sold_last_14_days: soldByItem.get(item.id) || 0,
    });
  }
  candidates.sort((a, b) => b.uses_per_serving - a.uses_per_serving || b.sold_last_14_days - a.sold_last_14_days);

  const excess = Math.max(0, analysis.current_stock - analysis.average_daily_usage * analysis.target_days);
  const recommended = candidates.slice(0, 3).map((c) => ({ ...c, extra_servings_to_clear_excess: Math.ceil(excess / c.uses_per_serving) }));
  return {
    ingredient_id: analysis.ingredient_id,
    ingredient: analysis.ingredient,
    reason: `${analysis.days_of_cover} days of inventory vs ${analysis.target_days}-day target`,
    excess_quantity: round(excess, 0),
    unit: analysis.unit,
    display: { excess_quantity: formatQuantity(excess, analysis.unit) },
    recommended_items: recommended.map((r) => r.name),
    ranking: recommended,
    excluded,
  };
}

module.exports = {
  remainingServiceFraction, nextReplenishmentDate, serviceDaysUntil, predictRunoutDate,
  analyzeIngredient, restockLine, expandRecipe, recommendSpecials,
};
