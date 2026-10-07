/**
 * DeploymentsTable — Tabular history of all deployments.
 *
 * Columns: Deployment ID | Commit | Status | Created At
 *
 * Note: This is a read-only view in Phase 1.
 * Phase 3 will add redeploy / rollback actions per row.
 */

import StatusBadge from './StatusBadge';

export default function DeploymentsTable({ deployments }) {
  if (deployments.length === 0) {
    return (
      <div className="table-wrapper">
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-text">No deployments yet</div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrapper animate-in">
      <table className="data-table">
        <thead>
          <tr>
            <th>Deployment ID</th>
            <th>Commit</th>
            <th>Status</th>
            <th>Created At</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((d) => (
            <tr key={d.id}>
              {/* Deployment ID */}
              <td>
                <span className="deploy-id" title={d.id}>
                  #{d.id.slice(0, 8)}
                </span>
              </td>

              {/* Commit hash + message */}
              <td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="commit-hash">{d.commitHash}</span>
                  <span className="commit-msg">{d.commitMessage}</span>
                </div>
              </td>

              {/* Status badge */}
              <td>
                <StatusBadge status={d.status} />
              </td>

              {/* Created date */}
              <td>
                {new Date(d.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
