/**
 * health.routes.js — Health check endpoint.
 *
 * GET /api/health
 *  Returns service status and metadata.
 *  Used by load balancers, Docker health checks, and monitoring tools.
 */

const express = require('express');
const router = express.Router();
const { getHealth } = require('../controllers/health.controller');

router.get('/health', getHealth);

module.exports = router;
