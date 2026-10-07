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
} = require('../controllers/project.controller');

router.get('/', getAllProjects);
router.post('/', createProject);
router.get('/:id', getProjectById);

module.exports = router;
