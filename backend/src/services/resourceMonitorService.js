/**
 * resourceMonitorService.js — Docker Container Resource Monitoring & Metrics Persistence.
 *
 * PHASE 7 FEATURES:
 *  - Centralized, non-duplicated background monitoring service.
 *  - Retrieves real CPU, RAM, Network & Uptime from live Docker containers.
 *  - Accurately calculates CPU % using Docker's container and system deltas.
 *  - Accurately calculates RAM % accounting for inactive_file / cache memory.
 *  - Tracks cumulative network RX/TX bytes across container interfaces.
 *  - Persists snapshots to PostgreSQL `resource_metrics` table with 7-day retention cleanup.
 *  - Streams real-time updates via Socket.IO to authorized users in room `deployment:<id>`.
 *  - Provides historical metrics for time-series charts (1h, 6h, 24h, 7d).
 *  - Provides admin-level platform-wide resource aggregates.
 *  - Safe fallback for stopped, removed, or unavailable containers without crashing the backend.
 */

const Docker = require('dockerode');
const pool = require('../db/pool');
const logger = require('../utils/logger.util');
const { calculateEstimatedCost } = require('./costEstimator.service');
const { emitResourceUpdate, emitResourceError } = require('./socket.service');

const docker = new Docker();

// In-memory cache for latest measurement per deployment: deploymentId -> metricsObject
const latestMetricsCache = new Map();

let monitorIntervalTimer = null;
let cleanupIntervalTimer = null;
let isSamplingInProgress = false;
let isCleanupInProgress = false;

// ─── Formatting & Helper Utilities ──────────────────────────────────────────

