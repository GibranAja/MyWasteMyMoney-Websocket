'use strict';

const wasteRepo  = require('../repositories/waste.repository');
const userRepo   = require('../repositories/user.repository');
const auditRepo  = require('../repositories/auditLog.repository');
const notifSvc   = require('./notification.service');
const { withTransaction } = require('../config/database');
const { NotFoundError, ForbiddenError, AppError } = require('../utils/errors');
const { broadcastToRole } = require('../websocket/server');

async function submit({ userId, wasteTypeId, weightKg, location, photoRef }, { ip } = {}) {
  const submission = await wasteRepo.create({ userId, wasteTypeId, weightKg, location, photoRef });

  await auditRepo.writeAuditLog({
    actorId:    userId,
    actionType: 'WASTE_SUBMITTED',
    metadata:   { submissionId: submission.id, wasteTypeId, weightKg },
    ipAddress:  ip,
  });

  // Notify all verifiers and admins in real-time
  broadcastToRole('VERIFIER', 'new_submission_for_admin', {
    submission_id: submission.id,
    user_id:       userId,
    waste_type:    submission.waste_type_name,
    weight_kg:     submission.weight_kg,
    location:      submission.location,
    submitted_at:  submission.submitted_at,
  });
  broadcastToRole('ADMIN', 'new_submission_for_admin', {
    submission_id: submission.id,
  });

  return submission;
}

async function verify({ submissionId, verifierId, action, notes }, { ip } = {}) {
  const submission = await wasteRepo.findById(submissionId);
  if (!submission)                     throw new NotFoundError('Submission');
  if (submission.status !== 'PENDING') throw new AppError('Submission already processed', 400, 'ALREADY_PROCESSED');

  let pointsEarned = null;

  await withTransaction(async conn => {
    if (action === 'APPROVED') {
      // Calculate points
      pointsEarned = Math.floor(submission.weight_kg * submission.points_per_kg);
      await wasteRepo.updateStatus(submissionId, 'APPROVED', pointsEarned, conn);
      await userRepo.incrementPoints(submission.user_id, pointsEarned, conn);
      await wasteRepo.addVerification({ submissionId, verifierId, action, notes }, conn);
    } else {
      await wasteRepo.updateStatus(submissionId, 'REJECTED', null, conn);
      await wasteRepo.addVerification({ submissionId, verifierId, action, notes }, conn);
    }
  });

  await auditRepo.writeAuditLog({
    actorId:    verifierId,
    actionType: `SUBMISSION_${action}`,
    metadata:   { submissionId, pointsEarned },
    ipAddress:  ip,
  });

  // Notifications
  if (action === 'APPROVED') {
    await notifSvc.send({
      userId:    submission.user_id,
      type:      'POINTS_EARNED',
      message:   `Your submission was approved! You earned ${pointsEarned} points.`,
      wsEvent:   'points_updated',
      wsPayload: {
        submission_id: submissionId,
        points_earned: pointsEarned,
      },
    });
  } else {
    await notifSvc.send({
      userId:    submission.user_id,
      type:      'SUBMISSION_REJECTED',
      message:   `Your submission was rejected.${notes ? ` Reason: ${notes}` : ''}`,
      wsEvent:   'submission_status_changed',
      wsPayload: {
        submission_id: submissionId,
        status:        'REJECTED',
        notes,
      },
    });
  }

  // Also send status-change event for approved
  if (action === 'APPROVED') {
    const { sendToUser } = require('../websocket/server');
    sendToUser(submission.user_id, 'submission_status_changed', {
      submission_id: submissionId,
      status:        'APPROVED',
      points_earned: pointsEarned,
    });
  }

  return { submission_id: submissionId, status: action, points_earned: pointsEarned };
}

async function listMySubmissions(userId, opts) {
  return wasteRepo.findByUserId(userId, opts);
}

async function listPending(opts) {
  return wasteRepo.findPending(opts);
}

async function getSubmission(id, requestingUser) {
  const submission = await wasteRepo.findById(id);
  if (!submission) throw new NotFoundError('Submission');
  if (requestingUser.role === 'USER' && submission.user_id !== requestingUser.user_id) {
    throw new ForbiddenError();
  }
  return submission;
}

module.exports = { submit, verify, listMySubmissions, listPending, getSubmission };
