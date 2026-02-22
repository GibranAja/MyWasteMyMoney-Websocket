'use strict';

const { query } = require('../config/database');
const crypto    = require('crypto');

async function create({ userId, type, message }) {
  const id = crypto.randomUUID();
  await query(
    'INSERT INTO notifications (id, user_id, type, message) VALUES (?, ?, ?, ?)',
    [id, userId, type, message]
  );
  return { id, user_id: userId, type, message, is_read: 0, created_at: new Date() };
}

async function listByUser(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const offset = (page - 1) * limit;
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];
  if (unreadOnly) { sql += ' AND is_read = 0'; }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const [rows] = await query(sql, params);
  return rows;
}

async function markRead(id, userId) {
  await query(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [id, userId]
  );
}

async function markAllRead(userId) {
  await query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
}

module.exports = { create, listByUser, markRead, markAllRead };
