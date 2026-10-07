/**
 * Mock menu. Each recipe ingredient references an inventory ingredient ID
 * and the amount used for ONE serving, in that ingredient's unit.
 *
 *   ING-001 Tomato Sauce (ml)     ING-007 Parmesan Cheese (g)
 *   ING-002 Mozzarella (g)        ING-008 Olive Oil (ml)
 *   ING-003 Pizza Dough (units)   ING-009 Chicken (g)
 *   ING-004 Pepperoni (slices)    ING-010 Garlic (g)
 *   ING-005 Pasta (g)             ING-011 Basil (g)
 *   ING-006 Alfredo Sauce (ml)    ING-012 Coca-Cola Cans (cans)
 */

function createMenu() {
  return [
    {
      id: 'MENU-001',
      name: 'Margherita Pizza',
      price: 15.99,
      ingredients: [
        { ingredientId: 'ING-003', quantity: 1 },
        { ingredientId: 'ING-001', quantity: 200 },
        { ingredientId: 'ING-002', quantity: 150 },
        { ingredientId: 'ING-011', quantity: 5 },
        { ingredientId: 'ING-008', quantity: 10 },
      ],
    },
    {
      id: 'MENU-002',
      name: 'Pepperoni Pizza',
      price: 17.99,
      ingredients: [
        { ingredientId: 'ING-003', quantity: 1 },
        { ingredientId: 'ING-001', quantity: 200 },
        { ingredientId: 'ING-002', quantity: 150 },
        { ingredientId: 'ING-004', quantity: 30 },
      ],
    },
    {
      id: 'MENU-003',
      name: 'Chicken Alfredo',
      price: 21.99,
      ingredients: [
        { ingredientId: 'ING-005', quantity: 150 },
        { ingredientId: 'ING-006', quantity: 200 },
        { ingredientId: 'ING-009', quantity: 180 },
        { ingredientId: 'ING-007', quantity: 20 },
        { ingredientId: 'ING-010', quantity: 5 },
      ],
    },
    {
      id: 'MENU-004',
      name: 'Spaghetti Marinara',
      price: 16.99,
      ingredients: [
        { ingredientId: 'ING-005', quantity: 150 },
        { ingredientId: 'ING-001', quantity: 250 },
        { ingredientId: 'ING-010', quantity: 6 },
        { ingredientId: 'ING-011', quantity: 3 },
        { ingredientId: 'ING-008', quantity: 15 },
        { ingredientId: 'ING-007', quantity: 10 },
      ],
    },
    {
      id: 'MENU-005',
      name: 'Coca-Cola',
      price: 2.99,
      ingredients: [{ ingredientId: 'ING-012', quantity: 1 }],
    },
  ];
}

module.exports = { createMenu };
