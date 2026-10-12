require('dotenv').config();
const pool = require('./src/db/pool');

async function fixUrls() {
  try {
    await pool.query("UPDATE deployments SET deployment_url = CONCAT('http://localhost:', container_port) WHERE status = 'LIVE' AND container_port IS NOT NULL");
    console.log('Successfully updated existing live deployment URLs in PostgreSQL!');
  } catch (err) {
    console.error('Error updating DB:', err);
  } finally {
    process.exit(0);
  }
}

fixUrls();
