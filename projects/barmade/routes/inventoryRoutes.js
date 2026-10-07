const express = require('express');
const controller = require('../controllers/inventoryController');

const router = express.Router();

router.get('/', controller.getInventory);
// Fixed paths are declared before /:id on purpose.
router.get('/movements', controller.getMovements);
router.get('/forecast', controller.getForecast);
router.post('/restock', controller.restock);
router.post('/delivery', controller.delivery);
router.post('/waste', controller.waste);
router.post('/adjustments', controller.adjust);
router.post('/prep', controller.prep);
router.get('/:id', controller.getIngredient);

module.exports = router;
