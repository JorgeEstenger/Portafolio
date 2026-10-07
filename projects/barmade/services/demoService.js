/**
 * Demo controls:
 *   POST /api/demo/reset - reload the deterministic 60-day dataset
 *   GET  /api/demo       - what is loaded (seed, dates, planted stories, counts)
 *
 * After the dataset is (re)loaded, the alert checks run once at the dataset's
 * "now" (Day 60, 6:30 PM), so every reset produces exactly the same alerts.
 */

const { store, resetStore, getDemoMeta } = require('../data/store');
const alertService = require('./alertService');
const { resetRushCounter } = require('./simulationService');
const clock = require('../utils/clock');
const { businessDate } = require('../utils/timezone');
const AppError = require('../utils/AppError');

let readyFor = null;
let readyPromise = null;

/**
 * Runs the startup alert pass for the currently loaded demo dataset (once).
 * Called by a tiny middleware in app.js before every request, so it also works
 * when the app is started without server.js (tests, Firebase Functions).
 */
function ensureReady() {
  const meta = getDemoMeta();
  if (!meta) return Promise.resolve();
  if (readyFor !== meta) {
    readyFor = meta;
    resetRushCounter(); // rush #1 after every reset is the same rush
    readyPromise = alertService.checkExpirations({ now: new Date(meta.now) });
  }
  return readyPromise;
}

function status() {
  const meta = getDemoMeta();
  const now = clock.now();
  return {
    dataset: meta ? 'demo' : 'classic',
    clock: { now: now.toISOString(), business_date: businessDate(now) },
    ...(meta || {}),
    counts: {
      ingredients: store.inventory.length,
      menu_items: store.menu.length,
      orders: store.orders.length,
      inventory_movements: store.movements.length,
      active_alerts: store.alerts.filter((a) => a.status === 'ACTIVE').length,
    },
  };
}

async function reset() {
  if (process.env.FIRESTORE_PROJECT_ID) {
    throw new AppError(409, 'DEMO_RESET_UNAVAILABLE', 'Demo reset only works with in-memory storage (FIRESTORE_PROJECT_ID is set).');
  }
  resetStore('demo');
  await ensureReady();
  return status();
}

module.exports = { reset, status, ensureReady };
