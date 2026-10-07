/**
 * pool.js — Shared PostgreSQL connection pool.
 *
 * Uses the 'pg' library's Pool for connection reuse.
 * Reads DATABASE_URL from environment variables.
 *
 * Usage in services:
 *   const pool = require('../db/pool');
 *   const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n❌  DATABASE_URL is not set in .env');
  console.error('   Format: postgresql://postgres:PASSWORD@localhost:5432/mini_deploy\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Reasonable defaults for a small dev deployment
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌  Unexpected PostgreSQL pool error:', err.message);
});

module.exports = pool;
