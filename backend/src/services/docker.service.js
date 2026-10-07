/**
 * docker.service.js — Docker integration using dockerode.
 *
 * Provides:
 *   - checkDockerAvailable()    : verify Docker daemon is accessible
 *   - buildImage()              : build a Docker image from a local path
 *   - findAvailablePort()       : find an unused host port in the configured range
 *   - startContainer()          : create and start a Docker container
 *   - stopAndRemoveContainer()  : stop + remove a container by ID
 *   - removeImage()             : remove a Docker image by tag
 *   - getContainerLogs()        : fetch logs from a running container
 *
 * SECURITY NOTES:
 *   - Image names are generated from sanitized project slugs — never from raw user input.
 *   - Container names use deployment IDs — never from raw user input.
 *   - Host ports are allocated by the backend, not accepted from the frontend.
 *   - Docker socket is NEVER exposed to the frontend.
 *
 * PRODUCTION NOTES:
 *   - This MVP runs containers without resource limits or network isolation.
 *   - Production would require: CPU/memory limits, network policies,
 *     seccomp profiles, read-only filesystems, and proper sandboxing.
 */

const Docker = require('dockerode');
const logger = require('../utils/logger.util');
const pool   = require('../db/pool');

// ─── Docker client ────────────────────────────────────────────────────────────

/**
 * Create a Dockerode instance.
 * On Windows with Docker Desktop, the named pipe is used automatically.
 * Falls back to environment-provided DOCKER_HOST if set.
 */
const getDockerClient = () => {
  return new Docker();
};

// ─── Port range configuration ────────────────────────────────────────────────

const PORT_RANGE_START = parseInt(process.env.DEPLOY_PORT_MIN || '5000', 10);
const PORT_RANGE_END   = parseInt(process.env.DEPLOY_PORT_MAX || '5999', 10);

// ─── Docker availability check ────────────────────────────────────────────────

/**
 * Verify that the Docker daemon is accessible.
 * Returns true if Docker is reachable, false otherwise.
 * Does NOT throw — caller decides how to handle unavailability.
 *
 * @returns {Promise<boolean>}
 */
const checkDockerAvailable = async () => {
  try {
    const docker = getDockerClient();
    await docker.ping();
    return true;
  } catch (err) {
    logger.warn('[DOCKER] Docker daemon is not accessible:', err.message);
    return false;
  }
};

// ─── Port management ─────────────────────────────────────────────────────────

/**
 * Find an available host port in the configured range.
 *
 * Strategy:
 *   1. Query PostgreSQL for ports already in use by LIVE/BUILDING deployments.
 *   2. Scan the configured port range and return the first unused port.
 *   3. Also verify via Docker that no container is actually bound to that port.
 *
 * @returns {Promise<number>} An available host port
 * @throws {Error} If no port is available in the configured range
 */
const findAvailablePort = async () => {
  const result = await pool.query(
    `SELECT container_port FROM deployments
     WHERE status IN ('BUILDING', 'LIVE') AND container_port IS NOT NULL`
  );
  const usedDbPorts = new Set(result.rows.map((r) => r.container_port));

  let usedDockerPorts = new Set();
  try {
    const docker = getDockerClient();
    const containers = await docker.listContainers({ all: false });
    for (const c of containers) {
      for (const p of (c.Ports || [])) {
        if (p.PublicPort) usedDockerPorts.add(p.PublicPort);
      }
    }
  } catch {
    logger.warn('[DOCKER] Could not list running containers for port check.');
  }

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!usedDbPorts.has(port) && !usedDockerPorts.has(port)) {
      return port;
    }
  }

  throw new Error(
    `No available port found in range ${PORT_RANGE_START}–${PORT_RANGE_END}. ` +
    'All ports are in use or allocated.'
  );
};

// ─── Image building ───────────────────────────────────────────────────────────

/**
 * Sanitize a string for use in a Docker image name.
 * Replaces any character that is not lowercase alphanumeric, dash, or underscore.
 *
 * @param {string} str
 * @returns {string}
 */
const sanitizeForImageName = (str) =>
  str.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 50);

/**
 * Build a Docker image from the given directory.
 *
 * @param {Object} opts
 * @param {string}   opts.contextPath    — absolute path to the build context directory
 * @param {string}   opts.imageTag       — full image tag e.g. "mini-deploy/myapp:abc123"
 * @param {Function} opts.onLog          — callback(line: string) called for each build log line
 * @returns {Promise<void>}
 * @throws {Error} If the build fails
 */
