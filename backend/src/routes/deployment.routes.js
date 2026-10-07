/**
 * deployment.routes.js — Deployment resource routes.
 *
 * GET  /api/deployments        → list the authenticated user's deployments
 * GET  /api/deployments/:id    → get a single deployment by ID (ownership enforced)
 *
 * Phase 4:
 *   POST /api/deployments      → trigger a new Docker deployment (returns 202)
 */

const express = require('express');
const router = express.Router();
const {
  getAllDeployments,
  getDeploymentById,
  createDeployment,
} = require('../controllers/deployment.controller');

router.get('/',    getAllDeployments);
router.get('/:id', getDeploymentById);

// Phase 4: trigger a new deployment
router.post('/', createDeployment);

module.exports = router;
