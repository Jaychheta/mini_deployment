/**
 * deployment.model.js — Deployment data model definition.
 *
 * Phase 1: Documents the expected shape of a deployment object.
 * Phase 3: Extended with Docker build pipeline integration.
 *
 * Reflects the `deployments` PostgreSQL table defined in database/schema.sql.
 */

/**
 * @typedef {Object} Deployment
 * @property {string}      id             - UUID primary key
 * @property {string}      projectId      - FK → projects.id
 * @property {string}      commitHash     - Git commit SHA (short or full)
 * @property {string}      commitMessage  - Git commit message
 * @property {string}      branch         - Git branch name
 * @property {'BUILDING'|'LIVE'|'FAILED'} status - Deployment status
 * @property {string[]}    logs           - Build log lines (Phase 3: streamed via Socket.io)
 * @property {string|null} deploymentUrl  - Live URL (Phase 4: set by Nginx)
 * @property {string}      createdAt      - ISO 8601 creation timestamp
 * @property {string|null} finishedAt     - ISO 8601 build completion timestamp
 */

module.exports = {};
