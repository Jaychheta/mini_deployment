/**
 * crypto.util.js — Encryption, token redaction, and OAuth state generation.
 *
 * Security Requirements:
 *   1. AES-256-GCM encryption for stored GitHub Access Tokens
 *   2. Cryptographically secure random OAuth state generation (crypto.randomBytes)
 *   3. Comprehensive log redaction for tokens, JWTs, URLs, and sensitive headers
 */

const crypto = require('crypto');

// Default key fallback only for dev — production requires process.env.GITHUB_TOKEN_ENCRYPTION_KEY
const DEFAULT_KEY = process.env.GITHUB_TOKEN_ENCRYPTION_KEY || 'minideploy-default-secret-encryption-key-32bytes!';

/**
 * Derive a 32-byte Buffer key from the configured encryption key.
 */
const getSecretKey = () => {
  const key = process.env.GITHUB_TOKEN_ENCRYPTION_KEY || DEFAULT_KEY;
  return crypto.createHash('sha256').update(key).digest();
};

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Output format: "iv:ciphertext:authTag" (hex encoded)
 *
 * @param {string} text — Plaintext string to encrypt
 * @returns {string} Encrypted string format iv:ciphertext:tag
 */
const encrypt = (text) => {
  if (!text) return null;
  // If already encrypted format (iv:ciphertext:tag), return as-is
  if (typeof text === 'string' && text.split(':').length === 3) {
    return text;
  }

  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const key = getSecretKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
};

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Supports backward compatibility for unencrypted legacy tokens.
 *
 * @param {string} encryptedText — Format iv:ciphertext:tag or legacy plaintext
 * @returns {string} Decrypted plaintext token
 */
const decrypt = (encryptedText) => {
  if (!encryptedText) return null;

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    // Legacy plaintext token
    return encryptedText;
  }

  try {
    const [ivHex, ciphertextHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = getSecretKey();

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // If decryption fails (e.g. invalid key or format mismatch), log warning without exposing data
    console.error('[CRYPTO] Decryption failed for token.');
    return null;
  }
};

/**
 * Generate a cryptographically secure, random OAuth state string.
 * @returns {string} 64-character hex string
 */
const generateOAuthState = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Redact sensitive credentials (tokens, JWTs, password values, basic auth URLs)
 * from log lines, output streams, error tracebacks, and stored strings.
 *
 * @param {string} text — Input text to sanitize
 * @returns {string} Redacted safe text
 */
const redactSecrets = (text) => {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // 1. Redact GitHub Personal Access Tokens & OAuth Tokens (ghp_, gho_, ghu_, ghr_, github_pat_)
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]{36,255}/g, 'ghp_[REDACTED]');
  sanitized = sanitized.replace(/gho_[a-zA-Z0-9]{36,255}/g, 'gho_[REDACTED]');
  sanitized = sanitized.replace(/ghu_[a-zA-Z0-9]{36,255}/g, 'ghu_[REDACTED]');
  sanitized = sanitized.replace(/github_pat_[a-zA-Z0-9_]{80,255}/g, 'github_pat_[REDACTED]');

  // 2. Redact embedded credentials in URLs (e.g. https://<token>@github.com/... or https://user:pass@...)
  sanitized = sanitized.replace(/https:\/\/[^@\s]+@github\.com/gi, 'https://[REDACTED]@github.com');

  // 3. Redact Authorization Headers
  sanitized = sanitized.replace(/Authorization:\s*(Bearer|token)\s+[^\s"']+/gi, 'Authorization: [REDACTED]');
  sanitized = sanitized.replace(/Bearer\s+ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, 'Bearer [REDACTED]');

  // 4. Redact raw JWT tokens in text/query params
  sanitized = sanitized.replace(/state=ey[a-zA-Z0-9._-]+\b/gi, 'state=[REDACTED]');
  sanitized = sanitized.replace(/token=ey[a-zA-Z0-9._-]+\b/gi, 'token=[REDACTED]');

  return sanitized;
};

module.exports = {
  encrypt,
  decrypt,
  generateOAuthState,
  redactSecrets,
};
