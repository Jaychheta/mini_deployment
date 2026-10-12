/**
 * nginx.service.js — Nginx Reverse Proxy & Route Configuration Manager.
 *
 * Handles:
 *   - Nginx template generation & safe config writing (atomic temp file → move)
 *   - Isolated Nginx syntax validation (`nginx -t` on an unprivileged high test port)
 *     without binding port 80, without touching /run/nginx.pid, and without sudo
 *   - Host Nginx integration verification (checking /etc/nginx/conf.d include)
 *   - Graceful reload (`systemctl reload nginx || nginx -s reload`)
 *   - Config cleanup on project deletion / redeployment
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const crypto = require('crypto');
const logger = require('../utils/logger.util');

const execAsync = util.promisify(exec);

const NGINX_ENABLED = (process.env.NGINX_ENABLED || 'false').toLowerCase() === 'true';
const NGINX_CONFIG_DIR = process.env.NGINX_CONFIG_DIR || path.join(__dirname, '../../../nginx/generated');
const NGINX_BIN_PATH = process.env.NGINX_BIN_PATH || 'nginx';

/**
 * Ensure nginx configuration directory and temp directory exist.
 */
const ensureConfigDir = async () => {
  try {
    await fsPromises.mkdir(NGINX_CONFIG_DIR, { recursive: true, mode: 0o775 });
    const tempDir = path.join(NGINX_CONFIG_DIR, 'temp');
    await fsPromises.mkdir(tempDir, { recursive: true, mode: 0o775 });
  } catch (err) {
    logger.error(`[NGINX] Failed to create config directory: ${err.message}`);
  }
};

/**
 * Check whether Nginx binary / service is accessible on the host machine.
 * @returns {Promise<{ available: boolean, reason?: string }>}
 */
const checkNginxAvailable = async () => {
  const isEnabled = (process.env.NGINX_ENABLED || 'false').toLowerCase() === 'true';
  if (!isEnabled) {
    return { available: false, reason: 'Nginx is disabled via NGINX_ENABLED=false in env.' };
  }

  try {
    const binPath = process.env.NGINX_BIN_PATH || 'nginx';
    await execAsync(`"${binPath}" -v`);
    return { available: true };
  } catch (err) {
    return {
      available: false,
      reason: `Nginx executable not found or not in PATH (${process.env.NGINX_BIN_PATH || 'nginx'}): ${err.message}`,
    };
  }
};

/**
 * Check whether host Nginx configuration includes our generated configs directory.
 * @returns {Promise<{ included: boolean, path?: string }>}
 */
const checkHostNginxIncluded = async () => {
  if (process.platform === 'win32') return { included: true };

  const commonIncludeLocations = [
    '/etc/nginx/conf.d/mini-deploy-apps.conf',
    '/etc/nginx/conf.d/mini-deploy.conf',
    '/etc/nginx/sites-enabled/mini-deploy',
    '/etc/nginx/nginx.conf',
  ];

  for (const loc of commonIncludeLocations) {
    try {
      const content = await fsPromises.readFile(loc, 'utf8');
      if (content.includes(NGINX_CONFIG_DIR) || content.includes('nginx/generated')) {
        return { included: true, path: loc };
      }
    } catch {
      // File doesn't exist or unreadable, continue
    }
  }

  return {
    included: false,
    reason: `Host Nginx does not yet include ${NGINX_CONFIG_DIR}/*.conf. Add 'include ${NGINX_CONFIG_DIR}/*.conf;' to /etc/nginx/conf.d/mini-deploy-apps.conf`,
  };
};

/**
 * Generate Nginx server block configuration string.
 * Uses strict escaping & validation — only dynamic hostname and integer port allowed.
 *
 * @param {string} hostname - e.g. "my-app-a91c.localhost"
 * @param {number} hostPort - e.g. 52341
 * @param {string|null} htpasswdPath - path to .htpasswd file
 * @returns {string} Nginx config file content
 */
