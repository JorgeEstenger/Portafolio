/**
 * Routes added for the restaurant workflow demo (mounted at /api in app.js).
 */

const express = require('express');
const controller = require('../controllers/reportController');

const router = express.Router();

router.get('/dashboard/today', controller.today);
router.get('/dashboard/sales', controller.sales);
router.get('/dashboard/channels', controller.channels);
router.get('/dashboard/items', controller.items);

router.get('/recipes', controller.recipes);
router.get('/recipes/:id', controller.recipe);

router.get('/recommendations', controller.recommendations);
router.get('/restock', controller.restock);

router.post('/simulate/rush', controller.rush);

router.get('/demo', controller.demoStatus);
router.post('/demo/reset', controller.demoReset);

module.exports = router;
