/**
 * deployment.controller.js — Handles deployment-related API requests.
 *
 * Phase 8:
 *  - One-click Redeployment: POST /api/deployments/:id/redeploy
 *  - Safe Rollback: POST /api/deployments/:id/rollback (never switches traffic unless healthy)
 *  - Concurrency locking: prevents duplicate parallel deployments/rollbacks
 *  - Filters: status (LIVE, FAILED, BUILDING) and source (MANUAL, WEBHOOK, REDEPLOY, ROLLBACK)
 *  - Safe container cleanup: POST /api/deployments/cleanup
 */

const deploymentService = require('../services/deployment.service');
const projectService    = require('../services/project.service');
const pipelineService   = require('../services/pipeline.service');
const dockerService     = require('../services/docker.service');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET /api/deployments — returns the authenticated user's deployments with optional filters */
const getAllDeployments = async (req, res, next) => {
  try {
    const { projectId, status, source } = req.query;
    const deployments = await deploymentService.findAll(req.user.id, projectId || null, { status, source });

    res.status(200).json({ success: true, count: deployments.length, data: deployments });
  } catch (err) {
    next(err);
  }
};

/** GET /api/deployments/:id — returns a single deployment (ownership verified) */
const getDeploymentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deployment ID format. Must be a valid UUID.',
      });
    }

    const deployment = await deploymentService.findById(id, req.user.id);

    if (!deployment) {
      return res.status(404).json({
        success: false,
        message: 'Deployment not found.',
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
 * Request body: { "projectId": "<uuid>", "commitHash": "<optional>" }
 */
const createDeployment = async (req, res, next) => {
  try {
    const { projectId, commitHash } = req.body;
    const userId = req.user.id;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'projectId is required.',
      });
    }

    const project = await projectService.findById(projectId, userId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    // Check concurrency locking & active building deployment
    const isLocked = deploymentService.isProjectLocked(projectId);
    const isBuilding = await deploymentService.hasBuildingDeployment(projectId);
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

    // Acquire project lock
    deploymentService.acquireProjectLock(projectId);

    // Create deployment record
    const deployment = await deploymentService.create({
      projectId,
      commitHash: commitHash || null,
      source: 'MANUAL',
    });

    res.status(202).json({
      success: true,
      message: 'Deployment started.',
      data: {
        deploymentId: deployment.id,
      },
    });

    pipelineService.runDeploymentPipeline(deployment.id, projectId, userId, {
      targetCommitSha: commitHash || null,
      source: 'MANUAL',
    }).catch((err) => {
      console.error('[DEPLOYMENT] Unhandled pipeline error:', err);
      deploymentService.releaseProjectLock(projectId);
    });

  } catch (err) {
    if (req.body?.projectId) {
      deploymentService.releaseProjectLock(req.body.projectId);
    }
    next(err);
  }
};

/**
 * POST /api/deployments/:id/redeploy — Redeploy a specific deployment's commit.
 */
const redeployDeployment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deployment ID format. Must be a valid UUID.',
      });
    }

    const targetDeployment = await deploymentService.findById(id, userId);
    if (!targetDeployment) {
      return res.status(404).json({
        success: false,
        message: 'Deployment not found.',
      });
    }

    const projectId = targetDeployment.projectId;
    const project = await projectService.findById(projectId, userId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    // Concurrency lock check
    const isLocked = deploymentService.isProjectLocked(projectId);
    const isBuilding = await deploymentService.hasBuildingDeployment(projectId);
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

    deploymentService.acquireProjectLock(projectId);

    // Create new deployment record
    const newDeployment = await deploymentService.create({
      projectId,
      commitHash: targetDeployment.commitHash,
      commitMessage: targetDeployment.commitMessage,
      source: 'REDEPLOY',
      redeployFromDeploymentId: targetDeployment.id,
    });

    res.status(202).json({
      success: true,
      message: `Redeployment started for commit ${targetDeployment.commitHash ? targetDeployment.commitHash.slice(0, 7) : 'latest'}.`,
      data: {
        deploymentId: newDeployment.id,
      },
    });

    pipelineService.runDeploymentPipeline(newDeployment.id, projectId, userId, {
      targetCommitSha: targetDeployment.commitHash,
      isRedeploy: true,
      redeployFromDeploymentId: targetDeployment.id,
      source: 'REDEPLOY',
    }).catch((err) => {
      console.error('[REDEPLOY] Unhandled pipeline error:', err);
      deploymentService.releaseProjectLock(projectId);
    });

  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/deployments/:id/rollback — Rollback to a previously successful deployment.
 *
 * CRITICAL RULE: Never switch production traffic to a failed or unhealthy deployment.
 * Candidate is built, started on an isolated port, and health-checked.
 * Only if healthy is active_deployment_id and live routing updated.
 */
const rollbackDeployment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deployment ID format. Must be a valid UUID.',
      });
    }

    const targetDeployment = await deploymentService.findById(id, userId);
    if (!targetDeployment) {
      return res.status(404).json({
        success: false,
        message: 'Target deployment not found.',
      });
    }

    // Validate that target deployment was successful and has a commit hash
    if (targetDeployment.status !== 'LIVE' || !targetDeployment.commitHash) {
      return res.status(400).json({
        success: false,
        message: 'Cannot rollback to an unsuccessful or incomplete deployment. Target deployment must have status LIVE.',
      });
    }

    const projectId = targetDeployment.projectId;
    const project = await projectService.findById(projectId, userId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    // Check if this deployment is already the active deployment
    if (project.activeDeploymentId === targetDeployment.id) {
      return res.status(400).json({
        success: false,
        message: `Deployment #${targetDeployment.id.slice(0, 8)} is already the active production deployment.`,
      });
    }

    // Concurrency lock check
    const isLocked = deploymentService.isProjectLocked(projectId);
    const isBuilding = await deploymentService.hasBuildingDeployment(projectId);
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

    deploymentService.acquireProjectLock(projectId);

    // Create rollback deployment record
    const rollbackRecord = await deploymentService.create({
      projectId,
      commitHash: targetDeployment.commitHash,
      commitMessage: targetDeployment.commitMessage,
      source: 'ROLLBACK',
      rollbackFromDeploymentId: targetDeployment.id,
    });

    res.status(202).json({
      success: true,
      message: `Rollback initiated to deployment #${targetDeployment.id.slice(0, 8)} (commit ${targetDeployment.commitHash.slice(0, 7)}).`,
      data: {
        deploymentId: rollbackRecord.id,
      },
    });

    pipelineService.runDeploymentPipeline(rollbackRecord.id, projectId, userId, {
      targetCommitSha: targetDeployment.commitHash,
      isRollback: true,
      rollbackFromDeploymentId: targetDeployment.id,
      source: 'ROLLBACK',
    }).catch((err) => {
      console.error('[ROLLBACK] Unhandled pipeline error:', err);
      deploymentService.releaseProjectLock(projectId);
    });

  } catch (err) {
    next(err);
  }
};

/** POST /api/deployments/cleanup — Trigger safe container cleanup without disturbing live apps */
const triggerSafeCleanup = async (req, res, next) => {
  try {
    const { projectId } = req.query;
    const result = await deploymentService.safeCleanupContainers(projectId || null, 2);
    res.status(200).json({
      success: true,
      message: `Safe container cleanup completed. Retired: ${result.removedContainers.length}, Preserved: ${result.preservedContainers.length}`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/deployments/:id — stop and remove a deployment */
const removeDeployment = async (req, res, next) => {
  try {
    await deploymentService.deleteDeployment(req.params.id, req.user.id);
    res.status(200).json({ success: true, message: 'Deployment deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllDeployments,
  getDeploymentById,
  createDeployment,
  redeployDeployment,
  rollbackDeployment,
  triggerSafeCleanup,
  removeDeployment,
};
