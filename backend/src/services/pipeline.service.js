/**
 * pipeline.service.js — Core deployment pipeline for Phase 4 & Phase 5.
 *
 * Orchestrates the full deployment lifecycle:
 *   1. Validate project ownership
 *   2. Get GitHub access token
 *   3. Fetch latest commit SHA
 *   4. Create deployment record (BUILDING)
 *   5. Verify repository access on GitHub
 *   6. Clone repository
 *   7. Detect project type
 *   8. Build Docker image
 *   9. Find available host port
 *  10. Start Docker container
 *  11. Health-check the container
 *  12. Mark deployment LIVE or FAILED
 *  13. Stream real-time logs & status updates via Socket.IO
 *
 * This function runs ASYNCHRONOUSLY after the HTTP 202 is sent.
 */

const http   = require('http');
const logger = require('../utils/logger.util');
const pool   = require('../db/pool');

const deploymentService  = require('./deployment.service');
const projectService     = require('./project.service');
const githubService      = require('./github.service');
const repositoryService  = require('./repository.service');
const dockerService      = require('./docker.service');
const socketService      = require('./socket.service');
const nginxService       = require('./nginx.service');
const { generateHostname } = require('../utils/slug.util');

// ─── Health check config ──────────────────────────────────────────────────────

const HEALTH_CHECK_MAX_ATTEMPTS = parseInt(process.env.HEALTH_CHECK_ATTEMPTS || '10', 10);
const HEALTH_CHECK_INTERVAL_MS  = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '3000', 10);
const HEALTH_CHECK_TIMEOUT_MS   = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '5000', 10);

// ─── Log accumulator ─────────────────────────────────────────────────────────

const createLogAccumulator = (deploymentId) => {
  const lines = [];
  let pendingFlush = null;

  const addLine = (line) => {
    const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
    const entry = `[${ts}] ${line}`;
    lines.push(entry);
    logger.info(`[DEPLOYMENT:${deploymentId.slice(0, 8)}] ${line}`);

    // Emit real-time log over Socket.IO
    socketService.emitDeploymentLog(deploymentId, entry);

    // Debounced flush every 1.5 seconds to DB
    if (pendingFlush) clearTimeout(pendingFlush);
    pendingFlush = setTimeout(() => flush(), 1500);
  };

  const getLogs = () => lines.join('\n');

  const flush = async () => {
    if (pendingFlush) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    try {
      await deploymentService.appendDeploymentLogs(deploymentId, getLogs());
    } catch {}
  };

  return { addLine, getLogs, flush };
};

// ─── Health check ─────────────────────────────────────────────────────────────

