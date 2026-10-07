/**
 * logger.util.js — Sanitized console logger utility.
 *
 * Automatically redacts GitHub access tokens, Bearer tokens, embedded URLs with secrets,
 * JWTs, and sensitive credentials from all console logs and output streams.
 */

const { redactSecrets } = require('./crypto.util');

const timestamp = () => new Date().toISOString();

const sanitizeArgs = (args) => {
  return args.map((arg) => {
    if (typeof arg === 'string') {
      return redactSecrets(arg);
    }
    if (arg instanceof Error) {
      arg.message = redactSecrets(arg.message);
      if (arg.stack) arg.stack = redactSecrets(arg.stack);
      return arg;
    }
    return arg;
  });
};

const logger = {
  info:  (...args) => console.log(`[${timestamp()}] [INFO] `, ...sanitizeArgs(args)),
  warn:  (...args) => console.warn(`[${timestamp()}] [WARN] `, ...sanitizeArgs(args)),
  error: (...args) => console.error(`[${timestamp()}] [ERROR]`, ...sanitizeArgs(args)),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${timestamp()}] [DEBUG]`, ...sanitizeArgs(args));
    }
  },
};

module.exports = logger;
