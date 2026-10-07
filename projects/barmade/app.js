/**
 * Express application setup (routes + middleware).
 * Kept separate from server.js so tests can start the app on a random port.
 */

const express = require('express');

const inventoryRoutes = require('./routes/inventoryRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const alertRoutes = require('./routes/alertRoutes');
const reportRoutes = require('./routes/reportRoutes');
const demoService = require('./services/demoService');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

// After the demo dataset is (re)loaded, run its alert checks once before serving.
app.use(async (req, res, next) => {
  await demoService.ensureReady();
  next();
});

// Health check / API index
app.get('/', (req, res) => {
  const demo = demoService.status();
  res.json({
    name: 'BarMade API',
    status: 'ok',
    storage: process.env.FIRESTORE_PROJECT_ID ? 'firestore' : 'memory',
    dataset: demo.dataset,
    business_date: demo.clock.business_date,
    endpoints: [
      '/api/inventory', '/api/menu', '/api/orders', '/api/alerts',
      '/api/inventory/movements', '/api/inventory/forecast', '/api/recipes',
      '/api/dashboard/today', '/api/dashboard/sales', '/api/dashboard/channels', '/api/dashboard/items',
      '/api/recommendations', '/api/restock', '/api/simulate/rush', '/api/demo', '/api/demo/reset',
    ],
  });
});

app.use('/api/inventory', inventoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api', reportRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
