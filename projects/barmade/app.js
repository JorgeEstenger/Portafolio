/**
 * Express application setup (routes + middleware).
 * Kept separate from server.js so tests can start the app on a random port.
 */

const express = require('express');

const inventoryRoutes = require('./routes/inventoryRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const alertRoutes = require('./routes/alertRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

// Health check / API index
app.get('/', (req, res) => {
  res.json({
    name: 'BarMade API',
    status: 'ok',
    storage: process.env.FIRESTORE_PROJECT_ID ? 'firestore' : 'memory',
    endpoints: ['/api/inventory', '/api/menu', '/api/orders', '/api/alerts'],
  });
});

app.use('/api/inventory', inventoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/alerts', alertRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
