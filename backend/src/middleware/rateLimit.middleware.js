/**
 * rateLimit.middleware.js — Simple in-memory rate limiting middleware.
 *
 * Protects sensitive endpoints against brute force and abuse:
 *   - /api/auth/login
 *   - /api/auth/signup
 *   - /api/github/connect-redirect
 *   - /api/github/callback
 */

const rateLimitStore = new Map();

// Clean expired records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Rate limiter middleware factory.
 *
 * @param {Object} options
 * @param {number} options.windowMs — Time window in milliseconds (default 15 mins)
 * @param {number} options.max — Max requests per windowMs (default 30)
 * @param {string} options.message — Custom error message
 */
const createRateLimiter = ({ windowMs = 15 * 60 * 1000, max = 30, message = 'Too many requests. Please try again later.' }) => {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimitStore.set(key, record);
      return next();
    }

    record.count += 1;

    if (record.count > max) {
      return res.status(429).json({
        success: false,
        message,
        retryAfterMs: record.resetTime - now,
      });
    }

    next();
  };
};

// Pre-configured rate limiters
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per IP per 15 mins
  message: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
});

const oauthLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30, // 30 requests per IP per 10 mins
  message: 'Too many GitHub authorization requests. Please try again in a few minutes.',
});

module.exports = {
  createRateLimiter,
  authLimiter,
  oauthLimiter,
};
