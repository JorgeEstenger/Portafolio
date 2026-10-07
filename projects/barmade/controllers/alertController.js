/**
 * Alert HTTP handlers.
 */

const alertService = require('../services/alertService');

// GET /api/alerts  (optional ?type=LOW_STOCK|EXPIRING_SOON|EXPIRED and ?status=ACTIVE|RESOLVED)
async function getAlerts(req, res) {
  const alerts = await alertService.getAlerts({ type: req.query.type, status: req.query.status });
  res.status(200).json({ count: alerts.length, data: alerts });
}

// POST /api/alerts/check-expiration
async function checkExpiration(req, res) {
  const result = await alertService.checkExpirations();
  res.status(200).json({
    message: `Expiration check complete: ${result.created.length} alert(s) created, ${result.resolved.length} resolved.`,
    data: result,
  });
}

module.exports = { getAlerts, checkExpiration };
