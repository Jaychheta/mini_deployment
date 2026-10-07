/**
 * ProjectCard — Renders a single project card.
 *
 * Shows:
 *  - Project name and repository
 *  - Branch
 *  - Status badge (LIVE / BUILDING / FAILED)
 *  - A Deploy button (will trigger the pipeline in Phase 3)
 *
 * @param {Object} props
 * @param {Object} props.project — project data object from the API
 * @param {Function} props.onDeploy — called when Deploy button is clicked
 */

import StatusBadge from './StatusBadge';

export default function ProjectCard({ project, onDeploy }) {
  const handleDeploy = (e) => {
    e.stopPropagation();
    onDeploy(project);
  };

  // Format the creation date for display
  const createdDate = new Date(project.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="project-card animate-in">
      {/* Top row: name + status */}
      <div className="project-card-top">
        <div>
          <div className="project-name">{project.name}</div>
          <div className="project-repo">{project.repository}</div>
        </div>
        <StatusBadge status={project.status} />
      </div>

      {/* Meta: branch */}
      <div className="project-meta">
        <div className="project-meta-item">
          <span className="project-meta-icon">🌿</span>
          <span>{project.branch}</span>
        </div>
        {project.deploymentUrl && (
          <div className="project-meta-item">
            <span className="project-meta-icon">🔗</span>
            <a href={project.deploymentUrl} target="_blank" rel="noopener noreferrer">
              {project.deploymentUrl}
            </a>
          </div>
        )}
      </div>

      {/* Footer: deploy button + created date */}
      <div className="project-card-footer">
        <button
          id={`deploy-btn-${project.id}`}
          className="btn btn-primary"
          onClick={handleDeploy}
          title="Deploy this project (available in Phase 3)"
        >
          🚀 Deploy
        </button>
        <span className="project-updated">Created {createdDate}</span>
      </div>
    </div>
  );
}
