/**
 * ProjectPage.jsx — Single project detail view with Redeploy and Safe Rollback.
 * Route: /projects/:id
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import StatusBadge from '../components/StatusBadge';
import TriggerBadge from '../components/TriggerBadge';
import ResourceDashboard from '../components/ResourceDashboard';
import RollbackModal from '../components/RollbackModal';
import { apiGet, apiPost } from '../api/api';

export default function ProjectPage() {
  const { id }       = useParams();
  const navigate     = useNavigate();

  const [project,          setProject]          = useState(null);
  const [deployments,      setDeployments]      = useState([]);
  const [projectResources, setProjectResources] = useState(null);
  const [resLoading,       setResLoading]       = useState(true);
  const [resError,         setResError]         = useState('');
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [deploying,        setDeploying]        = useState(false);
  const [redeploying,      setRedeploying]      = useState(false);
  const [actionError,      setActionError]      = useState('');
  const [copied,           setCopied]           = useState(false);

  // Rollback Modal State
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [targetDeployment,  setTargetDeployment]  = useState(null);
  const [rollbackLoading,   setRollbackLoading]   = useState(false);
  const [rollbackError,     setRollbackError]     = useState('');

  const handleCopyUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const load = useCallback(async () => {
    try {
      const [pRes, dRes] = await Promise.all([
        apiGet(`/projects/${id}`),
        apiGet(`/deployments?projectId=${id}`),
      ]);
      setProject(pRes.data);
      setDeployments(dRes.data || []);
      setActionError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }

    // Load resources separately so main page loads instantly
    try {
      const rRes = await apiGet(`/projects/${id}/resources`);
      if (rRes.data?.resources) {
        setProjectResources(rRes.data.resources);
      }
    } catch (rErr) {
      setResError(rErr.message);
    } finally {
      setResLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Check if there's already a BUILDING deployment
  const hasActiveDeployment = deployments.some((d) => d.status === 'BUILDING');

  const handleDeploy = async () => {
    if (deploying || redeploying || hasActiveDeployment) return;

    setDeploying(true);
    setActionError('');

    try {
      const res = await apiPost('/deployments', { projectId: id });
      navigate(`/deployments/${res.data.deploymentId}`);
    } catch (err) {
      setActionError(err.message);
      setDeploying(false);
    }
  };

  const handleRedeployProject = async () => {
    if (deploying || redeploying || hasActiveDeployment) return;

    setRedeploying(true);
    setActionError('');

    try {
      const res = await apiPost(`/projects/${id}/redeploy`);
      navigate(`/deployments/${res.data.deploymentId}`);
    } catch (err) {
      setActionError(`Redeploy failed: ${err.message}`);
      setRedeploying(false);
    }
  };

  const handleRedeploySpecific = async (deploymentId) => {
    if (deploying || redeploying || hasActiveDeployment) return;

    setActionError('');
    try {
      const res = await apiPost(`/deployments/${deploymentId}/redeploy`);
      navigate(`/deployments/${res.data.deploymentId}`);
    } catch (err) {
      setActionError(`Redeploy failed: ${err.message}`);
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

  if (loading) return (
    <div>
      <Navbar role="user" />
      <div className="loading-page"><div className="spinner" /></div>
    </div>
  );

  if (error || !project) return (
    <div>
      <Navbar role="user" />
      <div className="container page-body">
        <div className="alert alert-error">{error || 'Project not found.'}</div>
        <Link to="/projects" className="btn btn-ghost btn-sm">← Back to Projects</Link>
      </div>
    </div>
  );

  const isOperationDisabled = deploying || redeploying || hasActiveDeployment;

  return (
    <div>
      <Navbar role="user" />
      <div className="container page-body">
        {/* Back */}
        <div style={{ marginBottom: 8 }}>
          <Link to="/projects" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
            ← Projects
          </Link>
        </div>

        {/* Heading + Actions */}
        <div className="page-heading flex-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: '1.75rem', fontWeight: 700, color: '#0f172a' }}>
              {project.name}
            </h1>
            {project.deploymentHostname && (
              <span className="text-mono" style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                {project.deploymentHostname}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {hasActiveDeployment && (
              <span style={{ fontSize: '0.85rem', color: '#2563eb', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="spinner-sm" /> Building…
              </span>
            )}
            <button
              id="redeploy-btn"
              className="btn btn-outline"
              onClick={handleRedeployProject}
              disabled={isOperationDisabled}
              title="Redeploy the latest commit on branch"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {redeploying ? 'Redeploying…' : '🔄 Redeploy Latest'}
            </button>
            <button
              id="deploy-btn"
              className="btn btn-primary"
              onClick={handleDeploy}
              disabled={isOperationDisabled}
              title="Trigger a new deployment"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {deploying ? 'Starting…' : '🚀 Deploy'}
            </button>
          </div>
        </div>

        {/* Action error banner */}
        {actionError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {actionError}
          </div>
        )}

        {/* Active Deployment URL Banner */}
        {project.deploymentUrl && (
          <div className="card" style={{
            marginBottom: 24,
            background: 'var(--card-bg, #ffffff)',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 20
          }}>
            <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Live Production URL
                </div>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                  <a
                    href={project.deploymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-mono"
                    style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--primary, #2563eb)' }}
                  >
                    {project.deploymentUrl}
                  </a>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleCopyUrl(project.deploymentUrl)}
                >
                  {copied ? '✓ Copied' : 'Copy URL'}
                </button>
                <a
                  href={project.deploymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                >
                  Open Application ↗
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Project Meta Information */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-title" style={{ marginBottom: 16 }}>Repository Configuration</div>
          <table className="info-table">
            <tbody>
              <tr>
                <td className="info-label">Repository</td>
                <td>
                  <a
                    href={project.repositoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-mono"
                  >
                    {project.repositoryName}
                  </a>
                </td>
              </tr>
              <tr>
                <td className="info-label">Branch</td>
                <td>
                  <span className="badge badge-secondary">{project.branch}</span>
                </td>
              </tr>
              <tr>
                <td className="info-label">Domain</td>
                <td className="text-mono">
                  {project.deploymentHostname || '—'}
                </td>
              </tr>
              <tr>
                <td className="info-label">Created</td>
                <td>{new Date(project.createdAt).toLocaleDateString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Phase 7: Live Resource Monitoring */}
        {projectResources && (
          <ResourceDashboard
            resources={projectResources}
            loading={resLoading}
            error={resError}
            isLiveSocket={false}
          />
        )}

        {/* Deployments History Section */}
        <div className="section" style={{ marginTop: 24 }}>
          <div className="flex-between" style={{ marginBottom: 14 }}>
            <div>
              <h2 className="section-title" style={{ margin: '0 0 2px' }}>Deployments & Rollback History</h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                All builds for this repository. Restore any prior successful release with safe zero-downtime rollback.
              </p>
            </div>
            <Link to="/deployments" className="btn btn-ghost btn-sm">View all projects</Link>
          </div>

          <div className="table-wrap">
            {deployments.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🚀</div>
                <div className="empty-state-text">
                  No deployments yet. Click <strong>Deploy</strong> to get started.
                </div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Version ID</th>
                    <th>Commit</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Port / URL</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d) => (
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
                            }}>
                              ACTIVE
                            </span>
                          )}
                        </div>
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
                              maxWidth: '180px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
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
                            <div style={{ fontSize: '0.7rem', color: '#ef4444', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.errorMessage}>
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
                          <a href={d.deploymentUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
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
                            View
                          </Link>

                          {/* One-click Redeploy button */}
                          <button
                            onClick={() => handleRedeploySpecific(d.id)}
                            disabled={isOperationDisabled || d.status === 'BUILDING'}
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                            title="Redeploy this specific commit"
                          >
                            🔄 Redeploy
                          </button>

                          {/* Safe Rollback button: available if previously successful LIVE and not currently active */}
                          {d.status === 'LIVE' && !d.isActive && (
                            <button
                              onClick={() => openRollbackDialog(d)}
                              disabled={isOperationDisabled}
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: '0.75rem', padding: '3px 8px', backgroundColor: '#4f46e5' }}
                              title="Safely rollback to this version with automated health verification"
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
