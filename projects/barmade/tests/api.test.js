/**
 * End-to-end API tests. Starts the app on a random port and calls it with fetch.
 * The clock is frozen and the in-memory data is reset before every test,
 * so each test sees the exact same starting inventory.
 *
 * Run with: npm test
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Render exposes production variables during builds; tests must never use live data.
delete process.env.FIRESTORE_PROJECT_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

const clock = require('../utils/clock');
const { resetStore } = require('../data/store');
const app = require('../app');

const NOW = '2026-10-06T12:00:00';
let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  clock.setNow(null);
});

beforeEach(() => {
  clock.setNow(NOW);
  resetStore();
});

/** Small fetch wrapper: returns { status, body }. Pass rawBody to send a literal string. */
async function api(method, path, body, rawBody) {
  let payload;
  if (rawBody !== undefined) payload = rawBody;
  else if (body !== undefined) payload = JSON.stringify(body);

  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  return { status: res.status, body: await res.json() };
}

const getIngredient = async (id) => (await api('GET', `/api/inventory/${id}`)).body.data;
const order = (menuItemId, quantity) => api('POST', '/api/orders', { items: [{ menuItemId, quantity }] });

// ---------- Inventory ----------

test('GET /api/inventory returns all ingredients with totals and status', async () => {
  const { status, body } = await api('GET', '/api/inventory');
  assert.equal(status, 200);
  assert.equal(body.count, 12);

  const dough = body.data.find((i) => i.id === 'ING-003');
  assert.equal(dough.totalQuantity, 38);
  assert.equal(dough.status, 'IN_STOCK');

  // Expired basil batch is not counted as usable stock.
  const basil = body.data.find((i) => i.id === 'ING-011');
  assert.equal(basil.totalQuantity, 400);
  assert.equal(basil.expiredQuantity, 100);
});

test('GET /api/inventory/:id returns batches; unknown id -> 404', async () => {
  const ok = await api('GET', '/api/inventory/ING-001');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.batches.length, 2);

  const missing = await api('GET', '/api/inventory/ING-999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'INGREDIENT_NOT_FOUND');
});

// ---------- Orders ----------

test('successful order consumes the right amounts and decreases inventory', async () => {
  const { status, body } = await order('MENU-002', 3); // 3 Pepperoni Pizzas
  assert.equal(status, 201);
  assert.equal(body.data.total, 53.97);

  const consumed = Object.fromEntries(body.consumed.map((c) => [c.ingredientId, c.quantity]));
  assert.deepEqual(consumed, { 'ING-003': 3, 'ING-001': 600, 'ING-002': 450, 'ING-004': 90 });

  assert.equal((await getIngredient('ING-003')).totalQuantity, 35);
  assert.equal((await getIngredient('ING-001')).totalQuantity, 16400);
  assert.equal((await getIngredient('ING-002')).totalQuantity, 11050);
  assert.equal((await getIngredient('ING-004')).totalQuantity, 810);

  const orders = await api('GET', '/api/orders');
  assert.equal(orders.body.count, 3); // 2 mock + 1 new
});

test('FEFO: 6000 ml of tomato sauce empties the earliest batch first', async () => {
  // 24 Spaghetti Marinara x 250 ml = 6000 ml
  const { status, body } = await order('MENU-004', 24);
  assert.equal(status, 201);

  const sauce = body.consumed.find((c) => c.ingredientId === 'ING-001');
  assert.deepEqual(sauce.batches, [
    { batchId: 'TS-001', quantity: 5000 },
    { batchId: 'TS-002', quantity: 1000 },
  ]);

  const batches = Object.fromEntries((await getIngredient('ING-001')).batches.map((b) => [b.batchId, b.quantity]));
  assert.deepEqual(batches, { 'TS-001': 0, 'TS-002': 11000 });
});

test('expired batches are never used to fulfill orders', async () => {
  const { body } = await order('MENU-001', 2); // Margherita uses basil
  const basil = body.consumed.find((c) => c.ingredientId === 'ING-011');
  assert.deepEqual(basil.batches, [{ batchId: 'BA-002', quantity: 10 }]);

  const expiredBatch = (await getIngredient('ING-011')).batches.find((b) => b.batchId === 'BA-001');
  assert.equal(expiredBatch.quantity, 100);
  assert.equal(expiredBatch.status, 'EXPIRED');
});

test('insufficient inventory -> 409 and nothing changes', async () => {
  const before = await api('GET', '/api/inventory');

  // 2 Coca-Colas are fine, but 50 pizzas need 50 dough (only 38).
  const { status, body } = await api('POST', '/api/orders', {
    items: [
      { menuItemId: 'MENU-005', quantity: 2 },
      { menuItemId: 'MENU-002', quantity: 50 },
    ],
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'INSUFFICIENT_INVENTORY');
  const dough = body.error.details.shortages.find((s) => s.ingredientId === 'ING-003');
  assert.equal(dough.available, 38);
  assert.equal(dough.required, 50);

  const afterInv = await api('GET', '/api/inventory');
  assert.deepEqual(afterInv.body, before.body);
  assert.equal((await api('GET', '/api/orders')).body.count, 2);
});

test('order validation errors', async () => {
  const zero = await order('MENU-002', 0);
  assert.equal(zero.status, 400);
  assert.equal(zero.body.error.code, 'INVALID_QUANTITY');

  const negative = await order('MENU-002', -1);
  assert.equal(negative.status, 400);

  const unknown = await order('MENU-999', 1);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'MENU_ITEM_NOT_FOUND');

  const empty = await api('POST', '/api/orders', { items: [] });
  assert.equal(empty.status, 400);

  const badJson = await api('POST', '/api/orders', undefined, '{ "items": [ ');
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error.code, 'INVALID_JSON');
});

