/**
 * github.controller.js — Handles GitHub OAuth and repository API requests with Hardened Security.
 *
 * GET  /api/github/connect          — redirect user to GitHub OAuth page (requires auth header)
 * GET  /api/github/connect-redirect — redirect reading JWT query param
 * GET  /api/github/callback         — handle GitHub OAuth callback (validates random state)
 * GET  /api/github/status           — check if user has GitHub connected (no token in response)
 * GET  /api/github/repos            — list user's public & private GitHub repositories
 * POST /api/github/disconnect       — disconnect GitHub from authenticated user
 *
 * SECURITY ENFORCEMENTS:
 *   - Cryptographically random 64-char OAuth state values stored in PostgreSQL with 10-min expiry
 *   - Tokens are NEVER returned to frontend or written into logs
 *   - Tokens stored encrypted at rest
 */

const githubService = require('../services/github.service');
const authService = require('../services/auth.service');
const jwt           = require('jsonwebtoken');

const JWT_SECRET   = process.env.JWT_SECRET   || 'dev-secret-change-in-production';
const DEFAULT_FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const getFrontendUrl = (req) => {
  if (req && req.headers && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    return `${proto}://${req.headers.host}`;
  }
  return DEFAULT_FRONTEND_URL;
};

// ─── Connect ─────────────────────────────────────────────────────────────────

const initiateOAuthRedirect = async (userId, req, res) => {
  try {
    // Generate a short-lived random 64-character OAuth state
    const state = await githubService.createOAuthState(userId);
    const authUrl = githubService.getGithubAuthUrl(state);
    res.redirect(authUrl);
  } catch (err) {
    res.redirect(`${getFrontendUrl(req)}/dashboard?error=github_config_missing`);
  }
};

const connect = async (req, res) => {
  await initiateOAuthRedirect(req.user.id, req, res);
};

const connectViaToken = async (req, res) => {
  const { token } = req.query;
  const frontendUrl = getFrontendUrl(req);
  if (!token) {
    return res.redirect(`${frontendUrl}/dashboard?error=github_invalid_state`);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await initiateOAuthRedirect(decoded.id, req, res);
  } catch {
    return res.redirect(`${frontendUrl}/dashboard?error=github_invalid_state`);
  }
};

// ─── Callback ─────────────────────────────────────────────────────────────────

const callback = async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = getFrontendUrl(req);

  if (error) {
    return res.redirect(`${frontendUrl}/dashboard?error=github_denied`);
  }

  if (!code || !state) {
    return res.redirect(`${frontendUrl}/dashboard?error=github_invalid_callback`);
  }

  try {
    let isLoginFlow = false;
    try {
      const decodedState = jwt.verify(state, JWT_SECRET);
      if (decodedState && decodedState.action === 'login') {
        isLoginFlow = true;
      }
    } catch (e) {
      // Not a JWT, proceed with normal DB state check
    }

    let userId = null;

    if (!isLoginFlow) {
      // Validate short-lived random OAuth state from PostgreSQL
      const { valid, userId: dbUserId } = await githubService.validateAndConsumeOAuthState(state);
      if (!valid || !dbUserId) {
        return res.redirect(`${frontendUrl}/dashboard?error=github_invalid_state`);
      }
      userId = dbUserId;
    }

    // Exchange code for access token
    const accessToken = await githubService.exchangeCodeForToken(code);

    // Fetch GitHub user profile
    const githubUser = await githubService.getGithubUser(accessToken);

    if (isLoginFlow) {
      const { token } = await authService.githubAuth(githubUser, accessToken);
      return res.redirect(`${frontendUrl}/login?token=${token}`);
    }

    // Save encrypted token to database for normal connection flow
    await githubService.saveGithubConnection(userId, {
      githubId:       githubUser.id,
      githubUsername: githubUser.login,
      accessToken,
    });

    res.redirect(`${frontendUrl}/repositories`);
  } catch (err) {
    console.error('GitHub OAuth callback error:', err.message);
    const reason = encodeURIComponent(err.message || 'unknown');
    res.redirect(`${frontendUrl}/dashboard?error=github_oauth_failed&reason=${reason}`);
  }
};

// ─── Status ───────────────────────────────────────────────────────────────────

const status = async (req, res, next) => {
  try {
    const connectionStatus = await githubService.getConnectionStatus(req.user.id);
    res.status(200).json({ success: true, data: connectionStatus });
  } catch (err) {
    next(err);
  }
};

// ─── Repos ────────────────────────────────────────────────────────────────────

const repos = async (req, res, next) => {
  try {
    const token = await githubService.getAccessToken(req.user.id);

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'GitHub account is not connected. Please connect your GitHub account.',
      });
    }

    const repoList = await githubService.getGithubRepos(token);
    res.status(200).json({ success: true, count: repoList.length, data: repoList });
  } catch (err) {
    next(err);
  }
};

// ─── Disconnect ───────────────────────────────────────────────────────────────

const disconnect = async (req, res, next) => {
  try {
    await githubService.clearGithubConnection(req.user.id);
    res.status(200).json({
      success: true,
      message: 'GitHub account disconnected successfully.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  connect,
  connectViaToken,
  callback,
  status,
  repos,
  disconnect,
};
