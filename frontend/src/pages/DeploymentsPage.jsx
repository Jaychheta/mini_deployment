/**
 * DeploymentsPage.jsx — Enhanced user deployments history with filters, redeploy, and safe rollback.
 * Route: /deployments
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import StatusBadge from '../components/StatusBadge';
import TriggerBadge from '../components/TriggerBadge';
import RollbackModal from '../components/RollbackModal';
import { apiGet, apiPost } from '../api/api';

export default function DeploymentsPage() {
  const [deployments,    setDeployments]    = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [statusFilter,   setStatusFilter]   = useState('ALL');
  const [sourceFilter,   setSourceFilter]   = useState('ALL');
  const [searchQuery,    setSearchQuery]    = useState('');
  const [actionLoading,  setActionLoading]  = useState({});
  const [actionError,    setActionError]    = useState('');

  // Rollback Modal State
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [targetDeployment,  setTargetDeployment]  = useState(null);
  const [rollbackLoading,   setRollbackLoading]   = useState(false);
  const [rollbackError,     setRollbackError]     = useState('');

  const navigate = useNavigate();

  const loadDeployments = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (sourceFilter !== 'ALL') params.append('source', sourceFilter);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await apiGet(`/deployments${qs}`);
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

  const handleRedeploy = async (deploymentId) => {
    if (actionLoading[deploymentId]) return;
    setActionLoading((prev) => ({ ...prev, [deploymentId]: true }));
    setActionError('');

    try {
      const res = await apiPost(`/deployments/${deploymentId}/redeploy`);
      navigate(`/deployments/${res.data.deploymentId}`);
    } catch (err) {
      setActionError(`Redeploy failed: ${err.message}`);
      setActionLoading((prev) => ({ ...prev, [deploymentId]: false }));
    }
  };

  const openRollbackDialog = (deployment) => {
    setTargetDeployment(deployment);
    setRollbackError('');
    setRollbackModalOpen(true);
  };

  const handleConfirmRollback = async (deployment) => {
    setRollbackLoading(true);
    setRollbackError('');

    try {
      const res = await apiPost(`/deployments/${deployment.id}/rollback`);
      setRollbackModalOpen(false);
      navigate(`/deployments/${res.data.deploymentId}`);
    } catch (err) {
      setRollbackError(err.message);
    } finally {
      setRollbackLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    if (seconds == null || isNaN(seconds)) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const filteredDeployments = deployments.filter((d) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const idMatch = d.id.toLowerCase().includes(q);
    const projMatch = (d.projectName || '').toLowerCase().includes(q);
    const commitMatch = (d.commitHash || '').toLowerCase().includes(q);
    const msgMatch = (d.commitMessage || '').toLowerCase().includes(q);
    return idMatch || projMatch || commitMatch || msgMatch;
  });

  return (
    <div>
      <Navbar role="user" />
      <div className="container page-body">
        <div className="flex-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 4px', color: '#0f172a' }}>
              Deployments History
            </h1>
            <p style={{ color: '#64748b', margin: 0, fontSize: '0.95rem' }}>
              Track builds, one-click redeploy, and safely rollback to any previous version.
            </p>
          </div>
          <button
            onClick={loadDeployments}
            className="btn btn-outline btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            🔄 Refresh
          </button>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
        {actionError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{actionError}</div>}

        {/* Filters Toolbar */}
        <div className="card" style={{ padding: '16px 20px', marginBottom: 20, backgroundColor: '#ffffff', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {/* Search input */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search by ID, project, commit..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.875rem',
                    minWidth: '240px',
                  }}
                />
              </div>

              {/* Status filter dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: '#64748b' }}>Status:</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    backgroundColor: '#fff',
                  }}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="LIVE">Live</option>
                  <option value="BUILDING">Building</option>
                  <option value="FAILED">Failed</option>
                  <option value="STOPPED">Stopped</option>
                </select>
              </div>

              {/* Source filter dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: '#64748b' }}>Trigger:</label>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    backgroundColor: '#fff',
                  }}
                >
                  <option value="ALL">All Triggers</option>
                  <option value="MANUAL">Manual</option>
                  <option value="WEBHOOK">GitHub Push</option>
                  <option value="REDEPLOY">Redeploy</option>
                  <option value="ROLLBACK">Rollback</option>
                </select>
              </div>
            </div>

            <div style={{ fontSize: '0.825rem', color: '#64748b' }}>
              Showing {filteredDeployments.length} deployment{filteredDeployments.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        {/* Deployments Table */}
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : filteredDeployments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🚀</div>
              <div className="empty-state-text">No deployments found matching the criteria.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Deployment ID</th>
                  <th>Project</th>
                  <th>Commit</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Live Route</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeployments.map((d) => (
                  <tr key={d.id} style={{ backgroundColor: d.isActive ? '#f8fafc' : undefined }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="td-mono" style={{ fontWeight: 600 }}>
                          #{d.id.slice(0, 8)}
                        </span>
                        {d.isActive && (
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '1px 6px',
                            borderRadius: 4,
                            backgroundColor: '#22c55e',
                            color: '#fff',
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                          }}>
                            ACTIVE LIVE
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <Link to={`/projects/${d.projectId}`} style={{ fontWeight: 600, color: 'inherit' }}>
                        {d.projectName || 'Project'}
                      </Link>
                    </td>
                    <td>
                      <div>
                        <span className="td-mono" style={{ color: '#2563eb', fontWeight: 600 }}>
                          {d.commitHash ? d.commitHash.slice(0, 7) : '—'}
                        </span>
                        {d.commitMessage && (
                          <div style={{
                            fontSize: '0.75rem',
                            color: '#64748b',
                            maxWidth: '220px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }} title={d.commitMessage}>
                            {d.commitMessage}
                          </div>
                        )}
                      </div>
                    </td>
                    <td><TriggerBadge source={d.deploymentSource} /></td>
                    <td>
                      <div>
                        <StatusBadge status={d.status} />
                        {d.status === 'FAILED' && d.errorMessage && (
                          <div style={{ fontSize: '0.72rem', color: '#ef4444', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.errorMessage}>
                            {d.errorMessage}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="td-muted td-mono" style={{ fontSize: '0.825rem' }}>
                      {formatDuration(d.durationSeconds)}
                    </td>
                    <td className="td-muted td-mono" style={{ fontSize: '0.825rem' }}>
                      {d.deploymentUrl ? (
                        <a href={d.deploymentUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                          {d.deploymentUrl}
                        </a>
                      ) : d.containerPort ? (
                        `:${d.containerPort}`
                      ) : '—'}
                    </td>
                    <td className="td-muted" style={{ fontSize: '0.825rem' }}>
                      {new Date(d.createdAt).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                        <Link to={`/deployments/${d.id}`} className="btn btn-ghost btn-sm">
                          Logs
                        </Link>

                        {/* Redeploy button */}
                        <button
                          onClick={() => handleRedeploy(d.id)}
                          disabled={actionLoading[d.id] || d.status === 'BUILDING'}
                          className="btn btn-outline btn-sm"
                          style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                          title="Redeploy this commit in a fresh container"
                        >
                          {actionLoading[d.id] ? '...' : '🔄 Redeploy'}
                        </button>

                        {/* Rollback button: enabled if LIVE and not currently active */}
                        {d.status === 'LIVE' && !d.isActive && (
                          <button
                            onClick={() => openRollbackDialog(d)}
                            className="btn btn-primary btn-sm"
                            style={{ fontSize: '0.75rem', padding: '3px 8px', backgroundColor: '#4f46e5' }}
                            title="Safely restore this version with zero downtime"
                          >
                            ⏪ Rollback
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Reusable Rollback Confirmation Modal */}
      <RollbackModal
        isOpen={rollbackModalOpen}
        targetDeployment={targetDeployment}
        onClose={() => setRollbackModalOpen(false)}
        onConfirm={handleConfirmRollback}
        loading={rollbackLoading}
        error={rollbackError}
      />
    </div>
  );
}
