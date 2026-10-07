/**
 * server.js — Entry point for Mini Deploy Platform backend.
 *
 * Phase 5 additions:
 *  - Socket.IO server attached to Express HTTP server
 *  - GitHub Webhook endpoint (/api/webhooks/github) with raw body preservation
 *  - Real-time build log streaming & live status updates
 */

require('dotenv').config();

const http    = require('http');
const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');

const { initDatabase }         = require('./db/init');
const { checkDockerAvailable } = require('./services/docker.service');
const { initSocketServer }     = require('./services/socket.service');

const healthRoutes     = require('./routes/health.routes');
const authRoutes       = require('./routes/auth.routes');
const projectRoutes    = require('./routes/project.routes');
const deploymentRoutes = require('./routes/deployment.routes');
const adminRoutes      = require('./routes/admin.routes');
const githubRoutes     = require('./routes/github.routes');
const webhookRoutes    = require('./routes/webhook.routes');

const { requireAuth }            = require('./middleware/auth.middleware');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app  = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Preserve raw body buffer for HMAC signature verification on webhook requests
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Initialize Socket.IO ──────────────────────────────────────────────────────

initSocketServer(server);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public — health check
app.use('/api', healthRoutes);

// Public — GitHub webhooks (signature verified inside webhook.controller.js)
app.use('/api/webhooks', webhookRoutes);

// Public — authentication endpoints
app.use('/api/auth', authRoutes);

// GitHub OAuth — mix of public (callback) and protected routes
app.use('/api/github', githubRoutes);

// Protected — require a valid JWT for all project/deployment endpoints
app.use('/api/projects',    requireAuth, projectRoutes);
app.use('/api/deployments', requireAuth, deploymentRoutes);

// Protected — require ADMIN role (enforced inside admin.routes.js)
app.use('/api/admin', adminRoutes);

// ─── Error Handling ───────────────────────────────────────────────────────────

app.use(notFound);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

const start = async () => {
  console.log('\n🚀  Mini Deploy Platform — Phase 5 (Webhooks + Real-Time Logs)');
  console.log('   Initializing database...');

  await initDatabase();

  const dockerAvailable = await checkDockerAvailable();
  if (dockerAvailable) {
    console.log('   ✔  Docker daemon is accessible');
  } else {
    console.warn('   ⚠️  Docker daemon is NOT accessible.');
    console.warn('      Start Docker Desktop to enable deployments.');
  }

  server.listen(PORT, () => {
    console.log(`\n✅  Backend running with Socket.IO & Webhook support`);
    console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`   API Base    : http://localhost:${PORT}/api`);
    console.log(`   Webhooks    : http://localhost:${PORT}/api/webhooks/github`);
    console.log(`   Health Check: http://localhost:${PORT}/api/health`);
    console.log(`   Admin login : admin@minideploy.com / Admin@123\n`);
  });
};

start();

module.exports = app;
