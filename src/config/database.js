'use strict';

const mysql = require('mysql2/promise');
const config = require('../config');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:              config.db.host,
      port:              config.db.port,
      user:              config.db.user,
      password:          config.db.password,
      database:          config.db.database,
      waitForConnections: config.db.waitForConnections,
      connectionLimit:   config.db.poolMax,
      queueLimit:        config.db.queueLimit,
      // Enable prepared statements — prevents SQL injection at driver level
      namedPlaceholders: false,
      // Ensure strict mode
      timezone:          'Z',
      multipleStatements: false,
    });
  }
  return pool;
}

/**
 * Execute a parameterised query (always uses prepared statements).
 * @param {string} sql
 * @param {Array}  params
 * @returns {Promise<[rows, fields]>}
 */
async function query(sql, params = []) {
  const db = getPool();
  try {
    return await db.execute(sql, params);
  } catch (err) {
    // Re-throw with structured context
    const error = new Error(`DB query failed: ${err.message}`);
    error.code        = 'DB_ERROR';
    error.originalErr = err;
    throw error;
  }
}

/**
 * Run a function inside a transaction.
 * @param {(conn: mysql.PoolConnection) => Promise<any>} fn
 */
async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function testConnection() {
  try {
    await query('SELECT 1');
    console.log('[DB] Connection pool initialised');
  } catch (err) {
    console.error('[DB] Cannot connect to database:', err.message);
    process.exit(1);
  }
}

module.exports = { query, withTransaction, testConnection, getPool };
