const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const pool = require('../db/pool');

const router = express.Router();

/**
 * GET /app/:slug/*
 * Proxy requests to the active deployment container for a project.
 */
router.use('/:slug', async (req, res, next) => {
  const { slug } = req.params;

  // Ensure trailing slash for root app path so relative assets resolve correctly
  if (req.baseUrl && req.baseUrl === `/app/${slug}` && (req.path === '/' || req.path === '')) {
    if (!req.originalUrl.includes('?') && !req.originalUrl.endsWith('/')) {
      return res.redirect(301, `/app/${slug}/`);
    }
  }

  try {
    // Find project and its live deployment (case-insensitive name or slug match)
    const query = `
      SELECT p.id, p.name, d.container_port, d.status 
      FROM projects p
      JOIN deployments d ON (d.id = p.active_deployment_id OR d.project_id = p.id)
      WHERE (p.name ILIKE $1 OR p.deployment_slug ILIKE $1)
        AND d.status = 'LIVE'
        AND d.container_port IS NOT NULL
      ORDER BY (p.active_deployment_id = d.id) DESC, d.created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(query, [slug]);

    if (rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Application Not Found — Mini Deploy</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h1 { font-size: 20px; margin-bottom: 12px; color: #f43f5e; }
            p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
            a { display: inline-block; background: #3b82f6; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500; }
            a:hover { background: #2563eb; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>404 — No Live Deployment Found</h1>
            <p>Project <strong>"${slug}"</strong> does not have an active running container right now.<br>Check deployment history or trigger a new deployment in the dashboard.</p>
            <a href="http://localhost:5173">Go to Dashboard</a>
          </div>
        </body>
        </html>
      `);
    }

    const { container_port } = rows[0];

    // Create dynamic proxy middleware
    const proxy = createProxyMiddleware({
      target: `http://127.0.0.1:${container_port}`,
      changeOrigin: true,
      ws: true,
      pathRewrite: {
        [`^/app/${slug}`]: '',
      },
      onError: (err, req, res) => {
        console.error(`[PROXY] Error forwarding to port ${container_port}:`, err.message);
        if (!res.headersSent) {
          res.status(502).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <title>502 Bad Gateway — Mini Deploy</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; max-width: 500px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                h1 { font-size: 20px; margin-bottom: 12px; color: #f59e0b; }
                p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
                .direct { background: #0f172a; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 13px; margin-bottom: 20px; color: #38bdf8; word-break: break-all; }
                a { display: inline-block; background: #3b82f6; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500; margin: 4px; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>502 — Container Not Responding</h1>
                <p>The container for <strong>"${slug}"</strong> on port ${container_port} is not responding.</p>
                <div class="direct">Direct Container URL: <a href="http://localhost:${container_port}" style="background:none;padding:0;color:#38bdf8;" target="_blank">http://localhost:${container_port}</a></div>
                <a href="http://localhost:5173">Back to Dashboard</a>
              </div>
            </body>
            </html>
          `);
        }
      }
    });

    return proxy(req, res, next);
  } catch (err) {
    console.error('[PROXY] Error:', err);
    res.status(500).send('Internal proxy error.');
  }
});

module.exports = router;