const buildImage = async ({ contextPath, imageTag, onLog }) => {
  const docker = getDockerClient();

  onLog(`[INFO] Starting Docker image build: ${imageTag}`);

  const stream = await docker.buildImage(
    { context: contextPath, src: ['.'] },
    { t: imageTag, rm: true, forcerm: true }
  );

  await new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err, output) => {
        if (err) {
          reject(new Error(`Docker build failed: ${err.message}`));
        } else {
          const lastMsg = output?.[output.length - 1];
          if (lastMsg?.error) {
            reject(new Error(`Docker build error: ${lastMsg.error}`));
          } else {
            resolve();
          }
        }
      },
      (event) => {
        const line = event?.stream?.replace(/\n$/, '') || event?.status || '';
        if (line.trim()) {
          onLog(`[BUILD] ${line}`);
        }
        if (event?.error) {
          onLog(`[ERROR] ${event.error}`);
        }
      }
    );
  });

  onLog(`[INFO] Docker image built successfully: ${imageTag}`);
};

// ─── Container management ─────────────────────────────────────────────────────

/**
 * Create and start a Docker container from the given image.
 *
 * @param {Object} opts
 * @param {string}   opts.imageTag       — Docker image tag to run
 * @param {string}   opts.containerName  — unique container name
 * @param {number}   opts.hostPort       — host port to bind
 * @param {number}   opts.containerPort  — port the app listens on inside the container
 * @param {Function} opts.onLog          — callback(line: string)
 * @returns {Promise<{ containerId: string, hostPort: number }>}
 * @throws {Error} If container creation or start fails
 */
const startContainer = async ({ imageTag, containerName, hostPort, containerPort, onLog }) => {
  const docker = getDockerClient();

  onLog(`[INFO] Creating container: ${containerName}`);
  onLog(`[INFO] Port mapping: ${hostPort} (host) → ${containerPort} (container)`);

  const container = await docker.createContainer({
    Image: imageTag,
    name:  containerName,
    ExposedPorts: {
      [`${containerPort}/tcp`]: {},
    },
    HostConfig: {
      PortBindings: {
        [`${containerPort}/tcp`]: [{ HostPort: String(hostPort) }],
      },
      RestartPolicy: { Name: 'no' },
    },
    Env: [`PORT=${containerPort}`, 'NODE_ENV=production'],
  });

  onLog(`[INFO] Starting container...`);
  await container.start();

  const containerId = container.id;
  onLog(`[INFO] Container started: ${containerId.slice(0, 12)}`);

  return { containerId, hostPort };
};

/**
 * Stop and remove a Docker container by ID.
 * Errors are logged but not thrown — cleanup should not abort the caller.
 *
 * @param {string} containerId
 */
const stopAndRemoveContainer = async (containerId) => {
  if (!containerId) return;

  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);

    try {
      await container.stop({ t: 5 });
    } catch (stopErr) {
      if (!String(stopErr.message).includes('not running')) {
        logger.warn(`[DOCKER] Stop warning for ${containerId.slice(0, 12)}: ${stopErr.message}`);
      }
    }

    await container.remove({ force: true });
    logger.info(`[DOCKER] Container removed: ${containerId.slice(0, 12)}`);
  } catch (err) {
    logger.warn(`[DOCKER] Could not remove container ${containerId.slice(0, 12)}: ${err.message}`);
  }
};

/**
 * Remove a Docker image by tag.
 * Errors are logged but not thrown.
 *
 * @param {string} imageTag
 */
const removeImage = async (imageTag) => {
  if (!imageTag) return;

  try {
    const docker = getDockerClient();
    const image = docker.getImage(imageTag);
    await image.remove({ force: true });
    logger.info(`[DOCKER] Image removed: ${imageTag}`);
  } catch (err) {
    logger.warn(`[DOCKER] Could not remove image ${imageTag}: ${err.message}`);
  }
};

/**
 * Fetch recent logs from a running container.
 *
 * @param {string} containerId
 * @param {number} [tail=50]
 * @returns {Promise<string>}
 */
const getContainerLogs = async (containerId, tail = 50) => {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail,
    });
    return logsBuffer.toString('utf-8').replace(/[\x00-\x08\x0b-\x1f]/g, '');
  } catch (err) {
    logger.warn(`[DOCKER] Could not fetch logs for ${containerId.slice(0, 12)}: ${err.message}`);
    return '';
  }
};

/**
 * Check whether a container is currently running.
 *
 * @param {string} containerId
 * @returns {Promise<boolean>}
 */
const isContainerRunning = async (containerId) => {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return info.State?.Running === true;
  } catch {
    return false;
  }
};

module.exports = {
  checkDockerAvailable,
  findAvailablePort,
  sanitizeForImageName,
  buildImage,
  startContainer,
  stopAndRemoveContainer,
  removeImage,
  getContainerLogs,
  isContainerRunning,
};
