/**
 * socket.service.js — Socket.IO Real-Time Log & Status Streaming.
 *
 * Architecture:
 *   HTTP Server -> Express APIs & Socket.IO Server
 *
 * Security & Rooms:
 *   1. Handshake authenticates Mini Deploy JWT
 *   2. Room format: deployment:<deploymentId>
 *   3. Joining room requires backend ownership verification (project.user_id === user.id or ADMIN)
 *   4. Emits real-time build logs, status updates, and completion/error events
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const deploymentService = require('./deployment.service');
const logger = require('../utils/logger.util');
const { redactSecrets } = require('../utils/crypto.util');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

let io = null;

/**
 * Initialize Socket.IO server attached to the HTTP server instance.
 *
 * @param {import('http').Server} httpServer
 */
const initSocketServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, true),
      credentials: true,
    },
  });

  // Authentication Middleware
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers?.authorization
        ? socket.handshake.headers.authorization.split(' ')[1]
        : null);

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = { id: decoded.id, role: decoded.role, email: decoded.email };
      next();
    } catch (err) {
      return next(new Error('Invalid or expired authentication token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`[SOCKET] Client connected: user ${socket.user.id} (${socket.id})`);

    // Handle room join request for a deployment
    socket.on('deployment:join', async ({ deploymentId }) => {
      if (!deploymentId) return;

      try {
        // Verify user owns the deployment's project (or is ADMIN)
        const isAdmin = socket.user.role === 'ADMIN';
        const deployment = await deploymentService.findById(
          deploymentId,
          isAdmin ? undefined : socket.user.id
        );

        if (!deployment) {
          socket.emit('deployment:error', {
            deploymentId,
            message: 'Deployment not found or access denied.',
          });
          return;
        }

        const roomName = `deployment:${deploymentId}`;
        socket.join(roomName);
        logger.info(`[SOCKET] User ${socket.user.id} joined room ${roomName}`);

        // Emit current status and historical logs to the joining client
        socket.emit('deployment:status', {
          deploymentId,
          status: deployment.status,
          containerPort: deployment.containerPort,
          commitHash: deployment.commitHash,
        });

        if (deployment.logs) {
          socket.emit('deployment:history', {
            deploymentId,
            logs: redactSecrets(deployment.logs),
          });
        }

        // Emit latest resource metrics if already sampled
        try {
          const resourceMonitorService = require('./resourceMonitorService');
          resourceMonitorService.getLatestMetrics(deploymentId, isAdmin ? undefined : socket.user.id)
            .then((resData) => {
              if (resData) {
                socket.emit('resources:update', resData);
              }
            })
            .catch(() => {});
        } catch {
          // ignore if monitor service is loading
        }
      } catch (err) {
        logger.warn(`[SOCKET] Error joining deployment room: ${err.message}`);
      }
    });

    socket.on('deployment:leave', ({ deploymentId }) => {
      if (!deploymentId) return;
      const roomName = `deployment:${deploymentId}`;
      socket.leave(roomName);
      logger.info(`[SOCKET] User ${socket.user.id} left room ${roomName}`);
    });

    socket.on('disconnect', () => {
      logger.info(`[SOCKET] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

// ─── Event Emitters ──────────────────────────────────────────────────────────

const emitDeploymentLog = (deploymentId, message) => {
  if (!io || !deploymentId) return;
  const sanitized = redactSecrets(message);
  io.to(`deployment:${deploymentId}`).emit('deployment:log', {
    deploymentId,
    message: sanitized,
    timestamp: new Date().toISOString(),
  });
};

const emitDeploymentStatus = (deploymentId, status, extraData = {}) => {
  if (!io || !deploymentId) return;
  io.to(`deployment:${deploymentId}`).emit('deployment:status', {
    deploymentId,
    status,
    ...extraData,
    timestamp: new Date().toISOString(),
  });
};

const emitDeploymentComplete = (deploymentId, data = {}) => {
  if (!io || !deploymentId) return;
  io.to(`deployment:${deploymentId}`).emit('deployment:complete', {
    deploymentId,
    status: 'LIVE',
    ...data,
    timestamp: new Date().toISOString(),
  });
};

const emitDeploymentError = (deploymentId, error) => {
  if (!io || !deploymentId) return;
  const message = typeof error === 'string' ? error : error.message || 'Deployment failed';
  const sanitized = redactSecrets(message);

  io.to(`deployment:${deploymentId}`).emit('deployment:error', {
    deploymentId,
    status: 'FAILED',
    error: sanitized,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Emit real-time container resource statistics to clients in the deployment room.
 *
 * @param {string} deploymentId
 * @param {Object} resourceData
 */
const emitResourceUpdate = (deploymentId, resourceData) => {
  if (!io || !deploymentId || !resourceData) return;
  io.to(`deployment:${deploymentId}`).emit('resources:update', {
    deploymentId,
    ...resourceData,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Emit resource error event to clients in the deployment room.
 *
 * @param {string} deploymentId
 * @param {string|Error} error
 */
const emitResourceError = (deploymentId, error) => {
  if (!io || !deploymentId) return;
  const message = typeof error === 'string' ? error : error.message || 'Resource monitoring error';
  io.to(`deployment:${deploymentId}`).emit('resources:error', {
    deploymentId,
    error: message,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  initSocketServer,
  emitDeploymentLog,
  emitDeploymentStatus,
  emitDeploymentComplete,
  emitDeploymentError,
  emitResourceUpdate,
  emitResourceError,
};

