/**
 * webhook.routes.js — GitHub Webhook API Routes.
 *
 * POST /api/webhooks/github
 */

const express = require('express');
const router  = express.Router();
const { handleGithubWebhook } = require('../controllers/webhook.controller');

router.post('/github', handleGithubWebhook);

module.exports = router;
