'use strict';

const { query } = require('../config/database');
const crypto    = require('crypto');

async function create({ userId, wasteTypeId, weightKg, location, photoRef }) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO waste_submissions (id, user_id, waste_type_id, weight_kg, location, photo_ref)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, wasteTypeId, weightKg, location, photoRef || null]
  );
  return findById(id);
}

async function findById(id) {
  const [[row]] = await query(
    `SELECT ws.*, wt.name AS waste_type_name, wt.points_per_kg
     FROM waste_submissions ws
     JOIN waste_types wt ON ws.waste_type_id = wt.id
     WHERE ws.id = ?`,
    [id]
  );
  return row || null;
}

async function findByUserId(userId, { page = 1, limit = 20, status } = {}) {
  const offset = (page - 1) * limit;
  let sql = `SELECT ws.*, wt.name AS waste_type_name
             FROM waste_submissions ws
             JOIN waste_types wt ON ws.waste_type_id = wt.id
             WHERE ws.user_id = ?`;
  const params = [userId];
  if (status) { sql += ' AND ws.status = ?'; params.push(status); }
  sql += ' ORDER BY ws.submitted_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const [rows] = await query(sql, params);
  return rows;
}

async function findPending({ page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const [rows] = await query(
    `SELECT ws.*, wt.name AS waste_type_name, u.name AS user_name, u.email AS user_email
     FROM waste_submissions ws
     JOIN waste_types wt ON ws.waste_type_id = wt.id
     JOIN users u ON ws.user_id = u.id
     WHERE ws.status = 'PENDING'
     ORDER BY ws.submitted_at ASC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows;
}

async function updateStatus(id, status, pointsEarned, conn) {
  const execute = conn
    ? (sql, p) => conn.execute(sql, p)
    : (sql, p) => query(sql, p);

  await execute(
    `UPDATE waste_submissions SET status = ?, points_earned = ? WHERE id = ?`,
    [status, pointsEarned || null, id]
  );
}

async function addVerification({ submissionId, verifierId, action, notes }, conn) {
  const id = crypto.randomUUID();
  const execute = conn
    ? (sql, p) => conn.execute(sql, p)
    : (sql, p) => query(sql, p);

  await execute(
    `INSERT INTO submission_verifications (id, submission_id, verifier_id, action, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [id, submissionId, verifierId, action, notes || null]
  );
  return id;
}

module.exports = { create, findById, findByUserId, findPending, updateStatus, addVerification };
