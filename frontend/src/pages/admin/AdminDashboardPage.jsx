/**
 * AdminDashboardPage.jsx — Admin overview with platform-wide statistics and Docker resource monitoring.
 * Route: /admin/dashboard
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import StatusBadge from '../../components/StatusBadge';
import { apiGet } from '../../api/api';

export default function AdminDashboardPage() {
  const [stats,            setStats]            = useState(null);
  const [deployments,      setDeployments]      = useState([]);
  const [resourceSummary,  setResourceSummary]  = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [sRes, dRes, rRes] = await Promise.all([
          apiGet('/admin/stats'),
          apiGet('/admin/deployments'),
          apiGet('/admin/resources/summary').catch(() => ({ data: null })),
        ]);
        setStats(sRes.data);
        setDeployments(dRes.data || []);
        if (rRes?.data) {
          setResourceSummary(rRes.data);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div>
      <Navbar role="admin" />
      <div className="container page-body">
        <div className="page-heading">
          <h1>Admin Dashboard</h1>
          <p>Platform-wide overview of users, projects, deployments, and Docker container resources.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {/* Stats */}
        <div className="stats-row">
          {[
            { label: 'Users',        value: stats?.users,       cls: '' },
            { label: 'Projects',     value: stats?.projects,    cls: '' },
            { label: 'Deployments',  value: stats?.deployments, cls: '' },
            { label: 'Live',         value: stats?.live,        cls: 'live' },
            { label: 'Failed',       value: stats?.failed,      cls: 'failed' },
          ].map((s) => (
            <div className="stat-box" key={s.label}>
              <div className={`stat-box-value ${s.cls}`}>{loading ? '—' : (s.value ?? 0)}</div>
              <div className="stat-box-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Phase 7: Platform Resource Summary */}
        {resourceSummary && (
          <div className="card" style={{ marginBottom: 24, padding: 20 }}>
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Docker Platform Resource Summary</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Real-time statistics from host Docker engine
                </p>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Sampled: {new Date(resourceSummary.latestSampledAt).toLocaleTimeString()}
              </span>
            </div>

            <div className="stats-row" style={{ marginBottom: 16 }}>
              <div className="stat-box">
                <div className="stat-box-value live">{resourceSummary.totalActiveContainers}</div>
                <div className="stat-box-label">Active Containers</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-value">{resourceSummary.totalMonitoredDeployments}</div>
                <div className="stat-box-label">Total Monitored</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-value">{resourceSummary.aggregateCpuPercent}%</div>
                <div className="stat-box-label">Aggregate CPU</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-value">{resourceSummary.aggregateMemoryUsedMb} MB</div>
                <div className="stat-box-label">Aggregate RAM Used</div>
              </div>
            </div>

            {/* Container breakdown table */}
            {resourceSummary.containers && resourceSummary.containers.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Container ID</th>
                      <th>Project</th>
                      <th>Owner</th>
                      <th>Port</th>
                      <th>Status</th>
                      <th>CPU %</th>
                      <th>Memory</th>
                      <th>Uptime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resourceSummary.containers.map((c) => (
                      <tr key={c.deploymentId}>
                        <td>
                          <span className="td-mono">{c.containerId ? c.containerId.slice(0, 12) : '—'}</span>
                        </td>
                        <td className="td-primary">{c.projectName}</td>
                        <td>{c.userName}</td>
                        <td className="td-mono">:{c.containerPort}</td>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: c.isRunning ? '#f0fdf4' : '#fef2f2',
                              color: c.isRunning ? '#16a34a' : '#dc2626',
                              textTransform: 'capitalize',
                            }}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="td-mono">{c.cpuPercent != null ? `${c.cpuPercent}%` : '—'}</td>
                        <td className="td-mono">{c.memoryUsedMb != null ? `${c.memoryUsedMb} MB` : '—'}</td>
                        <td className="td-muted">{c.uptime || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Recent deployments */}
        <div className="section">
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <div className="section-title">Recent Deployments</div>
            <Link to="/admin/deployments" className="btn btn-ghost btn-sm">View all</Link>
          </div>

          <div className="table-wrap">
            {loading ? (
              <div className="empty-state"><div className="spinner" /></div>
            ) : deployments.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🚀</div>
                <div className="empty-state-text">No deployments yet.</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>User</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.slice(0, 10).map((d) => (
                    <tr key={d.id}>
                      <td className="td-primary">{d.projectName}</td>
                      <td>{d.ownerName}</td>
                      <td><StatusBadge status={d.status} /></td>
                      <td className="td-muted">
                        {new Date(d.createdAt).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

