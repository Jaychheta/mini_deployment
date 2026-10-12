/**
 * test_phase8.js — Automated test suite for Phase 8:
 *   - One-Click Redeployment
 *   - Safe Rollback (with zero-downtime safety guarantee)
 *   - Concurrency locking & duplicate prevention
 *   - Safe container retention & cleanup
 *   - Deployment history filters & metadata
 *   - Role-based authorization & secret isolation
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('./src/db/pool');
const deploymentService = require('./src/services/deployment.service');
const projectService = require('./src/services/project.service');
const { initDatabase } = require('./src/db/init');

const JWT_SECRET = process.env.JWT_SECRET || 'mini-deploy-jwt-secret-change-in-production';
const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}/api`;

const makeRequest = async (urlPath, options = {}) => {
  const token = options.token;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${urlPath}`, {
    ...options,
    headers,
  });

  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body: json };
};

const runTests = async () => {
  console.log('\n============================================================');
  console.log('🧪 RUNNING PHASE 8 VERIFICATION TEST SUITE');
  console.log('============================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  const assert = (condition, testName, details = '') => {
    if (condition) {
      console.log(`  ✅ PASS: ${testName} ${details ? '(' + details + ')' : ''}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
      failedCount++;
    }
  };

  await initDatabase();

  // 1. Fetch / create test users
  const userRes = await pool.query(`SELECT id, role, email FROM users ORDER BY created_at ASC`);
  const adminUser = userRes.rows.find((u) => u.role === 'ADMIN') || userRes.rows[0];
  let normalUser = userRes.rows.find((u) => u.role === 'USER' && u.id !== adminUser.id);

  if (!normalUser) {
    const createdUser = await pool.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Test User Phase 8', 'test_phase8@example.com', 'hashed_pass', 'USER')
      RETURNING id, role, email
    `);
    normalUser = createdUser.rows[0];
  }

  // Create unauthorized other user for security tests
  let otherUser = userRes.rows.find((u) => u.id !== normalUser.id && u.id !== adminUser.id);
  if (!otherUser) {
    const createdOther = await pool.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Other User Phase 8', 'other_phase8@example.com', 'hashed_pass', 'USER')
      RETURNING id, role, email
    `);
    otherUser = createdOther.rows[0];
  }

  const normalToken = jwt.sign({ id: normalUser.id, role: normalUser.role, email: normalUser.email }, JWT_SECRET, { expiresIn: '1h' });
  const adminToken  = jwt.sign({ id: adminUser.id, role: adminUser.role, email: adminUser.email }, JWT_SECRET, { expiresIn: '1h' });
  const otherToken  = jwt.sign({ id: otherUser.id, role: otherUser.role, email: otherUser.email }, JWT_SECRET, { expiresIn: '1h' });

  // 2. Setup isolated test projects
  // Project A: For Deployment-level Redeployment tests
  const projARes = await pool.query(`
    INSERT INTO projects (user_id, name, repository_name, repository_url, branch, deployment_slug)
    VALUES ($1, 'test-p8-redeploy', 'test-repo', 'https://github.com/test/repo', 'main', 'test-p8-a')
    RETURNING id, name
  `, [normalUser.id]);
  const projA = projARes.rows[0];

  const depA1Res = await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, commit_message, status, container_id, container_port, deployment_source, created_at, completed_at)
    VALUES ($1, 'aaaa111122223333444455556666777788889999', 'feat: initial version v1', 'LIVE', 'test-c1', 5010, 'MANUAL', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '119 minutes')
    RETURNING id, commit_hash, status
  `, [projA.id]);
  const depA1 = depA1Res.rows[0];

  const depA2Res = await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, commit_message, status, container_id, container_port, deployment_source, created_at, completed_at)
    VALUES ($1, 'bbbb111122223333444455556666777788889999', 'feat: second version v2', 'LIVE', 'test-c2', 5011, 'MANUAL', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '59 minutes')
    RETURNING id, commit_hash, status
  `, [projA.id]);
  const depA2 = depA2Res.rows[0];
  await pool.query(`UPDATE projects SET active_deployment_id = $1 WHERE id = $2`, [depA2.id, projA.id]);

  // Project B: For Project-level Redeployment test
  const projBRes = await pool.query(`
    INSERT INTO projects (user_id, name, repository_name, repository_url, branch, deployment_slug)
    VALUES ($1, 'test-p8-proj-redeploy', 'test-repo-b', 'https://github.com/test/repo-b', 'main', 'test-p8-b')
    RETURNING id, name
  `, [normalUser.id]);
  const projB = projBRes.rows[0];

  // Project C: For Rollback tests
  const projCRes = await pool.query(`
    INSERT INTO projects (user_id, name, repository_name, repository_url, branch, deployment_slug)
    VALUES ($1, 'test-p8-rollback', 'test-repo-c', 'https://github.com/test/repo-c', 'main', 'test-p8-c')
    RETURNING id, name
  `, [normalUser.id]);
  const projC = projCRes.rows[0];

  const depC1Res = await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, commit_message, status, container_id, container_port, deployment_source, created_at, completed_at)
    VALUES ($1, 'c111111122223333444455556666777788889999', 'feat: stable v1.0', 'LIVE', 'test-c-live1', 5012, 'MANUAL', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '179 minutes')
    RETURNING id, commit_hash, status
  `, [projC.id]);
  const depC1 = depC1Res.rows[0];

  const depC2Res = await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, commit_message, status, container_id, container_port, deployment_source, created_at, completed_at)
    VALUES ($1, 'c222222222223333444455556666777788889999', 'feat: v2.0 with regression', 'LIVE', 'test-c-live2', 5013, 'MANUAL', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '59 minutes')
    RETURNING id, commit_hash, status
  `, [projC.id]);
  const depC2 = depC2Res.rows[0];
  await pool.query(`UPDATE projects SET active_deployment_id = $1 WHERE id = $2`, [depC2.id, projC.id]);

  const depCFailedRes = await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, commit_message, status, error_message, deployment_source, created_at, completed_at)
    VALUES ($1, 'c333333322223333444455556666777788889999', 'broken build', 'FAILED', 'Build failed: Syntax error', 'MANUAL', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '29 minutes')
    RETURNING id, commit_hash, status
  `, [projC.id]);
  const depCFailed = depCFailedRes.rows[0];

  // Project D: For Concurrency tests
  const projDRes = await pool.query(`
    INSERT INTO projects (user_id, name, repository_name, repository_url, branch, deployment_slug)
    VALUES ($1, 'test-p8-concurrency', 'test-repo-d', 'https://github.com/test/repo-d', 'main', 'test-p8-d')
    RETURNING id, name
  `, [normalUser.id]);
  const projD = projDRes.rows[0];

  const depD1Res = await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, commit_message, status, container_id, container_port, deployment_source, created_at, completed_at)
    VALUES ($1, 'd111111122223333444455556666777788889999', 'feat: initial', 'LIVE', 'test-d-live', 5014, 'MANUAL', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '59 minutes')
    RETURNING id, commit_hash, status
  `, [projD.id]);
  const depD1 = depD1Res.rows[0];

  console.log('--- GROUP 1: One-Click Redeployment API & Authorization ---');

  // Test 1: Redeploy deployment via POST /api/deployments/:id/redeploy
  const redeployRes = await makeRequest(`/deployments/${depA1.id}/redeploy`, {
    method: 'POST',
    token: normalToken,
  });
  assert(redeployRes.status === 202 && redeployRes.body?.data?.deploymentId, 'One-click redeployment accepts request with HTTP 202', `ID: ${redeployRes.body?.data?.deploymentId?.slice(0, 8)}`);

  const createdRedeployId = redeployRes.body?.data?.deploymentId;
  if (createdRedeployId) {
    const recRes = await pool.query(`SELECT deployment_source, redeploy_from_deployment_id, commit_hash FROM deployments WHERE id = $1`, [createdRedeployId]);
    assert(recRes.rows[0]?.deployment_source === 'REDEPLOY', 'New record correctly marked as REDEPLOY');
    assert(recRes.rows[0]?.redeploy_from_deployment_id === depA1.id, 'Linked to target deployment via redeploy_from_deployment_id');
    assert(recRes.rows[0]?.commit_hash === depA1.commit_hash, 'Preserves targeted commit SHA');
  }

  // Test 2: Project-level redeployment endpoint POST /api/projects/:id/redeploy
  const projRedeployRes = await makeRequest(`/projects/${projB.id}/redeploy`, {
    method: 'POST',
    token: normalToken,
  });
  assert(projRedeployRes.status === 202 && projRedeployRes.body?.data?.deploymentId, 'Project-level redeploy accepted with HTTP 202');

  // Test 3: Unauthenticated redeploy attempt
  const unauthRedeploy = await makeRequest(`/deployments/${depA1.id}/redeploy`, { method: 'POST' });
  assert(unauthRedeploy.status === 401, 'Unauthenticated redeployment rejected with 401 Unauthorized');

  // Test 4: Unauthorized user attempting to redeploy another user's deployment
  const otherUserRedeploy = await makeRequest(`/deployments/${depA1.id}/redeploy`, {
    method: 'POST',
    token: otherToken,
  });
  assert(otherUserRedeploy.status === 404 || otherUserRedeploy.status === 403, 'Unauthorized user redeploy rejected (Access Denied)');

  // Test 5: Concurrency locking: duplicate request while project has active building deployment
  await pool.query(`
    INSERT INTO deployments (project_id, commit_hash, status, deployment_source)
    VALUES ($1, 'lock-test-hash', 'BUILDING', 'MANUAL')
  `, [projD.id]);

  const dupRedeploy = await makeRequest(`/deployments/${depD1.id}/redeploy`, {
    method: 'POST',
    token: normalToken,
  });
  assert(dupRedeploy.status === 409, 'Concurrent redeploy request blocked with 409 Conflict (Duplicate Prevention)');

  console.log('\n--- GROUP 2: Safe Rollback Workflow & Integrity ---');

  // Test 6: Valid rollback to a previously successful LIVE deployment (depC1)
  const rollbackRes = await makeRequest(`/deployments/${depC1.id}/rollback`, {
    method: 'POST',
    token: normalToken,
  });
  assert(rollbackRes.status === 202 && rollbackRes.body?.data?.deploymentId, 'Safe rollback initiated with HTTP 202', `Target #${depC1.id.slice(0, 8)}`);

  const createdRollbackId = rollbackRes.body?.data?.deploymentId;
  if (createdRollbackId) {
    const rbRec = await pool.query(`SELECT deployment_source, rollback_from_deployment_id, commit_hash FROM deployments WHERE id = $1`, [createdRollbackId]);
    assert(rbRec.rows[0]?.deployment_source === 'ROLLBACK', 'New record correctly marked as ROLLBACK');
    assert(rbRec.rows[0]?.rollback_from_deployment_id === depC1.id, 'Linked to target deployment via rollback_from_deployment_id');
    assert(rbRec.rows[0]?.commit_hash === depC1.commit_hash, 'Rollback targets exact historical commit');
  }

  // Test 7: Rollback to a FAILED deployment (depCFailed) must be strictly rejected
  const rollbackFailedDep = await makeRequest(`/deployments/${depCFailed.id}/rollback`, {
    method: 'POST',
    token: normalToken,
  });
  assert(rollbackFailedDep.status === 400, 'Rollback to FAILED deployment rejected with 400 Bad Request');

  // Test 8: Rollback to currently ACTIVE deployment (depC2) must be rejected
  const rollbackActiveDep = await makeRequest(`/deployments/${depC2.id}/rollback`, {
    method: 'POST',
    token: normalToken,
  });
  assert(rollbackActiveDep.status === 400, 'Rollback to ALREADY ACTIVE deployment rejected with 400 Bad Request');

  // Test 9: Rollback when project is busy returns 409 Conflict
  const rollbackBusy = await makeRequest(`/deployments/${depD1.id}/rollback`, {
    method: 'POST',
    token: normalToken,
  });
  assert(rollbackBusy.status === 409, 'Rollback during active deployment rejected with 409 Conflict');

  // Test 10: Unauthorized user rollback
  const rollbackOtherUser = await makeRequest(`/deployments/${depC1.id}/rollback`, {
    method: 'POST',
    token: otherToken,
  });
  assert(rollbackOtherUser.status === 404 || rollbackOtherUser.status === 403, 'Unauthorized user rollback rejected');

  // Test 11: Production route preservation guarantee
  // Verify that active_deployment_id remains depC2
  const checkProj = await pool.query(`SELECT active_deployment_id FROM projects WHERE id = $1`, [projC.id]);
  assert(checkProj.rows[0]?.active_deployment_id === depC2.id, 'Production active deployment remains intact throughout candidate evaluation');

  console.log('\n--- GROUP 3: Safe Container Retention & Cleanup ---');

  // Test 12 & 13: safeCleanupContainers preserves active production container
  const cleanupRes = await deploymentService.safeCleanupContainers(projA.id, 2);
  assert(cleanupRes.preservedContainers.includes('test-c2'), 'Active production container test-c2 is PRESERVED (Never Deleted)');

  // Test 14: Admin cleanup endpoint POST /api/admin/cleanup
  const adminCleanupReq = await makeRequest('/admin/cleanup', {
    method: 'POST',
    token: adminToken,
  });
  assert(adminCleanupReq.status === 200 && adminCleanupReq.body?.success, 'Admin can trigger platform safe container cleanup');

  // Test 15: Ordinary user calling /api/admin/cleanup receives 403 Forbidden
  const userAdminCleanupReq = await makeRequest('/admin/cleanup', {
    method: 'POST',
    token: normalToken,
  });
  assert(userAdminCleanupReq.status === 403, 'Ordinary USER calling /api/admin/cleanup rejected with 403 Forbidden');

  console.log('\n--- GROUP 4: History Metadata, Duration & Filters ---');

  // Test 16: Query deployments by status=LIVE
  const filterLiveRes = await makeRequest(`/deployments?projectId=${projA.id}&status=LIVE`, {
    token: normalToken,
  });
  assert(filterLiveRes.ok && filterLiveRes.body.data.every(d => d.status === 'LIVE'), 'Deployment filter ?status=LIVE returns only LIVE deployments');

  // Test 17: Query deployments by source=ROLLBACK
  const filterRollbackRes = await makeRequest(`/deployments?projectId=${projC.id}&source=ROLLBACK`, {
    token: normalToken,
  });
  assert(filterRollbackRes.ok && filterRollbackRes.body.data.every(d => d.deploymentSource === 'ROLLBACK'), 'Deployment filter ?source=ROLLBACK returns only ROLLBACK triggers');

  // Test 18: Metadata fields present
  const metaDep = filterLiveRes.body.data[0];
  assert(metaDep && metaDep.isActive !== undefined, 'isActive boolean flag present in response');
  assert(metaDep && metaDep.durationSeconds !== undefined, 'durationSeconds calculated and present in response');
  assert(metaDep && metaDep.commitMessage !== undefined, 'commitMessage present in response');
  assert(metaDep && metaDep.projectName !== undefined, 'projectName present in response');

  console.log('\n--- GROUP 5: Security & Secret Leak Prevention ---');

  // Test 19: Verify no secret exposure in deployment responses
  const jsonStr = JSON.stringify(filterLiveRes.body);
  const containsSecrets = jsonStr.includes('github_access_token') || jsonStr.includes('password_hash') || jsonStr.includes(JWT_SECRET);
  assert(!containsSecrets, 'Zero secrets exposed in deployment API responses (No tokens, passwords, or secrets)');

  // Test 20: Clean error handling for invalid UUIDs
  const invalidUuidRes = await makeRequest('/deployments/invalid-uuid-format', { token: normalToken });
  assert(invalidUuidRes.status === 400 || invalidUuidRes.status === 404 || invalidUuidRes.status === 500, 'Invalid deployment ID handled safely without server crash');

  // Cleanup test artifacts from DB
  await pool.query(`DELETE FROM projects WHERE id IN ($1, $2, $3, $4)`, [projA.id, projB.id, projC.id, projD.id]);
  await pool.query(`DELETE FROM users WHERE email IN ('test_phase8@example.com', 'other_phase8@example.com')`);

  console.log('\n============================================================');
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('============================================================\n');

  process.exit(failedCount > 0 ? 1 : 0);
};

runTests().catch((err) => {
  console.error('Fatal error during Phase 8 test run:', err);
  process.exit(1);
});
