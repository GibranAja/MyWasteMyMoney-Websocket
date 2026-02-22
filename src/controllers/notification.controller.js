'use strict';

const notifRepo = require('../repositories/notification.repository');
const { sendSuccess } = require('../middlewares');

async function list(req, res) {
  const page       = Math.max(1, parseInt(req.query?.page) || 1);
  const limit      = Math.min(100, parseInt(req.query?.limit) || 20);
  const unreadOnly = req.query?.unread === 'true';
  const notifications = await notifRepo.listByUser(req.user.user_id, { page, limit, unreadOnly });
  sendSuccess(res, 200, { notifications });
}

async function markRead(req, res) {
  await notifRepo.markRead(req.params.id, req.user.user_id);
  sendSuccess(res, 200, { message: 'Notification marked as read' });
}

async function markAllRead(req, res) {
  await notifRepo.markAllRead(req.user.user_id);
  sendSuccess(res, 200, { message: 'All notifications marked as read' });
}

module.exports = { list, markRead, markAllRead };
