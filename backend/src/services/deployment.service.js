/**
 * deployment.service.js — Business logic layer for deployments.
 *
 * Phase 3: Replaced in-memory store with PostgreSQL queries.
 *   - findAll(userId, projectId): filters by user's projects
 *   - findAllAdmin(): returns all with project + owner info
 *   - findById(id, userId): verifies ownership via project join
 *   - create(): inserts a new deployment record
 *
 * Phase 4: Full Docker deployment pipeline added.
 *   - triggerDeployment(projectId, userId): orchestrates the entire
 *     clone → build → run → health-check pipeline asynchronously.
 *   - checkBuildingDeployment(projectId): check if a BUILDING deployment exists
 *   - updateDeploymentStatus(): update status in PostgreSQL
 */

const pool   = require('../db/pool');
const logger = require('../utils/logger.util');

// ─── Service Methods ──────────────────────────────────────────────────────────

/**
 * Returns deployments for a specific user (filtered via their projects).
 * Optionally filter by a single projectId.
 *
 * @param {string} userId       — filter to this user's projects
 * @param {string|null} projectId — optional: further filter by a specific project
 * @returns {Promise<Array>}
 */
const findAll = async (userId, projectId = null) => {
  let query;
  let params;

  if (projectId) {
    query = `
      SELECT d.id, d.project_id, d.commit_hash, d.status,
             d.container_id, d.container_port, d.logs,
             d.created_at, d.completed_at
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      WHERE p.user_id = $1 AND d.project_id = $2
      ORDER BY d.created_at DESC
    `;
    params = [userId, projectId];
  } else {
    query = `
      SELECT d.id, d.project_id, d.commit_hash, d.status,
             d.container_id, d.container_port, d.logs,
             d.created_at, d.completed_at
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      WHERE p.user_id = $1
      ORDER BY d.created_at DESC
    `;
    params = [userId];
  }

  const result = await pool.query(query, params);
  return result.rows.map(formatDeployment);
};

/**
 * Returns ALL deployments with project + owner info.
 * For admin use only — do not call from user-facing routes.
 * @returns {Promise<Array>}
 */
const findAllAdmin = async () => {
  const result = await pool.query(`
    SELECT d.id, d.project_id, d.commit_hash, d.status,
           d.container_id, d.container_port, d.logs,
           d.created_at, d.completed_at,
           p.name AS project_name,
           u.name AS owner_name
    FROM deployments d
    JOIN projects p ON p.id = d.project_id
    JOIN users  u  ON u.id  = p.user_id
    ORDER BY d.created_at DESC
  `);

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
 * @param {string|undefined} userId — omit for admin access
 * @returns {Promise<Object|null>}
 */
const findById = async (id, userId) => {
  let result;

  if (userId) {
    result = await pool.query(`
      SELECT d.id, d.project_id, d.commit_hash, d.status,
             d.container_id, d.container_port, d.logs,
             d.created_at, d.completed_at
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1 AND p.user_id = $2
    `, [id, userId]);
  } else {
    result = await pool.query(`
      SELECT d.id, d.project_id, d.commit_hash, d.status,
             d.container_id, d.container_port, d.logs,
             d.created_at, d.completed_at
      FROM deployments d
      WHERE d.id = $1
    `, [id]);
  }

  return result.rows.length > 0 ? formatDeployment(result.rows[0]) : null;
};

/**
 * Creates a new deployment record with BUILDING status.
 * @param {{ projectId, commitHash }} data
 * @returns {Promise<Object>}
 */
const create = async ({ projectId, commitHash }) => {
  const result = await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, status)
    VALUES ($1, $2, 'BUILDING')
    RETURNING id, project_id, commit_hash, status,
              container_id, container_port, logs,
              created_at, completed_at
  `, [projectId, commitHash || null]);

  return formatDeployment(result.rows[0]);
};

/**
 * Update deployment status, container info, logs, and completed_at.
 * Used by the deployment pipeline after build/start/health-check results.
 *
 * @param {string}   deploymentId
 * @param {Object}   updates
 * @param {string}   updates.status       — 'LIVE' | 'FAILED'
 * @param {string}   [updates.containerId]
 * @param {number}   [updates.containerPort]
 * @param {string}   [updates.logs]
 * @returns {Promise<void>}
 */
const updateDeployment = async (deploymentId, { status, containerId, containerPort, logs }) => {
  await pool.query(`
    UPDATE deployments
    SET status = $1,
        container_id = COALESCE($2, container_id),
        container_port = COALESCE($3, container_port),
        logs = COALESCE($4, logs),
        completed_at = NOW()
    WHERE id = $5
  `, [status, containerId || null, containerPort || null, logs || null, deploymentId]);
};

/**
 * Append logs to an existing deployment record.
 * Used during the async pipeline to progressively update logs.
 *
 * @param {string} deploymentId
 * @param {string} logs
 */
const appendDeploymentLogs = async (deploymentId, logs) => {
  try {
    await pool.query(`
      UPDATE deployments
      SET logs = COALESCE(logs, '') || $1
      WHERE id = $2
    `, [logs, deploymentId]);
  } catch (err) {
    logger.warn(`[DEPLOYMENT] Failed to append logs for ${deploymentId}: ${err.message}`);
  }
};

/**
 * Check whether a BUILDING deployment exists for this project.
 * Used to prevent duplicate deployments.
 *
 * @param {string} projectId
 * @returns {Promise<boolean>}
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
 * Used to preserve the previous LIVE deployment when a new one fails.
 *
 * @param {string} projectId
 * @param {string} [excludeDeploymentId]
 * @returns {Promise<Object|null>}
 */
const findPreviousLiveDeployment = async (projectId, excludeDeploymentId) => {
  const result = await pool.query(`
    SELECT id, container_id, container_port
    FROM deployments
    WHERE project_id = $1
      AND status = 'LIVE'
      AND ($2::uuid IS NULL OR id != $2::uuid)
    ORDER BY completed_at DESC
    LIMIT 1
  `, [projectId, excludeDeploymentId || null]);

  return result.rows[0] || null;
};

// ─── Formatter ────────────────────────────────────────────────────────────────

/** Convert snake_case DB row to camelCase JS object. */
const formatDeployment = (row) => ({
  id:            row.id,
  projectId:     row.project_id,
  commitHash:    row.commit_hash,
  status:        row.status,
  containerId:   row.container_id,
  containerPort: row.container_port,
  logs:          row.logs,
  createdAt:     row.created_at,
  completedAt:   row.completed_at,
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
};
