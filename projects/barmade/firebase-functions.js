const { onRequest } = require('firebase-functions/v2/https');
const app = require('./app');

// This prototype keeps data in memory: use one instance and serial requests.
exports.api = onRequest({
  region: 'us-central1',
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  cpu: 'gcf_gen1',
  memory: '256MiB',
}, app);
