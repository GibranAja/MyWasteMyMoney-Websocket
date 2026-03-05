'use strict';

const merchantRepo = require('../repositories/merchant.repository');
const auditRepo    = require('../repositories/auditLog.repository');
const { query }    = require('../config/database');
const {
  ConflictError, NotFoundError, ForbiddenError, AppError,
} = require('../utils/errors');

/**
 * User applies to become a merchant.
 * - User must currently have role = 'USER'
 * - Creates merchant record (status = PENDING)
 * - Upgrades user.role to 'MERCHANT' immediately
 *   (PENDING status gates actual voucher-claiming, not the role)
 */
async function register({ userId, shopName, description, address }, { ip } = {}) {
  // Check the user's current role
  const [[user]] = await query('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!user) throw new NotFoundError('User');
  if (user.role !== 'USER') {
    throw new ConflictError('Only accounts with USER role can apply to become a merchant');
  }

  // Check if a merchant record already exists
  const existing = await merchantRepo.findByUserId(userId);
  if (existing) throw new ConflictError('Merchant application already exists for this account');

  // Create merchant record
  const merchant = await merchantRepo.create({ userId, shopName, description, address });

  // Promote user role to MERCHANT (pending admin activation for voucher claiming)
  await query("UPDATE users SET role = 'MERCHANT' WHERE id = ?", [userId]);

  await auditRepo.writeAuditLog({
    actorId:    userId,
    actionType: 'MERCHANT_APPLIED',
    metadata:   { merchantId: merchant.id, shopName },
    ipAddress:  ip,
  });

  return merchant;
}

/**
 * Admin sets merchant status: ACTIVE | INACTIVE | PENDING
 * - ACTIVE  → merchant can claim vouchers
 * - INACTIVE → locks them out; user role reverts to 'USER'
 */
async function setStatus(merchantId, status, { adminId, ip } = {}) {
  const merchant = await merchantRepo.findById(merchantId);
  if (!merchant) throw new NotFoundError('Merchant');

  const VALID = ['ACTIVE', 'INACTIVE', 'PENDING'];
  if (!VALID.includes(status)) {
    throw new AppError(`Invalid status. Must be one of: ${VALID.join(', ')}`, 400, 'VALIDATION_ERROR');
  }

  await merchantRepo.updateStatus(merchantId, status);

  // Sync user role: deactivated → revert to USER, re-activated → MERCHANT
  if (status === 'INACTIVE') {
    await query("UPDATE users SET role = 'USER' WHERE id = ?", [merchant.user_id]);
  } else if (status === 'ACTIVE' || status === 'PENDING') {
    await query("UPDATE users SET role = 'MERCHANT' WHERE id = ?", [merchant.user_id]);
  }

  await auditRepo.writeAuditLog({
    actorId:    adminId,
    actionType: 'MERCHANT_STATUS_CHANGED',
    metadata:   { merchantId, newStatus: status, previousStatus: merchant.status },
    ipAddress:  ip,
  });

  return merchantRepo.findById(merchantId);
}

/**
 * Admin lists all merchants (optionally filtered by status).
 */
async function list({ page = 1, limit = 20, status } = {}) {
  return merchantRepo.list({ page, limit, status });
}

/**
 * Merchant views their own profile.
 */
async function getMyProfile(userId) {
  const merchant = await merchantRepo.findByUserId(userId);
  if (!merchant) throw new NotFoundError('Merchant profile');
  return merchant;
}

/**
 * Merchant updates their own shop details.
 */
async function updateMyProfile(userId, fields, { ip } = {}) {
  const merchant = await merchantRepo.findByUserId(userId);
  if (!merchant) throw new NotFoundError('Merchant profile');

  const updated = await merchantRepo.update(merchant.id, fields);

  await auditRepo.writeAuditLog({
    actorId:    userId,
    actionType: 'MERCHANT_PROFILE_UPDATED',
    metadata:   { merchantId: merchant.id, changes: fields },
    ipAddress:  ip,
  });

  return updated;
}

module.exports = { register, setStatus, list, getMyProfile, updateMyProfile };
