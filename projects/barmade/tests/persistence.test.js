const { test } = require('node:test');
const assert = require('node:assert/strict');
delete process.env.FIRESTORE_PROJECT_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const { runTransaction } = require('../data/persistence');
const { store, createSeed, resetStore } = require('../data/store');
const orders = require('../services/orderService');
const clock = require('../utils/clock');

// A committed database outlives individual request contexts and memory resets.
// Real Firestore integration still requires configured credentials.
function fakeDatabase() {
  const records = new Map();
  function reference(path) {
    return {
      path,
      doc: (id) => reference(`${path}/${id}`),
      collection: (name) => reference(`${path}/${name}`),
    };
  }
  return {
    records,
    collection: reference,
    async runTransaction(task) {
      const writes = [];
      const result = await task({
        async get(ref) {
          if (ref.path.split('/').length % 2 === 0) {
            return { exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) };
          }
          return { docs: [...records].filter(([path]) =>
            path.startsWith(`${ref.path}/`) && path.split('/').length === ref.path.split('/').length + 1
          ).map(([, data]) => ({ data: () => structuredClone(data) })) };
        },
        set: (ref, value) => writes.push(() => records.set(ref.path, structuredClone(value))),
        delete: (ref) => writes.push(() => records.delete(ref.path)),
      });
      writes.forEach((write) => write());
      return result;
    },
  };
}

test('saved orders and consumed stock survive memory reset; seed runs only once', async () => {
  clock.setNow('2026-10-06T12:00:00');
  try {
    const db = fakeDatabase();
    let seeds = 0;
    const seed = () => { seeds++; return createSeed(); };
    const result = await runTransaction(db, () => orders.createOrder({
      items: [{ menuItemId: 'MENU-001', quantity: 1 }],
    }), seed);
    const savedQuantity = await runTransaction(db, () => store.inventory[2].batches[0].quantity, seed);
    resetStore();
    await runTransaction(db, () => {
      assert.equal(store.inventory[2].batches[0].quantity, savedQuantity);
      assert.ok(store.orders.some((order) => order.id === result.order.id));
      assert.equal(store.orders.length, 3);
    }, seed);
    assert.equal(seeds, 1);
  } finally {
    clock.setNow(null);
  }
});

test('failed operation commits neither stock changes nor order changes', async () => {
  const db = fakeDatabase();
  await runTransaction(db, () => {}, createSeed);
  const before = structuredClone([...db.records]);
  await assert.rejects(runTransaction(db, () => {
    store.inventory[0].batches[0].quantity = 0;
    store.orders.push({ id: 'ORD-999' });
    throw new Error('failed operation');
  }, createSeed), /failed operation/);
  assert.deepEqual([...db.records], before);
});

test('empty initialized collections remain empty rather than being reseeded', async () => {
  const db = fakeDatabase();
  await runTransaction(db, () => { store.orders = []; }, createSeed);
  await runTransaction(db, () => assert.equal(store.orders.length, 0), () => {
    throw new Error('must not seed again');
  });
});

test('read-only calls do not rewrite stored data', async () => {
  const db = fakeDatabase();
  await runTransaction(db, () => {}, createSeed);
  const before = structuredClone([...db.records]);
  await runTransaction(db, () => assert.equal(store.inventory.length, 12), createSeed);
  assert.deepEqual([...db.records], before);
});
