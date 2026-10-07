/**
 * Order data access (async + returns copies, ready to swap for a real database).
 */

const { store } = require('../data/store');
const { nextId } = require('../utils/ids');

const clone = (value) => structuredClone(value);

/** Newest orders first. */
async function findAll() {
  return clone(store.orders).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Save a new order and assign its ID (ORD-001, ORD-002, ...). */
async function create(order) {
  const saved = {
    id: nextId('ORD', store.orders.map((o) => o.id)),
    ...clone(order),
  };
  store.orders.push(saved);
  return clone(saved);
}

module.exports = { findAll, create };
