'use strict';

const voucherSvc = require('../services/voucher.service');
const { sendSuccess } = require('../middlewares');

/**
 * GET /api/vouchers/mine
 * Authenticated user sees all their own vouchers.
 */
async function mine(req, res) {
  const page  = Math.max(1, parseInt(req.query?.page) || 1);
  const limit = Math.min(100, parseInt(req.query?.limit) || 20);
  const vouchers = await voucherSvc.getMine(req.user.user_id, { page, limit });
  sendSuccess(res, 200, { vouchers });
}

/**
 * GET /api/vouchers/claimed
 * Authenticated MERCHANT sees all vouchers they have claimed.
 */
async function claimed(req, res) {
  const page  = Math.max(1, parseInt(req.query?.page) || 1);
  const limit = Math.min(100, parseInt(req.query?.limit) || 20);
  const vouchers = await voucherSvc.claimedHistory(req.user.user_id, { page, limit });
  sendSuccess(res, 200, { vouchers });
}

/**
 * GET /api/vouchers/:code
 * Authenticated MERCHANT looks up a voucher by code (preview before claiming).
 */
async function lookup(req, res) {
  const voucher = await voucherSvc.lookup(req.params.code, req.user.user_id);
  sendSuccess(res, 200, { voucher });
}

/**
 * POST /api/vouchers/:code/claim
 * Authenticated MERCHANT claims a voucher shown by a warga.
 */
async function claim(req, res) {
  const voucher = await voucherSvc.claim(req.params.code, req.user.user_id, {
    ip: req.socket.remoteAddress,
  });
  sendSuccess(res, 200, { message: 'Voucher claimed successfully', voucher });
}

module.exports = { mine, claimed, lookup, claim };
