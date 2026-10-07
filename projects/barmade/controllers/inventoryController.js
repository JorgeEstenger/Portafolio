/**
 * Inventory HTTP handlers: translate requests into service calls and
 * service results into responses. No business logic lives here.
 * (Express 5 forwards errors thrown in async handlers to errorHandler.)
 */

const inventoryService = require('../services/inventoryService');
const forecastService = require('../services/forecastService');

// GET /api/inventory  (optional ?status=IN_STOCK|LOW_STOCK|OUT_OF_STOCK)
async function getInventory(req, res) {
  const inventory = await inventoryService.getAllInventory({ status: req.query.status });
  res.status(200).json({ count: inventory.length, data: inventory });
}

// GET /api/inventory/:id  (ID like ING-002 or key like mozzarella)
async function getIngredient(req, res) {
  const ingredient = await inventoryService.getIngredientById(req.params.id);
  res.status(200).json({ data: ingredient });
}

// POST /api/inventory/restock
async function restock(req, res) {
  const result = await inventoryService.restock(req.body);
  res.status(201).json({ message: `Restocked ${result.ingredient.name}.`, data: result });
}

// POST /api/inventory/delivery
async function delivery(req, res) {
  const result = await inventoryService.recordDelivery(req.body);
  res.status(201).json({ message: `Received ${result.movement.change} ${result.movement.unit} of ${result.ingredient.name}.`, data: result });
}

// POST /api/inventory/waste
async function waste(req, res) {
  const result = await inventoryService.recordWaste(req.body);
  res.status(201).json({ message: `Recorded ${result.movements[0].reason} for ${result.ingredient.name}.`, data: result });
}

// POST /api/inventory/adjustments
async function adjust(req, res) {
  const result = await inventoryService.adjustStock(req.body);
  res.status(201).json({ message: `Adjusted ${result.ingredient.name} by ${result.change} ${result.ingredient.unit}.`, data: result });
}

// POST /api/inventory/prep
async function prep(req, res) {
  const result = await inventoryService.prepBatch(req.body);
  res.status(201).json({ message: `Prepped ${result.batch.quantity} ${result.ingredient.unit} of ${result.ingredient.name}.`, data: result });
}

// GET /api/inventory/movements
async function getMovements(req, res) {
  res.status(200).json(await inventoryService.getMovements(req.query));
}

// GET /api/inventory/forecast
async function getForecast(req, res) {
  res.status(200).json(await forecastService.getForecast({ status: req.query.status }));
}

module.exports = { getInventory, getIngredient, restock, delivery, waste, adjust, prep, getMovements, getForecast };
