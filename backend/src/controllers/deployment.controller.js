/**
 * deployment.controller.js — Handles deployment-related API requests.
 *
 * Phase 2: All routes now require authentication.
 *  - Users only see deployments belonging to their own projects.
 *  - Filtering by ?projectId=<id> is still supported.
 *
 * Phase 4: Added createDeployment handler for POST /api/deployments.
 *  - Validates project ownership.
 *  - Prevents duplicate BUILDING deployments.
 *  - Returns HTTP 202 immediately and runs pipeline asynchronously.
 */

const deploymentService = require('../services/deployment.service');
const projectService    = require('../services/project.service');
const pipelineService   = require('../services/pipeline.service');
const dockerService     = require('../services/docker.service');

/** GET /api/deployments — returns the authenticated user's deployments */
const getAllDeployments = async (req, res, next) => {
  try {
    const { projectId } = req.query;
    const deployments = await deploymentService.findAll(req.user.id, projectId || null);

    res.status(200).json({ success: true, count: deployments.length, data: deployments });
  } catch (err) {
    next(err);
  }
};

/** GET /api/deployments/:id — returns a single deployment (ownership verified) */
const getDeploymentById = async (req, res, next) => {
  try {
    const deployment = await deploymentService.findById(req.params.id, req.user.id);

    if (!deployment) {
      return res.status(404).json({
        success: false,
        message: `Deployment not found.`,
      });
    }

    res.status(200).json({ success: true, data: deployment });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/deployments — Trigger a new deployment.
 *
 * Request body: { "projectId": "<uuid>" }
 *
 * Security checks:
 *   1. Authenticated user (enforced by route middleware)
 *   2. projectId is required
 *   3. Project must belong to the authenticated user
 *   4. No duplicate BUILDING deployments for the same project
 *   5. Docker must be available
 *
 * Returns HTTP 202 immediately after creating the deployment record.
 * The pipeline runs asynchronously — client polls GET /api/deployments/:id.
 */
const createDeployment = async (req, res, next) => {
  try {
    const { projectId } = req.body;
    const userId = req.user.id;

    // ── Validate input ────────────────────────────────────────────────────────
    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'projectId is required.',
      });
    }

    // ── Verify project ownership ──────────────────────────────────────────────
    const project = await projectService.findById(projectId, userId);
    if (!project) {
      // Return 404 for both "not found" and "belongs to another user"
      // (avoids leaking information about project existence)
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    // ── Check for duplicate BUILDING deployment ───────────────────────────────
    const isBuilding = await deploymentService.hasBuildingDeployment(projectId);
    if (isBuilding) {
      return res.status(409).json({
        success: false,
        message: 'A deployment is already in progress for this project.',
      });
    }

    // ── Check Docker availability before accepting the deployment ─────────────
    const dockerAvailable = await dockerService.checkDockerAvailable();
    if (!dockerAvailable) {
      return res.status(503).json({
        success: false,
        message: 'Docker is not available. Please start Docker Desktop and try again.',
      });
    }

    // ── Create deployment record (status = BUILDING) ──────────────────────────
    const deployment = await deploymentService.create({
      projectId,
      commitHash: null, // will be updated by the pipeline
    });

    // ── Return 202 immediately ────────────────────────────────────────────────
    res.status(202).json({
      success: true,
      message: 'Deployment started.',
      data: {
        deploymentId: deployment.id,
      },
    });

    // ── Run deployment pipeline asynchronously ────────────────────────────────
    // The HTTP response has already been sent.
    // Any errors inside the pipeline are caught and recorded in the DB.
    pipelineService.runDeploymentPipeline(deployment.id, projectId, userId)
      .catch((err) => {
        // This should never happen since the pipeline catches everything,
        // but log as a last resort.
        console.error('[DEPLOYMENT] Unhandled pipeline error:', err);
      });

  } catch (err) {
    next(err);
  }
};

module.exports = { getAllDeployments, getDeploymentById, createDeployment };
