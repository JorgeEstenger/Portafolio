const express = require('express');
const controller = require('../controllers/inventoryController');

const router = express.Router();

router.get('/', controller.getInventory);
router.post('/restock', controller.restock); // declared before /:id on purpose
router.get('/:id', controller.getIngredient);

module.exports = router;
