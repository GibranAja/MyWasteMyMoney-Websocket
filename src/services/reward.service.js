'use strict';

const rewardRepo = require('../repositories/reward.repository');
const userRepo   = require('../repositories/user.repository');
const auditRepo  = require('../repositories/auditLog.repository');
const notifSvc   = require('./notification.service');
const { withTransaction, query } = require('../config/database');
const {
  NotFoundError, AppError,
  InsufficientPointsError, OutOfStockError,
} = require('../utils/errors');

async function createReward({ name, description, requiredPoints, stock, adminId }, { ip } = {}) {
  const reward = await rewardRepo.create({ name, description, requiredPoints, stock, createdBy: adminId });
  await auditRepo.writeAuditLog({
    actorId:    adminId,
    actionType: 'REWARD_CREATED',
    metadata:   { rewardId: reward.id, name, requiredPoints, stock },
    ipAddress:  ip,
  });
  return reward;
}

async function updateReward(id, fields, { adminId, ip } = {}) {
  const reward = await rewardRepo.findByIdNoLock(id);
  if (!reward) throw new NotFoundError('Reward');
  await rewardRepo.update(id, fields);
  await auditRepo.writeAuditLog({
    actorId:    adminId,
    actionType: 'REWARD_UPDATED',
    metadata:   { rewardId: id, changes: fields },
    ipAddress:  ip,
  });
  return rewardRepo.findByIdNoLock(id);
}

async function listRewards(opts) {
  return rewardRepo.list(opts);
}

async function redeem({ userId, rewardId }, { ip } = {}) {
  let redemptionId;
  let reward;

  await withTransaction(async conn => {
    // Lock the reward row for this transaction
    const [[lockedReward]] = await conn.execute(
      'SELECT * FROM rewards WHERE id = ? FOR UPDATE',
      [rewardId]
    );

    if (!lockedReward) throw new NotFoundError('Reward');
    if (lockedReward.status !== 'ACTIVE') throw new AppError('Reward is not available', 400, 'REWARD_INACTIVE');
    if (lockedReward.stock <= 0) throw new OutOfStockError(lockedReward.name);

    reward = lockedReward;

    // Lock user row and read current balance
    const [[lockedUser]] = await conn.execute(
      'SELECT id, points_balance FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );

    if (lockedUser.points_balance < lockedReward.required_points) {
      throw new InsufficientPointsError(lockedReward.required_points, lockedUser.points_balance);
    }

    // Deduct points
    await conn.execute(
      'UPDATE users SET points_balance = points_balance - ? WHERE id = ?',
      [lockedReward.required_points, userId]
    );

    // Decrement stock
    await conn.execute(
      'UPDATE rewards SET stock = stock - 1 WHERE id = ?',
      [rewardId]
    );

    // Record redemption
    const crypto = require('crypto');
    redemptionId = crypto.randomUUID();
    await conn.execute(
      'INSERT INTO reward_redemptions (id, user_id, reward_id, points_used) VALUES (?, ?, ?, ?)',
      [redemptionId, userId, rewardId, lockedReward.required_points]
    );
  });

  await auditRepo.writeAuditLog({
    actorId:    userId,
    actionType: 'REWARD_REDEEMED',
    metadata:   { rewardId, redemptionId, pointsUsed: reward.required_points },
    ipAddress:  ip,
  });

  await notifSvc.send({
    userId,
    type:      'REWARD_REDEEMED',
    message:   `You successfully redeemed "${reward.name}" for ${reward.required_points} points.`,
    wsEvent:   'reward_redeemed',
    wsPayload: {
      redemption_id: redemptionId,
      reward_id:     rewardId,
      reward_name:   reward.name,
      points_used:   reward.required_points,
    },
  });

  // Also push points_updated event
  const { sendToUser } = require('../websocket/server');
  sendToUser(userId, 'points_updated', {
    change: -reward.required_points,
    reason: 'reward_redemption',
    reward_name: reward.name,
  });

  return { redemption_id: redemptionId, reward_id: rewardId, points_used: reward.required_points };
}

async function listMyRedemptions(userId, opts) {
  return rewardRepo.listRedemptions(userId, opts);
}

module.exports = { createReward, updateReward, listRewards, redeem, listMyRedemptions };
