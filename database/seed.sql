-- =============================================================================
-- Mini Deploy Platform — Seed Data (Development Only)
-- =============================================================================
-- Inserts example rows so the database has data to display immediately.
-- Run AFTER schema.sql.
--
-- Usage:
--   psql -U postgres -d mini_deploy -f seed.sql
-- =============================================================================

-- Example user (will be replaced by real GitHub OAuth in Phase 2)
INSERT INTO users (
    id,
    name,
    email,
    password_hash,
    role,
    github_id,
    github_username
)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Dev User',
    'devuser@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6ZqJ1ZJ8Y5bXK0zF8p0b1jG8Yzq2K',
    'USER',
    '12345678',
    'devuser'
)
ON CONFLICT DO NOTHING;


-- Example projects
INSERT INTO projects (
    id, user_id, name, repository_name, repository_url, branch
)
VALUES
(
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'my-react-app',
    'my-react-app',
    'https://github.com/devuser/my-react-app',
    'main'
),
(
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'api-service',
    'api-service',
    'https://github.com/devuser/api-service',
    'develop'
)
ON CONFLICT DO NOTHING;

-- Example deployments
INSERT INTO deployments (
    id, project_id, commit_hash, commit_message, status
)
VALUES
(
    'c0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'a1b2c3d',
    'feat: initial setup',
    'LIVE'
),
(
    'c0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    'e4f5g6h',
    'fix: correct build script',
    'FAILED'
),
(
    'c0000000-0000-0000-0000-000000000003',
    'b0000000-0000-0000-0000-000000000001',
    'i7j8k9l',
    'chore: update dependencies',
    'LIVE'
)
ON CONFLICT DO NOTHING;
