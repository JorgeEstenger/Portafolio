const express = require('express');
const controller = require('../controllers/menuController');

const router = express.Router();

router.get('/', controller.getMenu);
router.get('/:id', controller.getMenuItem);

module.exports = router;
