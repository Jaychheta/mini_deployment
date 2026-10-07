/**
 * project.controller.js — Handles project-related API requests.
 *
 * Phase 3: Projects are now created via GitHub repository selection.
 *  - Fields updated: repositoryName, repositoryUrl, githubRepositoryId, branch
 *  - userId always comes from JWT (req.user.id) — never from request body
 *  - USER role: can only see and manage their own projects
 *  - ADMIN role: can see all projects (via /api/admin/projects)
 */

const projectService = require('../services/project.service');

/** GET /api/projects — returns the authenticated user's projects only */
const getAllProjects = async (req, res, next) => {
  try {
    const projects = await projectService.findAll(req.user.id);
    res.status(200).json({ success: true, count: projects.length, data: projects });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/projects — creates a new project for the authenticated user.
 *
 * Body (from repository selection in frontend):
 *   { name, repositoryName, repositoryUrl, branch, githubRepositoryId }
 *
 * userId is taken from the JWT — the frontend cannot override it.
 */
const createProject = async (req, res, next) => {
  try {
    const { name, repositoryName, repositoryUrl, branch, githubRepositoryId } = req.body;

    if (!name || !repositoryName || !repositoryUrl) {
      return res.status(400).json({
        success: false,
        message: 'name, repositoryName, and repositoryUrl are required.',
      });
    }

    const newProject = await projectService.create({
      name,
      repositoryName,
      repositoryUrl,
      branch:             branch             || 'main',
      githubRepositoryId: githubRepositoryId || null,
      userId:             req.user.id,  // from the JWT — authenticated user's ID
    });

    res.status(201).json({ success: true, data: newProject });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/projects/:id — returns a single project (ownership verified).
 * Returns 404 if the project doesn't exist OR belongs to another user.
 */
const getProjectById = async (req, res, next) => {
  try {
    const project = await projectService.findById(req.params.id, req.user.id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    res.status(200).json({ success: true, data: project });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllProjects, createProject, getProjectById };
