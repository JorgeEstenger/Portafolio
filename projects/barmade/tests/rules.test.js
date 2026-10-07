/**
 * Unit tests for the pure helpers added for the demo: units, timezone,
 * order rules (modifiers, fees) and forecasting formulas.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const units = require('../utils/units');
const tz = require('../utils/timezone');
const orderRules = require('../services/orderRules');
const forecastRules = require('../services/forecastRules');
const { createMenuCatalog } = require('../data/demo/catalog');
const { createRandom } = require('../utils/random');

test('units: convert to base units, refuse impossible conversions, format for display', () => {
  assert.equal(units.toBaseUnit(2.5, 'kg', 'g'), 2500);
  assert.equal(units.toBaseUnit(2, 'L', 'ml'), 2000);
  assert.equal(Math.round(units.toBaseUnit(1, 'gal', 'ml')), 3785);
  assert.equal(units.toBaseUnit(3, 'units', 'cans'), 3);
  assert.throws(() => units.toBaseUnit(1, 'gal', 'g'), /Cannot convert/);
  assert.equal(units.formatQuantity(6500, 'g'), '6.5 kg');
  assert.equal(units.formatQuantity(450, 'g'), '450 g');
  assert.equal(units.formatQuantity(38, 'units'), '38 units');
});

test('timezone: business dates are New York dates, across DST', () => {
  assert.equal(tz.zonedToUtc('2026-10-07', '18:30').toISOString(), '2026-10-07T22:30:00.000Z'); // EDT
  assert.equal(tz.zonedToUtc('2026-12-07', '18:30').toISOString(), '2026-12-07T23:30:00.000Z'); // EST
  assert.equal(tz.businessDate('2026-10-08T02:00:00Z'), '2026-10-07'); // 10 PM in New York
  assert.equal(tz.addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(tz.weekdayOf('2026-10-07'), 3);
});

test('random: same seed and stream -> same numbers', () => {
  const a = createRandom(20261007, 'x');
  const b = createRandom(20261007, 'x');
  const c = createRandom(20261007, 'y');
  const seqA = [a.next(), a.next(), a.next()];
  assert.deepEqual(seqA, [b.next(), b.next(), b.next()]);
  assert.notDeepEqual(seqA, [c.next(), c.next(), c.next()]);
});

test('order rules: recipe x quantity with modifiers, and channel fees', () => {
  const menu = createMenuCatalog();
  const { channel, lines } = orderRules.normalizeOrder({
    channel: 'doordash',
    items: [
      { item_id: 'pizza_margherita', qty: 3 },
      { menuItemId: 'MENU-001', quantity: 1, modifiers: ['extra_cheese'] },
    ],
  }, menu);
  const required = orderRules.computeRequirements(lines);
  assert.equal(required.get('ING-002'), 3 * 150 + (150 + 75)); // mozzarella
  assert.equal(required.get('ING-001'), 4 * 200); // tomato sauce
  assert.equal(required.get('ING-003'), 4); // dough

  const priced = orderRules.priceOrder(lines, channel);
  assert.equal(priced.gross, 3 * 15.99 + 17.99);
  assert.equal(priced.fee, Math.round(priced.gross * 0.25 * 100) / 100);
  assert.equal(priced.net, Math.round((priced.gross - priced.fee) * 100) / 100);
});

test('forecast: days of cover, overstock and run-out before next delivery', () => {
  const now = tz.zonedToUtc('2026-10-07', '18:30'); // Wednesday evening
  const ingredient = { id: 'X', name: 'Mozzarella', unit: 'g', reorderPoint: 5000, deliveryDays: [5], targetDays: 3 };
  const tight = forecastRules.analyzeIngredient({ ingredient, currentStock: 6500, avgDailyUsage: 2100, today: '2026-10-07', now });
  assert.equal(tight.days_remaining, 3.1);
  assert.equal(tight.next_delivery_date, '2026-10-09'); // Friday
  assert.equal(tight.status, 'OK'); // 6.5 kg > ~2.8 kg needed until Friday

  const short = forecastRules.analyzeIngredient({ ingredient, currentStock: 2000, avgDailyUsage: 2100, today: '2026-10-07', now });
  assert.equal(short.status, 'RUNOUT_RISK');
  assert.equal(short.predicted_runout_date, '2026-10-08');

  const over = forecastRules.analyzeIngredient({ ingredient, currentStock: 30000, avgDailyUsage: 2100, today: '2026-10-07', now });
  assert.equal(over.status, 'OVERSTOCK'); // 14.3 days vs 3-day target
});
