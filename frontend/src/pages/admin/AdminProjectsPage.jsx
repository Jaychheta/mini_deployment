/**
 * AdminProjectsPage.jsx — Admin view of all projects across all users.
 * Route: /admin/projects
 */

import { useState, useEffect } from 'react';
import Navbar from '../../components/Navbar';
import { apiGet } from '../../api/api';

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    apiGet('/admin/projects')
      .then((res) => setProjects(res.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar role="admin" />
      <div className="container page-body">
        <div className="page-heading">
          <h1>All Projects</h1>
          <p>Every project connected to the platform.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📁</div>
              <div className="empty-state-text">No projects found.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Owner</th>
                  <th>Repository</th>
                  <th>Branch</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td className="td-primary">{p.name}</td>
                    <td>{p.ownerName}</td>
                    <td className="td-mono td-muted">{p.repositoryUrl || p.repositoryName}</td>
                    <td className="td-mono td-muted">{p.branch}</td>
                    <td className="td-muted">
                      {new Date(p.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
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
