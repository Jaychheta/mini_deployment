/**
 * init.js — Database initializer.
 *
 * Called once at server startup. Performs two tasks:
 *   1. Creates all tables if they don't exist (idempotent).
 *   2. Seeds the default ADMIN account if it doesn't exist.
 *
 * This means you never need to manually run schema.sql in development —
 * starting the server is enough.
 */

const pool   = require('./pool');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

// ─── SQL to create all Phase 3 tables ─────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  CREATE TABLE IF NOT EXISTS users (
    id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(200) NOT NULL,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       TEXT         NOT NULL,
    role                VARCHAR(10)  NOT NULL DEFAULT 'USER'
                            CHECK (role IN ('USER', 'ADMIN')),
    github_id           VARCHAR(50)  UNIQUE,
    github_username     VARCHAR(100),
    github_access_token TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS projects (
    id                    UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                  VARCHAR(100) NOT NULL,
    repository_name       VARCHAR(200) NOT NULL,
    repository_url        TEXT         NOT NULL,
    branch                VARCHAR(100) NOT NULL DEFAULT 'main',
    github_repository_id  VARCHAR(50),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

  CREATE TABLE IF NOT EXISTS deployments (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_hash     VARCHAR(40),
    status          VARCHAR(10)  NOT NULL DEFAULT 'BUILDING'
                        CHECK (status IN ('BUILDING', 'LIVE', 'FAILED', 'STOPPED')),
    container_id    VARCHAR(100),
    container_port  INTEGER,
    logs            TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);

  CREATE TABLE IF NOT EXISTS resource_metrics (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id   UUID         NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    cpu_usage       NUMERIC(6, 2),
    memory_usage    NUMERIC(10, 2),
    estimated_cost  NUMERIC(10, 6),
    recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_deployment_id ON resource_metrics(deployment_id);
`;

// ─── Seed the default ADMIN account ──────────────────────────────────────────

const ADMIN_EMAIL    = 'admin@minideploy.com';
const ADMIN_PASSWORD = 'Admin@123';
const ADMIN_NAME     = 'Admin';

const seedAdmin = async () => {
  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [ADMIN_EMAIL]
  );

  if (existing.rows.length > 0) {
    // Admin already exists — nothing to do
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'ADMIN')`,
    [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
  );

  console.log('   ✔  Default admin account created (admin@minideploy.com)');
};

// ─── Main init function ───────────────────────────────────────────────────────

const initDatabase = async () => {
  try {
    // Verify connection
    await pool.query('SELECT 1');
    console.log('   ✔  PostgreSQL connected (mini_deploy)');

    // Create tables
    await pool.query(CREATE_TABLES_SQL);
    console.log('   ✔  Database tables ready');

    // Seed admin
    await seedAdmin();
  } catch (err) {
    console.error('\n❌  Database initialization failed:', err.message);
    console.error('   Make sure DATABASE_URL is correct and mini_deploy database exists.\n');
    process.exit(1);
  }
};

module.exports = { initDatabase };
