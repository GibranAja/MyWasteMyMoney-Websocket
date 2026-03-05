'use strict';

const voucherRepo  = require('../repositories/voucher.repository');
const merchantRepo = require('../repositories/merchant.repository');
const auditRepo    = require('../repositories/auditLog.repository');
const notifSvc     = require('./notification.service');
const { withTransaction } = require('../config/database');
const {
  NotFoundError,
  VoucherInvalidError,
  VoucherAlreadyClaimedError,
  VoucherExpiredError,
  MerchantPendingError,
  MerchantInactiveError,
  VoucherMerchantMismatchError,
  ForbiddenError,
} = require('../utils/errors');

/**
 * User views all their own vouchers.
 */
async function getMine(userId, opts) {
  return voucherRepo.listByUser(userId, opts);
}

/**
 * Merchant looks up a voucher by code to preview its details.
 * The merchant must be ACTIVE.
 */
async function lookup(code, merchantUserId) {
  const merchant = await _requireActiveMerchant(merchantUserId);

  const voucher = await voucherRepo.findByCode(code);
  if (!voucher) throw new VoucherInvalidError();

  // Check designated merchant restriction (read-only preview still enforced)
  if (voucher.merchant_id && voucher.merchant_id !== merchant.id) {
    throw new VoucherMerchantMismatchError();
  }

  return voucher;
}

/**
 * Merchant claims a voucher (warga shows the code to the merchant).
 * Full transaction to prevent double-claim under concurrent requests.
 */
async function claim(code, merchantUserId, { ip } = {}) {
  const merchant = await _requireActiveMerchant(merchantUserId);

  await withTransaction(async conn => {
    // Lock the voucher row
    const [[voucher]] = await conn.execute(
      'SELECT * FROM vouchers WHERE code = ? FOR UPDATE',
      [code.toUpperCase()]
    );

    if (!voucher) throw new VoucherInvalidError();

    // Self-claiming prevented: merchant cannot claim their own voucher
    if (voucher.user_id === merchant.user_id) {
      throw new ForbiddenError('Merchants cannot claim their own vouchers');
    }

    // Designated-merchant check
    if (voucher.merchant_id && voucher.merchant_id !== merchant.id) {
      throw new VoucherMerchantMismatchError();
    }

    // Status checks
    if (voucher.status === 'CLAIMED')  throw new VoucherAlreadyClaimedError();
    if (voucher.status === 'EXPIRED')  throw new VoucherExpiredError();

    // DB-level expiry check (guard against race with expireStale job)
    const [[{ now }]] = await conn.execute('SELECT NOW() AS now');
    if (new Date(voucher.expires_at) < new Date(now)) {
      await conn.execute("UPDATE vouchers SET status = 'EXPIRED' WHERE id = ?", [voucher.id]);
      throw new VoucherExpiredError();
    }

    // Claim it
    await conn.execute(
      `UPDATE vouchers
       SET status = 'CLAIMED', claimed_at = NOW(), claimed_by_merchant_id = ?
       WHERE id = ? AND status = 'ACTIVE'`,
      [merchant.id, voucher.id]
    );

    // Notify the voucher owner
    await notifSvc.send({
      userId:  voucher.user_id,
      type:    'VOUCHER_CLAIMED',
      message: `Your voucher ${voucher.code} was successfully claimed at ${merchant.shop_name}.`,
    });

    await auditRepo.writeAuditLog({
      actorId:    merchantUserId,
      actionType: 'VOUCHER_CLAIMED',
      metadata:   { voucherId: voucher.id, code: voucher.code, merchantId: merchant.id },
      ipAddress:  ip,
    });
  });

  return voucherRepo.findByCode(code.toUpperCase());
}

/**
 * Merchant views their claimed-vouchers history.
 */
async function claimedHistory(merchantUserId, opts) {
  const merchant = await merchantRepo.findByUserId(merchantUserId);
  if (!merchant) throw new NotFoundError('Merchant profile');
  return voucherRepo.listClaimedByMerchant(merchant.id, opts);
}

// ── Internal helpers ─────────────────────────────────────────

async function _requireActiveMerchant(userId) {
  const merchant = await merchantRepo.findByUserId(userId);
  if (!merchant) throw new NotFoundError('Merchant profile');
  if (merchant.status === 'PENDING')  throw new MerchantPendingError();
  if (merchant.status === 'INACTIVE') throw new MerchantInactiveError();
  return merchant;
}

module.exports = { getMine, lookup, claim, claimedHistory };
