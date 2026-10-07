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
  repos,
  disconnect,
} = require('../controllers/github.controller');
const { requireAuth }   = require('../middleware/auth.middleware');
const { oauthLimiter }  = require('../middleware/rateLimit.middleware');

router.get('/connect',          oauthLimiter, requireAuth, connect);
router.get('/connect-redirect', oauthLimiter, connectViaToken);
router.get('/callback',         oauthLimiter, callback);

router.get('/status',           requireAuth, status);
router.get('/repos',            requireAuth, repos);
router.post('/disconnect',      requireAuth, disconnect);

module.exports = router;
