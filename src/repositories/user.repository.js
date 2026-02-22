'use strict';

const { query } = require('../config/database');
const crypto    = require('crypto');

async function findByEmail(email) {
  const [[row]] = await query(
    'SELECT id, name, email, password_hash, salt, role, points_balance, is_active FROM users WHERE email = ?',
    [email]
  );
  return row || null;
}

async function findById(id) {
  const [[row]] = await query(
    'SELECT id, name, email, role, points_balance, is_active, created_at FROM users WHERE id = ?',
    [id]
  );
  return row || null;
}

async function create({ name, email, passwordHash, salt, role = 'USER' }) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO users (id, name, email, password_hash, salt, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, email, passwordHash, salt, role]
  );
  return { id, name, email, role, points_balance: 0 };
}

async function incrementPoints(userId, points, conn) {
  const db = conn || { execute: (sql, p) => query(sql, p) };
  // conn is a raw mysql2 connection inside a transaction
  if (conn) {
    await conn.execute(
      'UPDATE users SET points_balance = points_balance + ? WHERE id = ?',
      [points, userId]
    );
  } else {
    await query(
      'UPDATE users SET points_balance = points_balance + ? WHERE id = ?',
      [points, userId]
    );
  }
}

async function decrementPoints(userId, points, conn) {
  if (conn) {
    await conn.execute(
      'UPDATE users SET points_balance = points_balance - ? WHERE id = ? AND points_balance >= ?',
      [points, userId, points]
    );
  } else {
    await query(
      'UPDATE users SET points_balance = points_balance - ? WHERE id = ? AND points_balance >= ?',
      [points, userId, points]
    );
  }
}

async function blacklistToken(jti, expiresAt) {
  await query(
    'INSERT IGNORE INTO token_blacklist (jti, expires_at) VALUES (?, ?)',
    [jti, new Date(expiresAt * 1000)]
  );
}

async function listUsers({ page = 1, limit = 20, role } = {}) {
  const offset = (page - 1) * limit;
  let sql    = 'SELECT id, name, email, role, points_balance, is_active, created_at FROM users';
  const params = [];
  if (role) { sql += ' WHERE role = ?'; params.push(role); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const [rows] = await query(sql, params);
  return rows;
}

module.exports = { findByEmail, findById, create, incrementPoints, decrementPoints, blacklistToken, listUsers };
