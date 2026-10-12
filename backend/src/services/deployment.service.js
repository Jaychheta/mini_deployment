/**
 * deployment.service.js — Business logic layer for deployments.
 *
 * Phase 8:
 *   - Concurrency locking: prevents duplicate or racing deployments/rollbacks per project.
 *   - Extended history metadata: commit message, duration, error summaries, active flags.
 *   - Filtering support: filter deployments by status (LIVE, FAILED, BUILDING) and source (MANUAL, WEBHOOK, REDEPLOY, ROLLBACK).
 *   - Safe container retention & cleanup: preserves live production containers while cleaning up stale containers.
 */

const pool   = require('../db/pool');
const logger = require('../utils/logger.util');
const { redactSecrets } = require('../utils/crypto.util');

// In-memory concurrency locks to prevent race conditions across parallel requests
const projectOperationLocks = new Set();

const acquireProjectLock = (projectId) => {
  if (!projectId) return false;
  if (projectOperationLocks.has(projectId)) return false;
  projectOperationLocks.add(projectId);
  return true;
};

const releaseProjectLock = (projectId) => {
  if (projectId) {
    projectOperationLocks.delete(projectId);
  }
};

const isProjectLocked = (projectId) => {
  return projectOperationLocks.has(projectId);
};

// ─── Service Methods ──────────────────────────────────────────────────────────

/**
 * Returns deployments for a specific user (filtered via their projects).
 * Optionally filter by projectId, status, and source.
 *
 * @param {string} userId
 * @param {string|null} projectId
 * @param {Object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.source]
 * @returns {Promise<Array>}
 */
const findAll = async (userId, projectId = null, filters = {}) => {
  const conditions = ['p.user_id = $1'];
  const params = [userId];

  if (projectId) {
    params.push(projectId);
    conditions.push(`d.project_id = $${params.length}`);
  }

  if (filters.status && typeof filters.status === 'string') {
    params.push(filters.status.toUpperCase());
    conditions.push(`d.status = $${params.length}`);
  }

  if (filters.source && typeof filters.source === 'string') {
    params.push(filters.source.toUpperCase());
    conditions.push(`d.deployment_source = $${params.length}`);
  }

  const query = `
    SELECT d.id, d.project_id, d.commit_hash, d.commit_message, d.status,
           d.container_id, d.container_port, d.deployment_url, d.hostname, d.nginx_config_path, d.logs,
           d.deployment_source, d.rollback_from_deployment_id, d.redeploy_from_deployment_id, d.error_message,
           d.created_at, d.completed_at,
           (p.active_deployment_id = d.id) AS is_active,
           EXTRACT(EPOCH FROM (COALESCE(d.completed_at, NOW()) - d.created_at))::INTEGER AS duration_seconds,
           p.name AS project_name
    FROM deployments d
    JOIN projects p ON p.id = d.project_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY d.created_at DESC
  `;

  const result = await pool.query(query, params);
  return result.rows.map(formatDeployment);
};

/**
 * Returns ALL deployments with project + owner info.
 * For admin use only — includes filters.
 * @returns {Promise<Array>}
 */
