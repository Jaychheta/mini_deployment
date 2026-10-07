/**
 * StatusBadge.jsx — Pill badge for deployment/project status.
 * Updated for the Phase 2 white/simple theme.
 */

const CONFIG = {
  LIVE:     { label: 'Live',     css: 'badge-live' },
  BUILDING: { label: 'Building', css: 'badge-building' },
  FAILED:   { label: 'Failed',   css: 'badge-failed' },
  USER:     { label: 'User',     css: 'badge-user' },
  ADMIN:    { label: 'Admin',    css: 'badge-admin' },
};

export default function StatusBadge({ status }) {
  const config = CONFIG[status] || { label: status, css: 'badge-user' };
  return (
    <span className={`badge ${config.css}`}>
      <span className="badge-dot" />
      {config.label}
    </span>
  );
}
