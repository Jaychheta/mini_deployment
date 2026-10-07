/**
 * logger.util.js — Simple console logger utility.
 *
 * Wraps console.log/warn/error with timestamps and log-level prefixes.
 * Phase 5+ can swap this for Winston or Pino for structured JSON logging
 * that integrates with Docker log drivers.
 */

const timestamp = () => new Date().toISOString();

const logger = {
  info:  (...args) => console.log(`[${timestamp()}] [INFO] `, ...args),
  warn:  (...args) => console.warn(`[${timestamp()}] [WARN] `, ...args),
  error: (...args) => console.error(`[${timestamp()}] [ERROR]`, ...args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${timestamp()}] [DEBUG]`, ...args);
    }
  },
};

module.exports = logger;
