/**
 * In-memory "database".
 *
 * Holds the live collections that the repositories read and write.
 * Only files in /repositories should import this module - that is the
 * seam where MongoDB/PostgreSQL would plug in later.
 *
 * Two datasets:
 *   'demo'    (default) - 60 days of generated history, see data/demo/generator.js
 *   'classic' - the original small fixture (data/inventory.js, menu.js, orders.js),
 *               still used by the original tests and as the Firestore seed.
 */

const { createInventory } = require('./inventory');
const { createMenu } = require('./menu');
const { createOrders } = require('./orders');
const { createAlerts } = require('./alerts');
const { generateDemoData } = require('./demo/generator');
const config = require('../config');
const clock = require('../utils/clock');

const { context } = require('./persistence');

const memory = {
  inventory: [],
  menu: [],
  orders: [],
  alerts: [],
  movements: [],
};

// Repositories use the request's isolated transaction snapshot in Firestore mode.
const store = new Proxy(memory, {
  get(target, property) { return (context.getStore() || target)[property]; },
  set(target, property, value) {
    (context.getStore() || target)[property] = value;
    return true;
  },
});

/** Firestore seed: the classic fixture (60 days of history is too large for one transaction). */
function createSeed() {
  return {
    inventory: createInventory(), menu: createMenu(),
    orders: createOrders(), alerts: createAlerts(), movements: [],
  };
}

// The dataset is regenerated on every reset (~1 s) instead of cached: keeping a
// second copy in memory would not fit comfortably in a 512 MB free-tier instance.
let demoMeta = null;

/**
 * (Re)load all collections. Used on startup, by POST /api/demo/reset and by tests.
 * Returns the demo metadata (seed, dates, planted stories) for the demo dataset.
 */
function resetStore(dataset = config.demo.dataset) {
  if (dataset === 'classic') {
    Object.assign(store, createSeed());
    clock.startDemoClock(null);
    demoMeta = null;
    return null;
  }
  // Drop the old dataset first so both never have to fit in memory at once.
  Object.assign(store, { inventory: [], menu: [], orders: [], alerts: [], movements: [] });
  const { meta, ...collections } = generateDemoData();
  Object.assign(store, collections);
  demoMeta = meta;
  // Time continues from the end of the generated history (Day 60, 6:30 PM).
  clock.startDemoClock(meta.now);
  return meta;
}

const getDemoMeta = () => demoMeta;

resetStore(process.env.FIRESTORE_PROJECT_ID ? 'classic' : config.demo.dataset);

module.exports = { store, resetStore, createSeed, getDemoMeta };
