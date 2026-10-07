/**
 * auth.routes.js — Authentication API routes.
 *
 * POST /api/auth/signup  — public
 * POST /api/auth/login   — public
 * POST /api/auth/logout  — requires valid token
 * GET  /api/auth/me      — requires valid token
 */

const express = require('express');
const router  = express.Router();
const { signup, login, logout, me } = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.post('/signup',  signup);
router.post('/login',   login);
router.post('/logout',  requireAuth, logout);
router.get('/me',       requireAuth, me);

module.exports = router;
