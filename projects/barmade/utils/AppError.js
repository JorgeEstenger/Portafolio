/**
 * An error with an HTTP status code and a machine-readable code.
 * Services throw these; the error-handling middleware turns them into JSON responses.
 */
class AppError extends Error {
  /**
   * @param {number} statusCode HTTP status (400, 404, 409, ...)
   * @param {string} code       Stable error code, e.g. "INSUFFICIENT_INVENTORY"
   * @param {string} message    Human-readable message
   * @param {object} [details]  Optional extra data for the client
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

module.exports = AppError;
