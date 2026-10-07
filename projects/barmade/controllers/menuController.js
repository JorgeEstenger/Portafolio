/**
 * Menu HTTP handlers.
 */

const menuService = require('../services/menuService');

// GET /api/menu
async function getMenu(req, res) {
  const menu = await menuService.getMenu();
  res.status(200).json({ count: menu.length, data: menu });
}

// GET /api/menu/:id
async function getMenuItem(req, res) {
  const item = await menuService.getMenuItemById(req.params.id);
  res.status(200).json({ data: item });
}

module.exports = { getMenu, getMenuItem };
