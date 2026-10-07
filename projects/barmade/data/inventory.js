/**
 * Mock inventory for an Italian restaurant (~5-7 days of stock).
 *
 * Dates are generated RELATIVE to "today" (see utils/clock.js) so the demo
 * always shows the same situation no matter which day you run it:
 *   - Mozzarella batch MZ-001 and Chicken batch CH-001 expire within 2 days
 *     -> EXPIRING_SOON alerts on startup.
 *   - Basil batch BA-001 already expired -> EXPIRED alert, never used for orders.
 *   - Pizza Dough sits a few units above its reorder point -> a handful of
 *     pizza orders triggers a LOW_STOCK alert.
 *
 * Note: totalQuantity is NOT stored here. It is always calculated from the
 * batches so the two values can never drift apart.
 *
 * batchPrefix is used to generate IDs for new batches when restocking (e.g. "TS-003").
 */

const clock = require('../utils/clock');
const { atDayOffset } = require('../utils/dates');

function createInventory(base = clock.now()) {
  // d(-2, '08:00:00') = two days ago at 8 AM; d(3) = three days from now at 23:59:59
  const d = (days, time = '23:59:59') => atDayOffset(base, days, time);

  return [
    {
      id: 'ING-001',
      name: 'Tomato Sauce',
      category: 'Sauces',
      unit: 'ml',
      reorderPoint: 10000,
      batchPrefix: 'TS',
      batches: [
        { batchId: 'TS-001', quantity: 5000, arrivedAt: d(-4, '08:00:00'), expiresAt: d(3) },
        { batchId: 'TS-002', quantity: 12000, arrivedAt: d(-1, '08:00:00'), expiresAt: d(7) },
      ],
    },
    {
      id: 'ING-002',
      name: 'Mozzarella Cheese',
      category: 'Dairy',
      unit: 'g',
      reorderPoint: 5000,
      batchPrefix: 'MZ',
      batches: [
        { batchId: 'MZ-001', quantity: 3500, arrivedAt: d(-5, '07:30:00'), expiresAt: d(1) },
        { batchId: 'MZ-002', quantity: 8000, arrivedAt: d(-1, '07:30:00'), expiresAt: d(6) },
      ],
    },
    {
      id: 'ING-003',
      name: 'Pizza Dough',
      category: 'Dough & Pasta',
      unit: 'units',
      reorderPoint: 30,
      batchPrefix: 'PD',
      batches: [
        { batchId: 'PD-001', quantity: 20, arrivedAt: d(-2, '06:00:00'), expiresAt: d(3) },
        { batchId: 'PD-002', quantity: 18, arrivedAt: d(0, '06:00:00'), expiresAt: d(5) },
      ],
    },
    {
      id: 'ING-004',
      name: 'Pepperoni',
      category: 'Meats',
      unit: 'slices',
      reorderPoint: 300,
      batchPrefix: 'PP',
      batches: [
        { batchId: 'PP-001', quantity: 900, arrivedAt: d(-3, '09:00:00'), expiresAt: d(14) },
      ],
    },
    {
      id: 'ING-005',
      name: 'Pasta (Spaghetti)',
      category: 'Dough & Pasta',
      unit: 'g',
      reorderPoint: 5000,
      batchPrefix: 'PA',
      batches: [
        { batchId: 'PA-001', quantity: 20000, arrivedAt: d(-6, '10:00:00'), expiresAt: d(180) },
      ],
    },
    {
      id: 'ING-006',
      name: 'Alfredo Sauce',
      category: 'Sauces',
      unit: 'ml',
      reorderPoint: 3000,
      batchPrefix: 'AS',
      batches: [
        { batchId: 'AS-001', quantity: 4000, arrivedAt: d(-3, '08:00:00'), expiresAt: d(3) },
        { batchId: 'AS-002', quantity: 5000, arrivedAt: d(-1, '08:00:00'), expiresAt: d(6) },
      ],
    },
    {
      id: 'ING-007',
      name: 'Parmesan Cheese',
      category: 'Dairy',
      unit: 'g',
      reorderPoint: 1000,
      batchPrefix: 'PM',
      batches: [
        { batchId: 'PM-001', quantity: 3000, arrivedAt: d(-5, '07:30:00'), expiresAt: d(25) },
      ],
    },
    {
      id: 'ING-008',
      name: 'Olive Oil',
      category: 'Oils',
      unit: 'ml',
      reorderPoint: 2000,
      batchPrefix: 'OO',
      batches: [
        { batchId: 'OO-001', quantity: 6000, arrivedAt: d(-6, '10:00:00'), expiresAt: d(300) },
      ],
    },
    {
      id: 'ING-009',
      name: 'Chicken',
      category: 'Meats',
      unit: 'g',
      reorderPoint: 4000,
      batchPrefix: 'CH',
      batches: [
        { batchId: 'CH-001', quantity: 3000, arrivedAt: d(-3, '07:00:00'), expiresAt: d(0) },
        { batchId: 'CH-002', quantity: 7000, arrivedAt: d(-1, '07:00:00'), expiresAt: d(3) },
      ],
    },
    {
      id: 'ING-010',
      name: 'Garlic',
      category: 'Produce',
      unit: 'g',
      reorderPoint: 500,
      batchPrefix: 'GA',
      batches: [
        { batchId: 'GA-001', quantity: 1500, arrivedAt: d(-5, '09:00:00'), expiresAt: d(9) },
      ],
    },
    {
      id: 'ING-011',
      name: 'Basil',
      category: 'Produce',
      unit: 'g',
      reorderPoint: 200,
      batchPrefix: 'BA',
      batches: [
        // Already expired: kept for visibility, never used to fulfill orders.
        { batchId: 'BA-001', quantity: 100, arrivedAt: d(-6, '09:00:00'), expiresAt: d(-1) },
        { batchId: 'BA-002', quantity: 400, arrivedAt: d(-1, '09:00:00'), expiresAt: d(4) },
      ],
    },
    {
      id: 'ING-012',
      name: 'Coca-Cola Cans',
      category: 'Beverages',
      unit: 'cans',
      reorderPoint: 48,
      batchPrefix: 'CC',
      batches: [
        { batchId: 'CC-001', quantity: 120, arrivedAt: d(-6, '11:00:00'), expiresAt: d(180) },
      ],
    },
  ];
}

module.exports = { createInventory };
