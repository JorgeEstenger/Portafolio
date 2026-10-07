/**
 * Tests for the 60-day demo dataset and the full restaurant workflow:
 * order -> recipe -> inventory depletion -> movements -> alerts -> dashboard.
 *
 * The clock is frozen at the dataset's "now" (Day 60, 6:30 PM New York)
 * so results don't depend on how long the tests take.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.FIRESTORE_PROJECT_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

const clock = require('../utils/clock');
const { resetStore } = require('../data/store');
const { generateDemoData } = require('../data/demo/generator');
const rules = require('../services/stockRules');
const app = require('../app');

let server;
let baseUrl;
let demo; // one generated dataset, shared by the data tests

before(async () => {
  demo = generateDemoData();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  clock.setNow(null);
});

beforeEach(() => {
  clock.setNow(demo.meta.now);
  resetStore('demo');
});

async function api(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const get = async (path) => (await api('GET', path)).body;
const stock = async (key) => (await get(`/api/inventory/${key}`)).data.totalQuantity;

// ---------- generated data ----------

test('dataset is deterministic: same seed -> identical data, other seed -> different', () => {
  assert.deepEqual(generateDemoData(), demo);
  const other = generateDemoData({ seed: 42 });
  assert.notEqual(other.orders.length, demo.orders.length);
});

test('dataset size and shape are realistic', () => {
  const { orders, movements, inventory, menu, meta } = demo;
  assert.equal(meta.days, 60);
  assert.ok(orders.length >= 6000 && orders.length <= 9000, `orders: ${orders.length}`);
  assert.ok(inventory.length >= 20 && inventory.length <= 30);
  assert.ok(menu.length >= 15 && menu.length <= 25);
  assert.ok(inventory.filter((i) => i.kind === 'prep').length >= 3);
  assert.ok(movements.length > 10000);

  const reasons = new Set(movements.map((m) => m.reason));
  for (const r of ['sale', 'delivery', 'waste', 'spoilage', 'manual_count', 'correction', 'prep_production', 'prep_usage']) {
    assert.ok(reasons.has(r), `missing movement reason ${r}`);
  }
  assert.deepEqual(new Set(orders.map((o) => o.channel)), new Set(['dine_in', 'takeout', 'website', 'uber_eats', 'doordash', 'barmade']));
  // Every original menu item and ingredient is still there with its original ID.
  for (const id of ['MENU-001', 'MENU-002', 'MENU-003', 'MENU-004', 'MENU-005']) assert.ok(menu.some((m) => m.id === id));
  for (let n = 1; n <= 12; n++) assert.ok(inventory.some((i) => i.id === `ING-${String(n).padStart(3, '0')}`));
});

test('weekends are busier than early weekdays, and orders cluster in lunch/dinner rushes', () => {
  const perDay = new Map();
  for (const o of demo.orders) perDay.set(o.business_date, (perDay.get(o.business_date) || 0) + 1);
  const avg = (weekdays) => {
    const days = [...perDay].filter(([d]) => d !== demo.meta.end_date && weekdays.includes(new Date(`${d}T12:00:00Z`).getUTCDay()));
    return days.reduce((s, [, n]) => s + n, 0) / days.length;
  };
  assert.ok(avg([5, 6, 0]) > avg([1, 2, 3]) * 1.3);

  const hours = demo.orders.map((o) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(o.placed_at))));
  const share = (from, to) => hours.filter((h) => h >= from && h < to).length / hours.length;
  assert.ok(share(11, 14) + share(17, 22) > 0.85, 'most orders are in the rushes');
  assert.ok(share(15, 17) < 0.06, 'the afternoon is quiet');
});

test('stock never goes negative and the movement log adds up to the stock on hand', () => {
  assert.equal(demo.movements.filter((m) => m.balance_after < 0).length, 0);
  for (const ingredient of demo.inventory) {
    const logged = demo.movements.filter((m) => m.ingredient_id === ingredient.id).reduce((s, m) => s + m.change, 0);
    const onHand = ingredient.batches.reduce((s, b) => s + b.quantity, 0);
    assert.ok(Math.abs(logged - onHand) < 1e-6, `${ingredient.name}: movements ${logged} vs batches ${onHand}`);
  }
});

test('order totals: gross = sum of lines, net = gross - channel fee', () => {
  for (const o of demo.orders.slice(0, 500)) {
    const lines = Math.round(o.items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
    assert.equal(o.gross_total, lines);
    assert.equal(o.net_total, Math.round((o.gross_total - o.channel_fee) * 100) / 100);
  }
});

test('planted stories: low stock, overstock, delivery fees, best seller, sales spike', async () => {
  // 1. Mozzarella just above its minimum.
  const mozz = demo.inventory.find((i) => i.id === 'ING-002');
  const now = new Date(demo.meta.now);
  const mozzStock = rules.getUsableQuantity(mozz.batches, now);
  assert.ok(mozzStock > mozz.reorderPoint && mozzStock <= mozz.reorderPoint + 3000, `mozzarella ${mozzStock}`);

  // 2. Tomato sauce overstocked -> specials recommended.
  const recs = await get('/api/recommendations');
  assert.deepEqual(recs.overstock.map((o) => o.ingredient), ['Tomato Sauce']);
  assert.ok(recs.overstock[0].days_of_cover > 12);
  assert.equal(recs.specials[0].recommended_items.length, 3);

  // 3. Uber Eats: big gross, much lower net.
  const { channels } = await get('/api/dashboard/channels?days=60');
  const uber = channels.find((c) => c.channel === 'uber_eats');
  const dineIn = channels.find((c) => c.channel === 'dine_in');
  assert.ok(uber.gross > channels.find((c) => c.channel === 'takeout').gross);
  assert.ok(uber.net_margin_pct <= 75 && dineIn.net_margin_pct === 100);

  // 4. Margherita is the best-selling dish by a clear margin.
  const items = (await get('/api/dashboard/items?days=60')).data.filter((i) => i.category !== 'Beverage');
  assert.equal(items[0].name, 'Margherita Pizza');
  assert.ok(items[0].quantity > items[1].quantity * 1.2);

  // 5. The spike Saturday is detected as an anomaly.
  const sales = await get('/api/dashboard/sales?days=60');
  assert.ok(sales.anomalies.some((a) => a.date === demo.meta.stories.sales_spike.date && a.anomaly === 'SPIKE'));
  assert.equal(sales.daily.length, 60);
});

// ---------- the full workflow (spec section 25) ----------

test('full workflow: order -> depletion -> movements -> alert -> dashboard -> rush -> restock -> reset', async () => {
  // 1. Reset demo.
  const reset = await api('POST', '/api/demo/reset');
  assert.equal(reset.status, 200);
  assert.equal(reset.body.dataset, 'demo');

  // 2-3. Dashboard and mozzarella before.
  const dash0 = await get('/api/dashboard/today');
  const uber0 = dash0.channels.find((c) => c.channel === 'uber_eats');
  const before = { mozz: await stock('mozzarella'), sauce: await stock('tomato_sauce'), dough: await stock('pizza_dough') };
  assert.equal((await get('/api/inventory/mozzarella')).data.status, 'IN_STOCK');

  // 4. Submit a Margherita order (canonical shape, Uber Eats).
  const created = await api('POST', '/api/orders', { channel: 'uber_eats', items: [{ item_id: 'pizza_margherita', qty: 1, modifiers: [] }] });
  assert.equal(created.status, 201);
  const order = created.body.data;
  assert.equal(order.channel, 'uber_eats');
  assert.equal(order.gross_total, 15.99);
  assert.equal(order.channel_fee, 4.8);
  assert.equal(order.net_total, 11.19);

  // 5. Stored.
  assert.equal((await get(`/api/orders/${order.id}`)).data.id, order.id);

  // 6. Recipe amounts deducted (150 g mozzarella, 200 ml sauce, 1 dough ball).
  assert.equal(await stock('mozzarella'), before.mozz - 150);
  assert.equal(await stock('tomato_sauce'), before.sauce - 200);
  assert.equal(await stock('pizza_dough'), before.dough - 1);

  // 7. Movements recorded.
  const movements = await get(`/api/inventory/movements?order_id=${order.id}`);
  assert.equal(movements.total, 5);
  assert.ok(movements.data.every((m) => m.reason === 'sale' && m.change < 0));
  assert.equal(movements.data.find((m) => m.ingredient_id === 'ING-002').balance_after, before.mozz - 150);

  // 8-9. Keep ordering (legacy request shape) until mozzarella crosses its minimum.
  let lowAlert = null;
  let extraOrders = 0;
  while (!lowAlert && extraOrders < 20) {
    const res = await api('POST', '/api/orders', { items: [{ menuItemId: 'MENU-001', quantity: 2 }] });
    assert.equal(res.status, 201);
    extraOrders += 1;
    lowAlert = res.body.alertsCreated.find((a) => a.type === 'LOW_STOCK' && a.ingredient_id === 'ING-002');
  }
  assert.ok(lowAlert, 'LOW_STOCK alert for mozzarella');
  assert.equal(lowAlert.severity, 'high');
  assert.ok(lowAlert.current_stock <= lowAlert.minimum_stock);
  const active = await get('/api/alerts?type=LOW_STOCK&status=ACTIVE');
  assert.equal(active.data.filter((a) => a.ingredientId === 'ING-002').length, 1, 'no duplicate alert');

  // 10-11. Dashboard sales and channel stats moved.
  const dash1 = await get('/api/dashboard/today');
  assert.equal(dash1.sales.orders, dash0.sales.orders + 1 + extraOrders);
  assert.ok(dash1.sales.gross_revenue > dash0.sales.gross_revenue);
  assert.equal(dash1.channels.find((c) => c.channel === 'uber_eats').orders, uber0.orders + 1);
  assert.equal(dash1.inventory.low_stock_count, dash0.inventory.low_stock_count + 1);
  assert.ok(dash1.active_alerts.some((a) => a.type === 'LOW_STOCK' && a.ingredient_id === 'ING-002'));

  // 12-13. Rush through the normal pipeline.
  const mozzBeforeRush = await stock('mozzarella');
  const rush = await api('POST', '/api/simulate/rush', { orders: 30 });
  assert.equal(rush.status, 201);
  assert.equal(rush.body.orders_created + rush.body.orders_rejected, 30);
  assert.ok(rush.body.orders_created > 0 && rush.body.inventory_movements_created > rush.body.orders_created);
  const dash2 = await get('/api/dashboard/today');
  assert.equal(dash2.sales.orders, dash1.sales.orders + rush.body.orders_created);
  assert.ok(await stock('mozzarella') < mozzBeforeRush);

  // 14. Restock suggests buying mozzarella.
  const restock = await get('/api/restock');
  const mozzLine = restock.data.find((l) => l.ingredient_id === 'ING-002');
  assert.ok(mozzLine.suggested_order > 0 && mozzLine.suggested_order % 2500 === 0);

  // 15-16. Reset brings back the exact original state.
  await api('POST', '/api/demo/reset');
  assert.deepEqual(await get('/api/dashboard/today'), dash0);
  assert.equal(await stock('mozzarella'), before.mozz);
  assert.deepEqual((await get('/api/alerts')).data, (await (async () => { await api('POST', '/api/demo/reset'); return get('/api/alerts'); })()).data);
});

test('rush #1 after a reset is always the same rush', async () => {
  const first = (await api('POST', '/api/simulate/rush')).body;
  await api('POST', '/api/demo/reset');
  const again = (await api('POST', '/api/simulate/rush')).body;
  assert.equal(again.orders_created, first.orders_created);
  assert.equal(again.gross_revenue, first.gross_revenue);
  assert.ok(first.orders_created >= 20 && first.orders_created <= 50);
});

// ---------- new inventory endpoints ----------

test('delivery (with unit conversion), waste, manual count and prep write movements', async () => {
  const mozz = await stock('mozzarella');
  const delivery = await api('POST', '/api/inventory/delivery', { ingredient_id: 'mozzarella', quantity: 20, unit: 'kg' });
  assert.equal(delivery.status, 201);
  assert.equal(delivery.body.data.movement.change, 20000);
  assert.equal(delivery.body.data.movement.reason, 'delivery');
  assert.equal(await stock('mozzarella'), mozz + 20000);

  const badUnit = await api('POST', '/api/inventory/delivery', { ingredient_id: 'mozzarella', quantity: 2, unit: 'gal' });
  assert.equal(badUnit.status, 400);
  assert.equal(badUnit.body.error.code, 'INVALID_UNIT');

  const waste = await api('POST', '/api/inventory/waste', { ingredient_id: 'basil', quantity: 30, reason: 'waste', note: 'Bruised leaves' });
  assert.equal(waste.status, 201);
  assert.equal(waste.body.data.movements[0].change, -30);

  const counted = (await stock('olive_oil')) - 120;
  const count = await api('POST', '/api/inventory/adjustments', { ingredient_id: 'olive_oil', reason: 'manual_count', counted_quantity: counted });
  assert.equal(count.status, 201);
  assert.equal(count.body.data.change, -120);
  assert.equal(await stock('olive_oil'), counted);

  const dough = await stock('pizza_dough');
  const flour = await stock('flour');
  const prep = await api('POST', '/api/inventory/prep', { ingredient_id: 'pizza_dough', batches: 1 });
  assert.equal(prep.status, 201);
  assert.equal(await stock('pizza_dough'), dough + 40);
  assert.equal(await stock('flour'), flour - 10000);
  assert.deepEqual(prep.body.data.movements.map((m) => m.reason).sort(), ['prep_production', 'prep_usage', 'prep_usage']);
});

test('modifiers change what is consumed and what is charged', async () => {
  const mozz = await stock('mozzarella');
  const extra = await api('POST', '/api/orders', { items: [{ item_id: 'pizza_margherita', qty: 2, modifiers: ['extra_cheese'] }] });
  assert.equal(extra.status, 201);
  assert.equal(extra.body.data.items[0].unitPrice, 17.99);
  assert.equal(await stock('mozzarella'), mozz - 2 * (150 + 75));

  const none = await api('POST', '/api/orders', { items: [{ item_id: 'pizza_margherita', qty: 1, modifiers: ['no_cheese'] }] });
  assert.ok(!none.body.consumed.some((c) => c.ingredientId === 'ING-002'));

  const invalid = await api('POST', '/api/orders', { items: [{ item_id: 'tiramisu', qty: 1, modifiers: ['extra_cheese'] }] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_MODIFIER');

  const badChannel = await api('POST', '/api/orders', { channel: 'fax', items: [{ item_id: 'tiramisu', qty: 1 }] });
  assert.equal(badChannel.status, 400);
  assert.equal(badChannel.body.error.code, 'INVALID_CHANNEL');
});

test('recipes, forecast and paginated orders', async () => {
  const recipes = await get('/api/recipes');
  const margherita = recipes.data.find((r) => r.item_id === 'pizza_margherita');
  assert.deepEqual(margherita.ingredients.map((i) => `${i.key}:${i.quantity}${i.unit}`),
    ['pizza_dough:1units', 'tomato_sauce:200ml', 'mozzarella:150g', 'basil:5g', 'olive_oil:10ml']);
  assert.ok(margherita.raw_ingredients.some((i) => i.key === 'flour')); // through the dough prep recipe
  assert.equal(recipes.prep_recipes.length, 3);

  const forecast = await get('/api/inventory/forecast');
  const mozz = forecast.data.find((f) => f.ingredient_id === 'ING-002');
  assert.equal(mozz.status, 'RUNOUT_RISK');
  assert.ok(mozz.average_daily_usage > 0 && mozz.predicted_runout_date);

  const page = await get('/api/orders?limit=10&channel=doordash');
  assert.equal(page.count, 10);
  assert.ok(page.total > 500);
  assert.ok(page.data.every((o) => o.channel === 'doordash'));
});