// ---------- Alerts ----------

test('low-stock alert is created once and not duplicated', async () => {
  // 38 dough - 8 = 30 = reorderPoint -> LOW_STOCK
  const first = await order('MENU-001', 8);
  assert.equal(first.status, 201);
  assert.equal(first.body.alertsCreated.length, 1);
  assert.equal(first.body.alertsCreated[0].type, 'LOW_STOCK');
  assert.equal(first.body.alertsCreated[0].ingredientId, 'ING-003');
  assert.equal(first.body.alertsCreated[0].currentQuantity, 30);

  assert.equal((await getIngredient('ING-003')).status, 'LOW_STOCK');

  const second = await order('MENU-002', 1);
  assert.equal(second.body.alertsCreated.length, 0);

  const alerts = await api('GET', '/api/alerts?type=LOW_STOCK');
  assert.equal(alerts.status, 200);
  assert.equal(alerts.body.count, 1);
  assert.equal(alerts.body.data[0].currentQuantity, 29); // kept up to date
});

test('expiration check creates EXPIRING_SOON and EXPIRED alerts without duplicates', async () => {
  const { status, body } = await api('POST', '/api/alerts/check-expiration');
  assert.equal(status, 200);

  const summary = body.data.created.map((a) => `${a.type}:${a.batchId}`).sort();
  assert.deepEqual(summary, ['EXPIRED:BA-001', 'EXPIRING_SOON:CH-001', 'EXPIRING_SOON:MZ-001']);

  const again = await api('POST', '/api/alerts/check-expiration');
  assert.equal(again.body.data.created.length, 0);

  const expiring = await api('GET', '/api/alerts?type=EXPIRING_SOON');
  assert.equal(expiring.body.count, 2);
  assert.ok(expiring.body.data.every((a) => a.type === 'EXPIRING_SOON'));

  const badType = await api('GET', '/api/alerts?type=NOPE');
  assert.equal(badType.status, 400);
});

test('using up an expiring batch resolves its alert', async () => {
  await api('POST', '/api/alerts/check-expiration');
  // Chicken Alfredo uses 180 g chicken; 17 servings = 3060 g > CH-001's 3000 g.
  await order('MENU-003', 17);
  const { body } = await api('POST', '/api/alerts/check-expiration');
  assert.ok(body.data.resolved.some((a) => a.batchId === 'CH-001' && a.status === 'RESOLVED'));
});

// ---------- Restock ----------

test('restock adds a batch, increases total and resolves low-stock alert', async () => {
  await order('MENU-001', 8); // dough -> 30, LOW_STOCK

  const { status, body } = await api('POST', '/api/inventory/restock', {
    ingredientId: 'ING-003',
    quantity: 20,
    arrivedAt: '2026-10-06T08:00:00',
    expiresAt: '2026-10-11T23:59:59',
  });
  assert.equal(status, 201);
  assert.equal(body.data.batch.batchId, 'PD-003');
  assert.equal(body.data.ingredient.totalQuantity, 50);
  assert.equal(body.data.ingredient.status, 'IN_STOCK');
  assert.ok(body.data.alerts.resolved.some((a) => a.type === 'LOW_STOCK' && a.ingredientId === 'ING-003'));

  const active = await api('GET', '/api/alerts?type=LOW_STOCK&status=ACTIVE');
  assert.equal(active.body.count, 0);
});

test('restock validation errors', async () => {
  const valid = { ingredientId: 'ING-001', quantity: 1000, expiresAt: '2026-10-13T23:59:59' };
  const cases = [
    [{ ...valid, ingredientId: 'ING-999' }, 404, 'INGREDIENT_NOT_FOUND'],
    [{ ...valid, quantity: 0 }, 400, 'INVALID_QUANTITY'],
    [{ ...valid, quantity: 'lots' }, 400, 'INVALID_QUANTITY'],
    [{ ...valid, expiresAt: undefined }, 400, 'MISSING_EXPIRATION_DATE'],
    [{ ...valid, expiresAt: 'not-a-date' }, 400, 'INVALID_DATE'],
    [{ ...valid, arrivedAt: '2026-09-01T08:00:00', expiresAt: '2026-10-01T23:59:59' }, 400, 'EXPIRED_INVENTORY'],
  ];
  for (const [payload, expectedStatus, expectedCode] of cases) {
    const { status, body } = await api('POST', '/api/inventory/restock', payload);
    assert.equal(status, expectedStatus, JSON.stringify(payload));
    assert.equal(body.error.code, expectedCode, JSON.stringify(payload));
  }
});

test('GET /api/menu returns recipes with ingredient names', async () => {
  const { status, body } = await api('GET', '/api/menu');
  assert.equal(status, 200);
  assert.equal(body.count, 5);
  const pepperoni = body.data.find((m) => m.id === 'MENU-002');
  assert.equal(pepperoni.ingredients[0].ingredientName, 'Pizza Dough');
});
