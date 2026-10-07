/**
 * Inventory HTTP handlers: translate requests into service calls and
 * service results into responses. No business logic lives here.
 * (Express 5 forwards errors thrown in async handlers to errorHandler.)
 */

const inventoryService = require('../services/inventoryService');

// GET /api/inventory  (optional ?status=IN_STOCK|LOW_STOCK|OUT_OF_STOCK)
async function getInventory(req, res) {
  const inventory = await inventoryService.getAllInventory({ status: req.query.status });
  res.status(200).json({ count: inventory.length, data: inventory });
}

// GET /api/inventory/:id
async function getIngredient(req, res) {
  const ingredient = await inventoryService.getIngredientById(req.params.id);
  res.status(200).json({ data: ingredient });
}

// POST /api/inventory/restock
async function restock(req, res) {
  const result = await inventoryService.restock(req.body);
  res.status(201).json({ message: `Restocked ${result.ingredient.name}.`, data: result });
}

module.exports = { getInventory, getIngredient, restock };
