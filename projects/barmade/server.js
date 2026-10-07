/**
 * Entry point: runs the initial alert checks on the mock data, then starts listening.
 */

const app = require('./app');
const alertService = require('./services/alertService');

const PORT = process.env.PORT || 3000;

async function start() {
  // Generate EXPIRING_SOON / EXPIRED / LOW_STOCK alerts for the starting inventory.
  const { created } = await alertService.checkExpirations();
  console.log(`Startup check created ${created.length} alert(s).`);

  app.listen(PORT, () => {
    console.log(`BarMade API running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
