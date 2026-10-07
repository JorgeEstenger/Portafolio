/**
 * Demo catalog: ingredients, menu items with recipes, prep recipes and modifiers.
 *
 * This EXTENDS the original mock data instead of duplicating it:
 *   - the 12 ingredients from data/inventory.js keep their IDs, names and units
 *     (only thresholds are re-scaled for a ~120 orders/day restaurant);
 *   - the 5 menu items from data/menu.js keep their IDs, prices and recipes.
 * New ingredients / menu items are appended after them.
 *
 * Units are always the ingredient's base unit (g, ml, or a count such as units/slices/cans).
 *
 * Supply fields (used by the generator, restock and forecasts):
 *   kind          'purchased' (delivered by a supplier) or 'prep' (made in-house)
 *   deliveryDays  weekdays the supplier delivers (0 = Sunday ... 6 = Saturday)
 *   packSize      quantity per case/bag, in the base unit
 *   shelfLifeDays days from arrival (or prep) until the batch expires
 *   targetDays    normal days of cover; much more than this is overstock
 *   prepRecipe    for prep items: inputs used to make `yield` base units
 */

const { createInventory } = require('../inventory');
const { createMenu } = require('../menu');

const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 0;
const DAILY = [SUN, MON, TUE, WED, THU, FRI, SAT];

/** Demo settings for the original 12 ingredients (thresholds scaled to demo volume). */
const ORIGINAL_INGREDIENTS = {
  'ING-001': { key: 'tomato_sauce', kind: 'purchased', reorderPoint: 8000, supplier: 'Sysco', packSize: 12000, packLabel: '4 x #10 cans', deliveryDays: [TUE], shelfLifeDays: 120, targetDays: 7 },
  'ING-002': { key: 'mozzarella', kind: 'purchased', reorderPoint: 8000, supplier: 'Bella Dairy', packSize: 2500, packLabel: '2.5 kg block', deliveryDays: [MON, WED, FRI], shelfLifeDays: 12, targetDays: 3 },
  'ING-003': { key: 'pizza_dough', kind: 'prep', reorderPoint: 25, packSize: 1, packLabel: 'dough ball', deliveryDays: DAILY, shelfLifeDays: 3, targetDays: 1.5,
    prepRecipe: { yield: 40, inputs: [{ ingredientId: 'ING-013', quantity: 10000 }, { ingredientId: 'ING-008', quantity: 200 }] } },
  'ING-004': { key: 'pepperoni', kind: 'purchased', reorderPoint: 500, supplier: 'Sysco', packSize: 1000, packLabel: '1,000-slice case', deliveryDays: [TUE], shelfLifeDays: 30, targetDays: 7 },
  'ING-005': { key: 'spaghetti', kind: 'purchased', reorderPoint: 5000, supplier: 'Sysco', packSize: 10000, packLabel: '10 kg case', deliveryDays: [TUE], shelfLifeDays: 365, targetDays: 7 },
  'ING-006': { key: 'alfredo_sauce', kind: 'prep', reorderPoint: 2000, packSize: 1, packLabel: 'ml', deliveryDays: DAILY, shelfLifeDays: 4, targetDays: 1.5,
    prepRecipe: { yield: 6000, inputs: [{ ingredientId: 'ING-014', quantity: 4500 }, { ingredientId: 'ING-015', quantity: 600 }, { ingredientId: 'ING-007', quantity: 900 }, { ingredientId: 'ING-010', quantity: 60 }] } },
  'ING-007': { key: 'parmesan', kind: 'purchased', reorderPoint: 2000, supplier: 'Bella Dairy', packSize: 2000, packLabel: '2 kg wedge', deliveryDays: [MON, FRI], shelfLifeDays: 45, targetDays: 5 },
  'ING-008': { key: 'olive_oil', kind: 'purchased', reorderPoint: 2000, supplier: 'Sysco', packSize: 3000, packLabel: '3 L tin', deliveryDays: [TUE], shelfLifeDays: 365, targetDays: 9 },
  'ING-009': { key: 'chicken', kind: 'purchased', reorderPoint: 5000, supplier: 'Coastal Meats', packSize: 2000, packLabel: '2 kg pack', deliveryDays: [MON, WED, FRI], shelfLifeDays: 5, targetDays: 3 },
  'ING-010': { key: 'garlic', kind: 'purchased', reorderPoint: 400, supplier: 'Green Valley Produce', packSize: 500, packLabel: '500 g bag', deliveryDays: [MON, THU], shelfLifeDays: 21, targetDays: 5 },
  'ING-011': { key: 'basil', kind: 'purchased', reorderPoint: 250, supplier: 'Green Valley Produce', packSize: 250, packLabel: '250 g bunch case', deliveryDays: [MON, WED, FRI], shelfLifeDays: 6, targetDays: 3 },
  'ING-012': { key: 'coca_cola', kind: 'purchased', reorderPoint: 48, supplier: 'Coca-Cola Bottling', packSize: 24, packLabel: '24-can case', deliveryDays: [THU], shelfLifeDays: 270, targetDays: 9 },
};

