const express = require('express');
const controller = require('../controllers/alertController');

const router = express.Router();

router.get('/', controller.getAlerts);
router.post('/check-expiration', controller.checkExpiration);

module.exports = router;
