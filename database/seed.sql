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
INSERT INTO users (id, github_id, username, display_name, avatar_url)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    '12345678',
    'devuser',
    'Dev User',
    'https://avatars.githubusercontent.com/u/12345678'
) ON CONFLICT (github_id) DO NOTHING;

-- Example projects
INSERT INTO projects (id, user_id, name, repository, branch, status)
VALUES
    (
        'b0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'my-react-app',
        'github.com/devuser/my-react-app',
        'main',
        'LIVE'
    ),
    (
        'b0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'api-service',
        'github.com/devuser/api-service',
        'develop',
        'FAILED'
    )
ON CONFLICT DO NOTHING;

-- Example deployments
INSERT INTO deployments (id, project_id, commit_hash, commit_message, branch, status)
VALUES
    (
        'c0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'a1b2c3d',
        'feat: initial setup',
        'main',
        'LIVE'
    ),
    (
        'c0000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-000000000002',
        'e4f5g6h',
        'fix: correct build script',
        'develop',
        'FAILED'
    ),
    (
        'c0000000-0000-0000-0000-000000000003',
        'b0000000-0000-0000-0000-000000000001',
        'i7j8k9l',
        'chore: update dependencies',
        'main',
        'LIVE'
    )
ON CONFLICT DO NOTHING;
