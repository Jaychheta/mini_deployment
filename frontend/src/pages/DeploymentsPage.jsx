/**
 * DeploymentsPage.jsx — User's deployments list.
 * Route: /deployments
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import StatusBadge from '../components/StatusBadge';
import { apiGet } from '../api/api';

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  useEffect(() => {
    apiGet('/deployments')
      .then((res) => setDeployments(res.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar role="user" />
      <div className="container page-body">
        <div className="page-heading">
          <h1>Deployments</h1>
          <p>All deployment attempts across your projects.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : deployments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🚀</div>
              <div className="empty-state-text">No deployments yet.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Commit</th>
                  <th>Branch</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.id}>
                    <td className="td-mono td-muted">#{d.id.slice(0, 8)}</td>
                    <td>
                      <span className="td-mono">{d.commitHash}</span>
                      <div className="td-muted text-small">{d.commitMessage}</div>
                    </td>
                    <td className="td-mono td-muted">{d.branch}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className="td-muted">
                      {new Date(d.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </td>
                    <td>
                      <Link to={`/deployments/${d.id}`} className="btn btn-ghost btn-sm">
                        View Logs
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
  );
}
