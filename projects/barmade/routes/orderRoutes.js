const express = require('express');
const controller = require('../controllers/orderController');

const router = express.Router();

router.get('/', controller.getOrders);
router.post('/', controller.createOrder);
router.get('/:id', controller.getOrder);

module.exports = router;
