/**
 * DashboardPage.jsx — Main user dashboard.
 *
 * Shows:
 *   - Welcome message
 *   - Quick stats (Projects, Deployments, Live)
 *   - GitHub Connect section (Phase 3: real OAuth)
 *   - Recent projects list
 *
 * Phase 3: GitHub section shows real connection status.
 *   If connected: shows @username + View Repositories button
 *   If not connected: shows Connect GitHub button
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/api';

import { getBackendUrl } from '../api/config';

const BACKEND_URL = getBackendUrl();

export default function DashboardPage() {
  const { user } = useAuth();

  const [projects,      setProjects]      = useState([]);
  const [deployments,   setDeployments]   = useState([]);
  const [githubStatus,  setGithubStatus]  = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [githubLoading, setGithubLoading] = useState(true);
  const [error,         setError]         = useState('');
  const [urlError,      setUrlError]      = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  // Check for error message from GitHub OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    const reason = params.get('reason');
    if (err) {
      const messages = {
        github_denied:           'GitHub authorization was cancelled.',
        github_oauth_failed:     reason ? `GitHub connection failed: ${reason}` : 'GitHub connection failed. Please try again.',
        github_config_missing:   'GitHub OAuth is not configured on the server.',
        github_invalid_callback: 'Invalid GitHub callback. Please try again.',
        github_invalid_state:    'Session expired. Please try again.',
      };
      setUrlError(messages[err] || 'GitHub connection failed.');
      window.history.replaceState({}, '', '/dashboard');
    }
  }, []);

  // Load projects, deployments, and GitHub status
  useEffect(() => {
    const load = async () => {
      try {
        const [pRes, dRes] = await Promise.all([
          apiGet('/projects'),
          apiGet('/deployments'),
        ]);
        setProjects(pRes.data   || []);
        setDeployments(dRes.data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    const loadGithubStatus = async () => {
      try {
        const res = await apiGet('/github/status');
        setGithubStatus(res.data);
      } catch {
        setGithubStatus({ connected: false, username: null });
      } finally {
        setGithubLoading(false);
      }
    };

    load();
    loadGithubStatus();
  }, []);

  /**
   * Connect GitHub — navigates to the backend connect-redirect URL with the JWT
   * as a query parameter. The backend verifies the JWT and redirects to GitHub.
   */
  const handleConnectGitHub = () => {
    const token = localStorage.getItem('token');
    window.location.href = `${BACKEND_URL}/api/github/connect-redirect?token=${encodeURIComponent(token)}`;
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect GitHub? Your existing projects will remain.')) return;
    setDisconnecting(true);
    try {
      await apiPost('/github/disconnect', {});
      setGithubStatus({ connected: false, username: null });
    } catch (err) {
      setError(err.message);
    } finally {
      setDisconnecting(false);
    }
  };

  const liveCount = projects.filter((p) => p.activeDeploymentStatus === 'LIVE').length;

  return (
    <div>
      <Navbar role="user" />

      <div className="container page-body">
        {/* Welcome */}
        <div className="page-heading">
          <h1>Welcome, {user?.name} 👋</h1>
          <p>Here's an overview of your projects and deployments.</p>
        </div>

        {error    && <div className="alert alert-error">{error}</div>}
        {urlError && <div className="alert alert-error">{urlError}</div>}

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-box">
            <div className="stat-box-value">{loading ? '—' : projects.length}</div>
            <div className="stat-box-label">Projects</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-value">{loading ? '—' : deployments.length}</div>
            <div className="stat-box-label">Deployments</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-value live">{loading ? '—' : liveCount}</div>
            <div className="stat-box-label">Live</div>
          </div>
        </div>

        {/* GitHub Connect Section */}
        <div className="github-section">
          <div className="github-section-text">
            <h3>GitHub</h3>
            {githubLoading ? (
              <p style={{ color: 'var(--text-muted)' }}>Checking connection...</p>
            ) : githubStatus?.connected ? (
              <p>
                GitHub connected as{' '}
                <strong style={{ color: 'var(--text)' }}>@{githubStatus.username}</strong>
              </p>
            ) : (
              <p>
                Connect your GitHub account to select repositories and start deploying.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {githubLoading ? (
              <div className="spinner" />
            ) : githubStatus?.connected ? (
              <>
                <Link to="/repositories" id="view-repos-btn" className="btn btn-primary">
                  View Repositories
                </Link>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  style={{ color: 'var(--text-muted)' }}
                >
                  {disconnecting ? 'Disconnecting...' : '🔄 Switch GitHub Account'}
                </button>
              </>
            ) : (
              <button
                id="connect-github-btn"
                className="btn btn-outline"
                onClick={handleConnectGitHub}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.57v-2c-3.34.72-4.04-1.61-4.04-1.61-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.13 3 .4 2.28-1.55 3.3-1.23 3.3-1.23.65 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.69.82.57C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                Connect GitHub
              </button>
            )}
          </div>
        </div>

        {/* Projects list */}
        <div className="section">
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <div className="section-title">My Projects</div>
            <Link to="/projects" className="btn btn-ghost btn-sm">View all</Link>
          </div>

          <div className="table-wrap">
            {loading ? (
              <div className="empty-state">
                <div className="spinner" />
                <p className="mt-8 text-muted text-small">Loading projects...</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📁</div>
                <div className="empty-state-text">No projects yet.</div>
                {githubStatus?.connected ? (
                  <Link to="/repositories" className="btn btn-outline">
                    Select a Repository
                  </Link>
                ) : (
                  <button className="btn btn-outline" onClick={handleConnectGitHub}>
                    Connect GitHub to add a project
                  </button>
                )}
              </div>
            ) : (
              projects.slice(0, 5).map((p) => (
                <div className="project-row" key={p.id}>
                  <div className="project-row-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="project-row-name">{p.name}</div>
                      {p.activeDeploymentStatus === 'LIVE' && (
                        <span style={{ fontSize: '0.75rem', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
                          🟢 Live
                        </span>
                      )}
                    </div>
                    <div className="project-row-repo" style={{ marginTop: 2 }}>
                      {p.deploymentUrl ? (
                        <a href={p.deploymentUrl} target="_blank" rel="noopener noreferrer" className="text-mono" style={{ color: 'var(--primary, #2563eb)' }}>
                          {p.deploymentUrl}
                        </a>
                      ) : (
                        p.repositoryUrl || p.repositoryName
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.deploymentUrl && (
                      <a href={p.deploymentUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                        Open ↗
                      </a>
                    )}
                    <Link to={`/projects/${p.id}`} className="btn btn-ghost btn-sm">
                      View
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
