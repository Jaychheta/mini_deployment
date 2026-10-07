/**
 * webhook.service.js — GitHub Webhook Signature Verification, Delivery Deduplication & Event Handling.
 *
 * Requirements:
 *   1. HMAC SHA-256 signature verification using crypto.timingSafeEqual (raw body).
 *   2. Support X-GitHub-Event: push events only (ignores star, issue, pull_request, etc.).
 *   3. Delivery deduplication using X-GitHub-Delivery header (github_delivery_id).
 *   4. Exact project & branch matching.
 *   5. Automatic deployment triggering without blocking GitHub HTTP webhook response.
 */

const crypto = require('crypto');
const pool   = require('../db/pool');
const logger = require('../utils/logger.util');
const githubService     = require('./github.service');
const deploymentService = require('./deployment.service');
const pipelineService   = require('./pipeline.service');

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || 'minideploy-webhook-secret-change-in-production';
const WEBHOOK_BASE_URL      = process.env.WEBHOOK_BASE_URL      || process.env.FRONTEND_URL || 'http://localhost:3001';

/**
 * Verify GitHub HMAC SHA-256 signature using timing-safe comparison.
 *
 * @param {Buffer|string} rawBody         — Original raw HTTP request body
 * @param {string}        signatureHeader — Value of X-Hub-Signature-256 header (sha256=...)
 * @returns {boolean} True if signature is valid
 */
const verifyWebhookSignature = (rawBody, signatureHeader) => {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = signatureHeader.slice(7); // strip 'sha256='
  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const calculatedSignature = hmac.digest('hex');

  const expectedBuf   = Buffer.from(expectedSignature, 'hex');
  const calculatedBuf = Buffer.from(calculatedSignature, 'hex');

  if (expectedBuf.length !== calculatedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, calculatedBuf);
};

/**
 * Handle incoming GitHub Push event.
 *
 * @param {string} deliveryId — Value of X-GitHub-Delivery header
 * @param {Object} payload    — Parsed JSON payload
 * @returns {Promise<{ status: string, message: string, deploymentId?: string }>}
 */
