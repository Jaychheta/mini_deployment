/**
 * github.service.js — GitHub OAuth business logic.
 *
 * Handles the GitHub OAuth flow:
 *   1. Build the GitHub authorization URL
 *   2. Exchange authorization code for an access token
 *   3. Fetch GitHub user info using the token
 *   4. Save/clear GitHub connection in the database
 *   5. Fetch the user's repositories
 *
 * SECURITY:
 *   - GITHUB_CLIENT_SECRET is used only server-side
 *   - github_access_token is stored in the DB but NEVER sent to the frontend
 *   - GitHub API calls are made from the backend
 */

const https = require('https');
const pool  = require('../db/pool');

// env variables accessed dynamically below to avoid stale cached values during live configuration changes

// ─── OAuth URL ────────────────────────────────────────────────────────────────

/**
 * Build the GitHub OAuth authorization URL.
 * The user is redirected here to approve the connection.
 */
const getGithubAuthUrl = () => {
  const client_id = process.env.GITHUB_CLIENT_ID;
  const redirect_uri = process.env.GITHUB_CALLBACK_URL;

  if (!client_id) {
    throw new Error('GITHUB_CLIENT_ID is not configured.');
  }

  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    scope:        'read:user repo',
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
};

// ─── Token Exchange ───────────────────────────────────────────────────────────

/**
 * Exchange a GitHub authorization code for an access token.
 * Called from the callback route after GitHub redirects the user back.
 * @param {string} code — the code GitHub sends to the callback URL
 * @returns {Promise<string>} access_token
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
        'Content-Type':  'application/json',
        'Accept':        'application/json',
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

/**
 * Make an authenticated GET request to the GitHub API.
 * @param {string} path — e.g. '/user' or '/user/repos?per_page=100'
 * @param {string} token — GitHub access token
 * @returns {Promise<any>} parsed JSON response
 */
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

/**
 * Fetch the authenticated GitHub user's basic profile.
 * @param {string} token
 * @returns {Promise<{ id, login }>}
 */
const getGithubUser = async (token) => {
  const data = await githubApiGet('/user', token);
  return { id: String(data.id), login: data.login };
};

/**
 * Fetch the user's repositories from GitHub API.
 * Returns only the fields needed for the repository picker.
 * @param {string} token
 * @returns {Promise<Array>}
 */
const getGithubRepos = async (token) => {
  // Fetch up to 100 repos, sorted by newest update
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

// ─── Database Operations ──────────────────────────────────────────────────────

/**
 * Save GitHub connection details into the users table.
 * Called after successful OAuth callback.
 * @param {string} userId
 * @param {{ githubId, githubUsername, accessToken }} data
 */
const saveGithubConnection = async (userId, { githubId, githubUsername, accessToken }) => {
  // If this GitHub account was previously linked to another user row, unlink it first
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
    [String(githubId), githubUsername, accessToken, userId]
  );
};

/**
 * Clear GitHub connection — removes token and GitHub identity.
 * Existing projects are NOT deleted.
 * @param {string} userId
 */
const clearGithubConnection = async (userId) => {
  await pool.query(
    `UPDATE users
     SET github_id = NULL, github_username = NULL, github_access_token = NULL
     WHERE id = $1`,
    [userId]
  );
};

/**
 * Get the GitHub connection status for a user.
 * Returns connected status and username — NEVER the access token.
 * @param {string} userId
 * @returns {Promise<{ connected: boolean, username: string|null }>}
 */
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
 * Get the stored GitHub access token for a user.
 * Used internally only — NEVER send this to the frontend.
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
const getAccessToken = async (userId) => {
  const result = await pool.query(
    'SELECT github_access_token FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.github_access_token || null;
};

/**
 * Get the latest commit SHA for a branch in a GitHub repository.
 * Uses the GitHub API — requires a valid access token for private repos.
 *
 * @param {string} token          — GitHub access token
 * @param {string} repositoryUrl  — e.g. "https://github.com/username/repo"
 * @param {string} branch         — branch name
 * @returns {Promise<string>} The full 40-character commit SHA
 * @throws {Error} If the GitHub API call fails
 */
const getLatestCommitSha = async (token, repositoryUrl, branch) => {
  // Extract "username/repo" from the URL
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
  getGithubAuthUrl,
  exchangeCodeForToken,
  getGithubUser,
  getGithubRepos,
  saveGithubConnection,
  clearGithubConnection,
  getConnectionStatus,
  getAccessToken,
  getLatestCommitSha,
};
