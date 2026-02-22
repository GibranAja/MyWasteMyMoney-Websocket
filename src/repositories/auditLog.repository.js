'use strict';

const { query } = require('../config/database');
const logger    = require('../utils/logger');

/**
 * Write an audit log entry. Never throws — audit failures must not break business logic.
 */
async function writeAuditLog({ actorId, actionType, metadata = {}, ipAddress }) {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, action_type, metadata, ip_address)
       VALUES (?, ?, ?, ?)`,
      [actorId || null, actionType, JSON.stringify(metadata), ipAddress || null]
    );
  } catch (err) {
    // Log to stderr but don't propagate
    logger.error('Failed to write audit log', { err: err.message, actionType });
  }
}

module.exports = { writeAuditLog };
