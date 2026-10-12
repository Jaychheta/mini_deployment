/**
 * resource.controller.js — Resource Monitoring and Metrics Endpoints.
 *
 * All endpoints enforce user ownership validation:
 *  - USER role: can only access resources for their own projects/deployments.
 *  - ADMIN role: can access any deployment and the platform-wide summary.
 */

const resourceMonitorService = require('../services/resourceMonitorService');

/**
 * GET /api/deployments/:id/resources
 * Returns the latest available measurements for a deployment.
 */
const getDeploymentResources = async (req, res, next) => {
  try {
    const deploymentId = req.params.id;
    const userId = req.user.role === 'ADMIN' ? undefined : req.user.id;

    const data = await resourceMonitorService.getLatestMetrics(deploymentId, userId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Deployment not found or access denied.',
      });
    }

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/deployments/:id/resources/history?period=1h
 * Returns historical resource samples for time-series charts.
 * Query params: period ('1h' | '6h' | '24h' | '7d')
 */
const getDeploymentResourceHistory = async (req, res, next) => {
  try {
    const deploymentId = req.params.id;
    const userId = req.user.role === 'ADMIN' ? undefined : req.user.id;
    const period = req.query.period || '1h';

    const validPeriods = ['1h', '6h', '24h', '7d'];
    const selectedPeriod = validPeriods.includes(period) ? period : '1h';

    const history = await resourceMonitorService.getMetricsHistory(deploymentId, userId, selectedPeriod);

    if (history === null) {
      return res.status(404).json({
        success: false,
        message: 'Deployment not found or access denied.',
      });
    }

    res.status(200).json({
      success: true,
      period: selectedPeriod,
      count: history.length,
      data: history,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/projects/:id/resources
 * Returns resource summary for a project's active live deployment.
 */
const getProjectResources = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.role === 'ADMIN' ? undefined : req.user.id;

    const summary = await resourceMonitorService.getProjectResourceSummary(projectId, userId);

    if (!summary) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or access denied.',
      });
    }

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/resources/summary
 * Returns an aggregate summary for platform monitoring (ADMIN only).
 */
const getAdminResourceSummary = async (req, res, next) => {
  try {
    const summary = await resourceMonitorService.getAdminPlatformSummary();

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDeploymentResources,
  getDeploymentResourceHistory,
  getProjectResources,
  getAdminResourceSummary,
};
