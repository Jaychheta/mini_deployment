/**
 * AdminDashboardPage.jsx — Admin overview with platform-wide statistics.
 * Route: /admin/dashboard
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import StatusBadge from '../../components/StatusBadge';
import { apiGet } from '../../api/api';

export default function AdminDashboardPage() {
  const [stats,       setStats]       = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [sRes, dRes] = await Promise.all([
          apiGet('/admin/stats'),
          apiGet('/admin/deployments'),
        ]);
        setStats(sRes.data);
        setDeployments(dRes.data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div>
      <Navbar role="admin" />
      <div className="container page-body">
        <div className="page-heading">
          <h1>Admin Dashboard</h1>
          <p>Platform-wide overview of users, projects, and deployments.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {/* Stats */}
        <div className="stats-row">
          {[
            { label: 'Users',        value: stats?.users,       cls: '' },
            { label: 'Projects',     value: stats?.projects,    cls: '' },
            { label: 'Deployments',  value: stats?.deployments, cls: '' },
            { label: 'Live',         value: stats?.live,        cls: 'live' },
            { label: 'Failed',       value: stats?.failed,      cls: 'failed' },
          ].map((s) => (
            <div className="stat-box" key={s.label}>
              <div className={`stat-box-value ${s.cls}`}>{loading ? '—' : (s.value ?? 0)}</div>
              <div className="stat-box-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Recent deployments */}
        <div className="section">
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <div className="section-title">Recent Deployments</div>
            <Link to="/admin/deployments" className="btn btn-ghost btn-sm">View all</Link>
          </div>

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
                    <th>Project</th>
                    <th>User</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.slice(0, 10).map((d) => (
                    <tr key={d.id}>
                      <td className="td-primary">{d.projectName}</td>
                      <td>{d.ownerName}</td>
                      <td><StatusBadge status={d.status} /></td>
                      <td className="td-muted">
                        {new Date(d.createdAt).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric',
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
    </div>
  );
}
