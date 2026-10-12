/**
 * auth.service.js — Authentication business logic.
 *
 * Phase 3: Replaced in-memory user store with PostgreSQL queries.
 *
 * The default ADMIN account is seeded at startup via db/init.js.
 * All methods use parameterized queries to prevent SQL injection.
 *
 * SECURITY:
 *   - password_hash is NEVER returned to the frontend
 *   - github_access_token is NEVER returned to the frontend
 *   - Role is ALWAYS set to 'USER' on signup — ADMIN is seeded only
 */

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../db/pool');
const { v4: uuidv4 } = require('uuid');
const { encrypt } = require('../utils/crypto.util');

const SALT_ROUNDS = 10;
const JWT_SECRET  = process.env.JWT_SECRET   || 'dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a signed JWT for a user row from the database. */
const generateToken = (user) =>
  jwt.sign(
    {
      id:    user.id,
      email: user.email,
      name:  user.name,
      role:  user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

/**
 * Return a safe public user object — strips sensitive DB columns.
 * NEVER include password_hash or github_access_token.
 */
const safeUser = (row) => ({
  id:              row.id,
  name:            row.name,
  email:           row.email,
  role:            row.role,
  githubUsername:  row.github_username  || null,
  githubConnected: !!row.github_id,
  createdAt:       row.created_at,
});

// ─── Service Methods ──────────────────────────────────────────────────────────

/**
 * Register a new user.
 * Role is ALWAYS 'USER' — admin accounts are seeded via db/init.js.
 * @param {{ name, email, password }} data
 * @returns {{ user, token }}
 */
const signup = async ({ name, email, password }) => {
  // Check for existing account (case-insensitive)
  const existing = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  if (existing.rows.length > 0) {
    throw new Error('An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'USER')
     RETURNING id, name, email, role, github_id, github_username, created_at`,
    [name, email.toLowerCase(), passwordHash]
  );

  const newUser = result.rows[0];
  return { user: safeUser(newUser), token: generateToken(newUser) };
};

/**
 * Authenticate an existing user.
 * @param {{ email, password }} data
 * @returns {{ user, token }}
 */
const login = async ({ email, password }) => {
  const result = await pool.query(
    `SELECT id, name, email, password_hash, role, github_id, github_username, created_at
     FROM users
     WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  const user = result.rows[0];
  if (!user) throw new Error('Invalid email or password.');

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw new Error('Invalid email or password.');

  return { user: safeUser(user), token: generateToken(user) };
};

/**
 * Authenticate or register a user via GitHub OAuth.
 * @param {Object} githubUser
 * @param {string} accessToken
 */
const githubAuth = async (githubUser, accessToken) => {
  if (!githubUser.email) {
    throw new Error('Your GitHub account does not have a public email address. Please make it public or use email/password login.');
  }

  const email = githubUser.email.toLowerCase();
  const encryptedToken = encrypt(accessToken);
  const strGithubId = String(githubUser.id);

  let user = null;

  // 1. Try to find user by GitHub ID first (best match)
  const byGithub = await pool.query('SELECT * FROM users WHERE github_id = $1', [strGithubId]);
  
  if (byGithub.rows.length > 0) {
    user = byGithub.rows[0];
    // Update token and username
    await pool.query(
      `UPDATE users SET github_username = $1, github_access_token = $2 WHERE id = $3`,
      [githubUser.login, encryptedToken, user.id]
    );
    user.github_username = githubUser.login;
  } else {
    // 2. Fallback to finding by email
    const byEmail = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    
    if (byEmail.rows.length > 0) {
      user = byEmail.rows[0];
      // Unlink github_id from any other user just in case
      await pool.query(
        `UPDATE users SET github_id = NULL, github_username = NULL, github_access_token = NULL WHERE github_id = $1`,
        [strGithubId]
      );
      // Link to this user
      await pool.query(
        `UPDATE users SET github_id = $1, github_username = $2, github_access_token = $3 WHERE id = $4`,
        [strGithubId, githubUser.login, encryptedToken, user.id]
      );
      user.github_id = strGithubId;
      user.github_username = githubUser.login;
    } else {
      // 3. Create new user
      // Unlink github_id from any other user just in case
      await pool.query(
        `UPDATE users SET github_id = NULL, github_username = NULL, github_access_token = NULL WHERE github_id = $1`,
        [strGithubId]
      );

      const passwordHash = await bcrypt.hash(uuidv4(), SALT_ROUNDS);
      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, github_id, github_username, github_access_token)
         VALUES ($1, $2, $3, 'USER', $4, $5, $6)
         RETURNING *`,
        [githubUser.name || githubUser.login, email, passwordHash, strGithubId, githubUser.login, encryptedToken]
      );
      user = result.rows[0];
    }
  }

  return { user: safeUser(user), token: generateToken(user) };
};

/**
 * Look up a user by ID (safe — no password hash or tokens).
 * @param {string} id
 * @returns {Object|null}
 */
const findById = async (id) => {
  const result = await pool.query(
    `SELECT id, name, email, role, github_id, github_username, created_at
     FROM users
     WHERE id = $1`,
    [id]
  );
  return result.rows.length > 0 ? safeUser(result.rows[0]) : null;
};

/**
 * Return all users (safe — no password hashes or tokens).
 * Used by admin only.
 * @returns {Array}
 */
const findAll = async () => {
  const result = await pool.query(
    `SELECT id, name, email, role, github_id, github_username, created_at
     FROM users
     ORDER BY created_at ASC`
  );
  return result.rows.map(safeUser);
};

module.exports = { signup, login, findById, findAll, githubAuth };