const generateNginxConfigContent = (hostname, hostPort, htpasswdPath = null) => {
  if (!hostname || typeof hostname !== 'string' || !/^[a-z0-9.-]+$/i.test(hostname)) {
    throw new Error(`Invalid hostname for Nginx config: ${hostname}`);
  }

  const portInt = parseInt(hostPort, 10);
  if (isNaN(portInt) || portInt < 1024 || portInt > 65535) {
    throw new Error(`Invalid host port for Nginx config: ${hostPort}`);
  }

  // Support multiple alias hostnames (e.g. nip.io, sslip.io, custom domain, and raw IP subdomain if applicable)
  const serverNames = [hostname];
  if (hostname.endsWith('.nip.io')) {
    const rawHost = hostname.replace(/\.nip\.io$/, '');
    serverNames.push(`${rawHost}.sslip.io`);
    serverNames.push(rawHost);
  } else if (/(\d{1,3}\.){3}\d{1,3}/.test(hostname)) {
    serverNames.push(`${hostname}.nip.io`);
    serverNames.push(`${hostname}.sslip.io`);
  } else {
    // Custom domain (e.g. app-123.dbj.linkpc.net) -> also add nip.io alias as resilient fallback
    const slug = hostname.split('.')[0];
    const serverIp = process.env.PUBLIC_IP || '13.203.209.65';
    serverNames.push(`${slug}.${serverIp}.nip.io`);
  }

  const uniqueServerNames = [...new Set(serverNames)].join(' ');

  const sslCertPath = process.env.SSL_CERT_PATH || '/etc/letsencrypt/live/dbj.linkpc.net/fullchain.pem';
  const sslKeyPath  = process.env.SSL_KEY_PATH  || '/etc/letsencrypt/live/dbj.linkpc.net/privkey.pem';
  const hasSsl = fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath);

  return `# Auto-generated by Mini Deploy Platform — Phase 6 & Phase 8
# Hostname: ${hostname} -> http://127.0.0.1:${portInt}

server {
    listen 80;
    listen [::]:80;
${hasSsl ? `    listen 443 ssl;\n    listen [::]:443 ssl;\n    ssl_certificate ${sslCertPath};\n    ssl_certificate_key ${sslKeyPath};\n` : ''}    server_name ${uniqueServerNames};

    ${htpasswdPath ? `auth_basic "Restricted Access";\n    auth_basic_user_file ${htpasswdPath.replace(/\\/g, '/')};` : ''}

    location / {
        proxy_pass http://127.0.0.1:${portInt};
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
`;
};

/**
 * Validate Nginx server block syntax in an isolated test wrapper.
 *
 * CRITICAL SAFETY RULES:
 * 1. Must NOT attempt to bind port 80 (avoids EACCES / Permission denied for unprivileged user).
 *    Uses an unprivileged high test port (e.g. 18080) for validation only.
 * 2. Must NOT access /run/nginx.pid or /var/log/nginx/ (uses isolated temp paths).
 * 3. Must NOT require sudo.
 * 4. Must clean up all validation files in temp directory in a finally block.
 *
 * @param {string} serverBlockContent - The generated server { ... } block
 * @param {string} projectSlug - Project slug identifier
 * @returns {Promise<{ valid: boolean }>}
 */
