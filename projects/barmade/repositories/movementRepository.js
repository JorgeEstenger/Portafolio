/**
 * Inventory movement data access. Movements are an append-only audit log:
 * they are never updated or deleted.
 */

const { store } = require('../data/store');
const { nextIdAfter } = require('../utils/ids');

const clone = (value) => structuredClone(value);

/** Save several movements at once, assigning IDs (MOV-000001, ...). */
async function createMany(movements) {
  const saved = [];
  for (const movement of movements) {
    const last = store.movements[store.movements.length - 1];
    const record = { id: nextIdAfter('MOV', last && last.id, 6), ...clone(movement) };
    store.movements.push(record);
    saved.push(record);
  }
  return clone(saved);
}

const matches = (f) => (m) =>
  (!f.ingredientId || m.ingredient_id === f.ingredientId)
  && (!f.reason || m.reason === f.reason)
  && (!f.orderId || m.order_id === f.orderId)
  && (!f.date || m.business_date === f.date)
  && (!f.from || m.business_date >= f.from)
  && (!f.to || m.business_date <= f.to);

/** Filtered, paginated movements, newest first, plus a total per reason. */
async function find(filter = {}, { limit = 100, offset = 0 } = {}) {
  const matched = store.movements.filter(matches(filter));
  const byReason = {};
  for (const m of matched) {
    const r = (byReason[m.reason] ||= { count: 0, change: 0 });
    r.count += 1;
    r.change += m.change;
  }
  const page = matched.slice().reverse().slice(offset, offset + limit);
  return { total: matched.length, byReason, data: clone(page) };
}

/**
 * Units consumed per ingredient between two business dates (inclusive):
 * the negated sum of the given movement reasons. Like a SQL GROUP BY.
 * Returns Map ingredientId -> amount.
 */
async function sumConsumption({ from, to, reasons }) {
  const totals = new Map();
  for (const m of store.movements) {
    if (m.business_date < from || m.business_date > to || !reasons.includes(m.reason)) continue;
    totals.set(m.ingredient_id, (totals.get(m.ingredient_id) || 0) - m.change);
  }
  return totals;
}

module.exports = { createMany, find, sumConsumption };
