/**
 * DeploymentPage.jsx — Single deployment detail with Real-Time Socket.IO build logs & status updates.
 * Route: /deployments/:id
 *
 * Phase 5:
 *   - Real-time build log streaming over Socket.IO (room: deployment:<id>)
 *   - Automatic live status updates (BUILDING → LIVE / FAILED) without page refresh
 *   - Initial load via REST API for historical logs
 *   - Displays Deployment Source (Manual vs GitHub Push)
 *   - Reconnect handling & REST polling fallback
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import Navbar from '../components/Navbar';
import StatusBadge from '../components/StatusBadge';
import TriggerBadge from '../components/TriggerBadge';
import ResourceDashboard from '../components/ResourceDashboard';
import ResourceHistoryCharts from '../components/ResourceHistoryCharts';
import RollbackModal from '../components/RollbackModal';
import { apiGet, apiPost, apiDelete } from '../api/api';
import { useNavigate } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace('/api', '')
  : 'http://localhost:3001';

const POLL_INTERVAL_MS = 3000;

export default function DeploymentPage() {
  const { id }                      = useParams();
  const [deployment, setDeployment] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [socketConnected, setSocketConnected] = useState(false);
  const [liveLogs,   setLiveLogs]   = useState([]);
  const [copied,     setCopied]     = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [actionError, setActionError] = useState('');

  // Rollback Modal State
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [rollbackLoading,   setRollbackLoading]   = useState(false);
  const [rollbackError,     setRollbackError]     = useState('');

  // Phase 7: Resource Monitoring & History State
  const [resources,     setResources]     = useState(null);
  const [resLoading,    setResLoading]    = useState(true);
  const [resError,      setResError]      = useState('');
  const [history,       setHistory]       = useState([]);
  const [histLoading,   setHistLoading]   = useState(false);
  const [histError,     setHistError]     = useState('');
  const [historyPeriod, setHistoryPeriod] = useState('1h');

  const navigate = useNavigate();

  const handleRedeploy = async () => {
    if (redeploying) return;
    setRedeploying(true);
    setActionError('');
    try {
      const res = await apiPost(`/deployments/${id}/redeploy`);
      navigate(`/deployments/${res.data.deploymentId}`);
    } catch (err) {
      setActionError(`Redeploy failed: ${err.message}`);
      setRedeploying(false);
    }
  };

  const handleConfirmRollback = async () => {
    setRollbackLoading(true);
    setRollbackError('');
    try {
      const res = await apiPost(`/deployments/${id}/rollback`);
      setRollbackModalOpen(false);
      navigate(`/deployments/${res.data.deploymentId}`);
    } catch (err) {
      setRollbackError(err.message);
    } finally {
      setRollbackLoading(false);
    }
  };

  const pollRef     = useRef(null);
  const socketRef   = useRef(null);
  const logBodyRef  = useRef(null);


  const fetchDeployment = useCallback(async () => {
    try {
      const res = await apiGet(`/deployments/${id}`);
      setDeployment(res.data);
      if (res.data.logs) {
        setLiveLogs(res.data.logs.split('\n').filter((l) => l.trim()));
      }
      return res.data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchResources = useCallback(async () => {
    try {
      const res = await apiGet(`/deployments/${id}/resources`);
      setResources(res.data);
    } catch (err) {
      setResError(err.message);
    } finally {
      setResLoading(false);
    }
  }, [id]);

  const fetchHistory = useCallback(async (p) => {
    setHistLoading(true);
    setHistError('');
    try {
      const res = await apiGet(`/deployments/${id}/resources/history?period=${p}`);
      setHistory(res.data || []);
    } catch (err) {
      setHistError(err.message);
    } finally {
      setHistLoading(false);
    }
  }, [id]);

  // Auto-scroll log terminal to bottom
  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [liveLogs]);

  // 1. Initial REST API load
  useEffect(() => {
    fetchDeployment();
    fetchResources();
    fetchHistory(historyPeriod);
  }, [fetchDeployment, fetchResources, fetchHistory, historyPeriod]);

  // 2. Socket.IO Real-Time Connection
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !id) return;

    const socket = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('deployment:join', { deploymentId: id });
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('deployment:status', (data) => {
      if (data.deploymentId === id) {
        setDeployment((prev) => prev ? { ...prev, status: data.status, containerPort: data.containerPort || prev.containerPort } : prev);
      }
    });

    socket.on('deployment:log', (data) => {
      if (data.deploymentId === id && data.message) {
        setLiveLogs((prev) => [...prev, data.message]);
      }
    });

    socket.on('deployment:history', (data) => {
      if (data.deploymentId === id && data.logs) {
        setLiveLogs(data.logs.split('\n').filter((l) => l.trim()));
      }
    });

    socket.on('deployment:complete', (data) => {
      if (data.deploymentId === id) {
        setDeployment((prev) => prev ? {
          ...prev,
          status: 'LIVE',
          containerPort: data.containerPort || prev.containerPort,
          containerId: data.containerId || prev.containerId,
          deploymentUrl: data.deploymentUrl || prev.deploymentUrl,
          hostname: data.hostname || prev.hostname,
        } : prev);
        // Refresh resources on complete
        fetchResources();
      }
    });

    socket.on('deployment:error', (data) => {
      if (data.deploymentId === id) {
        setDeployment((prev) => prev ? { ...prev, status: 'FAILED' } : prev);
      }
    });

    // Phase 7: Real-Time Resource Updates over Socket.IO
    socket.on('resources:update', (data) => {
      if (data.deploymentId === id) {
        setResources(data);
        setHistory((prev) => {
          if (!data.sampledAt) return prev;
          if (prev.length > 0 && prev[prev.length - 1].recordedAt === data.sampledAt) {
            return prev;
          }
          return [
            ...prev.slice(-499),
            {
              id: `rt-${Date.now()}`,
              cpuPercent: data.cpuPercent,
              memoryUsedMb: data.memoryUsedMb,
              memoryLimitMb: data.memoryLimitMb,
              memoryPercent: data.memoryPercent,
              networkRxBytes: data.networkRxBytes,
              networkTxBytes: data.networkTxBytes,
              containerState: data.containerState,
              recordedAt: data.sampledAt,
            },
          ];
        });
      }
    });

    socket.on('resources:error', (data) => {
      if (data.deploymentId === id) {
        setResError(data.error);
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('deployment:leave', { deploymentId: id });
        socketRef.current.disconnect();
      }
    };
  }, [id, fetchResources]);


  // 3. Fallback REST Polling while BUILDING (in case socket drops)
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const d = await fetchDeployment();
      if (!d) return;

      if (!cancelled && d.status === 'BUILDING') {
        pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    if (deployment?.status === 'BUILDING' && !socketConnected) {
      pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [deployment?.status, socketConnected, fetchDeployment]);

  const handleCopyUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this deployment? This will stop its container permanently.')) return;
    setDeleting(true);
    try {
      await apiDelete(`/deployments/${id}`);
      navigate('/deployments');
    } catch (err) {
      alert(err.message || 'Failed to delete deployment');
      setDeleting(false);
    }
  };

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

  const getFailureReason = () => {
    if (liveLogs.length === 0) return 'An error occurred during deployment.';
    const errorLines = liveLogs.filter((l) => l.includes('[ERROR]'));
    if (errorLines.length > 0) {
      return errorLines[errorLines.length - 1].replace(/^\[.*?\]\s*\[ERROR\]\s*/, '');
    }
    return 'An error occurred during deployment. See logs below for details.';
  };

  const formatSource = (src) => {
    if (src === 'WEBHOOK') return '⚡ GitHub Push (Webhook)';
    return '👤 Manual Trigger';
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
            <h1>Deployment #{deployment.id.slice(0, 8)}</h1>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusBadge status={deployment.status} />
              {isBuilding && (
                <span style={{ fontSize: '0.8rem', color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                  {socketConnected ? 'Real-Time Streaming' : 'Polling status…'}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {deployment.isActive && (
              <span style={{
                fontSize: '0.75rem',
                padding: '3px 8px',
                borderRadius: 4,
                backgroundColor: '#22c55e',
                color: '#fff',
                fontWeight: 700,
              }}>
                ⭐ ACTIVE PRODUCTION
              </span>
            )}

            <button
              className="btn btn-outline btn-sm"
              onClick={handleRedeploy}
              disabled={redeploying || isBuilding}
              title="Redeploy this commit in a fresh container"
            >
              {redeploying ? 'Starting…' : '🔄 Redeploy'}
            </button>

            {isLive && !deployment.isActive && (
              <button
                className="btn btn-primary btn-sm"
                style={{ backgroundColor: '#4f46e5' }}
                onClick={() => { setRollbackError(''); setRollbackModalOpen(true); }}
                disabled={redeploying || isBuilding}
                title="Safely restore this version with zero downtime"
              >
                ⏪ Rollback to this version
              </button>
            )}

            {isLive && deployment.deploymentUrl && (
              <>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleCopyUrl(deployment.deploymentUrl)}
                >
                  {copied ? '✓ Copied' : 'Copy URL'}
                </button>
                <a
                  href={deployment.deploymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                >
                  Open App ↗
                </a>
              </>
            )}

            <button
              className="btn btn-outline btn-sm"
              style={{ borderColor: '#ef4444', color: '#ef4444' }}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : '🗑️ Delete'}
            </button>
          </div>
        </div>

        {actionError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {actionError}
          </div>
        )}

        {/* Success banner */}
        {isLive && (
          <div className="alert" style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            borderRadius: 8,
            padding: '16px',
            marginBottom: 20,
            fontSize: '0.9rem',
          }}>
            <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong>✅ Deployment is LIVE and routed!</strong>
                <div style={{ marginTop: 4 }}>
                  URL:{' '}
                  <a
                    href={deployment.deploymentUrl || `http://localhost:${deployment.containerPort}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-mono"
                    style={{ color: '#15803d', textDecoration: 'underline', fontWeight: 600 }}
                  >
                    {deployment.deploymentUrl || `http://localhost:${deployment.containerPort}`}
                  </a>
                </div>
              </div>
            </div>
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
                ['Live Status',   deployment.isActive ? <span key="live" style={{ color: '#15803d', fontWeight: 600 }}>Active Production Route</span> : <span key="live" style={{ color: '#64748b' }}>Historical Version</span>],
                ['Deployment URL', deployment.deploymentUrl ? (
                  <a href={deployment.deploymentUrl} target="_blank" rel="noopener noreferrer" className="text-mono" key="url" style={{ color: 'var(--primary, #2563eb)' }}>
                    {deployment.deploymentUrl}
                  </a>
                ) : '—'],
                ['Trigger Source', <TriggerBadge source={deployment.deploymentSource} key="src" />],
                ['Commit',        <span className="text-mono" key="commit">{deployment.commitHash ? deployment.commitHash.slice(0, 7) : '—'}</span>],
                ['Commit Message', deployment.commitMessage ? <span key="msg" style={{ fontStyle: 'italic', color: '#334155' }}>"{deployment.commitMessage}"</span> : '—'],
                ['Duration',      deployment.durationSeconds != null ? <span key="dur" className="text-mono">{deployment.durationSeconds}s</span> : '—'],
                ['Container ID',  <span className="text-mono" key="cid">{deployment.containerId ? deployment.containerId.slice(0, 12) : '—'}</span>],
                ['Host Port',     <span className="text-mono" key="port">{deployment.containerPort || '—'}</span>],
                ['Started',       new Date(deployment.createdAt).toLocaleString()],
                ['Finished',      deployment.completedAt ? new Date(deployment.completedAt).toLocaleString() : (isBuilding ? 'Building in progress…' : '—')],
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

        {/* Phase 7: Container Resource Monitoring Dashboard */}
        <ResourceDashboard
          resources={resources}
          loading={resLoading}
          error={resError}
          isLiveSocket={socketConnected}
        />

        {/* Phase 7: Historical Resource Charts */}
        <ResourceHistoryCharts
          history={history}
          loading={histLoading}
          error={histError}
          period={historyPeriod}
          onPeriodChange={(newPeriod) => {
            setHistoryPeriod(newPeriod);
            fetchHistory(newPeriod);
          }}
        />

        {/* Build log terminal */}
        <div className="section-title flex-between">

          <span>Live Build Logs</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {socketConnected ? '🟢 Connected via Socket.IO' : '🟡 REST Fallback'}
          </span>
        </div>

        <div className="terminal" style={{ marginTop: 12 }}>
          <div className="terminal-bar">
            <div className="terminal-bar-dot" style={{ background: '#ff5f57' }} />
            <div className="terminal-bar-dot" style={{ background: '#febc2e' }} />
            <div className="terminal-bar-dot" style={{ background: '#28c840' }} />
            <span className="terminal-bar-title">Build Output</span>
            {isBuilding && (
              <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: '0.7rem' }}>
                ● streaming live…
              </span>
            )}
          </div>
          <div
            className="terminal-body"
            ref={logBodyRef}
            style={{ maxHeight: 420, overflowY: 'auto' }}
          >
            {liveLogs.length === 0 ? (
              <div>
                <span className="terminal-line-prompt">$</span>{' '}
                <span className="terminal-line-waiting">
                  {isBuilding ? 'Starting deployment pipeline…' : 'No logs available.'}
                </span>
              </div>
            ) : (
              liveLogs.map((line, i) => {
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
                  waiting for next output line…
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Safe Rollback Confirmation Modal */}
        <RollbackModal
          isOpen={rollbackModalOpen}
          targetDeployment={deployment}
          onClose={() => setRollbackModalOpen(false)}
          onConfirm={handleConfirmRollback}
          loading={rollbackLoading}
          error={rollbackError}
        />
      </div>
    </div>
  );
}
