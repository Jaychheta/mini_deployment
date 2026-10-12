/**
 * init.js — Database initializer.
 *
 * Called once at server startup. Performs three tasks:
 *   1. Creates all tables if they don't exist (idempotent).
 *   2. Safely applies Phase 5 migration columns (webhook_id, deployment_source, github_delivery_id).
 *   3. Seeds the default ADMIN account if it doesn't exist.
 */

const pool   = require('./pool');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

// ─── SQL to create all tables ─────────────────────────────────────────

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
    webhook_id            VARCHAR(100),
    webhook_active        BOOLEAN      NOT NULL DEFAULT false,
    deployment_slug       VARCHAR(100),
    deployment_hostname   VARCHAR(255),
    active_deployment_id  UUID,
    access_password       TEXT,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_projects_github_repo_id ON projects(github_repository_id);

  CREATE TABLE IF NOT EXISTS deployments (
    id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_hash         VARCHAR(40),
    status              VARCHAR(10)  NOT NULL DEFAULT 'BUILDING'
                            CHECK (status IN ('BUILDING', 'LIVE', 'FAILED', 'STOPPED')),
    container_id        VARCHAR(100),
    container_port      INTEGER,
    deployment_url      TEXT,
    hostname            VARCHAR(255),
    nginx_config_path   TEXT,
    logs                TEXT,
    deployment_source   VARCHAR(20)  NOT NULL DEFAULT 'MANUAL',
    github_delivery_id  VARCHAR(100),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);

  CREATE TABLE IF NOT EXISTS resource_metrics (
    id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id     UUID         NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    project_id        UUID         REFERENCES projects(id) ON DELETE CASCADE,
    container_id      VARCHAR(100),
    cpu_usage         NUMERIC(6, 2),
    memory_usage      NUMERIC(14, 2),
    memory_limit      NUMERIC(14, 2),
    memory_percent    NUMERIC(6, 2),
    network_rx_bytes  BIGINT       DEFAULT 0,
    network_tx_bytes  BIGINT       DEFAULT 0,
    container_state   VARCHAR(50)  DEFAULT 'running',
    estimated_cost    NUMERIC(10, 6),
    recorded_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_deployment_id ON resource_metrics(deployment_id);

  CREATE TABLE IF NOT EXISTS oauth_states (
    state       VARCHAR(100) PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_oauth_states_user_id ON oauth_states(user_id);
`;

// ─── Phase 5, 6 & 7 Safe Migrations ──────────────────────────────────────────

const runMigrations = async () => {
  await pool.query(`
    DO $$
    BEGIN
      -- Phase 5 Columns
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='webhook_id') THEN
        ALTER TABLE projects ADD COLUMN webhook_id VARCHAR(100);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='webhook_active') THEN
        ALTER TABLE projects ADD COLUMN webhook_active BOOLEAN NOT NULL DEFAULT false;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='deployment_source') THEN
        ALTER TABLE deployments ADD COLUMN deployment_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='github_delivery_id') THEN
        ALTER TABLE deployments ADD COLUMN github_delivery_id VARCHAR(100);
      END IF;

      -- Phase 6 Columns
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='deployment_slug') THEN
        ALTER TABLE projects ADD COLUMN deployment_slug VARCHAR(100);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='deployment_hostname') THEN
        ALTER TABLE projects ADD COLUMN deployment_hostname VARCHAR(255);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='active_deployment_id') THEN
        ALTER TABLE projects ADD COLUMN active_deployment_id UUID;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='deployment_url') THEN
        ALTER TABLE deployments ADD COLUMN deployment_url TEXT;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='hostname') THEN
        ALTER TABLE deployments ADD COLUMN hostname VARCHAR(255);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='nginx_config_path') THEN
        ALTER TABLE deployments ADD COLUMN nginx_config_path TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='access_password') THEN
        ALTER TABLE projects ADD COLUMN access_password TEXT;
      END IF;

      -- Phase 7 Columns (Resource Monitoring)
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='project_id') THEN
        ALTER TABLE resource_metrics ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='container_id') THEN
        ALTER TABLE resource_metrics ADD COLUMN container_id VARCHAR(100);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='memory_limit') THEN
        ALTER TABLE resource_metrics ADD COLUMN memory_limit NUMERIC(14, 2);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='memory_percent') THEN
        ALTER TABLE resource_metrics ADD COLUMN memory_percent NUMERIC(6, 2);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='network_rx_bytes') THEN
        ALTER TABLE resource_metrics ADD COLUMN network_rx_bytes BIGINT DEFAULT 0;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='network_tx_bytes') THEN
        ALTER TABLE resource_metrics ADD COLUMN network_tx_bytes BIGINT DEFAULT 0;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='container_state') THEN
        ALTER TABLE resource_metrics ADD COLUMN container_state VARCHAR(50) DEFAULT 'running';
      END IF;

      -- Phase 8 Columns (Redeploy, Rollback & Detailed History)
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='commit_message') THEN
        ALTER TABLE deployments ADD COLUMN commit_message TEXT;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='rollback_from_deployment_id') THEN
        ALTER TABLE deployments ADD COLUMN rollback_from_deployment_id UUID REFERENCES deployments(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='redeploy_from_deployment_id') THEN
        ALTER TABLE deployments ADD COLUMN redeploy_from_deployment_id UUID REFERENCES deployments(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deployments' AND column_name='error_message') THEN
        ALTER TABLE deployments ADD COLUMN error_message TEXT;
      END IF;
    END $$;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deployments_delivery_id ON deployments(github_delivery_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deployments_source ON deployments(deployment_source);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_metrics_deployment_recorded ON resource_metrics(deployment_id, recorded_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_metrics_project_id ON resource_metrics(project_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_metrics_recorded_at ON resource_metrics(recorded_at);`);

  // Sanitize legacy or broken localtunnel URLs to reliable direct container ports
  await pool.query(`
    UPDATE deployments 
    SET deployment_url = 'http://localhost:' || container_port 
    WHERE (deployment_url LIKE '%loca.lt%' OR deployment_url IS NULL)
      AND container_port IS NOT NULL;
  `);
};

// ─── Seed default ADMIN account ──────────────────────────────────────────

const ADMIN_EMAIL    = 'admin@minideploy.com';
const ADMIN_PASSWORD = 'Admin@123';
const ADMIN_NAME     = 'Admin';

const seedAdmin = async () => {
  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [ADMIN_EMAIL]
  );

  if (existing.rows.length > 0) {
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
    await pool.query('SELECT 1');
    console.log('   ✔  PostgreSQL connected (mini_deploy)');

    await pool.query(CREATE_TABLES_SQL);
    await runMigrations();
    console.log('   ✔  Database tables ready');

    await seedAdmin();
  } catch (err) {
    console.error('   ❌  Database initialization failed:', err.message);
    process.exit(1);
  }
};

module.exports = { initDatabase };
