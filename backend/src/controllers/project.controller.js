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

const getAllProjects = async (req, res, next) => {
  try {
    const projects = await projectService.findAll(req.user.id);
    const maskedProjects = projects.map(p => {
      const { accessPassword, ...rest } = p;
      return { ...rest, hasAccessPassword: !!accessPassword };
    });
    res.status(200).json({ success: true, count: maskedProjects.length, data: maskedProjects });
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
    const { name, repositoryName, repositoryUrl, branch, githubRepositoryId, accessPassword } = req.body;

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
      accessPassword:     accessPassword     || null,
      userId:             req.user.id,  // from the JWT — authenticated user's ID
    });

    const { accessPassword: _, ...maskedProject } = newProject;
    maskedProject.hasAccessPassword = !!newProject.accessPassword;

    res.status(201).json({ success: true, data: maskedProject });
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

    const { accessPassword, ...maskedProject } = project;
    maskedProject.hasAccessPassword = !!accessPassword;

    res.status(200).json({ success: true, data: maskedProject });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/projects/:id/redeploy — Redeploy latest branch commit for this project.
 */
const redeployProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const project = await projectService.findById(id, userId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    const deploymentService = require('../services/deployment.service');
    const pipelineService   = require('../services/pipeline.service');
    const dockerService     = require('../services/docker.service');

    const isLocked = deploymentService.isProjectLocked(id);
    const isBuilding = await deploymentService.hasBuildingDeployment(id);
    if (isLocked || isBuilding) {
      return res.status(409).json({
        success: false,
        message: 'A deployment or rollback is already in progress for this project.',
      });
    }

    const dockerAvailable = await dockerService.checkDockerAvailable();
    if (!dockerAvailable) {
      return res.status(503).json({
        success: false,
        message: 'Docker is not available. Please start Docker Desktop and try again.',
      });
    }

    deploymentService.acquireProjectLock(id);

    const newDeployment = await deploymentService.create({
      projectId: id,
      source: 'REDEPLOY',
    });

    res.status(202).json({
      success: true,
      message: 'Redeployment started for project.',
      data: {
        deploymentId: newDeployment.id,
      },
    });

    pipelineService.runDeploymentPipeline(newDeployment.id, id, userId, {
      isRedeploy: true,
      source: 'REDEPLOY',
    }).catch((err) => {
      console.error('[PROJECT_REDEPLOY] Unhandled error:', err);
      deploymentService.releaseProjectLock(id);
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { getAllProjects, createProject, getProjectById, redeployProject };
