/**
 * slug.util.js — Helper utility for generating safe, unique hostnames and slugs.
 *
 * Implements Phase 6 Hostname rules:
 *   - Lowercase
 *   - Replace spaces/special chars with hyphens
 *   - Allowed chars: [a-z0-9-]
 *   - Remove leading/trailing hyphens
 *   - Prevent reserved platform hostnames (api, admin, www, etc.)
 *   - Append deterministic/random short unique suffix when needed
 */

const crypto = require('crypto');

const RESERVED_HOSTNAMES = new Set([
  'www', 'api', 'admin', 'dashboard', 'mail', 'app',
  'localhost', 'nginx', 'server', 'root', 'static',
  'assets', 'media', 'auth', 'login', 'signup', 'webhook', 'webhooks'
]);

/**
 * Generate a safe slug from a project name.
 * @param {string} name 
 * @returns {string}
 */
const generateSafeSlug = (name) => {
  if (!name || typeof name !== 'string') return 'app';

  let slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')  // replace unsupported chars with hyphen
    .replace(/-+/g, '-')          // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');     // trim leading/trailing hyphens

  if (!slug || slug.length < 2) {
    slug = 'project';
  }

  // Enforce maximum length of 40 chars for base slug
  if (slug.length > 40) {
    slug = slug.substring(0, 40).replace(/-+$/, '');
  }

  return slug;
};

/**
 * Generate a unique hostname given a project name and project ID.
 * @param {string} name - Project name
 * @param {string} projectId - Project UUID or ID
 * @param {string} baseDomain - e.g., 'localhost' or 'example.com'
 * @returns {{ slug: string, hostname: string }}
 */
const generateHostname = (name, projectId, baseDomain = process.env.DEPLOYMENT_DOMAIN || 'localhost') => {
  let slug = generateSafeSlug(name);

  // Check if reserved or short
  const isReserved = RESERVED_HOSTNAMES.has(slug);
  
  // Use short hash from projectId to ensure global uniqueness across users
  const shortId = projectId
    ? projectId.replace(/-/g, '').substring(0, 6)
    : crypto.randomBytes(3).toString('hex');

  // If reserved or always for standard uniqueness, construct slug with suffix
  let deploymentSlug = `${slug}-${shortId}`;
  if (!isReserved && slug.length > 15) {
    // Keep it readable if base slug is long
    deploymentSlug = `${slug.substring(0, 20)}-${shortId}`;
  }

  const protocol = process.env.PUBLIC_PROTOCOL || 'http';
  const hostname = `${deploymentSlug}.${baseDomain}`;
  const deploymentUrl = `${protocol}://${hostname}`;

  return {
    deploymentSlug,
    hostname,
    deploymentUrl,
  };
};

module.exports = {
  generateSafeSlug,
  generateHostname,
  RESERVED_HOSTNAMES,
};