/** Ingredients added for the demo. */
const NEW_INGREDIENTS = [
  { id: 'ING-013', key: 'flour', name: 'Flour (00)', category: 'Dry Goods', unit: 'g', reorderPoint: 10000, batchPrefix: 'FL', kind: 'purchased', supplier: 'Sysco', packSize: 22680, packLabel: '50 lb sack', deliveryDays: [TUE], shelfLifeDays: 180, targetDays: 8 },
  { id: 'ING-014', key: 'heavy_cream', name: 'Heavy Cream', category: 'Dairy', unit: 'ml', reorderPoint: 3000, batchPrefix: 'HC', kind: 'purchased', supplier: 'Bella Dairy', packSize: 1890, packLabel: 'half gallon', deliveryDays: [MON, THU], shelfLifeDays: 10, targetDays: 4 },
  { id: 'ING-015', key: 'butter', name: 'Butter', category: 'Dairy', unit: 'g', reorderPoint: 1000, batchPrefix: 'BU', kind: 'purchased', supplier: 'Bella Dairy', packSize: 1814, packLabel: '4 lb case', deliveryDays: [MON, THU], shelfLifeDays: 60, targetDays: 5 },
  { id: 'ING-016', key: 'ground_beef', name: 'Ground Beef', category: 'Meats', unit: 'g', reorderPoint: 3000, batchPrefix: 'GB', kind: 'purchased', supplier: 'Coastal Meats', packSize: 2268, packLabel: '5 lb chub', deliveryDays: [TUE, FRI], shelfLifeDays: 5, targetDays: 4 },
  { id: 'ING-017', key: 'eggs', name: 'Eggs', category: 'Dairy', unit: 'units', reorderPoint: 40, batchPrefix: 'EG', kind: 'purchased', supplier: 'Bella Dairy', packSize: 30, packLabel: '30-egg flat', deliveryDays: [MON, THU], shelfLifeDays: 28, targetDays: 5 },
  { id: 'ING-018', key: 'breadcrumbs', name: 'Breadcrumbs', category: 'Dry Goods', unit: 'g', reorderPoint: 1000, batchPrefix: 'BC', kind: 'purchased', supplier: 'Sysco', packSize: 2268, packLabel: '5 lb bag', deliveryDays: [TUE], shelfLifeDays: 120, targetDays: 8 },
  { id: 'ING-019', key: 'meatballs', name: 'Meatballs', category: 'Prep', unit: 'units', reorderPoint: 30, batchPrefix: 'MB', kind: 'prep', packSize: 1, packLabel: 'meatball', deliveryDays: DAILY, shelfLifeDays: 4, targetDays: 1.5,
    prepRecipe: { yield: 60, inputs: [{ ingredientId: 'ING-016', quantity: 3000 }, { ingredientId: 'ING-017', quantity: 4 }, { ingredientId: 'ING-018', quantity: 300 }, { ingredientId: 'ING-007', quantity: 200 }, { ingredientId: 'ING-010', quantity: 40 }] } },
  { id: 'ING-020', key: 'lasagna_sheets', name: 'Lasagna Sheets', category: 'Dough & Pasta', unit: 'g', reorderPoint: 2000, batchPrefix: 'LS', kind: 'purchased', supplier: 'Sysco', packSize: 5000, packLabel: '5 kg case', deliveryDays: [TUE], shelfLifeDays: 365, targetDays: 8 },
  { id: 'ING-021', key: 'ricotta', name: 'Ricotta', category: 'Dairy', unit: 'g', reorderPoint: 1500, batchPrefix: 'RI', kind: 'purchased', supplier: 'Bella Dairy', packSize: 1360, packLabel: '3 lb tub', deliveryDays: [MON, FRI], shelfLifeDays: 12, targetDays: 5 },
  { id: 'ING-022', key: 'romaine', name: 'Romaine Lettuce', category: 'Produce', unit: 'g', reorderPoint: 2500, batchPrefix: 'RO', kind: 'purchased', supplier: 'Green Valley Produce', packSize: 2000, packLabel: '2 kg case', deliveryDays: [MON, WED, FRI], shelfLifeDays: 6, targetDays: 3 },
  { id: 'ING-023', key: 'caesar_dressing', name: 'Caesar Dressing', category: 'Sauces', unit: 'ml', reorderPoint: 1000, batchPrefix: 'CD', kind: 'purchased', supplier: 'Sysco', packSize: 3780, packLabel: '1 gal jug', deliveryDays: [TUE], shelfLifeDays: 45, targetDays: 9 },
  { id: 'ING-024', key: 'pancetta', name: 'Pancetta', category: 'Meats', unit: 'g', reorderPoint: 800, batchPrefix: 'PC', kind: 'purchased', supplier: 'Coastal Meats', packSize: 1000, packLabel: '1 kg pack', deliveryDays: [TUE, FRI], shelfLifeDays: 21, targetDays: 5 },
  { id: 'ING-025', key: 'penne', name: 'Pasta (Penne)', category: 'Dough & Pasta', unit: 'g', reorderPoint: 2000, batchPrefix: 'PE', kind: 'purchased', supplier: 'Sysco', packSize: 10000, packLabel: '10 kg case', deliveryDays: [TUE], shelfLifeDays: 365, targetDays: 10 },
  { id: 'ING-026', key: 'mushrooms', name: 'Mushrooms', category: 'Produce', unit: 'g', reorderPoint: 500, batchPrefix: 'MU', kind: 'purchased', supplier: 'Green Valley Produce', packSize: 1000, packLabel: '1 kg case', deliveryDays: [MON, WED, FRI], shelfLifeDays: 5, targetDays: 3 },
  { id: 'ING-027', key: 'italian_bread', name: 'Italian Bread', category: 'Bakery', unit: 'units', reorderPoint: 8, batchPrefix: 'IB', kind: 'purchased', supplier: 'Rossi Bakery', packSize: 6, packLabel: '6 loaves', deliveryDays: DAILY, shelfLifeDays: 3, targetDays: 1.5 },
  { id: 'ING-028', key: 'mascarpone', name: 'Mascarpone', category: 'Dairy', unit: 'g', reorderPoint: 800, batchPrefix: 'MS', kind: 'purchased', supplier: 'Bella Dairy', packSize: 1000, packLabel: '1 kg tub', deliveryDays: [MON, FRI], shelfLifeDays: 14, targetDays: 5 },
  { id: 'ING-029', key: 'ladyfingers', name: 'Ladyfingers', category: 'Dry Goods', unit: 'units', reorderPoint: 60, batchPrefix: 'LF', kind: 'purchased', supplier: 'Sysco', packSize: 240, packLabel: '240-piece case', deliveryDays: [TUE], shelfLifeDays: 180, targetDays: 9 },
  { id: 'ING-030', key: 'san_pellegrino', name: 'San Pellegrino', category: 'Beverages', unit: 'bottles', reorderPoint: 24, batchPrefix: 'SP', kind: 'purchased', supplier: 'Coca-Cola Bottling', packSize: 24, packLabel: '24-bottle case', deliveryDays: [THU], shelfLifeDays: 365, targetDays: 9 },
];

