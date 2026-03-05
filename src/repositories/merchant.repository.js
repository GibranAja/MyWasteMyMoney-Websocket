'use strict';

const { query } = require('../config/database');
const crypto    = require('crypto');

async function create({ userId, shopName, description, address }) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO merchants (id, user_id, shop_name, description, address)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, shopName, description || null, address]
  );
  return findById(id);
}

async function findById(id) {
  const [[row]] = await query('SELECT * FROM merchants WHERE id = ?', [id]);
  return row || null;
}

async function findByUserId(userId) {
  const [[row]] = await query('SELECT * FROM merchants WHERE user_id = ?', [userId]);
  return row || null;
}

async function list({ page = 1, limit = 20, status } = {}) {
  const offset = (page - 1) * limit;
  if (status) {
    const [rows] = await query(
      `SELECT m.*, u.name AS owner_name, u.email AS owner_email
       FROM merchants m JOIN users u ON m.user_id = u.id
       WHERE m.status = ?
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [status, limit, offset]
    );
    return rows;
  }
  const [rows] = await query(
    `SELECT m.*, u.name AS owner_name, u.email AS owner_email
     FROM merchants m JOIN users u ON m.user_id = u.id
     ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows;
}

async function updateStatus(id, status) {
  await query('UPDATE merchants SET status = ? WHERE id = ?', [status, id]);
}

async function update(id, { shopName, description, address }) {
  const sets = [];
  const params = [];
  if (shopName   !== undefined) { sets.push('shop_name = ?');   params.push(shopName); }
  if (description !== undefined) { sets.push('description = ?'); params.push(description); }
  if (address    !== undefined) { sets.push('address = ?');     params.push(address); }
  if (!sets.length) return findById(id);
  params.push(id);
  await query(`UPDATE merchants SET ${sets.join(', ')} WHERE id = ?`, params);
  return findById(id);
}

module.exports = { create, findById, findByUserId, list, updateStatus, update };
