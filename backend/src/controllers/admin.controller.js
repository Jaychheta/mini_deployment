/**
 * admin.controller.js — Admin-only API handlers.
 *
 * All routes here require ADMIN role (enforced by admin.routes.js).
 * Phase 3: All data now comes from PostgreSQL via the service layer.
 *
 * GET /api/admin/stats       — platform-wide statistics
 * GET /api/admin/users       — list all users
 * GET /api/admin/projects    — list all projects (with owner name)
 * GET /api/admin/deployments — list all deployments (with project + owner info)
 */

const authService       = require('../services/auth.service');
const projectService    = require('../services/project.service');
const deploymentService = require('../services/deployment.service');

/** GET /api/admin/stats */
const getStats = async (req, res, next) => {
  try {
    const [users, projects, deployments] = await Promise.all([
      authService.findAll(),
      projectService.findAll(),          // no userId = all projects
      deploymentService.findAllAdmin(),  // admin-only
    ]);

    res.status(200).json({
      success: true,
      data: {
        users:       users.length,
        projects:    projects.length,
        deployments: deployments.length,
        live:        deployments.filter((d) => d.status === 'LIVE').length,
        failed:      deployments.filter((d) => d.status === 'FAILED').length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/users */
const getUsers = async (req, res, next) => {
  try {
    const users = await authService.findAll();
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/projects — enriched with owner name (via JOIN in service) */
const getProjects = async (req, res, next) => {
  try {
    // findAllAdmin() returns projects already joined with user data
    const projects = await projectService.findAllAdmin();
    res.status(200).json({ success: true, count: projects.length, data: projects });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/deployments — enriched with project name + owner name */
const getDeployments = async (req, res, next) => {
  try {
    // findAllAdmin() returns deployments already joined with project + user data
    const deployments = await deploymentService.findAllAdmin();
    res.status(200).json({ success: true, count: deployments.length, data: deployments });
  } catch (err) {
    next(err);
  }
};

module.exports = { getStats, getUsers, getProjects, getDeployments };
