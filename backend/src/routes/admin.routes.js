/**
 * admin.routes.js — Admin API routes.
 *
 * All routes require ADMIN role — enforced by requireAdmin middleware.
 * Normal users (role = USER) will receive a 403 Forbidden response.
 *
 * GET /api/admin/stats
 * GET /api/admin/users
 * GET /api/admin/projects
 * GET /api/admin/deployments
 */

const express = require('express');
const router  = express.Router();
const { getStats, getUsers, getProjects, getDeployments, triggerAdminCleanup } = require('../controllers/admin.controller');
const { getAdminResourceSummary } = require('../controllers/resource.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

// Apply requireAdmin to every route in this router
router.use(requireAdmin);

router.get('/stats',             getStats);
router.get('/users',             getUsers);
router.get('/projects',          getProjects);
router.get('/deployments',       getDeployments);
router.get('/resources/summary', getAdminResourceSummary);
router.post('/cleanup',          triggerAdminCleanup);

module.exports = router;

