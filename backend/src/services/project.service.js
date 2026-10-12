/**
 * project.service.js — Business logic layer for projects.
 *
 * Phase 3: Replaced in-memory store with PostgreSQL queries.
 *
 * SECURITY:
 *   - findAll(userId) returns ONLY the specified user's projects
 *   - findById(id, userId) verifies ownership — returns null for other users' projects
 *   - userId always comes from the verified JWT, never from the frontend body
 */

const pool = require('../db/pool');
const { generateHostname } = require('../utils/slug.util');

// ─── Service Methods ──────────────────────────────────────────────────────────

/**
 * Returns projects.
 * If userId is provided, returns only that user's projects.
 * If userId is omitted, returns all projects (admin use only).
 * @param {string|undefined} userId
 * @returns {Promise<Array>}
 */
const findAll = async (userId) => {
  const selectFields = `
    p.id, p.user_id, p.name, p.repository_name, p.repository_url, p.branch,
    p.github_repository_id, p.deployment_slug, p.deployment_hostname, p.active_deployment_id,
    p.access_password, p.created_at,
    d.deployment_url, d.status AS active_deployment_status, d.container_port
  `;

  let query;
  let params = [];

  if (userId) {
    query = `
      SELECT ${selectFields}
      FROM projects p
      LEFT JOIN deployments d ON d.id = p.active_deployment_id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `;
    params = [userId];
  } else {
    // Admin: return all projects
    query = `
      SELECT ${selectFields}
      FROM projects p
      LEFT JOIN deployments d ON d.id = p.active_deployment_id
      ORDER BY p.created_at DESC
    `;
  }

  const result = await pool.query(query, params);
  return result.rows.map(formatProject);
};

/**
 * Returns a single project by ID.
 * If userId is provided, verifies ownership (prevents cross-user access).
 * Returns null if not found OR if userId doesn't match.
 * @param {string} id
 * @param {string|undefined} userId — omit for admin access
 * @returns {Promise<Object|null>}
 */
const findById = async (id, userId) => {
  const selectFields = `
    p.id, p.user_id, p.name, p.repository_name, p.repository_url, p.branch,
    p.github_repository_id, p.deployment_slug, p.deployment_hostname, p.active_deployment_id,
    p.access_password, p.created_at,
    d.deployment_url, d.status AS active_deployment_status, d.container_port
  `;

  let result;

  if (userId) {
    result = await pool.query(
      `SELECT ${selectFields}
       FROM projects p
       LEFT JOIN deployments d ON d.id = p.active_deployment_id
       WHERE p.id = $1 AND p.user_id = $2`,
      [id, userId]
    );
  } else {
    // Admin access — no ownership check
    result = await pool.query(
      `SELECT ${selectFields}
       FROM projects p
       LEFT JOIN deployments d ON d.id = p.active_deployment_id
       WHERE p.id = $1`,
      [id]
    );
  }

  return result.rows.length > 0 ? formatProject(result.rows[0]) : null;
};

/**
 * Creates a new project for a user.
 * Generates safe unique deployment slug and hostname.
 * @param {{ name, repositoryName, repositoryUrl, branch, githubRepositoryId, accessPassword, userId }} data
 * @returns {Promise<Object>}
 */
const create = async ({ name, repositoryName, repositoryUrl, branch, githubRepositoryId, accessPassword, userId }) => {
  // First insert project to generate ID
  const tempResult = await pool.query(
    `INSERT INTO projects
       (user_id, name, repository_name, repository_url, branch, github_repository_id, access_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, name, repositoryName, repositoryUrl, branch || 'main', githubRepositoryId || null, accessPassword || null]
  );

  const projectId = tempResult.rows[0].id;

  // Generate safe deterministic unique hostname
  const { deploymentSlug, hostname } = generateHostname(name, projectId);

  const result = await pool.query(
    `UPDATE projects
     SET deployment_slug = $1, deployment_hostname = $2
     WHERE id = $3
     RETURNING id, user_id, name, repository_name, repository_url, branch,
               github_repository_id, deployment_slug, deployment_hostname,
               active_deployment_id, access_password, created_at`,
    [deploymentSlug, hostname, projectId]
  );

  return formatProject(result.rows[0]);
};

/**
 * Update project's active deployment pointer.
 * @param {string} projectId
 * @param {string} activeDeploymentId
 */
const setActiveDeployment = async (projectId, activeDeploymentId) => {
  await pool.query(
    `UPDATE projects SET active_deployment_id = $1 WHERE id = $2`,
    [activeDeploymentId, projectId]
  );
};

/**
 * Delete a project and return its deployment_slug for Nginx config cleanup.
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
const deleteProject = async (projectId, userId) => {
  let query = `DELETE FROM projects WHERE id = $1`;
  let params = [projectId];

  if (userId) {
    query += ` AND user_id = $2`;
    params.push(userId);
  }

  query += ` RETURNING id, deployment_slug`;

  const result = await pool.query(query, params);
  return result.rows[0] || null;
};

/**
 * Returns all projects with owner info — for admin use only.
 * Joins with users to get owner name/email.
 * @returns {Promise<Array>}
 */
const findAllAdmin = async () => {
  const result = await pool.query(
    `SELECT p.id, p.user_id, p.name, p.repository_name, p.repository_url,
            p.branch, p.github_repository_id, p.deployment_slug, p.deployment_hostname,
            p.active_deployment_id, p.access_password, p.created_at,
            u.name AS owner_name, u.email AS owner_email,
            d.deployment_url, d.status AS active_deployment_status, d.container_port
     FROM projects p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN deployments d ON d.id = p.active_deployment_id
     ORDER BY p.created_at DESC`
  );
  return result.rows.map((row) => ({
    ...formatProject(row),
    ownerName:  row.owner_name,
    ownerEmail: row.owner_email,
  }));
};

// ─── Formatter ────────────────────────────────────────────────────────────────

/** Convert snake_case DB row to camelCase JS object. */
const formatProject = (row) => ({
  id:                     row.id,
  userId:                 row.user_id,
  name:                   row.name,
  repositoryName:         row.repository_name,
  repositoryUrl:          row.repository_url,
  branch:                 row.branch,
  githubRepositoryId:     row.github_repository_id,
  deploymentSlug:         row.deployment_slug,
  deploymentHostname:     row.deployment_hostname,
  activeDeploymentId:     row.active_deployment_id,
  deploymentUrl:          (row.deployment_url && !row.deployment_url.includes('loca.lt')) ? row.deployment_url : (row.container_port ? `http://localhost:${row.container_port}` : null),
  activeDeploymentStatus: row.active_deployment_status || null,
  containerPort:          row.container_port || null,
  accessPassword:         row.access_password || null,
  createdAt:              row.created_at,
});

module.exports = { findAll, findById, create, setActiveDeployment, deleteProject, findAllAdmin };
