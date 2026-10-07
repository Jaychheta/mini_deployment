/**
 * DeploymentsPage.jsx — User's deployments history list with Source indicator.
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

  const formatSourceBadge = (src) => {
    if (src === 'WEBHOOK') {
      return (
        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 99, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
          ⚡ GitHub Push
        </span>
      );
    }
    return (
      <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 99, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }}>
        👤 Manual
      </span>
    );
  };

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
                  <th>Source</th>
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
                      <span className="td-mono">{d.commitHash ? d.commitHash.slice(0, 7) : '—'}</span>
                    </td>
                    <td>{formatSourceBadge(d.deploymentSource)}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className="td-muted">
                      {new Date(d.createdAt).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
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
