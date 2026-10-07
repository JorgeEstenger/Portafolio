/**
 * Unit tests for the pure stock rules (FEFO, statuses).
 * Run with: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../services/stockRules');

const now = new Date('2026-10-06T12:00:00');

test('FEFO takes from the batch that expires first', () => {
  const batches = [
    { batchId: 'B', quantity: 10000, arrivedAt: '2026-10-05T08:00:00', expiresAt: '2026-10-12T23:59:59' },
    { batchId: 'A', quantity: 5000, arrivedAt: '2026-10-02T08:00:00', expiresAt: '2026-10-08T23:59:59' },
  ];
  const plan = rules.planFefoConsumption(batches, 6000, now);

  assert.equal(plan.fulfilled, true);
  assert.deepEqual(plan.allocations, [
    { batchId: 'A', take: 5000, remaining: 0 },
    { batchId: 'B', take: 1000, remaining: 9000 },
  ]);
});

test('FEFO never uses expired batches', () => {
  const batches = [
    { batchId: 'OLD', quantity: 100, arrivedAt: '2026-09-30T08:00:00', expiresAt: '2026-10-05T23:59:59' },
    { batchId: 'NEW', quantity: 50, arrivedAt: '2026-10-05T08:00:00', expiresAt: '2026-10-10T23:59:59' },
  ];
  const plan = rules.planFefoConsumption(batches, 80, now);

  assert.equal(plan.fulfilled, false);
  assert.equal(plan.available, 50);
  assert.equal(rules.getExpiredQuantity(batches, now), 100);
});

test('FEFO never plans a negative remaining quantity', () => {
  const batches = [{ batchId: 'A', quantity: 3, arrivedAt: '2026-10-05T08:00:00', expiresAt: '2026-10-10T23:59:59' }];
  const plan = rules.planFefoConsumption(batches, 10, now);
  assert.ok(plan.allocations.every((a) => a.remaining >= 0));
});

test('batch status: expired / expiring soon / fresh / depleted', () => {
  const batch = (expiresAt, quantity = 1) => ({ quantity, expiresAt });
  assert.equal(rules.getBatchStatus(batch('2026-10-06T11:00:00'), now), 'EXPIRED');
  assert.equal(rules.getBatchStatus(batch('2026-10-08T11:00:00'), now), 'EXPIRING_SOON');
  assert.equal(rules.getBatchStatus(batch('2026-10-08T13:00:00'), now), 'FRESH');
  assert.equal(rules.getBatchStatus(batch('2026-10-10T00:00:00', 0), now), 'DEPLETED');
});

test('stock status uses totalQuantity <= reorderPoint', () => {
  assert.equal(rules.getStockStatus(0, 30), 'OUT_OF_STOCK');
  assert.equal(rules.getStockStatus(30, 30), 'LOW_STOCK');
  assert.equal(rules.getStockStatus(31, 30), 'IN_STOCK');
});
