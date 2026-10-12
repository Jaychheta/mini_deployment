/**
 * AdminDeploymentsPage.jsx — Admin view of all deployments platform-wide with filters and cleanup action.
 * Route: /admin/deployments
 */

import { useState, useEffect, useCallback } from 'react';
import Navbar from '../../components/Navbar';
import StatusBadge from '../../components/StatusBadge';
import TriggerBadge from '../../components/TriggerBadge';
import { apiGet, apiPost } from '../../api/api';

export default function AdminDeploymentsPage() {
  const [deployments,  setDeployments]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [cleaning,     setCleaning]     = useState(false);
  const [cleanMessage, setCleanMessage] = useState('');

  const loadDeployments = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (sourceFilter !== 'ALL') params.append('source', sourceFilter);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await apiGet(`/admin/deployments${qs}`);
      setDeployments(res.data || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter]);

  useEffect(() => {
    loadDeployments();
  }, [loadDeployments]);

  const handleTriggerCleanup = async () => {
    if (cleaning) return;
    setCleaning(true);
    setCleanMessage('');
    try {
      const res = await apiPost('/admin/cleanup');
      setCleanMessage(res.message);
      loadDeployments();
    } catch (err) {
      setError(`Cleanup failed: ${err.message}`);
    } finally {
      setCleaning(false);
    }
  };

  const formatDuration = (seconds) => {
    if (seconds == null || isNaN(seconds)) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div>
      <Navbar role="admin" />
      <div className="container page-body">
        <div className="flex-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: '1.75rem', fontWeight: 700, color: '#0f172a' }}>
              All Platform Deployments
            </h1>
            <p style={{ color: '#64748b', margin: 0, fontSize: '0.95rem' }}>
              Every deployment across all users and projects.
            </p>
          </div>
          <button
            onClick={handleTriggerCleanup}
            disabled={cleaning}
            className="btn btn-outline btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            title="Safely retire stale containers while preserving live production containers"
          >
            {cleaning ? 'Cleaning…' : '🧹 Safe Container Cleanup'}
          </button>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
        {cleanMessage && <div className="alert" style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', marginBottom: 16, padding: '10px 14px', borderRadius: 8 }}>{cleanMessage}</div>}

        {/* Filters */}
        <div className="card" style={{ padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: '#64748b' }}>Status:</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="LIVE">Live</option>
                  <option value="BUILDING">Building</option>
                  <option value="FAILED">Failed</option>
                  <option value="STOPPED">Stopped</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: '#64748b' }}>Trigger:</label>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                >
                  <option value="ALL">All Triggers</option>
                  <option value="MANUAL">Manual</option>
                  <option value="WEBHOOK">Push</option>
                  <option value="REDEPLOY">Redeploy</option>
                  <option value="ROLLBACK">Rollback</option>
                </select>
              </div>
            </div>

            <span style={{ fontSize: '0.825rem', color: '#64748b' }}>
              Total: {deployments.length}
            </span>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : deployments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🚀</div>
              <div className="empty-state-text">No deployments found.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Project</th>
                  <th>Owner</th>
                  <th>Commit</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.id} style={{ backgroundColor: d.isActive ? '#f8fafc' : undefined }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="td-mono td-muted">#{d.id.slice(0, 8)}</span>
                        {d.isActive && (
                          <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: 4, backgroundColor: '#22c55e', color: '#fff', fontWeight: 700 }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="td-primary" style={{ fontWeight: 600 }}>{d.projectName}</td>
                    <td>{d.ownerName}</td>
                    <td>
                      <span className="td-mono" style={{ color: '#2563eb' }}>
                        {d.commitHash ? d.commitHash.slice(0, 7) : '—'}
                      </span>
                    </td>
                    <td><TriggerBadge source={d.deploymentSource} /></td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className="td-muted td-mono" style={{ fontSize: '0.825rem' }}>
                      {formatDuration(d.durationSeconds)}
                    </td>
                    <td className="td-muted" style={{ fontSize: '0.825rem' }}>
                      {new Date(d.createdAt).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
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
  );
}
