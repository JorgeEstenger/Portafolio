/**
 * Error-handling middleware. Every error ends up here and is returned as:
 *
 *   { "error": { "code": "INSUFFICIENT_INVENTORY", "message": "...", "details": {...} } }
 */

const AppError = require('../utils/AppError');

/** 404 for routes that don't exist. */
function notFound(req, res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} does not exist.`));
}

// eslint-disable-next-line no-unused-vars -- Express needs 4 args to treat this as an error handler
function errorHandler(err, req, res, next) {
  // Malformed JSON body (thrown by express.json()).
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
    });
  }

  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  // Anything else is unexpected: log it, don't leak internals to the client.
  console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong.' },
  });
}

module.exports = { notFound, errorHandler };
