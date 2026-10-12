/**
 * ResourceDashboard.jsx — Clean, white, simple resource metrics cards.
 * Displays real-time Docker container CPU, RAM, Network, Status, Uptime, and Cost Estimate.
 */

import React from 'react';

const formatBytesDisplay = (bytes) => {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(2)} ${units[idx]}`;
};

const formatMbDisplay = (mb) => {
  if (mb == null || isNaN(mb)) return '0 MB';
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
};

export default function ResourceDashboard({ resources, loading, error, isLiveSocket }) {
  if (loading && !resources) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', marginBottom: 24 }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Loading container resource statistics…
        </div>
      </div>
    );
  }

  if (error && !resources) {
    return (
      <div className="alert alert-error" style={{ marginBottom: 24 }}>
        <strong>Resource monitoring:</strong> {error}
      </div>
    );
  }

  if (!resources) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', marginBottom: 24 }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Resource data is temporarily unavailable.
        </div>
      </div>
    );
  }

  const {
    containerState = 'unavailable',
    isRunning = false,
    cpuPercent = 0,
    memoryUsedMb = 0,
    memoryLimitMb = 0,
    memoryPercent = 0,
    networkRxBytes = 0,
    networkTxBytes = 0,
    uptime = '—',
    sampledAt,
    costEstimate,
  } = resources;

  // CPU progress bar color
  const cpuColor = cpuPercent > 85 ? '#ef4444' : cpuPercent > 60 ? '#f59e0b' : '#2563eb';
  const memColor = memoryPercent > 85 ? '#ef4444' : memoryPercent > 60 ? '#f59e0b' : '#10b981';

  // Status badge styling
  const isContainerRunning = isRunning && containerState === 'running';
  const statusBg = isContainerRunning ? '#f0fdf4' : '#fef2f2';
  const statusColor = isContainerRunning ? '#16a34a' : '#dc2626';
  const statusBorder = isContainerRunning ? '#bbf7d0' : '#fecaca';

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Live header row */}
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
          Container Resource Usage
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isLiveSocket && (
            <div className="live-pulse">
              <span className="pulse-dot" />
              <span>Real-Time Live</span>
            </div>
          )}
          {sampledAt && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Sampled: {new Date(sampledAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Resource Metrics Grid */}
      <div className="resource-grid">
        {/* CPU Usage Card */}
        <div className="resource-card">
          <div>
            <div className="resource-card-header">
              <span className="resource-card-title">CPU Usage</span>
              <span style={{ fontSize: '1.1rem' }}>⚡</span>
            </div>
            <div className="resource-card-value">
              {isContainerRunning ? `${cpuPercent}%` : '0.00%'}
            </div>
            <div className="resource-card-sub">
              {isContainerRunning ? 'Active container usage' : 'Container is not active'}
            </div>
          </div>
          <div className="resource-progress-bg">
            <div
              className="resource-progress-bar"
              style={{
                width: `${Math.min(100, Math.max(0, cpuPercent))}%`,
                backgroundColor: cpuColor,
              }}
            />
          </div>
        </div>

        {/* Memory Usage Card */}
        <div className="resource-card">
          <div>
            <div className="resource-card-header">
              <span className="resource-card-title">Memory Usage</span>
              <span style={{ fontSize: '1.1rem' }}>🧠</span>
            </div>
            <div className="resource-card-value">
              {isContainerRunning ? `${memoryPercent}%` : '0.00%'}
            </div>
            <div className="resource-card-sub">
              {isContainerRunning
                ? `${formatMbDisplay(memoryUsedMb)} / ${formatMbDisplay(memoryLimitMb)}`
                : '0 MB / 0 MB'}
            </div>
          </div>
          <div className="resource-progress-bg">
            <div
              className="resource-progress-bar"
              style={{
                width: `${Math.min(100, Math.max(0, memoryPercent))}%`,
                backgroundColor: memColor,
              }}
            />
          </div>
        </div>

        {/* Container Status Card */}
        <div className="resource-card">
          <div>
            <div className="resource-card-header">
              <span className="resource-card-title">Container Status</span>
              <span style={{ fontSize: '1.1rem' }}>📦</span>
            </div>
            <div style={{ marginTop: 4, marginBottom: 8 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 9999,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  backgroundColor: statusBg,
                  color: statusColor,
                  border: `1px solid ${statusBorder}`,
                  textTransform: 'capitalize',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: statusColor,
                  }}
                />
                {containerState}
              </span>
            </div>
            <div className="resource-card-sub">
              {isContainerRunning ? `Uptime: ${uptime}` : 'Container is stopped or exited'}
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Docker Managed Engine
          </div>
        </div>

        {/* Network Usage Card */}
        <div className="resource-card">
          <div>
            <div className="resource-card-header">
              <span className="resource-card-title">Network I/O</span>
              <span style={{ fontSize: '1.1rem' }}>🌐</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <div style={{ fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Received (RX):</span>
                <span className="text-mono" style={{ fontWeight: 600 }}>
                  {formatBytesDisplay(networkRxBytes)}
                </span>
              </div>
              <div style={{ fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Sent (TX):</span>
                <span className="text-mono" style={{ fontWeight: 600 }}>
                  {formatBytesDisplay(networkTxBytes)}
                </span>
              </div>
            </div>
          </div>
          <div className="resource-card-sub" style={{ marginTop: 10 }}>
            Cumulative container network transfer
          </div>
        </div>
      </div>

      {/* Estimated Resource Cost Card */}
      <div className="cost-card">
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                Estimated Resource Cost
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: 4,
                  backgroundColor: '#eff6ff',
                  color: '#2563eb',
                  fontWeight: 600,
                  border: '1px solid #bfdbfe',
                }}
              >
                Educational Simulation
              </span>
            </div>

            {costEstimate?.enabled ? (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)' }}>
                  ${costEstimate.monthlyUsd.toFixed(2)}{' '}
                  <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                    / month
                  </span>
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  (~${costEstimate.hourlyUsd.toFixed(4)} / hr)
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Cost estimate not configured
              </div>
            )}
          </div>

          {costEstimate?.enabled && costEstimate.breakdown && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>
              <div>Model: {costEstimate.breakdown.formula}</div>
              <div style={{ marginTop: 2 }}>
                Status: {isContainerRunning ? 'Active deployment running' : 'Container stopped (0 charge)'}
              </div>
            </div>
          )}
        </div>

        <div className="cost-disclaimer">
          <span>ℹ️</span>
          <span>
            {costEstimate?.disclaimer || 'This is an approximate estimate, not an actual cloud bill.'}
          </span>
        </div>
      </div>
    </div>
  );
}