const processPushWebhook = async (deliveryId, payload) => {
  const repo = payload.repository;
  if (!repo) {
    return { status: 'ignored', message: 'No repository information in payload' };
  }

  const githubRepoId   = String(repo.id);
  const repoFullName   = repo.full_name; // e.g. "user/repo"
  const repoHtmlUrl    = repo.html_url;  // e.g. "https://github.com/user/repo"
  const ref            = payload.ref || ''; // e.g. "refs/heads/main"
  const commitSha      = payload.after;
  const branch         = ref.replace(/^refs\/heads\//, '') || repo.default_branch || 'main';

  logger.info(`[WEBHOOK] Push received: ${repoFullName} (branch: ${branch}, commit: ${commitSha ? commitSha.slice(0, 7) : 'none'})`);

  // Ignore pushes with zero commit SHA (e.g. branch deletion)
  if (!commitSha || commitSha === '0000000000000000000000000000000000000000') {
    return { status: 'ignored', message: 'Branch deletion or empty commit ref ignored' };
  }

  // Deduplication check: Has this X-GitHub-Delivery ID already been processed?
  if (deliveryId) {
    const existingDelivery = await pool.query(
      'SELECT id FROM deployments WHERE github_delivery_id = $1 LIMIT 1',
      [deliveryId]
    );
    if (existingDelivery.rows.length > 0) {
      logger.info(`[WEBHOOK] Duplicate delivery ${deliveryId} ignored.`);
      return { status: 'ignored', message: 'Duplicate webhook delivery already processed' };
    }
  }

  // Match against stored project in PostgreSQL by github_repository_id or repository_url
  const matchingProjects = await pool.query(
    `SELECT p.id, p.user_id, p.name, p.branch, p.repository_url
     FROM projects p
     WHERE (p.github_repository_id = $1 OR p.repository_url ILIKE $2 OR p.repository_url ILIKE $3)
       AND (p.branch = $4 OR p.branch = 'main' OR p.branch = 'master')`,
    [
      githubRepoId,
      `%github.com/${repoFullName}%`,
      `%github.com/${repoFullName}.git`,
      branch,
    ]
  );

  if (matchingProjects.rows.length === 0) {
    logger.info(`[WEBHOOK] No project matching repository ${repoFullName} (branch ${branch}) found.`);
    return { status: 'ignored', message: 'No configured project found matching this repository and branch' };
  }

  const project = matchingProjects.rows[0];

  // Deduplication check: Is the same commit SHA already BUILDING or LIVE for this project?
  const existingCommit = await pool.query(
    `SELECT id FROM deployments WHERE project_id = $1 AND commit_hash = $2 AND status = 'LIVE' LIMIT 1`,
    [project.id, commitSha]
  );
  if (existingCommit.rows.length > 0) {
    logger.info(`[WEBHOOK] Commit ${commitSha.slice(0, 7)} is already LIVE for project ${project.name}.`);
    return { status: 'ignored', message: 'Commit is already deployed and live' };
  }

  // Create new deployment record with status = BUILDING and source = WEBHOOK
  const deploymentResult = await pool.query(
    `INSERT INTO deployments (project_id, commit_hash, status, deployment_source, github_delivery_id)
     VALUES ($1, $2, 'BUILDING', 'WEBHOOK', $3)
     RETURNING id`,
    [project.id, commitSha, deliveryId || null]
  );

  const deploymentId = deploymentResult.rows[0].id;
  logger.info(`[WEBHOOK] Deployment ${deploymentId.slice(0, 8)} created via webhook push for project ${project.name}`);

  // Trigger deployment pipeline asynchronously — DO NOT block HTTP response
  setImmediate(() => {
    pipelineService.runDeploymentPipeline(deploymentId, project.id, project.user_id);
  });

  return {
    status: 'accepted',
    message: 'Automatic deployment initiated from GitHub push event',
    deploymentId,
    projectId: project.id,
  };
};

/**
 * Register a GitHub webhook on the GitHub repository using the user's OAuth access token.
 *
 * @param {string} userId
 * @param {string} repositoryUrl  — e.g. "https://github.com/user/repo"
 * @returns {Promise<{ registered: boolean, webhookId?: string }>}
 */
const registerGithubWebhook = async (userId, repositoryUrl) => {
  try {
    const token = await githubService.getAccessToken(userId);
    if (!token) return { registered: false, reason: 'GitHub token not connected' };

    const match = repositoryUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (!match) return { registered: false, reason: 'Invalid GitHub URL' };

    const repoPath = match[1];
    const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhooks/github`;

    // 1. Check if hook already exists
    const existingHooks = await githubService.githubApiGet(`/repos/${repoPath}/hooks`, token).catch(() => []);
    if (Array.isArray(existingHooks)) {
      const matchHook = existingHooks.find(h => h.config && h.config.url === webhookUrl);
      if (matchHook) {
        return { registered: true, webhookId: String(matchHook.id) };
      }
    }

    // 2. Create webhook via GitHub API
    const body = JSON.stringify({
      name:   'web',
      active: true,
      events: ['push'],
      config: {
        url:          webhookUrl,
        content_type: 'json',
        secret:       GITHUB_WEBHOOK_SECRET,
        insecure_ssl: '0',
      },
    });

    const createdHook = await new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.request(
        {
          hostname: 'api.github.com',
          path:     `/repos/${repoPath}/hooks`,
          method:   'POST',
          headers: {
            'Authorization':  `Bearer ${token}`,
            'Accept':         'application/vnd.github+json',
            'User-Agent':     'mini-deploy-platform',
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode < 300) resolve(json);
              else reject(new Error(json.message || 'Webhook creation failed'));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return { registered: true, webhookId: String(createdHook.id) };
  } catch (err) {
    logger.warn(`[WEBHOOK] Automatic webhook registration notice: ${err.message}`);
    return { registered: false, reason: err.message };
  }
};

module.exports = {
  verifyWebhookSignature,
  processPushWebhook,
  registerGithubWebhook,
};
