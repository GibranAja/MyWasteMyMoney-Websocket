'use strict';

const notifRepo = require('../repositories/notification.repository');
const { sendToUser } = require('../websocket/server');
const logger = require('../utils/logger');

async function send({ userId, type, message, wsEvent, wsPayload }) {
  try {
    const notif = await notifRepo.create({ userId, type, message });
    // Push real-time
    sendToUser(userId, wsEvent || 'notification', {
      notification: notif,
      ...(wsPayload || {}),
    });
    return notif;
  } catch (err) {
    logger.error('Failed to send notification', { err: err.message, userId, type });
  }
}

module.exports = { send };
