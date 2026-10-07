/**
 * github.routes.js — GitHub OAuth API routes.
 *
 * GET  /api/github/connect          — start OAuth (requires auth header)
 * GET  /api/github/connect-redirect — start OAuth via token query param (browser redirect)
 * GET  /api/github/callback         — GitHub callback (public — GitHub redirects here)
 * GET  /api/github/status           — connection status (requires auth)
 * GET  /api/github/repos            — list repositories (requires auth)
 * POST /api/github/disconnect       — disconnect GitHub (requires auth)
 */

const express  = require('express');
const router   = express.Router();
const {
  connect,
  connectViaToken,
  callback,
  status,
  getRepos,
  disconnect,
} = require('../controllers/github.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// Protected connect (via Authorization header — for API clients)
router.get('/connect',          requireAuth, connect);

// Public connect-redirect (reads token from query param — for browser redirects)
// Token is verified inside connectViaToken before use
router.get('/connect-redirect', connectViaToken);

// Public callback — GitHub redirects here with code + state (JWT)
router.get('/callback',         callback);

// Protected: require JWT authentication
router.get('/status',           requireAuth, status);
router.get('/repos',            requireAuth, getRepos);
router.post('/disconnect',      requireAuth, disconnect);

module.exports = router;
