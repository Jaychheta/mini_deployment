/**
 * github.service.js — GitHub OAuth & Repository Management with Hardened Security.
 *
 * Security Protections:
 *   1. Tokens are encrypted at rest using AES-256-GCM before saving to PostgreSQL.
 *   2. OAuth state values are short-lived, cryptographically secure random bytes stored server-side.
 *   3. Tokens are NEVER returned to the frontend or exposed in API responses.
 *   4. Backend verifies repository access via GitHub API before initiating deployments.
 */

const https   = require('https');
const pool    = require('../db/pool');
const { encrypt, decrypt, generateOAuthState } = require('../utils/crypto.util');

// ─── OAuth State Security ─────────────────────────────────────────────────────

/**
 * Create a short-lived (10-min), cryptographically secure random OAuth state for a user.
 * Stored in PostgreSQL `oauth_states` table.
 *
 * @param {string} userId — Mini Deploy User UUID
 * @returns {Promise<string>} 64-char hex state
 */
const createOAuthState = async (userId) => {
  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

  // Clean old expired states for this user
  await pool.query('DELETE FROM oauth_states WHERE user_id = $1 OR expires_at < NOW()', [userId]);

  await pool.query(
    `INSERT INTO oauth_states (state, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [state, userId, expiresAt]
  );

  return state;
};

/**
 * Validate and immediately invalidate (consume) an OAuth state parameter.
 * Rejects missing, invalid, or expired states.
 *
 * @param {string} state
 * @returns {Promise<{ valid: boolean, userId: string|null }>}
 */
const validateAndConsumeOAuthState = async (state) => {
  if (!state || typeof state !== 'string') {
    return { valid: false, userId: null };
  }

  const result = await pool.query(
    `SELECT user_id, expires_at FROM oauth_states WHERE state = $1`,
    [state]
  );

  if (result.rows.length === 0) {
    return { valid: false, userId: null };
  }

  const row = result.rows[0];

  // Immediately delete the used state to prevent replay attacks
  await pool.query(`DELETE FROM oauth_states WHERE state = $1`, [state]);

  if (new Date(row.expires_at) < new Date()) {
    return { valid: false, userId: null };
  }

  return { valid: true, userId: row.user_id };
};

// ─── OAuth URL ────────────────────────────────────────────────────────────────

/**
 * Build the GitHub OAuth authorization URL using a secure random state.
 *
 * @param {string} state — Random 64-char hex state string
 * @returns {string} GitHub OAuth redirect URL
 */
const getGithubAuthUrl = (state) => {
  const client_id = process.env.GITHUB_CLIENT_ID;
  const redirect_uri = process.env.GITHUB_CALLBACK_URL;

  if (!client_id) {
    throw new Error('GITHUB_CLIENT_ID is not configured.');
  }

  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    scope: 'read:user repo',
    state,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
};

// ─── Token Exchange ───────────────────────────────────────────────────────────

/**
 * Exchange a GitHub authorization code for an access token.
 * Called from the callback route after GitHub redirects the user back.
 *
 * @param {string} code — the code GitHub sends to the callback URL
 * @returns {Promise<string>} plaintext access_token
 */
const exchangeCodeForToken = (code) => {
  return new Promise((resolve, reject) => {
    const client_id = process.env.GITHUB_CLIENT_ID;
    const client_secret = process.env.GITHUB_CLIENT_SECRET;
    const redirect_uri = process.env.GITHUB_CALLBACK_URL;

    if (!client_id || !client_secret) {
      return reject(new Error('GitHub OAuth credentials are not configured.'));
    }

    const body = JSON.stringify({
      client_id,
      client_secret,
      code,
      redirect_uri,
    });

    const options = {
      hostname: 'github.com',
      path:     '/login/oauth/access_token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error_description || parsed.error));
          } else if (!parsed.access_token) {
            reject(new Error('No access token received from GitHub.'));
          } else {
            resolve(parsed.access_token);
          }
        } catch {
          reject(new Error('Failed to parse GitHub token response.'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

// ─── GitHub API Helper ────────────────────────────────────────────────────────

const githubApiGet = (path, token) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method:   'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
        'User-Agent':    'mini-deploy-platform',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || `GitHub API error: ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('Failed to parse GitHub API response.'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

// ─── GitHub User & Repos ─────────────────────────────────────────────────────

const getGithubUser = async (token) => {
  const data = await githubApiGet('/user', token);
  return { id: String(data.id), login: data.login };
};

/**
 * Fetch the user's public and authorized private repositories from GitHub API.
 * Returns safe metadata fields only — NEVER exposes tokens or client secrets.
 */
const getGithubRepos = async (token) => {
  const repos = await githubApiGet('/user/repos?per_page=100&sort=updated&type=all', token);

  return repos.map((repo) => ({
    id:            repo.id,
    name:          repo.name,
    fullName:      repo.full_name,
    url:           repo.html_url,
    defaultBranch: repo.default_branch || 'main',
    private:       repo.private,
    description:   repo.description || '',
  }));
};

/**
 * Verify that a repository is still accessible via the stored GitHub token.
 * Prevents deployment of revoked or deleted repositories.
 *
 * @param {string} token          — Decrypted GitHub access token
 * @param {string} repositoryUrl  — e.g. "https://github.com/username/repo"
 * @returns {Promise<boolean>}
 */
const verifyRepoAccess = async (token, repositoryUrl) => {
  const match = repositoryUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) return false;

  const repoPath = match[1];
  try {
    const data = await githubApiGet(`/repos/${repoPath}`, token);
    return !!data && !!data.id;
  } catch (err) {
    return false;
  }
};

// ─── Database Operations ──────────────────────────────────────────────────────

/**
 * Encrypt and store GitHub connection details in PostgreSQL users table.
 *
 * @param {string} userId
 * @param {{ githubId, githubUsername, accessToken }} data
 */
const saveGithubConnection = async (userId, { githubId, githubUsername, accessToken }) => {
  const encryptedToken = encrypt(accessToken);

  // Unlink this GitHub account from any old user record first
  await pool.query(
    `UPDATE users
     SET github_id = NULL, github_username = NULL, github_access_token = NULL
     WHERE github_id = $1 AND id != $2`,
    [String(githubId), userId]
  );

  await pool.query(
    `UPDATE users
     SET github_id = $1, github_username = $2, github_access_token = $3
     WHERE id = $4`,
    [String(githubId), githubUsername, encryptedToken, userId]
  );
};

const clearGithubConnection = async (userId) => {
  await pool.query(
    `UPDATE users
     SET github_id = NULL, github_username = NULL, github_access_token = NULL
     WHERE id = $1`,
    [userId]
  );
};

const getConnectionStatus = async (userId) => {
  const result = await pool.query(
    'SELECT github_id, github_username FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return { connected: false, username: null };
  }

  const user = result.rows[0];
  return {
    connected: !!user.github_id,
    username:  user.github_username || null,
  };
};

/**
 * Retrieve and decrypt the stored GitHub access token for a user.
 * Used ONLY internally on the backend.
 *
 * @param {string} userId
 * @returns {Promise<string|null>} Decrypted token
 */
const getAccessToken = async (userId) => {
  const result = await pool.query(
    'SELECT github_access_token FROM users WHERE id = $1',
    [userId]
  );

  const rawToken = result.rows[0]?.github_access_token || null;
  if (!rawToken) return null;

  return decrypt(rawToken);
};

const getLatestCommitSha = async (token, repositoryUrl, branch) => {
  const match = repositoryUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Cannot parse repository URL: ${repositoryUrl}`);
  }
  const repoPath = match[1];

  const data = await githubApiGet(
    `/repos/${repoPath}/commits/${encodeURIComponent(branch)}`,
    token
  );

  if (!data.sha) {
    throw new Error(`No commit SHA found for branch "${branch}" in repository "${repoPath}"`);
  }

  return data.sha;
};

module.exports = {
  createOAuthState,
  validateAndConsumeOAuthState,
  getGithubAuthUrl,
  exchangeCodeForToken,
  getGithubUser,
  getGithubRepos,
  verifyRepoAccess,
  saveGithubConnection,
  clearGithubConnection,
  getConnectionStatus,
  getAccessToken,
  getLatestCommitSha,
};
