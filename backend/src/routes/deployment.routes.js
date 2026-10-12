/**
 * deployment.routes.js — Deployment resource routes.
 *
 * GET  /api/deployments              → list the authenticated user's deployments (supports ?status & ?source filters)
 * GET  /api/deployments/:id          → get a single deployment by ID (ownership enforced)
 * POST /api/deployments              → trigger a new Docker deployment (returns 202)
 * POST /api/deployments/:id/redeploy → one-click redeployment of a specific commit
 * POST /api/deployments/:id/rollback → safe rollback to a previous successful deployment
 * POST /api/deployments/cleanup      → safe background container retention cleanup
 * DELETE /api/deployments/:id        → remove a deployment and clean up its container
 */

const express = require('express');
const router = express.Router();
const {
  getAllDeployments,
  getDeploymentById,
  createDeployment,
  redeployDeployment,
  rollbackDeployment,
  triggerSafeCleanup,
  removeDeployment,
} = require('../controllers/deployment.controller');
const {
  getDeploymentResources,
  getDeploymentResourceHistory,
} = require('../controllers/resource.controller');

router.get('/',    getAllDeployments);
router.get('/:id', getDeploymentById);
router.delete('/:id', removeDeployment);

// Phase 7: Resource monitoring & historical metrics
router.get('/:id/resources',         getDeploymentResources);
router.get('/:id/resources/history', getDeploymentResourceHistory);

// Phase 8: One-Click Redeploy, Safe Rollback & Safe Cleanup
router.post('/',              createDeployment);
router.post('/cleanup',       triggerSafeCleanup);
router.post('/:id/redeploy',  redeployDeployment);
router.post('/:id/rollback',  rollbackDeployment);

module.exports = router;