const performHealthCheck = async (hostPort, onLog) => {
  onLog(`[INFO] Starting health check on http://localhost:${hostPort}`);

  for (let attempt = 1; attempt <= HEALTH_CHECK_MAX_ATTEMPTS; attempt++) {
    onLog(`[INFO] Health check attempt ${attempt}/${HEALTH_CHECK_MAX_ATTEMPTS}...`);

    const healthy = await new Promise((resolve) => {
      const req = http.get(
        { hostname: 'localhost', port: hostPort, path: '/', timeout: HEALTH_CHECK_TIMEOUT_MS },
        (res) => {
          resolve(res.statusCode < 500);
        }
      );

      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error',   ()  => resolve(false));
    });

    if (healthy) {
      onLog(`[INFO] Health check passed on attempt ${attempt}.`);
      return true;
    }

    if (attempt < HEALTH_CHECK_MAX_ATTEMPTS) {
      const waitMs = HEALTH_CHECK_INTERVAL_MS * Math.min(attempt, 3);
      onLog(`[INFO] Not ready yet — waiting ${waitMs / 1000}s before next attempt...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  onLog(`[ERROR] Health check failed after ${HEALTH_CHECK_MAX_ATTEMPTS} attempts.`);
  return false;
};

// ─── Main pipeline ────────────────────────────────────────────────────────────

const runDeploymentPipeline = async (deploymentId, projectId, userId, options = {}) => {
  let workspacePath = null;
  let imageTag      = null;
  let containerId   = null;
  let hostPort      = null;

  const { targetCommitSha = null, isRollback = false, isRedeploy = false } = options;
  const log = createLogAccumulator(deploymentId);

  // Preserve previous live deployment in case new candidate fails
  const previousLiveDeployment = await deploymentService.findPreviousLiveDeployment(projectId, deploymentId);

  const failDeployment = async (reason) => {
    log.addLine(`[ERROR] Deployment FAILED: ${reason}`);

    if (previousLiveDeployment) {
      log.addLine(`[INFO] Safe deployment protection active: Previous LIVE deployment (${previousLiveDeployment.id.slice(0, 8)}) remains ACTIVE.`);
    }

    if (containerId) {
      log.addLine(`[INFO] Cleaning up failed candidate container...`);
      await dockerService.stopAndRemoveContainer(containerId);
    }
    if (imageTag) {
      log.addLine(`[INFO] Cleaning up failed candidate image...`);
      await dockerService.removeImage(imageTag);
    }
    if (workspacePath) {
      await repositoryService.cleanupWorkspace(deploymentId);
    }

    await log.flush();

    await deploymentService.updateDeployment(deploymentId, {
      status: 'FAILED',
      logs:   log.getLogs(),
      errorMessage: reason,
    });

    // Release project concurrency lock
    deploymentService.releaseProjectLock(projectId);

    // Emit Socket.IO error & status events
    socketService.emitDeploymentError(deploymentId, reason);
    socketService.emitDeploymentStatus(deploymentId, 'FAILED');
  };

  try {
    log.addLine(`[INFO] Deployment pipeline started.`);
    socketService.emitDeploymentStatus(deploymentId, 'BUILDING');

    // ── Step 1: Verify Docker is available ────────────────────────────────────
    const dockerAvailable = await dockerService.checkDockerAvailable();
    if (!dockerAvailable) {
      await failDeployment('Docker daemon is not available. Please start Docker Desktop.');
      return;
    }
    log.addLine(`[INFO] Docker daemon is accessible.`);

    // ── Step 2: Load project from DB ─────────────────────────────────────────
    const project = await projectService.findById(projectId, userId);
    if (!project) {
      await failDeployment('Project not found or access denied.');
      return;
    }

    const { repositoryUrl, branch = 'main' } = project;
    log.addLine(`[INFO] Project: ${project.name}`);
    log.addLine(`[INFO] Repository: ${repositoryUrl}`);
    log.addLine(`[INFO] Branch: ${branch}`);

    // Generate/verify project hostname details
    const { deploymentSlug, hostname, deploymentUrl } = generateHostname(
      project.name,
      project.id
    );
    log.addLine(`[INFO] Target Hostname: ${hostname}`);
    log.addLine(`[INFO] Target Deployment URL: ${deploymentUrl}`);

    // ── Step 3: Validate repository URL & Branch ──────────────────────────────
    if (!repositoryService.isValidGithubUrl(repositoryUrl)) {
      await failDeployment(`Invalid repository URL: ${repositoryUrl}`);
      return;
    }

    if (!repositoryService.isValidBranch(branch)) {
      await failDeployment(`Invalid branch name: ${branch}`);
      return;
    }

    // ── Step 4: Get GitHub access token (backend-only) ────────────────────────
    const accessToken = await githubService.getAccessToken(userId);
    if (!accessToken) {
      await failDeployment('GitHub is not connected. Please connect your GitHub account in settings.');
      return;
    }
    log.addLine(`[INFO] GitHub token retrieved (backend-only, not logged).`);

    // ── Step 5: Verify repository access via GitHub API ───────────────────────
    log.addLine(`[INFO] Verifying repository access on GitHub...`);
    const hasAccess = await githubService.verifyRepoAccess(accessToken, repositoryUrl);
    if (!hasAccess) {
      await failDeployment('Unable to access GitHub repository. Access may have been revoked or repository deleted.');
      return;
    }
    log.addLine(`[INFO] Repository access verified.`);

    // ── Step 6: Determine Commit SHA ─────────────────────────────────────────
    let commitSha = targetCommitSha;
    if (!commitSha) {
      log.addLine(`[INFO] Fetching latest commit SHA from GitHub...`);
      try {
        commitSha = await githubService.getLatestCommitSha(accessToken, repositoryUrl, branch);
      } catch (err) {
        await failDeployment(`GitHub API error: ${err.message}`);
        return;
      }
    } else {
      log.addLine(`[INFO] Targeted commit SHA for ${isRollback ? 'rollback' : 'redeploy'}: ${commitSha}`);
    }

    log.addLine(`[INFO] Commit: ${commitSha}`);
    await pool.query(
      `UPDATE deployments SET commit_hash = $1 WHERE id = $2`,
      [commitSha, deploymentId]
    );

    // ── Step 7: Clone repository ──────────────────────────────────────────────
    log.addLine(`[INFO] Cloning repository...`);
    try {
      workspacePath = await repositoryService.cloneRepository({
        deploymentId,
        repositoryUrl,
        branch,
        accessToken,
        onLog: log.addLine,
        targetCommitSha: commitSha,
      });

      // Extract commit message from cloned repository
      const commitInfo = await repositoryService.getWorkspaceCommitInfo(workspacePath);
      if (commitInfo.message) {
        log.addLine(`[INFO] Commit message: ${commitInfo.message}`);
        await pool.query(
          `UPDATE deployments SET commit_message = $1 WHERE id = $2`,
          [commitInfo.message, deploymentId]
        );
      }
    } catch (err) {
      await failDeployment(`Repository clone failed: ${err.message}`);
      return;
    }

    // ── Step 8: Detect project type ───────────────────────────────────────────
    log.addLine(`[INFO] Detecting project type...`);
    let projectType, containerPort;
    try {
      const result = await repositoryService.detectAndPrepareProject(workspacePath, log.addLine);
      projectType   = result.type;
      containerPort = result.containerPort;
      log.addLine(`[INFO] Project type: ${projectType} (container port: ${containerPort})`);
    } catch (err) {
      await failDeployment(`Project type detection failed: ${err.message}`);
      return;
    }

    // ── Step 9: Build Docker image ────────────────────────────────────────────
    const sanitizedRepoName = project.repositoryName
      ? project.repositoryName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      : 'app';
    imageTag = `mini-deploy/${sanitizedRepoName}:${deploymentId.slice(0, 8)}`;

    log.addLine(`[INFO] Docker image tag: ${imageTag}`);
    log.addLine(`[INFO] Building Docker image...`);

    try {
      await dockerService.buildImage({
        workspacePath,
        imageTag,
        onLog: log.addLine,
      });
    } catch (err) {
      await failDeployment(`Docker image build failed: ${err.message}`);
      return;
    }
    log.addLine(`[INFO] Docker image build complete.`);

    // ── Step 10: Clean up workspace ───────────────────────────────────────────
    await repositoryService.cleanupWorkspace(deploymentId);
    workspacePath = null;
    log.addLine(`[INFO] Build workspace cleaned up.`);

    // ── Step 11: Allocate host port ───────────────────────────────────────────
    log.addLine(`[INFO] Finding available host port...`);
    try {
      hostPort = await dockerService.findAvailablePort();
    } catch (err) {
      await failDeployment(`Port allocation failed: ${err.message}`);
      return;
    }
    log.addLine(`[INFO] Assigned host port: ${hostPort}`);

    // ── Step 12: Start container ──────────────────────────────────────────────
    const containerName = `mini-deploy-${deploymentId.slice(0, 8)}`;
    log.addLine(`[INFO] Starting container: ${containerName}`);
    try {
      const result = await dockerService.startContainer({
        imageTag,
        containerName,
        hostPort,
        containerPort,
        onLog: log.addLine,
      });
      containerId = result.containerId;
    } catch (err) {
      await failDeployment(`Container start failed: ${err.message}`);
      return;
    }
    log.addLine(`[INFO] Container started: ${containerId.slice(0, 12)}`);

    // ── Step 13: Wait a moment for app startup ────────────────────────────────
    log.addLine(`[INFO] Waiting for application to initialize...`);
    await new Promise((r) => setTimeout(r, 3000));

    // ── Step 14: Container Health Check ───────────────────────────────────────
    const healthy = await performHealthCheck(hostPort, log.addLine);

    if (!healthy) {
      const containerLogs = await dockerService.getContainerLogs(containerId, 100);
      if (containerLogs.trim()) {
        log.addLine(`[INFO] Container output before failure:`);
        log.addLine(containerLogs);
      }

      const stillRunning = await dockerService.isContainerRunning(containerId);
      if (!stillRunning) {
        log.addLine(`[ERROR] Container exited unexpectedly.`);
      }

      await failDeployment('Health check failed — application did not become reachable.');
      return;
    }

    // ── Step 15: Phase 6 — Nginx Reverse Proxy Configuration & Validation ──────
    log.addLine(`[INFO] Container is healthy. Configuring Nginx reverse proxy...`);
    let nginxConfigPath = null;
    let finalDeploymentUrl = deploymentUrl;

    try {
      log.addLine(`[INFO] Generating Nginx configuration for ${hostname} -> port ${hostPort}...`);
      const nginxResult = await nginxService.applyNginxConfig(
        deploymentSlug,
        hostname,
        hostPort,
        project.accessPassword
      );
      nginxConfigPath = nginxResult.configPath;
      if (nginxResult.reloaded) {
        log.addLine(`[INFO] Nginx configuration validated and gracefully reloaded.`);
      } else if (nginxResult.warning) {
        log.addLine(`[WARN] Nginx warning: ${nginxResult.warning}`);
        // Direct container port is 100% reliable on localhost. Only use PUBLIC_BASE_URL if explicitly configured and not an ephemeral tunnel
        if (process.env.PUBLIC_BASE_URL && !process.env.PUBLIC_BASE_URL.includes('loca.lt')) {
          finalDeploymentUrl = `${process.env.PUBLIC_BASE_URL}/app/${project.name}`;
        } else {
          finalDeploymentUrl = `http://localhost:${hostPort}`;
        }
        log.addLine(`[INFO] Live Deployment URL configured: ${finalDeploymentUrl}`);
      }
    } catch (err) {
      log.addLine(`[ERROR] Nginx configuration or reload failed: ${err.message}`);
      await failDeployment(`Nginx proxy configuration failed: ${err.message}`);
      return;
    }

    // ── Step 16: Zero-Downtime Atomic Switch & Persistence ────────────────────
    log.addLine(`[INFO] Updating project active deployment to #${deploymentId.slice(0, 8)}...`);

    // Update deployment record
    await deploymentService.updateDeployment(deploymentId, {
      status:          'LIVE',
      containerId,
      containerPort:   hostPort,
      deploymentUrl:   finalDeploymentUrl,
      hostname,
      nginxConfigPath,
      logs:            log.getLogs(),
    });

    // Update project pointer
    await projectService.setActiveDeployment(projectId, deploymentId);

    log.addLine(`[INFO] Deployment is LIVE!`);
    log.addLine(`[INFO] Access URL: ${finalDeploymentUrl}`);

    await log.flush();

    // Clean up old containers safely according to retention policy
    try {
      log.addLine(`[INFO] Applying safe container retention policy...`);
      const cleanupResult = await deploymentService.safeCleanupContainers(projectId, 2);
      if (cleanupResult.removedContainers.length > 0) {
        log.addLine(`[INFO] Safe cleanup: Retired ${cleanupResult.removedContainers.length} old container(s).`);
      }
    } catch (cleanupErr) {
      log.addLine(`[WARN] Cleanup warning: ${cleanupErr.message}`);
    }

    // Emit Socket.IO completion event with Phase 6 URL
    socketService.emitDeploymentComplete(deploymentId, {
      containerId: containerId.slice(0, 12),
      containerPort: hostPort,
      deploymentUrl: finalDeploymentUrl,
      hostname,
    });
    socketService.emitDeploymentStatus(deploymentId, 'LIVE');

    logger.info(`[DEPLOYMENT] Deployment ${deploymentId.slice(0, 8)} is LIVE at ${finalDeploymentUrl}`);

  } catch (err) {
    logger.error(`[DEPLOYMENT] Unexpected pipeline error:`, err);
    await failDeployment(`Unexpected error: ${err.message}`);
  } finally {
    deploymentService.releaseProjectLock(projectId);
  }
};

module.exports = { runDeploymentPipeline };
