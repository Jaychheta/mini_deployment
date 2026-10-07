/**
 * project.model.js — Project data model definition.
 *
 * Phase 1: Documents the expected shape of a project object.
 *          Used as a reference for the in-memory store and future DB schema.
 *
 * Phase 2: This file will be replaced/extended with an ORM model
 *          (e.g., Sequelize or Drizzle) or raw pg query functions.
 *
 * Reflects the `projects` PostgreSQL table defined in database/schema.sql.
 */

/**
 * @typedef {Object} Project
 * @property {string}      id             - UUID primary key
 * @property {string}      name           - Human-readable project name
 * @property {string}      repository     - GitHub repository URL
 * @property {string}      branch         - Target branch to deploy
 * @property {'BUILDING'|'LIVE'|'FAILED'} status - Current deployment status
 * @property {string|null} deploymentUrl  - Live URL (set by Nginx in Phase 4)
 * @property {string}      userId         - Owner user ID (FK → users.id)
 * @property {string}      createdAt      - ISO 8601 creation timestamp
 * @property {string}      updatedAt      - ISO 8601 last-updated timestamp
 */

// Exporting the typedef for use in JSDoc across the codebase.
// No runtime object is needed at this phase.
module.exports = {};
