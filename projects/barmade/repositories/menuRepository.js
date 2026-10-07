/**
 * Menu data access (async + returns copies, ready to swap for a real database).
 */

const { store } = require('../data/store');

const clone = (value) => structuredClone(value);

async function findAll() {
  return clone(store.menu);
}

async function findById(id) {
  const item = store.menu.find((m) => m.id === id);
  return item ? clone(item) : null;
}

module.exports = { findAll, findById };
