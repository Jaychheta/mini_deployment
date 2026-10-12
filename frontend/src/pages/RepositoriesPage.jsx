/**
 * RepositoriesPage.jsx — GitHub repository picker & custom repo creation.
 * Route: /repositories
 *
 * Provides:
 *   1. List of user's GitHub repositories with search & select
 *   2. Manual Custom Git Repository URL input form
 *   3. Disconnect / Switch GitHub account option
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { apiGet, apiPost } from '../api/api';

import { getBackendUrl } from '../api/config';

const BACKEND_URL = getBackendUrl();

export default function RepositoriesPage() {
  const navigate = useNavigate();

  const [repos,          setRepos]          = useState([]);
  const [search,         setSearch]         = useState('');
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [selecting,      setSelecting]      = useState(null);
  const [deployRepo,     setDeployRepo]     = useState(null);
  const [accessPassword, setAccessPassword] = useState('');
  const [disconnecting,  setDisconnecting]  = useState(false);

  // Manual custom repo form state
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    name: '',
    repositoryUrl: '',
    branch: 'main',
    accessPassword: '',
  });
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError]     = useState('');

  const fetchRepos = () => {
    setLoading(true);
    setError('');
    apiGet('/github/repos')
      .then((res) => setRepos(res.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRepos();
  }, []);

  const handleSelectClick = (repo) => {
    setDeployRepo(repo);
    setAccessPassword('');
  };

  const handleDeployConfirm = async () => {
    if (!deployRepo) return;
    setSelecting(deployRepo.id);
    setError('');
    try {
      const res = await apiPost('/projects', {
        name:               deployRepo.name,
        repositoryName:     deployRepo.name,
        repositoryUrl:      deployRepo.url,
        branch:             deployRepo.defaultBranch,
        githubRepositoryId: String(deployRepo.id),
        accessPassword:     accessPassword || null,
      });
      navigate(`/projects/${res.data.id}`);
    } catch (err) {
      setError(err.message);
      setSelecting(null);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setManualError('');
    if (!manualForm.name.trim() || !manualForm.repositoryUrl.trim()) {
      setManualError('Project name and repository URL are required.');
      return;
    }
    setManualLoading(true);
    try {
      const repoName = manualForm.repositoryUrl.split('/').pop().replace('.git', '') || manualForm.name;
      const res = await apiPost('/projects', {
        name:               manualForm.name.trim(),
        repositoryName:     repoName,
        repositoryUrl:      manualForm.repositoryUrl.trim(),
        branch:             manualForm.branch.trim() || 'main',
        githubRepositoryId: null,
        accessPassword:     manualForm.accessPassword || null,
      });
      navigate(`/projects/${res.data.id}`);
    } catch (err) {
      setManualError(err.message);
      setManualLoading(false);
    }
  };

  const handleConnectGitHub = () => {
    const token = localStorage.getItem('token');
    window.location.href = `${BACKEND_URL}/api/github/connect-redirect?token=${encodeURIComponent(token)}`;
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect your current GitHub account?')) return;
    setDisconnecting(true);
    try {
      await apiPost('/github/disconnect', {});
      handleConnectGitHub();
    } catch (err) {
      setError(err.message);
      setDisconnecting(false);
    }
  };

  const filtered = repos.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <Navbar role="user" />

      <div className="container page-body">
        <div className="page-heading flex-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div style={{ marginBottom: 8 }}>
              <Link to="/dashboard" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
                ← Dashboard
              </Link>
            </div>
            <h1>Add & Deploy Repository</h1>
            <p>Select a repository from your GitHub account or manually enter a Git repository URL.</p>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowManual(!showManual)}
            >
              {showManual ? '📋 Select GitHub Repo' : '➕ Add Custom Git URL'}
            </button>
            {repos.length > 0 && (
              <button
                className="btn btn-ghost btn-sm text-danger"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting...' : '🔄 Switch GitHub Account'}
              </button>
            )}
          </div>
        </div>

        {error && repos.length > 0 && <div className="alert alert-error">{error}</div>}

        {/* Manual Repository Entry Card */}
        {showManual ? (
          <div className="card" style={{ maxWidth: 600, margin: '0 auto 24px' }}>
            <h2>Add Custom Git Repository</h2>
            <p className="text-muted text-small" style={{ marginBottom: 20 }}>
              Enter any public or accessible Git repository URL to create a new project.
            </p>

            {manualError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{manualError}</div>}

            <form onSubmit={handleManualSubmit}>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="manual-name">Project Name</label>
                <input
                  id="manual-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. My Web App"
                  value={manualForm.name}
                  onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="manual-url">Git Repository URL</label>
                <input
                  id="manual-url"
                  type="url"
                  className="form-input"
                  placeholder="https://github.com/username/repository.git"
                  value={manualForm.repositoryUrl}
                  onChange={(e) => setManualForm({ ...manualForm, repositoryUrl: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label" htmlFor="manual-branch">Branch</label>
                <input
                  id="manual-branch"
                  type="text"
                  className="form-input"
                  placeholder="main"
                  value={manualForm.branch}
                  onChange={(e) => setManualForm({ ...manualForm, branch: e.target.value })}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label" htmlFor="manual-password">Live URL Password (Optional)</label>
                <input
                  id="manual-password"
                  type="password"
                  className="form-input"
                  placeholder="Enter a password to protect the Live URL"
                  value={manualForm.accessPassword}
                  onChange={(e) => setManualForm({ ...manualForm, accessPassword: e.target.value })}
                />
              </div>

              <div className="flex-between">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowManual(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={manualLoading}
                >
                  {manualLoading ? 'Creating Project...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            {/* Search */}
            {!loading && repos.length > 0 && (
              <div style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
                <input
                  id="repo-search"
                  type="text"
                  className="form-input"
                  placeholder="Search repositories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ maxWidth: 400 }}
                />
                <button className="btn btn-ghost btn-sm" onClick={fetchRepos} title="Refresh repositories list">
                  🔄 Refresh
                </button>
              </div>
            )}

            {/* Repository list */}
            <div className="table-wrap">
              {loading ? (
                <div className="empty-state">
                  <div className="spinner" />
                  <p className="mt-8 text-muted text-small">Loading repositories...</p>
                </div>
              ) : error && repos.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🔗</div>
                  <div className="empty-state-text" style={{ color: 'var(--text)', fontWeight: 600 }}>
                    {error.toLowerCase().includes('credentials') || error.toLowerCase().includes('token')
                      ? 'Your GitHub token has expired or is invalid.'
                      : 'GitHub is not connected or session expired.'}
                  </div>
                  <p className="text-muted text-small" style={{ marginTop: 4 }}>
                    Please reconnect your GitHub account to refresh permissions, or enter a manual Git URL.
                  </p>
                  <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                    <button className="btn btn-primary" onClick={handleConnectGitHub}>
                      🔑 Reconnect GitHub Account
                    </button>
                    <button className="btn btn-outline" onClick={() => setShowManual(true)}>
                      Enter Manual Git URL
                    </button>
                  </div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🔍</div>
                  <div className="empty-state-text">
                    {search ? `No repositories match "${search}"` : 'No repositories found.'}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                    {search && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>
                        Clear search
                      </button>
                    )}
                    <button className="btn btn-outline btn-sm" onClick={() => setShowManual(true)}>
                      ➕ Add Custom Git URL
                    </button>
                  </div>
                </div>
              ) : (
                filtered.map((repo) => (
                  <div className="project-row" key={repo.id}>
                    <div className="project-row-info">
                      <div className="project-row-name">
                        {repo.name}
                        {repo.private && (
                          <span style={{
                            fontSize: '0.7rem', fontWeight: 600,
                            background: '#fef3c7', color: '#92400e',
                            padding: '1px 6px', borderRadius: 99,
                            border: '1px solid #fde68a',
                            marginLeft: 8,
                          }}>
                            Private
                          </span>
                        )}
                      </div>
                      <div className="project-row-repo">
                        {repo.url.replace('https://', '')}
                        {' '}&mdash; Branch: <strong>{repo.defaultBranch}</strong>
                      </div>
                      {repo.description && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {repo.description}
                        </div>
                      )}
                    </div>

                    {deployRepo && deployRepo.id === repo.id ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="Live URL Password (Optional)"
                          value={accessPassword}
                          onChange={(e) => setAccessPassword(e.target.value)}
                          style={{ padding: '4px 8px', fontSize: '0.8rem', width: 200 }}
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleDeployConfirm}
                          disabled={selecting === repo.id}
                        >
                          {selecting === repo.id ? 'Creating...' : 'Deploy'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setDeployRepo(null)}
                          disabled={selecting === repo.id}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        id={`select-repo-${repo.id}`}
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSelectClick(repo)}
                        disabled={selecting !== null}
                      >
                        {selecting === repo.id ? (
                          <>
                            <span className="spinner" style={{ width: 12, height: 12, borderTopColor: 'white' }} />
                            Creating...
                          </>
                        ) : (
                          'Select'
                        )}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {!loading && filtered.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 12 }}>
                Showing {filtered.length} of {repos.length} repositories
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
