/**
 * server.js — Entry point for Mini Deploy Platform backend.
 *
 * Phase 2 additions:
 *  - Auth routes  (/api/auth/*)    — signup, login, logout, me
 *  - Admin routes (/api/admin/*)   — admin-only dashboard data
 *  - requireAuth applied to /api/projects and /api/deployments
 *
 * Phase 3 additions:
 *  - PostgreSQL database connection (via pg Pool in db/pool.js)
 *  - Database table creation + admin seed on startup (db/init.js)
 *  - GitHub OAuth routes (/api/github/*)
 *
 * Phase 4 additions:
 *  - Docker deployment pipeline (services/pipeline.service.js)
 *  - POST /api/deployments triggers real Docker builds
 *  - Docker availability check at startup
 *
 * Later phases will add:
 *  - Socket.io for live build log streaming
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');

const { initDatabase }         = require('./db/init');
const { checkDockerAvailable } = require('./services/docker.service');

const healthRoutes     = require('./routes/health.routes');
const authRoutes       = require('./routes/auth.routes');
const projectRoutes    = require('./routes/project.routes');
const deploymentRoutes = require('./routes/deployment.routes');
const adminRoutes      = require('./routes/admin.routes');
const githubRoutes     = require('./routes/github.routes');

const { requireAuth }            = require('./middleware/auth.middleware');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public — health check (no auth required)
app.use('/api', healthRoutes);

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
  console.log('\n🚀  Mini Deploy Platform — Phase 4');
  console.log('   Initializing database...');

  // Initialize database: create tables + seed admin
  await initDatabase();

  // Check Docker availability (non-fatal — server still starts if Docker is down)
  const dockerAvailable = await checkDockerAvailable();
  if (dockerAvailable) {
    console.log('   ✔  Docker daemon is accessible');
  } else {
    console.warn('   ⚠️  Docker daemon is NOT accessible.');
    console.warn('      Start Docker Desktop to enable deployments.');
  }

  app.listen(PORT, () => {
    console.log(`\n✅  Backend running`);
    console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`   API Base    : http://localhost:${PORT}/api`);
    console.log(`   Health Check: http://localhost:${PORT}/api/health`);
    console.log(`   Admin login : admin@minideploy.com / Admin@123\n`);
  });
};

start();

module.exports = app;