const findAllAdmin = async (filters = {}) => {
  const conditions = [];
  const params = [];

  if (filters.status && typeof filters.status === 'string') {
    params.push(filters.status.toUpperCase());
    conditions.push(`d.status = $${params.length}`);
  }

  if (filters.source && typeof filters.source === 'string') {
    params.push(filters.source.toUpperCase());
    conditions.push(`d.deployment_source = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(`
    SELECT d.id, d.project_id, d.commit_hash, d.commit_message, d.status,
           d.container_id, d.container_port, d.deployment_url, d.hostname, d.nginx_config_path, d.logs,
           d.deployment_source, d.rollback_from_deployment_id, d.redeploy_from_deployment_id, d.error_message,
           d.created_at, d.completed_at,
           (p.active_deployment_id = d.id) AS is_active,
           EXTRACT(EPOCH FROM (COALESCE(d.completed_at, NOW()) - d.created_at))::INTEGER AS duration_seconds,
           p.name AS project_name,
           u.name AS owner_name
    FROM deployments d
    JOIN projects p ON p.id = d.project_id
    JOIN users  u  ON u.id  = p.user_id
    ${whereClause}
    ORDER BY d.created_at DESC
  `, params);

  return result.rows.map((row) => ({
    ...formatDeployment(row),
    projectName: row.project_name,
    ownerName:   row.owner_name,
  }));
};

/**
 * Returns a single deployment by ID.
 * If userId is provided, verifies the deployment belongs to that user's project.
 * @param {string} id
 * @param {string|undefined} userId
 * @returns {Promise<Object|null>}
 */
const findById = async (id, userId) => {
  let result;

  if (userId) {
    result = await pool.query(`
      SELECT d.id, d.project_id, d.commit_hash, d.commit_message, d.status,
             d.container_id, d.container_port, d.deployment_url, d.hostname, d.nginx_config_path, d.logs,
             d.deployment_source, d.rollback_from_deployment_id, d.redeploy_from_deployment_id, d.error_message,
             d.created_at, d.completed_at,
             (p.active_deployment_id = d.id) AS is_active,
             EXTRACT(EPOCH FROM (COALESCE(d.completed_at, NOW()) - d.created_at))::INTEGER AS duration_seconds,
             p.name AS project_name
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1 AND p.user_id = $2
    `, [id, userId]);
  } else {
    result = await pool.query(`
      SELECT d.id, d.project_id, d.commit_hash, d.commit_message, d.status,
             d.container_id, d.container_port, d.deployment_url, d.hostname, d.nginx_config_path, d.logs,
             d.deployment_source, d.rollback_from_deployment_id, d.redeploy_from_deployment_id, d.error_message,
             d.created_at, d.completed_at,
             (p.active_deployment_id = d.id) AS is_active,
             EXTRACT(EPOCH FROM (COALESCE(d.completed_at, NOW()) - d.created_at))::INTEGER AS duration_seconds,
             p.name AS project_name
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1
    `, [id]);
  }

  return result.rows.length > 0 ? formatDeployment(result.rows[0]) : null;
};

/**
 * Creates a new deployment record with BUILDING status.
 * @param {Object} params
 * @returns {Promise<Object>}
 */
const create = async ({
  projectId,
  commitHash = null,
  commitMessage = null,
  source = 'MANUAL',
  rollbackFromDeploymentId = null,
  redeployFromDeploymentId = null
}) => {
  const result = await pool.query(`
    INSERT INTO deployments (
      project_id, commit_hash, commit_message, status, deployment_source,
      rollback_from_deployment_id, redeploy_from_deployment_id
    )
    VALUES ($1, $2, $3, 'BUILDING', $4, $5, $6)
    RETURNING id, project_id, commit_hash, commit_message, status,
              container_id, container_port, deployment_url, hostname, nginx_config_path, logs,
              deployment_source, rollback_from_deployment_id, redeploy_from_deployment_id, error_message,
              created_at, completed_at
  `, [
    projectId,
    commitHash || null,
    commitMessage || null,
    source,
    rollbackFromDeploymentId || null,
    redeployFromDeploymentId || null
  ]);

  return formatDeployment(result.rows[0]);
};

/**
 * Update deployment record.
 */
const updateDeployment = async (deploymentId, {
  status,
  containerId,
  containerPort,
  deploymentUrl,
  hostname,
  nginxConfigPath,
  logs,
  commitHash,
  commitMessage,
  errorMessage,
}) => {
  const sanitizedLogs = logs ? redactSecrets(logs) : null;
  await pool.query(`
    UPDATE deployments
    SET status = $1,
        container_id = COALESCE($2, container_id),
        container_port = COALESCE($3, container_port),
        deployment_url = COALESCE($4, deployment_url),
        hostname = COALESCE($5, hostname),
        nginx_config_path = COALESCE($6, nginx_config_path),
        logs = COALESCE($7, logs),
        commit_hash = COALESCE($8, commit_hash),
        commit_message = COALESCE($9, commit_message),
        error_message = COALESCE($10, error_message),
        completed_at = NOW()
    WHERE id = $11
  `, [
    status,
    containerId || null,
    containerPort || null,
    deploymentUrl || null,
    hostname || null,
    nginxConfigPath || null,
    sanitizedLogs,
    commitHash || null,
    commitMessage || null,
    errorMessage || null,
    deploymentId
  ]);
};

/**
 * Append logs to an existing deployment record.
 */
const appendDeploymentLogs = async (deploymentId, logs) => {
  try {
    const sanitized = logs ? redactSecrets(logs) : '';
    await pool.query(`
      UPDATE deployments
      SET logs = COALESCE(logs, '') || $1
      WHERE id = $2
    `, [sanitized, deploymentId]);
  } catch (err) {
    logger.warn(`[DEPLOYMENT] Failed to append logs for ${deploymentId}: ${err.message}`);
  }
};

/**
 * Check whether a BUILDING deployment exists for this project.
 */
const hasBuildingDeployment = async (projectId) => {
  const result = await pool.query(
    `SELECT id FROM deployments WHERE project_id = $1 AND status = 'BUILDING' LIMIT 1`,
    [projectId]
  );
  return result.rows.length > 0;
};

/**
 * Get the most recent LIVE deployment for a project (excluding a specific deployment).
 */
const findPreviousLiveDeployment = async (projectId, excludeDeploymentId) => {
  const result = await pool.query(`
    SELECT id, container_id, container_port, deployment_url, hostname, commit_hash
    FROM deployments
    WHERE project_id = $1
      AND status = 'LIVE'
      AND ($2::uuid IS NULL OR id != $2::uuid)
    ORDER BY completed_at DESC
    LIMIT 1
  `, [projectId, excludeDeploymentId || null]);

  return result.rows[0] || null;
};

/**
 * Safe container retention & cleanup.
 *
 * Rules:
 *   1. NEVER removes or stops any container marked as active_deployment_id for ANY project!
 *   2. Keeps the last `retentionCount` LIVE/recent deployments intact.
 *   3. Removes old inactive candidate/stopped containers safely.
 *   4. Logs errors without throwing or corrupting deployment statuses.
 *
 * @param {string|null} [projectId] - Specific project or all projects if null
 * @param {number} [retentionCount=2]
 * @returns {Promise<{ removedContainers: string[], preservedContainers: string[] }>}
 */
const safeCleanupContainers = async (projectId = null, retentionCount = 2) => {
  const removedContainers = [];
  const preservedContainers = [];

  try {
    // 1. Fetch all active production deployment container IDs (NEVER DELETE THESE)
    const activeRes = await pool.query(`
      SELECT d.container_id 
      FROM projects p
      JOIN deployments d ON p.active_deployment_id = d.id
      WHERE d.container_id IS NOT NULL
    `);
    const activeContainerIds = new Set(activeRes.rows.map((r) => r.container_id));

    // 2. Fetch deployments with containers
    let query = `
      SELECT d.id, d.project_id, d.container_id, d.status, d.created_at
      FROM deployments d
      WHERE d.container_id IS NOT NULL
    `;
    const params = [];
    if (projectId) {
      params.push(projectId);
      query += ` AND d.project_id = $1`;
    }
    query += ` ORDER BY d.created_at DESC`;

    const depRes = await pool.query(query, params);
    const deploymentsByProject = new Map();

    for (const dep of depRes.rows) {
      if (!deploymentsByProject.has(dep.project_id)) {
        deploymentsByProject.set(dep.project_id, []);
      }
      deploymentsByProject.get(dep.project_id).push(dep);
    }

    const Docker = require('dockerode');
    const docker = new Docker();

    for (const [projId, depList] of deploymentsByProject.entries()) {
      // Keep up to retentionCount recent containers, plus any active container
      let keptCount = 0;
      for (const dep of depList) {
        const isCurrentActive = activeContainerIds.has(dep.container_id);

        if (isCurrentActive) {
          preservedContainers.push(dep.container_id);
          continue;
        }

        if (keptCount < retentionCount && dep.status === 'LIVE') {
          preservedContainers.push(dep.container_id);
          keptCount++;
          continue;
        }

        // Safe candidate for cleanup
        try {
          const container = docker.getContainer(dep.container_id);
          await container.stop({ t: 3 }).catch(() => {});
          await container.remove({ force: true }).catch(() => {});
          removedContainers.push(dep.container_id);

          await pool.query(
            `UPDATE deployments SET status = CASE WHEN status = 'LIVE' THEN 'STOPPED' ELSE status END WHERE id = $1`,
            [dep.id]
          );
          logger.info(`[CLEANUP] Safely removed inactive container ${dep.container_id.slice(0, 12)} for project ${projId}`);
        } catch (cleanupErr) {
          logger.warn(`[CLEANUP] Could not remove container ${dep.container_id}: ${cleanupErr.message}`);
        }
      }
    }
  } catch (err) {
    logger.error('[CLEANUP] Error during safe container cleanup:', err);
  }

  return { removedContainers, preservedContainers };
};

/**
 * Stop deployment container (if any) and delete the deployment record.
 */
const deleteDeployment = async (id, userId) => {
  const deployment = await findById(id, userId);
  if (!deployment) throw new Error('Deployment not found or unauthorized');

  if (deployment.containerId) {
    const Docker = require('dockerode');
    const docker = new Docker();
    try {
      const container = docker.getContainer(deployment.containerId);
      await container.stop().catch(() => {});
      await container.remove().catch(() => {});
    } catch (err) {
      logger.warn(`Failed to stop/remove container for deployment ${id}: ${err.message}`);
    }
  }

  if (deployment.nginxConfigPath) {
    const fs = require('fs').promises;
    try {
      await fs.unlink(deployment.nginxConfigPath);
    } catch (err) {
      logger.warn(`Failed to remove nginx config for ${id}: ${err.message}`);
    }
  }

  await pool.query('UPDATE projects SET active_deployment_id = NULL WHERE active_deployment_id = $1', [id]);
  await pool.query('DELETE FROM deployments WHERE id = $1', [id]);
};

// ─── Formatter ────────────────────────────────────────────────────────────────

/** Convert snake_case DB row to camelCase JS object. */
const formatDeployment = (row) => ({
  id:                       row.id,
  projectId:                row.project_id,
  projectName:              row.project_name || null,
  commitHash:               row.commit_hash,
  commitMessage:            row.commit_message || null,
  status:                   row.status,
  containerId:              row.container_id,
  containerPort:            row.container_port,
  deploymentUrl:            (row.deployment_url && !row.deployment_url.includes('loca.lt')) ? row.deployment_url : (row.container_port ? `http://localhost:${row.container_port}` : null),
  hostname:                 row.hostname || null,
  nginxConfigPath:          row.nginx_config_path || null,
  logs:                     row.logs,
  deploymentSource:         row.deployment_source || 'MANUAL',
  rollbackFromDeploymentId: row.rollback_from_deployment_id || null,
  redeployFromDeploymentId: row.redeploy_from_deployment_id || null,
  errorMessage:             row.error_message || null,
  isActive:                 row.is_active === true,
  durationSeconds:          row.duration_seconds != null ? Number(row.duration_seconds) : null,
  createdAt:                row.created_at,
  completedAt:              row.completed_at,
});

module.exports = {
  findAll,
  findAllAdmin,
  findById,
  create,
  updateDeployment,
  appendDeploymentLogs,
  hasBuildingDeployment,
  findPreviousLiveDeployment,
  deleteDeployment,
  acquireProjectLock,
  releaseProjectLock,
  isProjectLocked,
  safeCleanupContainers,
};
