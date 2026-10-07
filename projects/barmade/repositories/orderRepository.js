/**
 * Order data access (async + returns copies, ready to swap for a real database).
 */

const { store } = require('../data/store');
const { nextIdAfter } = require('../utils/ids');

const clone = (value) => structuredClone(value);

const placedAt = (o) => o.placed_at || o.createdAt;
const newestFirst = (a, b) => new Date(placedAt(b)) - new Date(placedAt(a));

/** Newest orders first. */
async function findAll() {
  return clone(store.orders).sort(newestFirst);
}

const matches = ({ date, from, to, channel }) => (o) =>
  (!date || o.business_date === date)
  && (!from || o.business_date >= from)
  && (!to || o.business_date <= to)
  && (!channel || (o.channel || 'dine_in') === channel);

/**
 * Filtered, paginated orders (newest first).
 * filter: { date, from, to, channel } - dates are business dates 'YYYY-MM-DD'.
 */
async function find(filter = {}, { limit = 100, offset = 0 } = {}) {
  const matched = store.orders.filter(matches(filter)).sort(newestFirst);
  return { total: matched.length, data: clone(matched.slice(offset, offset + limit)) };
}

async function findById(id) {
  const order = store.orders.find((o) => o.id === id);
  return order ? clone(order) : null;
}

/**
 * Light copies for reports (no `consumed` detail), oldest first.
 * Like a SELECT of a few columns - much cheaper than copying whole orders.
 */
async function findSummaries(filter = {}) {
  return store.orders.filter(matches(filter)).map((o) => ({
    id: o.id,
    channel: o.channel || 'dine_in',
    placed_at: placedAt(o),
    business_date: o.business_date,
    gross_total: o.gross_total ?? o.total,
    channel_fee: o.channel_fee ?? 0,
    net_total: o.net_total ?? o.total,
    items: o.items.map((i) => ({ menuItemId: i.menuItemId, item_id: i.item_id || i.menuItemId, name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
  }));
}

/** Save a new order and assign its ID (ORD-001, ORD-002, ...). */
async function create(order) {
  const last = store.orders[store.orders.length - 1];
  const saved = {
    id: nextIdAfter('ORD', last && last.id),
    ...clone(order),
  };
  store.orders.push(saved);
  return clone(saved);
}

module.exports = { findAll, find, findById, findSummaries, create };
