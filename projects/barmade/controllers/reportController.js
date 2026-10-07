/**
 * HTTP handlers for the dashboard, recipes, recommendations, restock,
 * rush simulation and demo controls.
 */

const dashboardService = require('../services/dashboardService');
const recipeService = require('../services/recipeService');
const forecastService = require('../services/forecastService');
const simulationService = require('../services/simulationService');
const demoService = require('../services/demoService');

// GET /api/dashboard/today  (optional ?date=YYYY-MM-DD)
const today = async (req, res) => res.status(200).json(await dashboardService.getToday({ date: req.query.date }));
// GET /api/dashboard/sales?days=60
const sales = async (req, res) => res.status(200).json(await dashboardService.getSales({ days: req.query.days }));
// GET /api/dashboard/channels?days=30
const channels = async (req, res) => res.status(200).json(await dashboardService.getChannels({ days: req.query.days }));
// GET /api/dashboard/items?days=30
const items = async (req, res) => res.status(200).json(await dashboardService.getItems({ days: req.query.days }));

// GET /api/recipes
async function recipes(req, res) {
  const result = await recipeService.getRecipes();
  res.status(200).json({ count: result.data.length, ...result });
}
// GET /api/recipes/:id
const recipe = async (req, res) => res.status(200).json({ data: await recipeService.getRecipe(req.params.id) });

// GET /api/recommendations
const recommendations = async (req, res) => res.status(200).json(await forecastService.getRecommendations());
// GET /api/restock
const restock = async (req, res) => res.status(200).json(await forecastService.getRestock());

// POST /api/simulate/rush
const rush = async (req, res) => res.status(201).json(await simulationService.simulateRush(req.body));

// GET /api/demo
const demoStatus = async (req, res) => res.status(200).json(demoService.status());
// POST /api/demo/reset
async function demoReset(req, res) {
  const result = await demoService.reset();
  res.status(200).json({ message: 'Demo data reset to the deterministic 60-day dataset.', ...result });
}

module.exports = { today, sales, channels, items, recipes, recipe, recommendations, restock, rush, demoStatus, demoReset };