/**
 * Ingredient master data (no batches - the generator creates those).
 * Original ingredients come straight from data/inventory.js.
 */
function createIngredientCatalog() {
  const originals = createInventory().map(({ batches, ...ingredient }) => ({
    ...ingredient,
    ...ORIGINAL_INGREDIENTS[ingredient.id],
  }));
  return [...originals, ...structuredClone(NEW_INGREDIENTS)];
}

/**
 * Modifiers change what an item consumes (and may change its price).
 *   add    - extra ingredient per item
 *   remove - ingredient IDs left out of the recipe
 */
const MODIFIERS = {
  extra_cheese: { id: 'extra_cheese', name: 'Extra cheese', price: 2.0, add: [{ ingredientId: 'ING-002', quantity: 75 }] },
  no_cheese: { id: 'no_cheese', name: 'No cheese', price: 0, remove: ['ING-002'] },
  add_chicken: { id: 'add_chicken', name: 'Add grilled chicken', price: 5.0, add: [{ ingredientId: 'ING-009', quantity: 120 }] },
};

const PIZZA_MODS = ['extra_cheese', 'no_cheese'];

/** Demo fields for the original 5 menu items (recipes are kept exactly as they were). */
const ORIGINAL_MENU = {
  'MENU-001': { key: 'pizza_margherita', category: 'Pizza', modifierIds: PIZZA_MODS },
  'MENU-002': { key: 'pizza_pepperoni', category: 'Pizza', modifierIds: PIZZA_MODS },
  'MENU-003': { key: 'chicken_alfredo', category: 'Pasta', modifierIds: [] },
  'MENU-004': { key: 'spaghetti_marinara', category: 'Pasta', modifierIds: ['add_chicken'] },
  'MENU-005': { key: 'coca_cola', category: 'Beverage', modifierIds: [] },
};

