'use strict';

const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config');
const { getPool } = require('../config/database');

async function migrate() {
  // First, connect without database to create it if needed
  console.log('[DB] Connecting to MySQL...');
  const initPool = mysql.createPool({
    host:     config.db.host,
    port:     config.db.port,
    user:     config.db.user,
    password: config.db.password,
    waitForConnections: true,
    connectionLimit:    5,
  });

  const initConn = await initPool.getConnection();
  try {
    // Create database if not exists
    await initConn.query(`CREATE DATABASE IF NOT EXISTS ${config.db.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('[DB] Database assured to exist');
  } finally {
    initConn.release();
    await initPool.end();
  }

  // Now connect to the database for migrations
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.query('SELECT 1');
    console.log('[DB] Connection pool initialised');
  } catch (err) {
    console.error('[DB] Cannot connect to database:', err.message);
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, '../../sql/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Split on semicolons and extract SQL statements
  const allParts = sql.split(';');

  const statements = allParts
    .map(part => {
      // Remove comment lines and rejoin
      return part
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
    })
    .filter(stmt => stmt.length > 0);

  console.log(`[DB] Found ${statements.length} SQL statements to execute\n`);

  // Allow multiple statements for migration
  try {
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      try {
        await conn.query(stmt);
        console.log('✓', stmt.slice(0, 60).replace(/\n/g, ' '));
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_DUP_ENTRY') {
          console.log('~ (already exists, skipping)');
        } else {
          throw err;
        }
      }
    }
    console.log('\nMigration complete!');
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
