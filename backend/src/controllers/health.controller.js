/**
 * health.controller.js — Handles the /api/health endpoint.
 *
 * Returns a simple status object so that:
 *  - Docker HEALTHCHECK directives can confirm the container is running
 *  - Load balancers can verify the service is alive
 *  - Developers can quickly confirm the backend started correctly
 */

/**
 * GET /api/health
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
const getHealth = (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mini-deploy-platform',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
};

module.exports = { getHealth };