const NEW_MENU = [
  { id: 'MENU-006', key: 'lasagna', name: 'Lasagna Bolognese', category: 'Pasta', price: 19.99, modifierIds: ['extra_cheese'],
    ingredients: [{ ingredientId: 'ING-020', quantity: 120 }, { ingredientId: 'ING-016', quantity: 120 }, { ingredientId: 'ING-021', quantity: 80 }, { ingredientId: 'ING-002', quantity: 100 }, { ingredientId: 'ING-001', quantity: 150 }, { ingredientId: 'ING-007', quantity: 15 }] },
  { id: 'MENU-007', key: 'carbonara', name: 'Spaghetti Carbonara', category: 'Pasta', price: 18.99, modifierIds: ['add_chicken'],
    ingredients: [{ ingredientId: 'ING-005', quantity: 150 }, { ingredientId: 'ING-024', quantity: 60 }, { ingredientId: 'ING-017', quantity: 2 }, { ingredientId: 'ING-007', quantity: 30 }, { ingredientId: 'ING-010', quantity: 3 }] },
  { id: 'MENU-008', key: 'caesar_salad', name: 'Caesar Salad', category: 'Salad', price: 11.99, modifierIds: ['add_chicken'],
    ingredients: [{ ingredientId: 'ING-022', quantity: 150 }, { ingredientId: 'ING-023', quantity: 50 }, { ingredientId: 'ING-007', quantity: 15 }, { ingredientId: 'ING-018', quantity: 20 }] },
  { id: 'MENU-009', key: 'spaghetti_meatballs', name: 'Spaghetti & Meatballs', category: 'Pasta', price: 19.49, modifierIds: [],
    ingredients: [{ ingredientId: 'ING-005', quantity: 150 }, { ingredientId: 'ING-019', quantity: 3 }, { ingredientId: 'ING-001', quantity: 200 }, { ingredientId: 'ING-007', quantity: 10 }, { ingredientId: 'ING-011', quantity: 2 }] },
  { id: 'MENU-010', key: 'meatball_parm', name: 'Meatball Parmigiana Hero', category: 'Sandwich', price: 15.49, modifierIds: ['extra_cheese'],
    ingredients: [{ ingredientId: 'ING-019', quantity: 4 }, { ingredientId: 'ING-001', quantity: 120 }, { ingredientId: 'ING-002', quantity: 80 }, { ingredientId: 'ING-027', quantity: 1 }] },
  { id: 'MENU-011', key: 'penne_vodka', name: 'Penne alla Vodka', category: 'Pasta', price: 18.49, modifierIds: ['add_chicken'],
    ingredients: [{ ingredientId: 'ING-025', quantity: 150 }, { ingredientId: 'ING-001', quantity: 150 }, { ingredientId: 'ING-014', quantity: 60 }, { ingredientId: 'ING-007', quantity: 15 }, { ingredientId: 'ING-010', quantity: 4 }] },
  { id: 'MENU-012', key: 'chicken_parm', name: 'Chicken Parmigiana', category: 'Entree', price: 22.99, modifierIds: ['extra_cheese'],
    ingredients: [{ ingredientId: 'ING-009', quantity: 200 }, { ingredientId: 'ING-018', quantity: 40 }, { ingredientId: 'ING-017', quantity: 1 }, { ingredientId: 'ING-001', quantity: 150 }, { ingredientId: 'ING-002', quantity: 100 }, { ingredientId: 'ING-007', quantity: 15 }, { ingredientId: 'ING-005', quantity: 100 }] },
  { id: 'MENU-013', key: 'pizza_funghi', name: 'Funghi Pizza', category: 'Pizza', price: 17.49, modifierIds: PIZZA_MODS,
    ingredients: [{ ingredientId: 'ING-003', quantity: 1 }, { ingredientId: 'ING-001', quantity: 180 }, { ingredientId: 'ING-002', quantity: 150 }, { ingredientId: 'ING-026', quantity: 80 }, { ingredientId: 'ING-010', quantity: 3 }] },
  { id: 'MENU-014', key: 'pizza_quattro_formaggi', name: 'Quattro Formaggi Pizza', category: 'Pizza', price: 18.99, modifierIds: [],
    ingredients: [{ ingredientId: 'ING-003', quantity: 1 }, { ingredientId: 'ING-002', quantity: 120 }, { ingredientId: 'ING-007', quantity: 30 }, { ingredientId: 'ING-021', quantity: 50 }, { ingredientId: 'ING-008', quantity: 10 }] },
  { id: 'MENU-015', key: 'garlic_bread', name: 'Garlic Bread', category: 'Appetizer', price: 7.99, modifierIds: ['extra_cheese'],
    ingredients: [{ ingredientId: 'ING-027', quantity: 1 }, { ingredientId: 'ING-015', quantity: 30 }, { ingredientId: 'ING-010', quantity: 8 }, { ingredientId: 'ING-007', quantity: 10 }] },
  { id: 'MENU-016', key: 'tiramisu', name: 'Tiramisu', category: 'Dessert', price: 8.99, modifierIds: [],
    ingredients: [{ ingredientId: 'ING-028', quantity: 90 }, { ingredientId: 'ING-029', quantity: 4 }, { ingredientId: 'ING-017', quantity: 1 }, { ingredientId: 'ING-014', quantity: 20 }] },
  { id: 'MENU-017', key: 'san_pellegrino', name: 'San Pellegrino', category: 'Beverage', price: 3.49, modifierIds: [],
    ingredients: [{ ingredientId: 'ING-030', quantity: 1 }] },
];

/** Menu with recipes. Original items come straight from data/menu.js. */
function createMenuCatalog() {
  const originals = createMenu().map((item) => ({ ...item, ...ORIGINAL_MENU[item.id] }));
  return [...originals, ...structuredClone(NEW_MENU)];
}

module.exports = { createIngredientCatalog, createMenuCatalog, MODIFIERS };
