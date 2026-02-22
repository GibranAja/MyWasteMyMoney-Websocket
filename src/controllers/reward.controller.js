'use strict';

const rewardSvc = require('../services/reward.service');
const { rewardValidators } = require('../validators');
const { sendSuccess } = require('../middlewares');

async function create(req, res) {
  const data = rewardValidators.create(req.body);
  const reward = await rewardSvc.createReward({
    ...data,
    requiredPoints: data.required_points,
    adminId: req.user.user_id,
  }, { ip: req.socket.remoteAddress });
  sendSuccess(res, 201, { message: 'Reward created', reward });
}

async function update(req, res) {
  const data = rewardValidators.update(req.body);
  const reward = await rewardSvc.updateReward(req.params.id, data, {
    adminId: req.user.user_id,
    ip: req.socket.remoteAddress,
  });
  sendSuccess(res, 200, { message: 'Reward updated', reward });
}

async function list(req, res) {
  const status = req.query?.status || 'ACTIVE';
  const page   = Math.max(1, parseInt(req.query?.page) || 1);
  const limit  = Math.min(100, parseInt(req.query?.limit) || 20);
  const rewards = await rewardSvc.listRewards({ status, page, limit });
  sendSuccess(res, 200, { rewards });
}

async function redeem(req, res) {
  const result = await rewardSvc.redeem({
    userId:   req.user.user_id,
    rewardId: req.params.id,
  }, { ip: req.socket.remoteAddress });
  sendSuccess(res, 200, { message: 'Reward redeemed successfully', result });
}

async function myRedemptions(req, res) {
  const page  = Math.max(1, parseInt(req.query?.page) || 1);
  const limit = Math.min(100, parseInt(req.query?.limit) || 20);
  const redemptions = await rewardSvc.listMyRedemptions(req.user.user_id, { page, limit });
  sendSuccess(res, 200, { redemptions });
}

module.exports = { create, update, list, redeem, myRedemptions };
