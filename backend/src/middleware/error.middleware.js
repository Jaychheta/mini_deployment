/**
 * error.middleware.js — Centralised error handling for Express.
 *
 * Two middleware functions:
 *  1. notFound   — catches any request that didn't match a route
 *  2. errorHandler — formats all thrown errors as consistent JSON responses
 *
 * Using a central handler means:
 *  - Controllers only call next(error) — no duplicated try/catch response code
 *  - Error format is consistent across all endpoints
 *  - Stack traces are hidden in production
 */

/**
 * 404 handler — mounted after all routes.
 * If no route matched, generate a 404 error and pass it to errorHandler.
 */
const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

/**
 * Global error handler — must have 4 parameters for Express to treat it as
 * an error-handling middleware (even if `next` is unused).
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Hide internal details in production to avoid leaking sensitive info
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Internal Server Error'
      : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    // Include stack trace only in development
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };
