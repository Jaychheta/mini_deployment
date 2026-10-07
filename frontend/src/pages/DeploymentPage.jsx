/**
 * DeploymentPage.jsx — Single deployment detail with build log and status polling.
 * Route: /deployments/:id
 *
 * Phase 4:
 *   - Polls GET /api/deployments/:id every 3 seconds while status = BUILDING
 *   - Shows container ID, host port, commit hash
 *   - Displays full deployment logs from the database
 *   - Renders clear success/failure message
 *   - Stops polling when status becomes LIVE or FAILED
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import StatusBadge from '../components/StatusBadge';
import { apiGet } from '../api/api';

const POLL_INTERVAL_MS = 3000; // poll every 3 seconds while BUILDING

export default function DeploymentPage() {
  const { id }                        = useParams();
  const [deployment, setDeployment]   = useState(null);
  const [loading,    setLoading]      = useState(true);
  const [error,      setError]        = useState('');
  const pollRef                       = useRef(null);
  const logBodyRef                    = useRef(null);

  const fetchDeployment = useCallback(async () => {
    try {
      const res = await apiGet(`/deployments/${id}`);
      setDeployment(res.data);
      return res.data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Auto-scroll log terminal to bottom
  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [deployment?.logs]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const d = await fetchDeployment();
      if (!d) return; // error — stop polling

      if (!cancelled && d.status === 'BUILDING') {
        // Schedule next poll
        pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
      // If LIVE or FAILED, polling stops automatically
    };

    poll();

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchDeployment]);

  if (loading) return (
    <div>
      <Navbar role="user" />
      <div className="loading-page"><div className="spinner" /></div>
    </div>
  );

  if (error || !deployment) return (
    <div>
      <Navbar role="user" />
      <div className="container page-body">
        <div className="alert alert-error">{error || 'Deployment not found.'}</div>
        <Link to="/deployments" className="btn btn-ghost btn-sm">← Back</Link>
      </div>
    </div>
  );

  const isBuilding = deployment.status === 'BUILDING';
  const isLive     = deployment.status === 'LIVE';
  const isFailed   = deployment.status === 'FAILED';

  // Parse the logs string into lines for display
  const logLines = deployment.logs
    ? deployment.logs.split('\n').filter((l) => l.trim())
    : [];

  // Extract a user-friendly failure reason from logs
  const getFailureReason = () => {
    if (!deployment.logs) return 'An error occurred during deployment.';
    const errorLines = logLines.filter((l) => l.includes('[ERROR]'));
    if (errorLines.length > 0) {
      return errorLines[errorLines.length - 1].replace(/^\[.*?\]\s*\[ERROR\]\s*/, '');
    }
    return 'An error occurred during deployment. See logs below for details.';
  };

  return (
    <div>
      <Navbar role="user" />
      <div className="container page-body">
        <div style={{ marginBottom: 8 }}>
          <Link to="/deployments" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
            ← Deployments
          </Link>
        </div>

        <div className="page-heading flex-between">
          <div>
            <h1>Deployment</h1>
            <div style={{ marginTop: 4 }}>
              <StatusBadge status={deployment.status} />
              {isBuilding && (
                <span style={{ marginLeft: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  (refreshing every {POLL_INTERVAL_MS / 1000}s…)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Success banner */}
        {isLive && (
          <div className="alert" style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 16,
            fontSize: '0.875rem',
          }}>
            ✅ Deployment is LIVE on port <strong>{deployment.containerPort}</strong>
            {' — '}
            <a
              href={`http://localhost:${deployment.containerPort}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#15803d', textDecoration: 'underline' }}
            >
              http://localhost:{deployment.containerPort}
            </a>
          </div>
        )}

        {/* Failure banner */}
        {isFailed && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <strong>Deployment failed.</strong>
            <br />
            <span style={{ fontSize: '0.875rem' }}>{getFailureReason()}</span>
          </div>
        )}

        {/* Deployment details */}
        <div className="card" style={{ marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Deployment ID', <span className="text-mono" key="id">#{deployment.id.slice(0, 8)}</span>],
                ['Status',        <StatusBadge status={deployment.status} key="status" />],
                ['Commit',        <span className="text-mono" key="commit">{deployment.commitHash ? deployment.commitHash.slice(0, 7) : '—'}</span>],
                ['Container',     <span className="text-mono" key="cid">{deployment.containerId ? deployment.containerId.slice(0, 12) : '—'}</span>],
                ['Host Port',     <span className="text-mono" key="port">{deployment.containerPort || '—'}</span>],
                ['Started',       new Date(deployment.createdAt).toLocaleString()],
                ['Finished',      deployment.completedAt ? new Date(deployment.completedAt).toLocaleString() : (isBuilding ? 'In progress…' : '—')],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td style={{ padding: '10px 0', color: 'var(--text-muted)', fontSize: '0.875rem', width: 140, verticalAlign: 'middle' }}>
                    {label}
                  </td>
                  <td style={{ padding: '10px 0', fontSize: '0.875rem', color: 'var(--text)', verticalAlign: 'middle' }}>
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Build log terminal */}
        <div className="section-title">Deployment Logs</div>
        <div className="terminal" style={{ marginTop: 12 }}>
          <div className="terminal-bar">
            <div className="terminal-bar-dot" style={{ background: '#ff5f57' }} />
            <div className="terminal-bar-dot" style={{ background: '#febc2e' }} />
            <div className="terminal-bar-dot" style={{ background: '#28c840' }} />
            <span className="terminal-bar-title">Build Output</span>
            {isBuilding && (
              <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: '0.7rem' }}>
                ● streaming…
              </span>
            )}
          </div>
          <div
            className="terminal-body"
            ref={logBodyRef}
            style={{ maxHeight: 400, overflowY: 'auto' }}
          >
            {logLines.length === 0 ? (
              <div>
                <span className="terminal-line-prompt">$</span>{' '}
                <span className="terminal-line-waiting">
                  {isBuilding ? 'Starting deployment pipeline…' : 'No logs available.'}
                </span>
              </div>
            ) : (
              logLines.map((line, i) => {
                const isError   = line.includes('[ERROR]');
                const isSuccess = line.includes('LIVE') || line.includes('Health check passed');
                const color     = isError ? '#ef4444' : isSuccess ? '#22c55e' : undefined;
                return (
                  <div key={i} style={{ color }}>
                    <span className="terminal-line-prompt">›</span>{' '}
                    {line.replace(/^\[\d{2}:\d{2}:\d{2}\] /, '')}
                  </div>
                );
              })
            )}
            {isBuilding && (
              <div>
                <span className="terminal-line-prompt">$</span>{' '}
                <span className="terminal-line-waiting" style={{ animation: 'none', color: '#6b7280' }}>
                  waiting for next update…
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
