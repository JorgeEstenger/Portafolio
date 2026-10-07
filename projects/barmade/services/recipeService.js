/**
 * Recipes: menu item -> ingredients -> quantity consumed per item sold.
 * Recipes are stored on the menu items (data/demo/catalog.js); this service
 * presents them with ingredient names/units, prep sub-recipes and modifiers.
 */

const menuRepository = require('../repositories/menuRepository');
const inventoryRepository = require('../repositories/inventoryRepository');
const { MODIFIERS } = require('../data/demo/catalog');
const { expandRecipe } = require('./forecastRules');
const { findMenuItem } = require('./orderRules');
const { round } = require('../utils/units');
const AppError = require('../utils/AppError');

function toRecipe(item, byId) {
  const line = (ingredientId, quantity) => {
    const ingredient = byId.get(ingredientId);
    return {
      ingredientId,
      key: ingredient ? ingredient.key || null : null,
      name: ingredient ? ingredient.name : null,
      quantity: round(quantity, 2),
      unit: ingredient ? ingredient.unit : null,
      kind: ingredient ? ingredient.kind || 'purchased' : null,
    };
  };
  return {
    menuItemId: item.id,
    item_id: item.key || item.id,
    name: item.name,
    category: item.category || null,
    price: item.price,
    ingredients: item.ingredients.map((l) => line(l.ingredientId, l.quantity)),
    // The same recipe followed down through prep items (dough -> flour, ...).
    raw_ingredients: [...expandRecipe(item, byId)]
      .filter(([id]) => !(byId.get(id) && byId.get(id).prepRecipe))
      .map(([id, quantity]) => line(id, quantity)),
    modifiers: (item.modifierIds || []).map((id) => MODIFIERS[id]),
  };
}

async function load() {
  const [menu, inventory] = await Promise.all([menuRepository.findAll(), inventoryRepository.findAll()]);
  return { menu, byId: new Map(inventory.map((i) => [i.id, i])) };
}

/** GET /api/recipes */
async function getRecipes() {
  const { menu, byId } = await load();
  const prep = [...byId.values()].filter((i) => i.prepRecipe).map((i) => ({
    ingredientId: i.id,
    key: i.key,
    name: i.name,
    yield: i.prepRecipe.yield,
    unit: i.unit,
    inputs: i.prepRecipe.inputs.map((input) => ({
      ingredientId: input.ingredientId,
      name: byId.get(input.ingredientId).name,
      quantity: input.quantity,
      unit: byId.get(input.ingredientId).unit,
    })),
  }));
  return { data: menu.map((item) => toRecipe(item, byId)), prep_recipes: prep, modifiers: Object.values(MODIFIERS) };
}

/** GET /api/recipes/:id - by menu item ID or key. */
async function getRecipe(id) {
  const { menu, byId } = await load();
  const item = findMenuItem(menu, id);
  if (!item) throw new AppError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${id} was not found.`);
  return toRecipe(item, byId);
}

const { persistent } = require('../data/persistence');
module.exports = { getRecipes: persistent(getRecipes), getRecipe: persistent(getRecipe) };
