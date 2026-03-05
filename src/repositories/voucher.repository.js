'use strict';

const { query } = require('../config/database');
const crypto    = require('crypto');

// Charset excludes visually ambiguous chars (0, 1, I, O) → 32 chars
// 32^8 ≈ 1.1 trillion combinations — safe against brute force at village scale
const CODE_CHARS   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VOUCHER_DAYS = 30; // vouchers expire after 30 days

function generateCode() {
  const bytes = crypto.randomBytes(8);
  const raw   = Array.from(bytes).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  // Format as XXXX-XXXX for readability
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

async function generateUniqueCode() {
  // Retry up to 5 times on the (astronomically unlikely) collision
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const [[existing]] = await query('SELECT id FROM vouchers WHERE code = ?', [code]);
    if (!existing) return code;
  }
  throw new Error('Failed to generate unique voucher code after 5 attempts');
}

async function create({ userId, rewardId, redemptionId, merchantId = null }) {
  const id   = crypto.randomUUID();
  const code = await generateUniqueCode();
  const expiresAt = new Date(Date.now() + VOUCHER_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  await query(
    `INSERT INTO vouchers (id, code, user_id, reward_id, redemption_id, merchant_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, code, userId, rewardId, redemptionId, merchantId || null, expiresAt]
  );
  return findById(id);
}

async function findById(id) {
  const [[row]] = await query('SELECT * FROM vouchers WHERE id = ?', [id]);
  return row || null;
}

async function findByCode(code) {
  const [[row]] = await query(
    `SELECT v.*,
            r.name  AS reward_name,
            r.description AS reward_description,
            u.name  AS owner_name,
            m.shop_name AS designated_merchant
     FROM vouchers v
     JOIN rewards  r ON v.reward_id = r.id
     JOIN users    u ON v.user_id   = u.id
     LEFT JOIN merchants m ON v.merchant_id = m.id
     WHERE v.code = ?`,
    [code.toUpperCase()]
  );
  return row || null;
}

async function findByRedemptionId(redemptionId) {
  const [[row]] = await query('SELECT * FROM vouchers WHERE redemption_id = ?', [redemptionId]);
  return row || null;
}

async function listByUser(userId, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const [rows] = await query(
    `SELECT v.*, r.name AS reward_name,
            m.shop_name AS designated_merchant,
            cm.shop_name AS claimed_by_shop
     FROM vouchers v
     JOIN rewards r ON v.reward_id = r.id
     LEFT JOIN merchants m  ON v.merchant_id           = m.id
     LEFT JOIN merchants cm ON v.claimed_by_merchant_id = cm.id
     WHERE v.user_id = ?
     ORDER BY v.created_at DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

async function listClaimedByMerchant(merchantId, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const [rows] = await query(
    `SELECT v.*, r.name AS reward_name, u.name AS owner_name
     FROM vouchers v
     JOIN rewards r ON v.reward_id = r.id
     JOIN users   u ON v.user_id   = u.id
     WHERE v.claimed_by_merchant_id = ?
     ORDER BY v.claimed_at DESC LIMIT ? OFFSET ?`,
    [merchantId, limit, offset]
  );
  return rows;
}

async function claim(voucherId, merchantId, conn) {
  const execute = conn
    ? (sql, p) => conn.execute(sql, p)
    : (sql, p) => query(sql, p);

  await execute(
    `UPDATE vouchers
     SET status = 'CLAIMED', claimed_at = NOW(), claimed_by_merchant_id = ?
     WHERE id = ? AND status = 'ACTIVE'`,
    [merchantId, voucherId]
  );
}

async function expireStale() {
  const [result] = await query(
    `UPDATE vouchers SET status = 'EXPIRED'
     WHERE status = 'ACTIVE' AND expires_at < NOW()`
  );
  return result.affectedRows;
}

module.exports = {
  create, findById, findByCode, findByRedemptionId,
  listByUser, listClaimedByMerchant, claim, expireStale,
};
