/**
 * Menu use cases. Recipes are returned with ingredient names and units
 * attached, so the client doesn't need a second lookup.
 */

const menuRepository = require('../repositories/menuRepository');
const inventoryRepository = require('../repositories/inventoryRepository');
const AppError = require('../utils/AppError');

async function withIngredientDetails(menuItems) {
  const inventory = await inventoryRepository.findAll();
  return menuItems.map((item) => ({
    ...item,
    ingredients: item.ingredients.map((line) => {
      const ingredient = inventory.find((i) => i.id === line.ingredientId);
      return {
        ...line,
        ingredientName: ingredient ? ingredient.name : null,
        unit: ingredient ? ingredient.unit : null,
      };
    }),
  }));
}

async function getMenu() {
  return withIngredientDetails(await menuRepository.findAll());
}

async function getMenuItemById(id) {
  const item = await menuRepository.findById(id);
  if (!item) throw new AppError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${id} was not found.`);
  const [detailed] = await withIngredientDetails([item]);
  return detailed;
}

const { persistent } = require('../data/persistence');
module.exports = { getMenu: persistent(getMenu), getMenuItemById: persistent(getMenuItemById) };
