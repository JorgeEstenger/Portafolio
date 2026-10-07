/**
 * In-memory "database".
 *
 * Holds the live collections that the repositories read and write.
 * Only files in /repositories should import this module - that is the
 * seam where MongoDB/PostgreSQL would plug in later.
 */

const { createInventory } = require('./inventory');
const { createMenu } = require('./menu');
const { createOrders } = require('./orders');
const { createAlerts } = require('./alerts');

const { context } = require('./persistence');

const memory = {
  inventory: [],
  menu: [],
  orders: [],
  alerts: [],
};

// Repositories use the request's isolated transaction snapshot in Firestore mode.
const store = new Proxy(memory, {
  get(target, property) { return (context.getStore() || target)[property]; },
  set(target, property, value) {
    (context.getStore() || target)[property] = value;
    return true;
  },
});

function createSeed() {
  return {
    inventory: createInventory(), menu: createMenu(),
    orders: createOrders(), alerts: createAlerts(),
  };
}

/** (Re)load all collections from the mock data. Used on startup and by tests. */
function resetStore() {
  store.inventory = createInventory();
  store.menu = createMenu();
  store.orders = createOrders();
  store.alerts = createAlerts();
}

resetStore();

module.exports = { store, resetStore, createSeed };