const validateNginxConfig = async (serverBlockContent, projectSlug = 'test') => {
  const tempDir = path.join(NGINX_CONFIG_DIR, 'temp');
  await fsPromises.mkdir(tempDir, { recursive: true, mode: 0o775 });

  const testId = `${projectSlug}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const validationConfigFile = path.join(tempDir, `validate-${testId}.conf`);
  const validationPidFile    = path.join(tempDir, `validate-${testId}.pid`);
  const validationErrorLog   = path.join(tempDir, `validate-${testId}-err.log`);
  const validationAccessLog  = path.join(tempDir, `validate-${testId}-acc.log`);

  // Replace all listen directives with a single unprivileged listen port to validate syntax without duplicate listen or privilege errors
  const testPort = 18080;
  let safeValidationBlock = serverBlockContent
    .replace(/listen\s+[^;]+;/gi, '')
    .replace(/ssl_certificate.*?;/gi, '')
    .replace(/ssl_certificate_key.*?;/gi, '')
    .replace(/server\s*\{/i, `server {\n        listen ${testPort};`);

  const wrappedValidationConfig = `# Isolated syntax validation wrapper
pid ${validationPidFile.replace(/\\/g, '/')};
error_log ${validationErrorLog.replace(/\\/g, '/')} crit;

events {
    worker_connections 64;
}

http {
    access_log ${validationAccessLog.replace(/\\/g, '/')};
    client_body_temp_path ${tempDir.replace(/\\/g, '/')}/client_temp_${testId};
    proxy_temp_path ${tempDir.replace(/\\/g, '/')}/proxy_temp_${testId};
    fastcgi_temp_path ${tempDir.replace(/\\/g, '/')}/fastcgi_temp_${testId};
    uwsgi_temp_path ${tempDir.replace(/\\/g, '/')}/uwsgi_temp_${testId};
    scgi_temp_path ${tempDir.replace(/\\/g, '/')}/scgi_temp_${testId};

    ${safeValidationBlock}
}
`;

  try {
    await fsPromises.writeFile(validationConfigFile, wrappedValidationConfig, 'utf8');

    // Run syntax check
    const { stdout, stderr } = await execAsync(`"${NGINX_BIN_PATH}" -t -c "${validationConfigFile}"`);
    return { valid: true };
  } catch (err) {
    const errorDetails = err.stderr || err.stdout || err.message;
    logger.error(`[NGINX] Syntax validation error for ${projectSlug}: ${errorDetails}`);
    throw new Error(`Nginx configuration syntax validation failed: ${errorDetails}`);
  } finally {
    // Unconditionally clean up test files
    try { await fsPromises.unlink(validationConfigFile); } catch {}
    try { await fsPromises.unlink(validationPidFile); } catch {}
    try { await fsPromises.unlink(validationErrorLog); } catch {}
    try { await fsPromises.unlink(validationAccessLog); } catch {}
  }
};

/**
 * Write configuration atomically (temp file -> validate -> move).
 *
 * @param {string} projectSlug
 * @param {string} hostname
 * @param {number} hostPort
 * @param {string|null} accessPassword
 * @returns {Promise<{ configPath: string, reloaded: boolean, warning?: string }>}
 */
const applyNginxConfig = async (projectSlug, hostname, hostPort, accessPassword = null) => {
  await ensureConfigDir();

  let htpasswdPath = null;
  if (accessPassword) {
    htpasswdPath = path.join(NGINX_CONFIG_DIR, `${projectSlug}.htpasswd`);
    const sha1 = crypto.createHash('sha1').update(accessPassword).digest('base64');
    const htpasswdContent = `admin:{SHA}${sha1}\n`;
    await fsPromises.writeFile(htpasswdPath, htpasswdContent, 'utf8');
  }

  const configContent = generateNginxConfigContent(hostname, hostPort, htpasswdPath);
  const targetFileName = `${projectSlug}.conf`;
  const targetPath = path.join(NGINX_CONFIG_DIR, targetFileName);
  const tempPath = path.join(NGINX_CONFIG_DIR, 'temp', `${projectSlug}-${Date.now()}.tmp`);

  // Check Nginx availability
  const { available, reason } = await checkNginxAvailable();

  if (!available) {
    logger.warn(`[NGINX] Nginx is not available on host (${reason}). File saved to ${targetPath} without live reload.`);
    await fsPromises.writeFile(tempPath, configContent, 'utf8');
    await fsPromises.rename(tempPath, targetPath);
    return { configPath: targetPath, reloaded: false, warning: reason };
  }

  // 1. Validate generated configuration syntax using unprivileged isolated test
  await validateNginxConfig(configContent, projectSlug);

  // 2. Check if host Nginx includes the generated directory
  const includeCheck = await checkHostNginxIncluded();
  if (!includeCheck.included && includeCheck.reason) {
    logger.warn(`[NGINX] ${includeCheck.reason}`);
  }

  // 3. Atomically write live configuration to targetPath
  // Keep backup of existing targetPath if it exists (for rollback on reload failure)
  let backupPath = null;
  try {
    await fsPromises.access(targetPath);
    backupPath = `${targetPath}.bak`;
    await fsPromises.copyFile(targetPath, backupPath);
  } catch {
    // No previous file, nothing to back up
  }

  await fsPromises.writeFile(tempPath, configContent, 'utf8');
  await fsPromises.rename(tempPath, targetPath);

  // 4. Reload Nginx gracefully
  try {
    await reloadNginx();
    logger.info(`[NGINX] Successfully updated and reloaded config for ${hostname}`);
    if (backupPath) {
      try { await fsPromises.unlink(backupPath); } catch {}
    }
    return { configPath: targetPath, reloaded: true };
  } catch (err) {
    // If reload fails, restore previous configuration to preserve working state
    logger.error(`[NGINX] Reload failed. Restoring previous state...`);
    if (backupPath) {
      try {
        await fsPromises.rename(backupPath, targetPath);
        await reloadNginx().catch(() => {});
      } catch {}
    } else {
      try { await fsPromises.unlink(targetPath); } catch {}
    }
    throw new Error(`Nginx reload failed: ${err.message}`);
  }
};

/**
 * Perform Nginx graceful reload.
 * Works without sudo via systemd polkit / systemctl.
 */
const reloadNginx = async () => {
  const reloadCmd = process.platform === 'win32'
    ? `"${NGINX_BIN_PATH}" -s reload`
    : `systemctl reload nginx || "${NGINX_BIN_PATH}" -s reload`;

  try {
    await execAsync(reloadCmd);
  } catch (err) {
    logger.error(`[NGINX] Reload command failed: ${err.message}`);
    throw new Error(`Failed to reload Nginx daemon: ${err.stderr || err.message}`);
  }
};

/**
 * Remove Nginx configuration file for a project (e.g., when deleted).
 * @param {string} projectSlug
 */
const removeNginxConfig = async (projectSlug) => {
  if (!projectSlug) return;
  const targetFileName = `${projectSlug}.conf`;
  const targetPath = path.join(NGINX_CONFIG_DIR, targetFileName);
  const htpasswdPath = path.join(NGINX_CONFIG_DIR, `${projectSlug}.htpasswd`);

  try {
    await fsPromises.access(targetPath);
    await fsPromises.unlink(targetPath);
    try { await fsPromises.unlink(htpasswdPath); } catch {}
    const { available } = await checkNginxAvailable();
    if (available) {
      try {
        await reloadNginx();
      } catch (err) {
        logger.warn(`[NGINX] Failed to reload Nginx after config removal: ${err.message}`);
      }
    }
  } catch {}
};

module.exports = {
  checkNginxAvailable,
  checkHostNginxIncluded,
  generateNginxConfigContent,
  validateNginxConfig,
  applyNginxConfig,
  reloadNginx,
  removeNginxConfig,
};
