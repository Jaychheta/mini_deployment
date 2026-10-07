/**
 * ProjectsPage.jsx — Lists all of the user's projects.
 * Route: /projects
 *
 * Phase 3: "+ New Project" now links to /repositories (GitHub repo picker).
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { apiGet } from '../api/api';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    apiGet('/projects')
      .then((res) => setProjects(res.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar role="user" />
      <div className="container page-body">
        <div className="page-heading flex-between">
          <div>
            <h1>Projects</h1>
            <p>All your connected repositories.</p>
          </div>
          <Link to="/repositories" className="btn btn-primary">
            + New Project
          </Link>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📁</div>
              <div className="empty-state-text">No projects yet. Connect GitHub to add one.</div>
              <Link to="/repositories" className="btn btn-outline">
                Select a Repository
              </Link>
            </div>
          ) : (
            projects.map((p) => (
              <div className="project-row" key={p.id}>
                <div className="project-row-info">
                  <div className="project-row-name">{p.name}</div>
                  <div className="project-row-repo">
                    {p.repositoryUrl || p.repositoryName} — {p.branch}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Link to={`/projects/${p.id}`} className="btn btn-ghost btn-sm">View Project</Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
