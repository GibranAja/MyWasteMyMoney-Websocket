'use strict';

const { query } = require('../config/database');
const crypto    = require('crypto');

async function create({ name, description, requiredPoints, stock, createdBy, merchantId = null }) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO rewards (id, name, description, required_points, stock, created_by, merchant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || null, requiredPoints, stock, createdBy, merchantId || null]
  );
  return findById(id);
}

async function findById(id, conn) {
  const execute = conn
    ? (sql, p) => conn.execute(sql, p)
    : (sql, p) => query(sql, p);
  const [[row]] = await execute(
    'SELECT * FROM rewards WHERE id = ? FOR UPDATE',
    [id]
  );
  // Remove FOR UPDATE when no transaction
  if (!conn) {
    const [[row2]] = await query('SELECT * FROM rewards WHERE id = ?', [id]);
    return row2 || null;
  }
  return row || null;
}

async function findByIdNoLock(id) {
  const [[row]] = await query('SELECT * FROM rewards WHERE id = ?', [id]);
  return row || null;
}

async function list({ page = 1, limit = 20, status = 'ACTIVE' } = {}) {
  const offset = (page - 1) * limit;
  const [rows] = await query(
    'SELECT * FROM rewards WHERE status = ? ORDER BY required_points ASC LIMIT ? OFFSET ?',
    [status, limit, offset]
  );
  return rows;
}

async function update(id, fields) {
  const allowed = ['name', 'description', 'required_points', 'stock', 'status'];
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (!sets.length) return;
  params.push(id);
  await query(`UPDATE rewards SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function decrementStock(rewardId, conn) {
  await conn.execute(
    'UPDATE rewards SET stock = stock - 1 WHERE id = ? AND stock > 0',
    [rewardId]
  );
}

async function createRedemption({ userId, rewardId, pointsUsed }, conn) {
  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO reward_redemptions (id, user_id, reward_id, points_used)
     VALUES (?, ?, ?, ?)`,
    [id, userId, rewardId, pointsUsed]
  );
  return id;
}

async function listRedemptions(userId, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const [rows] = await query(
    `SELECT rr.*, r.name AS reward_name
     FROM reward_redemptions rr
     JOIN rewards r ON rr.reward_id = r.id
     WHERE rr.user_id = ?
     ORDER BY rr.redeemed_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

module.exports = { create, findById, findByIdNoLock, list, update, decrementStock, createRedemption, listRedemptions };
