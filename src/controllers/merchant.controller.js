'use strict';

const merchantSvc  = require('../services/merchant.service');
const { merchantValidators } = require('../validators');
const { sendSuccess } = require('../middlewares');

/**
 * POST /api/merchants/register
 * Authenticated USER applies to become a merchant.
 */
async function register(req, res) {
  const data = merchantValidators.register(req.body);
  const merchant = await merchantSvc.register({
    userId:      req.user.user_id,
    shopName:    data.shop_name,
    description: data.description,
    address:     data.address,
  }, { ip: req.socket.remoteAddress });
  sendSuccess(res, 201, { message: 'Merchant application submitted. Waiting for admin approval.', merchant });
}

/**
 * GET /api/merchants/me
 * Authenticated MERCHANT views their own profile.
 */
async function getMe(req, res) {
  const merchant = await merchantSvc.getMyProfile(req.user.user_id);
  sendSuccess(res, 200, { merchant });
}

/**
 * PUT /api/merchants/me
 * Authenticated MERCHANT updates their shop details.
 */
async function updateMe(req, res) {
  const data = merchantValidators.update(req.body);
  const merchant = await merchantSvc.updateMyProfile(req.user.user_id, {
    shopName:    data.shop_name,
    description: data.description,
    address:     data.address,
  }, { ip: req.socket.remoteAddress });
  sendSuccess(res, 200, { message: 'Merchant profile updated', merchant });
}

/**
 * GET /api/merchants
 * Admin lists all merchants (optionally filtered by ?status=PENDING|ACTIVE|INACTIVE).
 */
async function list(req, res) {
  const status = req.query?.status || undefined;
  const page   = Math.max(1, parseInt(req.query?.page) || 1);
  const limit  = Math.min(100, parseInt(req.query?.limit) || 20);
  const merchants = await merchantSvc.list({ page, limit, status });
  sendSuccess(res, 200, { merchants });
}

/**
 * PUT /api/merchants/:id/status
 * Admin sets a merchant's status to ACTIVE | INACTIVE | PENDING.
 */
async function setStatus(req, res) {
  const data = merchantValidators.setStatus(req.body);
  const merchant = await merchantSvc.setStatus(req.params.id, data.status, {
    adminId: req.user.user_id,
    ip:      req.socket.remoteAddress,
  });
  sendSuccess(res, 200, { message: `Merchant status updated to ${data.status}`, merchant });
}

module.exports = { register, getMe, updateMe, list, setStatus };
