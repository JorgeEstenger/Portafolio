/**
 * Mock order history (yesterday's service), returned by GET /api/orders.
 *
 * These are historical records only: the starting inventory in inventory.js
 * already reflects them, so they are NOT subtracted again on startup.
 */

const clock = require('../utils/clock');
const { atDayOffset } = require('../utils/dates');

function createOrders(base = clock.now()) {
  const d = (days, time) => atDayOffset(base, days, time);

  return [
    {
      id: 'ORD-001',
      status: 'COMPLETED',
      createdAt: d(-1, '12:15:00'),
      items: [
        { menuItemId: 'MENU-001', name: 'Margherita Pizza', quantity: 2, unitPrice: 15.99, lineTotal: 31.98 },
        { menuItemId: 'MENU-005', name: 'Coca-Cola', quantity: 2, unitPrice: 2.99, lineTotal: 5.98 },
      ],
      total: 37.96,
      consumed: [
        { ingredientId: 'ING-003', ingredientName: 'Pizza Dough', unit: 'units', quantity: 2, batches: [{ batchId: 'PD-001', quantity: 2 }] },
        { ingredientId: 'ING-001', ingredientName: 'Tomato Sauce', unit: 'ml', quantity: 400, batches: [{ batchId: 'TS-001', quantity: 400 }] },
        { ingredientId: 'ING-002', ingredientName: 'Mozzarella Cheese', unit: 'g', quantity: 300, batches: [{ batchId: 'MZ-001', quantity: 300 }] },
        { ingredientId: 'ING-011', ingredientName: 'Basil', unit: 'g', quantity: 10, batches: [{ batchId: 'BA-001', quantity: 10 }] },
        { ingredientId: 'ING-008', ingredientName: 'Olive Oil', unit: 'ml', quantity: 20, batches: [{ batchId: 'OO-001', quantity: 20 }] },
        { ingredientId: 'ING-012', ingredientName: 'Coca-Cola Cans', unit: 'cans', quantity: 2, batches: [{ batchId: 'CC-001', quantity: 2 }] },
      ],
    },
    {
      id: 'ORD-002',
      status: 'COMPLETED',
      createdAt: d(-1, '19:40:00'),
      items: [
        { menuItemId: 'MENU-003', name: 'Chicken Alfredo', quantity: 1, unitPrice: 21.99, lineTotal: 21.99 },
        { menuItemId: 'MENU-002', name: 'Pepperoni Pizza', quantity: 1, unitPrice: 17.99, lineTotal: 17.99 },
      ],
      total: 39.98,
      consumed: [
        { ingredientId: 'ING-005', ingredientName: 'Pasta (Spaghetti)', unit: 'g', quantity: 150, batches: [{ batchId: 'PA-001', quantity: 150 }] },
        { ingredientId: 'ING-006', ingredientName: 'Alfredo Sauce', unit: 'ml', quantity: 200, batches: [{ batchId: 'AS-001', quantity: 200 }] },
        { ingredientId: 'ING-009', ingredientName: 'Chicken', unit: 'g', quantity: 180, batches: [{ batchId: 'CH-001', quantity: 180 }] },
        { ingredientId: 'ING-007', ingredientName: 'Parmesan Cheese', unit: 'g', quantity: 20, batches: [{ batchId: 'PM-001', quantity: 20 }] },
        { ingredientId: 'ING-010', ingredientName: 'Garlic', unit: 'g', quantity: 5, batches: [{ batchId: 'GA-001', quantity: 5 }] },
        { ingredientId: 'ING-003', ingredientName: 'Pizza Dough', unit: 'units', quantity: 1, batches: [{ batchId: 'PD-001', quantity: 1 }] },
        { ingredientId: 'ING-001', ingredientName: 'Tomato Sauce', unit: 'ml', quantity: 200, batches: [{ batchId: 'TS-001', quantity: 200 }] },
        { ingredientId: 'ING-002', ingredientName: 'Mozzarella Cheese', unit: 'g', quantity: 150, batches: [{ batchId: 'MZ-001', quantity: 150 }] },
        { ingredientId: 'ING-004', ingredientName: 'Pepperoni', unit: 'slices', quantity: 30, batches: [{ batchId: 'PP-001', quantity: 30 }] },
      ],
    },
  ];
}

module.exports = { createOrders };
