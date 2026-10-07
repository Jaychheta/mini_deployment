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
const { getStats, getUsers, getProjects, getDeployments } = require('../controllers/admin.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

// Apply requireAdmin to every route in this router
router.use(requireAdmin);

router.get('/stats',       getStats);
router.get('/users',       getUsers);
router.get('/projects',    getProjects);
router.get('/deployments', getDeployments);

module.exports = router;
