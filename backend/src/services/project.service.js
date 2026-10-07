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

// ─── Service Methods ──────────────────────────────────────────────────────────

/**
 * Returns projects.
 * If userId is provided, returns only that user's projects.
 * If userId is omitted, returns all projects (admin use only).
 * @param {string|undefined} userId
 * @returns {Promise<Array>}
 */
const findAll = async (userId) => {
  if (userId) {
    const result = await pool.query(
      `SELECT id, user_id, name, repository_name, repository_url, branch,
              github_repository_id, created_at
       FROM projects
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map(formatProject);
  }

  // Admin: return all projects
  const result = await pool.query(
    `SELECT id, user_id, name, repository_name, repository_url, branch,
            github_repository_id, created_at
     FROM projects
     ORDER BY created_at DESC`
  );
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
  let result;

  if (userId) {
    result = await pool.query(
      `SELECT id, user_id, name, repository_name, repository_url, branch,
              github_repository_id, created_at
       FROM projects
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
  } else {
    // Admin access — no ownership check
    result = await pool.query(
      `SELECT id, user_id, name, repository_name, repository_url, branch,
              github_repository_id, created_at
       FROM projects
       WHERE id = $1`,
      [id]
    );
  }

  return result.rows.length > 0 ? formatProject(result.rows[0]) : null;
};

/**
 * Creates a new project for a user.
 * userId must come from the authenticated JWT — never from the frontend body.
 * @param {{ name, repositoryName, repositoryUrl, branch, githubRepositoryId, userId }} data
 * @returns {Promise<Object>}
 */
const create = async ({ name, repositoryName, repositoryUrl, branch, githubRepositoryId, userId }) => {
  const result = await pool.query(
    `INSERT INTO projects
       (user_id, name, repository_name, repository_url, branch, github_repository_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, name, repository_name, repository_url, branch,
               github_repository_id, created_at`,
    [userId, name, repositoryName, repositoryUrl, branch || 'main', githubRepositoryId || null]
  );
  return formatProject(result.rows[0]);
};

/**
 * Returns all projects with owner info — for admin use only.
 * Joins with users to get owner name/email.
 * @returns {Promise<Array>}
 */
const findAllAdmin = async () => {
  const result = await pool.query(
    `SELECT p.id, p.user_id, p.name, p.repository_name, p.repository_url,
            p.branch, p.github_repository_id, p.created_at,
            u.name AS owner_name, u.email AS owner_email
     FROM projects p
     JOIN users u ON u.id = p.user_id
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
  id:                 row.id,
  userId:             row.user_id,
  name:               row.name,
  repositoryName:     row.repository_name,
  repositoryUrl:      row.repository_url,
  branch:             row.branch,
  githubRepositoryId: row.github_repository_id,
  createdAt:          row.created_at,
});

module.exports = { findAll, findById, create, findAllAdmin };