const formatUptime = (seconds) => {
  if (seconds == null || isNaN(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

const formatBytes = (bytes) => {
  if (!bytes || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(2)} ${units[idx]}`;
};

// ─── Single Container Stats Fetcher ─────────────────────────────────────────

/**
 * Fetch and calculate real resource statistics for a single container.
 *
 * @param {string} containerId - Docker container ID
 * @returns {Promise<Object>} Formatted resource statistics
 */
const fetchContainerResourceStats = async (containerId) => {
  if (!containerId) {
    return {
      containerId: null,
      containerState: 'unavailable',
      isRunning: false,
      cpuPercent: 0,
      memoryUsedBytes: 0,
      memoryUsedMb: 0,
      memoryLimitBytes: 0,
      memoryLimitMb: 0,
      memoryPercent: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
      uptimeSeconds: 0,
      uptime: '—',
      sampledAt: new Date().toISOString(),
      costEstimate: calculateEstimatedCost({ isRunning: false }),
    };
  }

  const container = docker.getContainer(containerId);

  // 1. Inspect container state and uptime
  let inspectInfo;
  try {
    inspectInfo = await container.inspect();
  } catch (err) {
    const isNotFound = err.statusCode === 404 || String(err.message).includes('no such container');
    return {
      containerId,
      containerState: isNotFound ? 'exited' : 'unavailable',
      isRunning: false,
      cpuPercent: 0,
      memoryUsedBytes: 0,
      memoryUsedMb: 0,
      memoryLimitBytes: 0,
      memoryLimitMb: 0,
      memoryPercent: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
      uptimeSeconds: 0,
      uptime: '—',
      sampledAt: new Date().toISOString(),
      costEstimate: calculateEstimatedCost({ isRunning: false }),
    };
  }

  const isRunning = inspectInfo.State?.Running === true;
  const rawStatus = inspectInfo.State?.Status || (isRunning ? 'running' : 'stopped');
  const containerState = rawStatus.toLowerCase();

  let uptimeSeconds = 0;
  if (isRunning && inspectInfo.State?.StartedAt) {
    const startedMs = new Date(inspectInfo.State.StartedAt).getTime();
    if (!isNaN(startedMs) && startedMs > 0) {
      uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    }
  }

  // If container is not running, return stopped state safely without reading stats
  if (!isRunning) {
    return {
      containerId,
      containerName: inspectInfo.Name?.replace(/^\//, '') || containerId.slice(0, 12),
      containerState,
      isRunning: false,
      cpuPercent: 0,
      memoryUsedBytes: 0,
      memoryUsedMb: 0,
      memoryLimitBytes: 0,
      memoryLimitMb: 0,
      memoryPercent: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
      uptimeSeconds: 0,
      uptime: '—',
      sampledAt: new Date().toISOString(),
      costEstimate: calculateEstimatedCost({ isRunning: false }),
    };
  }

  // 2. Fetch live stats from Docker
  let stats;
  try {
    stats = await container.stats({ stream: false });
  } catch (err) {
    logger.warn(`[RESOURCE_MONITOR] Could not read stats for container ${containerId.slice(0, 12)}: ${err.message}`);
    return {
      containerId,
      containerName: inspectInfo.Name?.replace(/^\//, '') || containerId.slice(0, 12),
      containerState,
      isRunning: true,
      cpuPercent: 0,
      memoryUsedBytes: 0,
      memoryUsedMb: 0,
      memoryLimitBytes: 0,
      memoryLimitMb: 0,
      memoryPercent: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
      uptimeSeconds,
      uptime: formatUptime(uptimeSeconds),
      sampledAt: new Date().toISOString(),
      costEstimate: calculateEstimatedCost({ isRunning: true }),
    };
  }

  // 3. CPU Usage Calculation
  // Docker formula:
  // cpuDelta = cpu_stats.cpu_usage.total_usage - precpu_stats.cpu_usage.total_usage
  // systemDelta = cpu_stats.system_cpu_usage - precpu_stats.system_cpu_usage
  // cpuPercent = (cpuDelta / systemDelta) * online_cpus * 100
  let cpuPercent = 0;
  const cpuStats = stats.cpu_stats || {};
  const precpuStats = stats.precpu_stats || {};

  const currentTotal = cpuStats.cpu_usage?.total_usage || 0;
  const previousTotal = precpuStats.cpu_usage?.total_usage || 0;
  const currentSystem = cpuStats.system_cpu_usage || 0;
  const previousSystem = precpuStats.system_cpu_usage || 0;

  const cpuDelta = currentTotal - previousTotal;
  const systemDelta = currentSystem - previousSystem;

  const onlineCpus =
    cpuStats.online_cpus ||
    (Array.isArray(cpuStats.cpu_usage?.percpu_usage) ? cpuStats.cpu_usage.percpu_usage.length : 1);

  if (systemDelta > 0 && cpuDelta >= 0) {
    const rawCpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100.0;
    cpuPercent = isFinite(rawCpuPercent) ? Number(rawCpuPercent.toFixed(2)) : 0;
  }

  // 4. Memory Usage Calculation
  // In Docker, memory_stats.usage includes file cache.
  // Accurate active memory: usage - inactive_file (or cache if available).
  const memoryStats = stats.memory_stats || {};
  const rawUsage = memoryStats.usage || 0;
  const memDetails = memoryStats.stats || {};
  const inactiveFile = memDetails.inactive_file || memDetails.total_inactive_file || memDetails.cache || 0;

  const memoryUsedBytes = Math.max(0, rawUsage - inactiveFile);
  const memoryLimitBytes = memoryStats.limit || 0;

  const memoryUsedMb = Number((memoryUsedBytes / (1024 * 1024)).toFixed(2));
  const memoryLimitMb = Number((memoryLimitBytes / (1024 * 1024)).toFixed(2));

  let memoryPercent = 0;
  if (memoryLimitBytes > 0) {
    const rawMemPercent = (memoryUsedBytes / memoryLimitBytes) * 100.0;
    memoryPercent = isFinite(rawMemPercent) ? Number(rawMemPercent.toFixed(2)) : 0;
  }

  // 5. Network Cumulative RX/TX
  let networkRxBytes = 0;
  let networkTxBytes = 0;
  if (stats.networks && typeof stats.networks === 'object') {
    for (const iface of Object.values(stats.networks)) {
      if (iface) {
        networkRxBytes += iface.rx_bytes || 0;
        networkTxBytes += iface.tx_bytes || 0;
      }
    }
  }

  // 6. Cost Estimation
  const costEstimate = calculateEstimatedCost({
    isRunning: true,
    cpuPercent,
    memoryUsedMb,
  });

  return {
    containerId,
    containerName: inspectInfo.Name?.replace(/^\//, '') || containerId.slice(0, 12),
    containerState,
    isRunning: true,
    cpuPercent,
    memoryUsedBytes,
    memoryUsedMb,
    memoryLimitBytes,
    memoryLimitMb,
    memoryPercent,
    networkRxBytes,
    networkTxBytes,
    uptimeSeconds,
    uptime: formatUptime(uptimeSeconds),
    sampledAt: new Date().toISOString(),
    costEstimate,
  };
};

// ─── Metrics Sampling & Persistence ─────────────────────────────────────────

/**
 * Sample all LIVE deployments and persist stats in PostgreSQL.
 */
const sampleActiveDeployments = async () => {
  if (isSamplingInProgress) return;
  isSamplingInProgress = true;

  try {
    // Find all LIVE deployments with an assigned container
    const result = await pool.query(`
      SELECT d.id, d.project_id, d.container_id, d.container_port
      FROM deployments d
      WHERE d.status = 'LIVE' AND d.container_id IS NOT NULL
    `);

    const liveDeployments = result.rows;
    if (liveDeployments.length === 0) {
      isSamplingInProgress = false;
      return;
    }

    for (const dep of liveDeployments) {
      try {
        const stats = await fetchContainerResourceStats(dep.container_id);

        const enriched = {
          deploymentId: dep.id,
          projectId: dep.project_id,
          ...stats,
        };

        // Cache latest metrics in memory
        latestMetricsCache.set(dep.id, enriched);

        // Persist snapshot to PostgreSQL
        await pool.query(`
          INSERT INTO resource_metrics (
            deployment_id,
            project_id,
            container_id,
            cpu_usage,
            memory_usage,
            memory_limit,
            memory_percent,
            network_rx_bytes,
            network_tx_bytes,
            container_state,
            estimated_cost,
            recorded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        `, [
          dep.id,
          dep.project_id,
          dep.container_id,
          enriched.cpuPercent,
          enriched.memoryUsedMb,
          enriched.memoryLimitMb,
          enriched.memoryPercent,
          enriched.networkRxBytes,
          enriched.networkTxBytes,
          enriched.containerState,
          enriched.costEstimate?.hourlyUsd || 0,
        ]);

        // Emit real-time Socket.IO event to room `deployment:<id>`
        emitResourceUpdate(dep.id, enriched);
      } catch (depErr) {
        logger.warn(`[RESOURCE_MONITOR] Error sampling deployment ${dep.id}: ${depErr.message}`);
        emitResourceError(dep.id, depErr.message);
      }
    }
  } catch (err) {
    logger.warn(`[RESOURCE_MONITOR] Sampling loop encountered an error: ${err.message}`);
  } finally {
    isSamplingInProgress = false;
  }
};

// ─── Historical Retention Cleanup ───────────────────────────────────────────

/**
 * Remove historical samples older than configured retention period (default 7 days).
 */
const cleanupOldMetrics = async () => {
  if (isCleanupInProgress) return;
  isCleanupInProgress = true;

  try {
    const days = parseInt(process.env.RESOURCE_RETENTION_DAYS || '7', 10);
    const retentionDays = isNaN(days) || days < 1 ? 7 : days;

    const result = await pool.query(
      `DELETE FROM resource_metrics WHERE recorded_at < NOW() - ($1 || ' days')::INTERVAL`,
      [retentionDays]
    );

    if (result.rowCount > 0) {
      logger.info(`[RESOURCE_MONITOR] Pruned ${result.rowCount} historical resource samples older than ${retentionDays} days.`);
    }
  } catch (err) {
    logger.warn(`[RESOURCE_MONITOR] Error during metrics cleanup: ${err.message}`);
  } finally {
    isCleanupInProgress = false;
  }
};

// ─── Service Lifecycle ──────────────────────────────────────────────────────

/**
 * Start the centralized resource monitoring service.
 */
const startMonitoring = () => {
  if (process.env.RESOURCE_MONITOR_ENABLED === 'false') {
    logger.info('[RESOURCE_MONITOR] Disabled via RESOURCE_MONITOR_ENABLED=false');
    return;
  }

  if (monitorIntervalTimer) return;

  const intervalMs = parseInt(process.env.RESOURCE_SAMPLE_INTERVAL_MS || '10000', 10);
  const sampleInterval = isNaN(intervalMs) || intervalMs < 2000 ? 10000 : intervalMs;

  logger.info(`[RESOURCE_MONITOR] Starting service (polling every ${sampleInterval / 1000}s)`);

  // Initial immediate sample & cleanup
  sampleActiveDeployments();
  cleanupOldMetrics();

  // Set recurring timers
  monitorIntervalTimer = setInterval(sampleActiveDeployments, sampleInterval);
  // Cleanup runs once every 24 hours
  cleanupIntervalTimer = setInterval(cleanupOldMetrics, 24 * 60 * 60 * 1000);
};

/**
 * Stop the resource monitoring service cleanly.
 */
const stopMonitoring = () => {
  if (monitorIntervalTimer) {
    clearInterval(monitorIntervalTimer);
    monitorIntervalTimer = null;
  }
  if (cleanupIntervalTimer) {
    clearInterval(cleanupIntervalTimer);
    cleanupIntervalTimer = null;
  }
  logger.info('[RESOURCE_MONITOR] Service stopped.');
};

// ─── Query APIs for Controllers ─────────────────────────────────────────────

/**
 * Get the latest metrics for a deployment (ownership verified).
 *
 * @param {string} deploymentId
 * @param {string} [userId] - Authenticated user ID (omit for ADMIN)
 * @returns {Promise<Object|null>}
 */
const getLatestMetrics = async (deploymentId, userId) => {
  // Verify deployment and ownership
  let depResult;
  if (userId) {
    depResult = await pool.query(`
      SELECT d.id, d.project_id, d.container_id, d.status
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1 AND p.user_id = $2
    `, [deploymentId, userId]);
  } else {
    depResult = await pool.query(`
      SELECT d.id, d.project_id, d.container_id, d.status
      FROM deployments d
      WHERE d.id = $1
    `, [deploymentId]);
  }

  if (depResult.rows.length === 0) return null;
  const deployment = depResult.rows[0];

  // If in memory cache and recent (< 15s), return it
  const cached = latestMetricsCache.get(deploymentId);
  if (cached && (Date.now() - new Date(cached.sampledAt).getTime()) < 15000) {
    return cached;
  }

  // If deployment is LIVE and has containerId, try real-time query
  if (deployment.status === 'LIVE' && deployment.container_id) {
    try {
      const stats = await fetchContainerResourceStats(deployment.container_id);
      const metrics = {
        deploymentId: deployment.id,
        projectId: deployment.project_id,
        ...stats,
      };
      latestMetricsCache.set(deploymentId, metrics);
      return metrics;
    } catch {
      // Fall through to DB fallback
    }
  }

  // Fallback: Query most recent recorded snapshot from database
  const dbResult = await pool.query(`
    SELECT cpu_usage, memory_usage, memory_limit, memory_percent,
           network_rx_bytes, network_tx_bytes, container_state, recorded_at
    FROM resource_metrics
    WHERE deployment_id = $1
    ORDER BY recorded_at DESC
    LIMIT 1
  `, [deploymentId]);

  if (dbResult.rows.length > 0) {
    const row = dbResult.rows[0];
    const isRunning = row.container_state?.toLowerCase() === 'running';
    return {
      deploymentId: deployment.id,
      projectId: deployment.project_id,
      containerId: deployment.container_id,
      containerState: row.container_state || 'stopped',
      isRunning,
      cpuPercent: Number(row.cpu_usage || 0),
      memoryUsedMb: Number(row.memory_usage || 0),
      memoryUsedBytes: Math.round(Number(row.memory_usage || 0) * 1024 * 1024),
      memoryLimitMb: Number(row.memory_limit || 0),
      memoryLimitBytes: Math.round(Number(row.memory_limit || 0) * 1024 * 1024),
      memoryPercent: Number(row.memory_percent || 0),
      networkRxBytes: Number(row.network_rx_bytes || 0),
      networkTxBytes: Number(row.network_tx_bytes || 0),
      uptime: isRunning ? 'Active' : '—',
      uptimeSeconds: 0,
      sampledAt: row.recorded_at,
      costEstimate: calculateEstimatedCost({
        isRunning,
        cpuPercent: Number(row.cpu_usage || 0),
        memoryUsedMb: Number(row.memory_usage || 0),
      }),
    };
  }

  // No samples recorded yet
  return {
    deploymentId: deployment.id,
    projectId: deployment.project_id,
    containerId: deployment.container_id,
    containerState: deployment.status === 'LIVE' ? 'waiting' : 'stopped',
    isRunning: false,
    cpuPercent: 0,
    memoryUsedMb: 0,
    memoryUsedBytes: 0,
    memoryLimitMb: 0,
    memoryLimitBytes: 0,
    memoryPercent: 0,
    networkRxBytes: 0,
    networkTxBytes: 0,
    uptime: '—',
    uptimeSeconds: 0,
    sampledAt: null,
    costEstimate: calculateEstimatedCost({ isRunning: false }),
  };
};

/**
 * Get historical time-series resource metrics for a deployment (ownership verified).
 *
 * @param {string} deploymentId
 * @param {string} [userId]
 * @param {string} [period='1h'] - '1h' | '6h' | '24h' | '7d'
 * @returns {Promise<Array>}
 */
const getMetricsHistory = async (deploymentId, userId, period = '1h') => {
  // Validate ownership
  let depResult;
  if (userId) {
    depResult = await pool.query(`
      SELECT d.id FROM deployments d
      JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1 AND p.user_id = $2
    `, [deploymentId, userId]);
  } else {
    depResult = await pool.query(`SELECT id FROM deployments WHERE id = $1`, [deploymentId]);
  }

  if (depResult.rows.length === 0) return null;

  // Determine interval
  let intervalSql = '1 hour';
  if (period === '6h') intervalSql = '6 hours';
  else if (period === '24h') intervalSql = '24 hours';
  else if (period === '7d') intervalSql = '7 days';

  const result = await pool.query(`
    SELECT id, cpu_usage, memory_usage, memory_limit, memory_percent,
           network_rx_bytes, network_tx_bytes, container_state, recorded_at
    FROM resource_metrics
    WHERE deployment_id = $1
      AND recorded_at >= NOW() - ($2)::INTERVAL
    ORDER BY recorded_at ASC
    LIMIT 500
  `, [deploymentId, intervalSql]);

  return result.rows.map((row) => ({
    id: row.id,
    cpuPercent: Number(row.cpu_usage || 0),
    memoryUsedMb: Number(row.memory_usage || 0),
    memoryLimitMb: Number(row.memory_limit || 0),
    memoryPercent: Number(row.memory_percent || 0),
    networkRxBytes: Number(row.network_rx_bytes || 0),
    networkTxBytes: Number(row.network_tx_bytes || 0),
    containerState: row.container_state || 'running',
    recordedAt: row.recorded_at,
  }));
};

/**
 * Get resource summary for a project's active live deployment.
 *
 * @param {string} projectId
 * @param {string} [userId]
 * @returns {Promise<Object|null>}
 */
const getProjectResourceSummary = async (projectId, userId) => {
  // Verify project ownership
  let projResult;
  if (userId) {
    projResult = await pool.query(
      `SELECT id, name, active_deployment_id FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, userId]
    );
  } else {
    projResult = await pool.query(
      `SELECT id, name, active_deployment_id FROM projects WHERE id = $1`,
      [projectId]
    );
  }

  if (projResult.rows.length === 0) return null;
  const project = projResult.rows[0];

  // Resolve active deployment or most recent LIVE deployment
  let deploymentId = project.active_deployment_id;
  if (!deploymentId) {
    const liveDep = await pool.query(`
      SELECT id FROM deployments
      WHERE project_id = $1 AND status = 'LIVE'
      ORDER BY completed_at DESC LIMIT 1
    `, [projectId]);
    if (liveDep.rows.length > 0) {
      deploymentId = liveDep.rows[0].id;
    }
  }

  if (!deploymentId) {
    return {
      projectId,
      projectName: project.name,
      hasActiveDeployment: false,
      message: 'No active deployment for this project.',
      resources: null,
    };
  }

  const resources = await getLatestMetrics(deploymentId, userId);

  return {
    projectId,
    projectName: project.name,
    deploymentId,
    hasActiveDeployment: true,
    resources,
  };
};

/**
 * Get platform-wide aggregate resource summary for administrators.
 *
 * @returns {Promise<Object>} Aggregate statistics
 */
const getAdminPlatformSummary = async () => {
  // Query all LIVE deployments with user and project details
  const result = await pool.query(`
    SELECT d.id AS deployment_id, d.container_id, d.container_port, d.status,
           p.id AS project_id, p.name AS project_name,
           u.id AS user_id, u.name AS user_name, u.email AS user_email
    FROM deployments d
    JOIN projects p ON p.id = d.project_id
    JOIN users u ON u.id = p.user_id
    WHERE d.status = 'LIVE'
    ORDER BY d.created_at DESC
  `);

  const liveDeployments = result.rows;
  let aggregateCpu = 0;
  let aggregateMemoryUsedMb = 0;
  let aggregateMemoryLimitMb = 0;
  let totalActiveContainers = 0;
  let totalStoppedContainers = 0;

  const containerList = [];

  for (const dep of liveDeployments) {
    let metrics = latestMetricsCache.get(dep.deployment_id);

    if (!metrics) {
      // Check latest measurement from DB for this deployment
      const lastRow = await pool.query(`
        SELECT cpu_usage, memory_usage, memory_limit, memory_percent,
               network_rx_bytes, network_tx_bytes, container_state, recorded_at
        FROM resource_metrics
        WHERE deployment_id = $1
        ORDER BY recorded_at DESC LIMIT 1
      `, [dep.deployment_id]);

      if (lastRow.rows.length > 0) {
        const r = lastRow.rows[0];
        const isRunning = r.container_state?.toLowerCase() === 'running';
        metrics = {
          deploymentId: dep.deployment_id,
          containerId: dep.container_id,
          containerState: r.container_state || 'stopped',
          isRunning,
          cpuPercent: Number(r.cpu_usage || 0),
          memoryUsedMb: Number(r.memory_usage || 0),
          memoryLimitMb: Number(r.memory_limit || 0),
          memoryPercent: Number(r.memory_percent || 0),
          networkRxBytes: Number(r.network_rx_bytes || 0),
          networkTxBytes: Number(r.network_tx_bytes || 0),
          uptime: isRunning ? 'Active' : '—',
          sampledAt: r.recorded_at,
          costEstimate: calculateEstimatedCost({ isRunning, cpuPercent: Number(r.cpu_usage || 0), memoryUsedMb: Number(r.memory_usage || 0) }),
        };
      } else {
        metrics = {
          deploymentId: dep.deployment_id,
          containerId: dep.container_id,
          containerState: 'stopped',
          isRunning: false,
          cpuPercent: 0,
          memoryUsedMb: 0,
          memoryLimitMb: 0,
          memoryPercent: 0,
          networkRxBytes: 0,
          networkTxBytes: 0,
          uptime: '—',
          sampledAt: null,
          costEstimate: calculateEstimatedCost({ isRunning: false }),
        };
      }
    }

    if (metrics.isRunning) {
      totalActiveContainers++;
      aggregateCpu += (metrics.cpuPercent || 0);
      aggregateMemoryUsedMb += (metrics.memoryUsedMb || 0);
      aggregateMemoryLimitMb = Math.max(aggregateMemoryLimitMb, metrics.memoryLimitMb || 0);
    } else {
      totalStoppedContainers++;
    }


    containerList.push({
      deploymentId: dep.deployment_id,
      projectId: dep.project_id,
      projectName: dep.project_name,
      userId: dep.user_id,
      userName: dep.user_name,
      userEmail: dep.user_email,
      containerId: dep.container_id,
      containerPort: dep.container_port,
      status: metrics.containerState || dep.status,
      isRunning: metrics.isRunning,
      cpuPercent: metrics.cpuPercent,
      memoryUsedMb: metrics.memoryUsedMb,
      memoryLimitMb: metrics.memoryLimitMb,
      memoryPercent: metrics.memoryPercent,
      networkRxBytes: metrics.networkRxBytes,
      networkTxBytes: metrics.networkTxBytes,
      uptime: metrics.uptime,
      sampledAt: metrics.sampledAt,
      costEstimate: metrics.costEstimate,
    });
  }

  return {
    totalMonitoredDeployments: liveDeployments.length,
    totalActiveContainers,
    totalStoppedContainers,
    aggregateCpuPercent: Number(aggregateCpu.toFixed(2)),
    aggregateMemoryUsedMb: Number(aggregateMemoryUsedMb.toFixed(2)),
    aggregateMemoryLimitMb: Number(aggregateMemoryLimitMb.toFixed(2)),
    latestSampledAt: new Date().toISOString(),
    containers: containerList,
  };
};

module.exports = {
  fetchContainerResourceStats,
  sampleActiveDeployments,
  cleanupOldMetrics,
  startMonitoring,
  stopMonitoring,
  getLatestMetrics,
  getMetricsHistory,
  getProjectResourceSummary,
  getAdminPlatformSummary,
  formatBytes,
  formatUptime,
};
