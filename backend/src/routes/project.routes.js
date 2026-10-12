/**
 * project.routes.js — Project resource routes.
 *
 * GET    /api/projects       → list all projects
 * POST   /api/projects       → create a new project
 * GET    /api/projects/:id   → get a single project by ID
 *
 * Phase 2+ will add:
 *   PUT    /api/projects/:id   → update project settings
 *   DELETE /api/projects/:id   → delete project
 */

const express = require('express');
const router = express.Router();
const {
  getAllProjects,
  createProject,
  getProjectById,
  redeployProject,
} = require('../controllers/project.controller');
const { getProjectResources } = require('../controllers/resource.controller');

router.get('/',              getAllProjects);
router.post('/',             createProject);
router.get('/:id',           getProjectById);
router.post('/:id/redeploy', redeployProject);

// Phase 7: Project active deployment resource summary
router.get('/:id/resources', getProjectResources);

module.exports = router;

