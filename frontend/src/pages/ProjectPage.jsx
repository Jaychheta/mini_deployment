/**
 * ProjectPage.jsx — Single project detail view.
 * Route: /projects/:id
 *
 * Phase 4: Deploy button is now enabled.
 *   - Clicking Deploy calls POST /api/deployments
 *   - Button is disabled while a deployment is BUILDING
 *   - User is redirected to the deployment detail page after trigger
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import StatusBadge from '../components/StatusBadge';
import { apiGet, apiPost } from '../api/api';

export default function ProjectPage() {
  const { id }       = useParams();
  const navigate     = useNavigate();

  const [project,     setProject]     = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [deploying,   setDeploying]   = useState(false);
  const [deployError, setDeployError] = useState('');

  const load = useCallback(async () => {
    try {
      const [pRes, dRes] = await Promise.all([
        apiGet(`/projects/${id}`),
        apiGet(`/deployments?projectId=${id}`),
      ]);
      setProject(pRes.data);
      setDeployments(dRes.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Check if there's already a BUILDING deployment
  const hasActiveDeployment = deployments.some((d) => d.status === 'BUILDING');

  const handleDeploy = async () => {
    if (deploying || hasActiveDeployment) return;

    setDeploying(true);
    setDeployError('');

    try {
      const res = await apiPost('/deployments', { projectId: id });
      const { deploymentId } = res.data;
      // Navigate to the deployment detail page immediately
      navigate(`/deployments/${deploymentId}`);
    } catch (err) {
      setDeployError(err.message);
      setDeploying(false);
    }
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

  const isDeployDisabled = deploying || hasActiveDeployment;
  const deployBtnTitle   = hasActiveDeployment
    ? 'A deployment is already in progress'
    : deploying
      ? 'Starting deployment...'
      : 'Deploy this project';

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

        {/* Heading + Deploy button */}
        <div className="page-heading flex-between">
          <div>
            <h1>{project.name}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {hasActiveDeployment && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Deployment in progress…
              </span>
            )}
            <button
              id="deploy-btn"
              className="btn btn-primary"
              onClick={handleDeploy}
              disabled={isDeployDisabled}
              title={deployBtnTitle}
            >
              {deploying ? 'Starting…' : hasActiveDeployment ? 'Building…' : 'Deploy'}
            </button>
          </div>
        </div>

        {/* Deploy error */}
        {deployError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {deployError}
          </div>
        )}

        {/* Project details */}
        <div className="card" style={{ marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Repository', project.repositoryUrl || project.repositoryName || '—'],
                ['Branch',     project.branch || 'main'],
                ['GitHub',     'Connected'],
                ['Created',    new Date(project.createdAt).toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td style={{
                    padding: '10px 0',
                    color: 'var(--text-muted)',
                    fontSize: '0.875rem',
                    width: 140,
                    verticalAlign: 'middle',
                  }}>
                    {label}
                  </td>
                  <td style={{
                    padding: '10px 0',
                    fontSize: '0.875rem',
                    color: label === 'GitHub' ? '#16a34a' : 'var(--text)',
                    verticalAlign: 'middle',
                  }}>
                    {label === 'Repository' ? (
                      <a
                        href={project.repositoryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-mono"
                        style={{ color: 'var(--text)' }}
                      >
                        {project.repositoryUrl}
                      </a>
                    ) : typeof value === 'string' ? (
                      <span className={label === 'Branch' ? 'text-mono' : ''}>
                        {value}
                      </span>
                    ) : value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Deployments section */}
        <div className="section">
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <div className="section-title">Deployments</div>
            <Link to="/deployments" className="btn btn-ghost btn-sm">View all</Link>
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
                    <th>Commit</th>
                    <th>Status</th>
                    <th>Port</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.slice(0, 5).map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className="td-mono">{d.commitHash ? d.commitHash.slice(0, 7) : '—'}</span>
                      </td>
                      <td><StatusBadge status={d.status} /></td>
                      <td className="td-muted td-mono">{d.containerPort || '—'}</td>
                      <td className="td-muted">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <Link to={`/deployments/${d.id}`} className="btn btn-ghost btn-sm">
                          View
                        </Link>
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
