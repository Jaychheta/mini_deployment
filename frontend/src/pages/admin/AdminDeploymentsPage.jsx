/**
 * AdminDeploymentsPage.jsx — Admin view of all deployments platform-wide.
 * Route: /admin/deployments
 */

import { useState, useEffect } from 'react';
import Navbar from '../../components/Navbar';
import StatusBadge from '../../components/StatusBadge';
import { apiGet } from '../../api/api';

export default function AdminDeploymentsPage() {
  const [deployments, setDeployments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  useEffect(() => {
    apiGet('/admin/deployments')
      .then((res) => setDeployments(res.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar role="admin" />
      <div className="container page-body">
        <div className="page-heading">
          <h1>All Deployments</h1>
          <p>Every deployment across all users and projects.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : deployments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🚀</div>
              <div className="empty-state-text">No deployments found.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Project</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.id}>
                    <td className="td-mono td-muted">#{d.id.slice(0, 8)}</td>
                    <td className="td-primary">{d.projectName}</td>
                    <td>{d.ownerName}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className="td-muted">
                      {new Date(d.createdAt).toLocaleDateString('en-US', {
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
