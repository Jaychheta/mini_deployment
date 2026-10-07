/**
 * github.controller.js — Handles GitHub OAuth and repository API requests.
 *
 * GET  /api/github/connect    — redirect user to GitHub OAuth page (requires auth header)
 * GET  /api/github/connect-redirect — same but reads token from query param (browser redirect)
 * GET  /api/github/callback   — handle GitHub OAuth callback
 * GET  /api/github/status     — check if current user has GitHub connected
 * GET  /api/github/repos      — list user's GitHub repositories
 * POST /api/github/disconnect — disconnect GitHub from current user account
 *
 * SECURITY:
 *   - connect embeds the user's JWT in the OAuth 'state' parameter
 *     so the callback knows which user is connecting
 *   - github_access_token is NEVER returned to the frontend
 *   - Client secret stays entirely on the server
 */

const githubService = require('../services/github.service');
const jwt           = require('jsonwebtoken');

const JWT_SECRET   = process.env.JWT_SECRET   || 'dev-secret-change-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ─── Connect ─────────────────────────────────────────────────────────────────

/**
 * Shared helper: build GitHub OAuth URL with the user's JWT as state.
 * @param {string} token — the user's JWT
 * @param {object} res   — Express response
 */
const redirectToGitHub = (token, res) => {
  try {
    const authUrl = githubService.getGithubAuthUrl();
    const url = `${authUrl}&state=${encodeURIComponent(token)}`;
    res.redirect(url);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/dashboard?error=github_config_missing`);
  }
};

/**
 * GET /api/github/connect
 * Redirect the user to GitHub's OAuth authorization page.
 * Requires Bearer token in Authorization header (applied via requireAuth middleware).
 */
const connect = (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  redirectToGitHub(token, res);
};

/**
 * GET /api/github/connect-redirect?token=JWT
 * Same as /connect but reads the token from a query parameter.
 * Used when the browser navigates directly (can't set Authorization headers in <a href>).
 */
const connectViaToken = (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect(`${FRONTEND_URL}/dashboard?error=github_invalid_state`);
  }

  // Verify the token is valid before using it
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.redirect(`${FRONTEND_URL}/dashboard?error=github_invalid_state`);
  }

  redirectToGitHub(token, res);
};

// ─── Callback ─────────────────────────────────────────────────────────────────

/**
 * GET /api/github/callback
 * GitHub redirects here after the user approves or denies.
 *
 * 1. Verify the state (JWT) to identify the user
 * 2. Exchange the code for an access token
 * 3. Fetch the GitHub user's profile
 * 4. Save the GitHub connection in the database
 * 5. Redirect to the repositories page
 */
const callback = async (req, res) => {
  const { code, state, error } = req.query;

  // User denied access on GitHub
  if (error) {
    return res.redirect(`${FRONTEND_URL}/dashboard?error=github_denied`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/dashboard?error=github_invalid_callback`);
  }

  try {
    // Verify the JWT from state to identify the user
    let decoded;
    try {
      decoded = jwt.verify(decodeURIComponent(state), JWT_SECRET);
    } catch {
      return res.redirect(`${FRONTEND_URL}/dashboard?error=github_invalid_state`);
    }

    const userId = decoded.id;

    // Exchange code for access token
    const accessToken = await githubService.exchangeCodeForToken(code);

    // Fetch GitHub user profile
    const githubUser = await githubService.getGithubUser(accessToken);

    // Save to database
    await githubService.saveGithubConnection(userId, {
      githubId:      githubUser.id,
      githubUsername: githubUser.login,
      accessToken,
    });

    // Redirect to repositories page
    res.redirect(`${FRONTEND_URL}/repositories`);
  } catch (err) {
    console.error('GitHub OAuth callback error:', err.message);
    const reason = encodeURIComponent(err.message || 'unknown');
    res.redirect(`${FRONTEND_URL}/dashboard?error=github_oauth_failed&reason=${reason}`);
  }
};

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * GET /api/github/status
 * Returns whether the current user has GitHub connected.
 * Never returns the access token.
 */
const status = async (req, res, next) => {
  try {
    const connectionStatus = await githubService.getConnectionStatus(req.user.id);
    res.status(200).json({ success: true, data: connectionStatus });
  } catch (err) {
    next(err);
  }
};

// ─── Repos ────────────────────────────────────────────────────────────────────

/**
 * GET /api/github/repos
 * Fetch and return the user's GitHub repositories.
 * The access token is retrieved from the database — never sent from frontend.
 */
const getRepos = async (req, res, next) => {
  try {
    const accessToken = await githubService.getAccessToken(req.user.id);

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: 'GitHub is not connected. Please connect your GitHub account first.',
      });
    }

    const repos = await githubService.getGithubRepos(accessToken);
    res.status(200).json({ success: true, count: repos.length, data: repos });
  } catch (err) {
    next(err);
  }
};

// ─── Disconnect ───────────────────────────────────────────────────────────────

/**
 * POST /api/github/disconnect
 * Remove GitHub connection from the user's account.
 * Does NOT delete existing projects.
 */
const disconnect = async (req, res, next) => {
  try {
    await githubService.clearGithubConnection(req.user.id);
    res.status(200).json({
      success: true,
      message: 'GitHub account disconnected. Your existing projects are still saved.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { connect, connectViaToken, callback, status, getRepos, disconnect };
