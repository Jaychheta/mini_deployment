/**
 * auth.controller.js — Handles signup, login, logout, and /me.
 *
 * POST /api/auth/signup  — create account (role always = USER)
 * POST /api/auth/login   — authenticate and receive JWT
 * POST /api/auth/logout  — client deletes token (JWT is stateless)
 * GET  /api/auth/me      — return authenticated user's info
 *
 * Phase 3: findById is now async (PostgreSQL query).
 */

const authService = require('../services/auth.service');
const githubService = require('../services/github.service');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/** GET /api/auth/github — start GitHub OAuth for login */
const githubLogin = (req, res) => {
  // Use a signed JWT as the OAuth state so we know it's a login flow
  const state = jwt.sign({ action: 'login' }, JWT_SECRET, { expiresIn: '10m' });
  const authUrl = githubService.getGithubAuthUrl(state);
  res.redirect(authUrl);
};

/** POST /api/auth/signup */
const signup = async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    // Basic server-side validation (client also validates)
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const result = await authService.signup({ name, email, password });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    // Treat "already exists" as a 409 Conflict, not a 500
    if (err.message.includes('already exists')) {
      return res.status(409).json({ success: false, message: err.message });
    }
    next(err);
  }
};

/** POST /api/auth/login */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const result = await authService.login({ email, password });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    // Treat credential errors as 401
    if (err.message.includes('Invalid email or password')) {
      return res.status(401).json({ success: false, message: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/auth/logout
 * JWTs are stateless — the client is responsible for deleting its token.
 */
const logout = (req, res) => {
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
};

/** GET /api/auth/me — returns the authenticated user's profile */
const me = async (req, res, next) => {
  try {
    const user = await authService.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

module.exports = { signup, login, logout, me, githubLogin };
