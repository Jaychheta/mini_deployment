/**
 * auth.middleware.js — JWT verification middleware.
 *
 * Exports two middleware functions:
 *   requireAuth  — verifies any authenticated user (USER or ADMIN)
 *   requireAdmin — additionally enforces ADMIN role
 *
 * Usage in routes:
 *   router.get('/protected', requireAuth, handler);
 *   router.get('/admin-only', requireAdmin, handler);
 *
 * The decoded JWT payload is attached to req.user:
 *   { id, email, name, role }
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Verifies the Bearer token in the Authorization header.
 * Attaches the decoded payload to req.user on success.
 */
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Session expired. Please log in again.',
    });
  }
};

/**
 * Enforces ADMIN role. Must be preceded by requireAuth (or call it internally).
 */
const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.',
      });
    }
    next();
  });
};

module.exports = { requireAuth, requireAdmin };
