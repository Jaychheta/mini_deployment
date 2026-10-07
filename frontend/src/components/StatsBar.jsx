/**
 * StatsBar — Four summary statistics at the top of the dashboard.
 * Values are derived from the projects and deployments data passed as props.
 */

export default function StatsBar({ projects, deployments }) {
  const live   = projects.filter((p) => p.status === 'LIVE').length;
  const failed = deployments.filter((d) => d.status === 'FAILED').length;

  const stats = [
    { icon: '📁', label: 'Projects',            value: projects.length,    variant: '' },
    { icon: '🚀', label: 'Deployments',         value: deployments.length, variant: '' },
    { icon: '✅', label: 'Live Deployments',    value: live,               variant: 'live' },
    { icon: '❌', label: 'Failed Deployments',  value: failed,             variant: 'failed' },
  ];

  return (
    <div className="stats-grid">
      {stats.map((s) => (
        <div key={s.label} className={`stat-card animate-in ${s.variant}`}>
          <span className="stat-icon">{s.icon}</span>
          <div className="stat-value">{s.value}</div>
          <div className="stat-label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
