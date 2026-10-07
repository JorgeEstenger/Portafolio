/**
 * Alert data access (async + returns copies, ready to swap for a real database).
 */

const { store } = require('../data/store');
const { nextId } = require('../utils/ids');

const clone = (value) => structuredClone(value);

/**
 * Find alerts matching every provided field, e.g.
 * find({ type: 'LOW_STOCK', status: 'ACTIVE' }). Undefined fields are ignored.
 */
async function find(filter = {}) {
  const entries = Object.entries(filter).filter(([, value]) => value !== undefined);
  return clone(store.alerts.filter((alert) => entries.every(([key, value]) => alert[key] === value)));
}

/** Save a new alert and assign its ID (ALERT-001, ALERT-002, ...). */
async function create(alert) {
  const saved = {
    id: nextId('ALERT', store.alerts.map((a) => a.id)),
    ...clone(alert),
  };
  store.alerts.push(saved);
  return clone(saved);
}

async function update(id, changes) {
  const alert = store.alerts.find((a) => a.id === id);
  if (!alert) return null;
  Object.assign(alert, clone(changes));
  return clone(alert);
}

module.exports = { find, create, update };
