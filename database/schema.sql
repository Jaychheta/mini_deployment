-- =============================================================================
-- Mini Deploy Platform — PostgreSQL Schema (Phase 3)
-- =============================================================================
-- Database: mini_deploy
-- Run via: psql -U postgres -d mini_deploy -f schema.sql
--
-- Tables:
--   users            — platform accounts (email/password + optional GitHub)
--   projects         — GitHub repositories selected for deployment
--   deployments      — individual deployment attempts per project (Phase 4)
--   resource_metrics — CPU/memory snapshots per deployment (Phase 6)
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- USERS
-- Stores platform accounts created via email/password signup.
-- GitHub OAuth fields are added when a user connects their GitHub account.
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(200) NOT NULL,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       TEXT         NOT NULL,
    role                VARCHAR(10)  NOT NULL DEFAULT 'USER'
                            CHECK (role IN ('USER', 'ADMIN')),

    -- GitHub OAuth fields (nullable — filled when user connects GitHub)
    github_id           VARCHAR(50)  UNIQUE,
    github_username     VARCHAR(100),
    github_access_token TEXT,        -- stored server-side only, NEVER sent to frontend

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- PROJECTS
-- Each project maps to one GitHub repository chosen by the user.
-- One user can own many projects (1:N).
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id                    UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                  VARCHAR(100) NOT NULL,
    repository_name       VARCHAR(200) NOT NULL,   -- e.g. "portfolio"
    repository_url        TEXT         NOT NULL,   -- e.g. "https://github.com/jay/portfolio"
    branch                VARCHAR(100) NOT NULL DEFAULT 'main',
    github_repository_id  VARCHAR(50),             -- GitHub's numeric repo ID

    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- =============================================================================
-- DEPLOYMENTS
-- Each deployment is one attempt to build and run a project.
-- One project can have many deployments (1:N).
-- Phase 3: records exist but Docker build is NOT triggered yet.
-- =============================================================================
CREATE TABLE IF NOT EXISTS deployments (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_hash     VARCHAR(40),
    status          VARCHAR(10)  NOT NULL DEFAULT 'BUILDING'
                        CHECK (status IN ('BUILDING', 'LIVE', 'FAILED', 'STOPPED')),
    container_id    VARCHAR(100),  -- Docker container ID (Phase 4)
    container_port  INTEGER,       -- Port assigned to container (Phase 4)
    logs            TEXT,          -- Build output (Phase 4)

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ             -- NULL until build completes or fails
);

CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);

-- =============================================================================
-- RESOURCE_METRICS
-- CPU/memory snapshots per running container (Phase 6).
-- =============================================================================
CREATE TABLE IF NOT EXISTS resource_metrics (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id   UUID         NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    cpu_usage       NUMERIC(6, 2),   -- percentage e.g. 34.50
    memory_usage    NUMERIC(10, 2),  -- MB e.g. 128.00
    estimated_cost  NUMERIC(10, 6),  -- USD
    recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_deployment_id ON resource_metrics(deployment_id);
