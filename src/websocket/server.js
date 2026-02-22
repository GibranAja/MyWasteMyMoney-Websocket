'use strict';

/**
 * Native WebSocket Server implementation using raw HTTP upgrade.
 * Implements RFC 6455 (WebSocket Protocol) manually.
 */

const http    = require('http');
const crypto  = require('crypto');
const { verifyToken } = require('../utils/token');
const { query }       = require('../config/database');
const logger          = require('../utils/logger');

// Map<userId, Set<WebSocketConnection>>
const connections = new Map();

// ============================================================
// Frame parsing/building (RFC 6455)
// ============================================================

function buildFrame(data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + opcode=1 (text)
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 2 > buffer.length) break;

    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];

    const fin    = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked  = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let pos = offset + 2;

    if (payloadLen === 126) {
      if (pos + 2 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (payloadLen === 127) {
      if (pos + 8 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(pos));
      pos += 8;
    }

    const maskKey = masked ? buffer.slice(pos, pos + 4) : null;
    if (masked) pos += 4;

    if (pos + payloadLen > buffer.length) break;

    let payload = buffer.slice(pos, pos + payloadLen);
    if (masked) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }

    frames.push({ fin, opcode, payload });
    offset = pos + payloadLen;
  }

  return { frames, remaining: buffer.slice(offset) };
}

// ============================================================
// WebSocket Handshake
// ============================================================

function performHandshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }

  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const response = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n');

  socket.write(response);
  return true;
}

// ============================================================
// Connection management
// ============================================================

function addConnection(userId, conn) {
  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId).add(conn);
}

function removeConnection(userId, conn) {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) connections.delete(userId);
}

/**
 * Send a typed event to all connections for a given user.
 */
function sendToUser(userId, eventType, payload) {
  const set = connections.get(userId);
  if (!set) return;
  const msg = JSON.stringify({ event: eventType, data: payload, ts: new Date().toISOString() });
  const frame = buildFrame(msg);
  for (const { socket } of set) {
    try { socket.write(frame); } catch (_) {}
  }
}

/**
 * Broadcast to all users with a given role.
 */
function broadcastToRole(role, eventType, payload) {
  const msg = JSON.stringify({ event: eventType, data: payload, ts: new Date().toISOString() });
  const frame = buildFrame(msg);
  for (const [, set] of connections) {
    for (const conn of set) {
      if (conn.user && conn.user.role === role) {
        try { conn.socket.write(frame); } catch (_) {}
      }
    }
  }
}

// ============================================================
// Handle a connected WebSocket socket
// ============================================================

function handleConnection(socket) {
  let user = null;
  let authenticated = false;
  let buffer = Buffer.alloc(0);
  const connObj = { socket, user: null };

  const PING_INTERVAL = 30000;
  const pingTimer = setInterval(() => {
    if (socket.writable) {
      // Send ping frame (opcode 0x9)
      const pingFrame = Buffer.from([0x89, 0x00]);
      try { socket.write(pingFrame); } catch (_) {}
    }
  }, PING_INTERVAL);

  function sendMessage(event, data, error = null) {
    const msg = error
      ? JSON.stringify({ event, error, ts: new Date().toISOString() })
      : JSON.stringify({ event, data, ts: new Date().toISOString() });
    try { socket.write(buildFrame(msg)); } catch (_) {}
  }

  function close(code = 1000, reason = '') {
    clearInterval(pingTimer);
    if (user) removeConnection(user.user_id, connObj);
    try {
      const closeFrame = Buffer.alloc(2);
      closeFrame.writeUInt16BE(code, 0);
      const frame = Buffer.concat([Buffer.from([0x88]), Buffer.from([closeFrame.length]), closeFrame]);
      socket.write(frame);
    } catch (_) {}
    socket.destroy();
    logger.debug('WS connection closed', { userId: user?.user_id, reason });
  }

  async function processMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (_) {
      return sendMessage('error', null, { code: 'INVALID_JSON', message: 'Message must be valid JSON' });
    }

    if (!authenticated) {
      // First message MUST be auth
      if (msg.event !== 'auth') {
        return sendMessage('error', null, { code: 'NOT_AUTHENTICATED', message: 'Send auth event first' });
      }
      if (!msg.token) {
        return sendMessage('error', null, { code: 'TOKEN_MISSING', message: 'Token required' });
      }

      try {
        const payload = verifyToken(msg.token);

        // Check blacklist
        const [[bl]] = await query('SELECT jti FROM token_blacklist WHERE jti = ?', [payload.jti]);
        if (bl) {
          sendMessage('auth_error', null, { code: 'TOKEN_REVOKED', message: 'Token revoked' });
          return close(1008, 'Token revoked');
        }

        user = payload;
        connObj.user = payload;
        authenticated = true;
        addConnection(user.user_id, connObj);

        sendMessage('auth_success', { user_id: user.user_id, role: user.role });
        logger.info('WS authenticated', { userId: user.user_id, role: user.role });
      } catch (err) {
        sendMessage('auth_error', null, { code: err.code || 'AUTH_FAILED', message: err.message });
        return close(1008, 'Authentication failed');
      }
      return;
    }

    // Authenticated message handling
    switch (msg.event) {
      case 'ping':
        sendMessage('pong', { ts: Date.now() });
        break;
      case 'subscribe':
        // Future: room-based subscriptions
        sendMessage('subscribed', { channel: msg.channel });
        break;
      default:
        sendMessage('error', null, { code: 'UNKNOWN_EVENT', message: `Unknown event: ${msg.event}` });
    }
  }

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, remaining } = parseFrames(buffer);
    buffer = remaining;

    for (const frame of frames) {
      switch (frame.opcode) {
        case 0x1: // text
        case 0x2: // binary
          processMessage(frame.payload.toString('utf8')).catch(err => {
            logger.error('WS message processing error', { err: err.message });
            sendMessage('error', null, { code: 'INTERNAL_ERROR', message: 'Internal error' });
          });
          break;
        case 0x8: // close
          close(1000, 'Client closed');
          break;
        case 0x9: // ping
          // Pong frame opcode 0xA
          try { socket.write(Buffer.from([0x8a, 0x00])); } catch (_) {}
          break;
        case 0xa: // pong
          break;
      }
    }
  });

  socket.on('error',  err => { logger.debug('WS socket error', { err: err.message }); close(1011, 'Socket error'); });
  socket.on('close',  ()  => { clearInterval(pingTimer); if (user) removeConnection(user.user_id, connObj); });
  socket.on('end',    ()  => close(1000, 'Socket ended'));

  // Unauthenticated timeout
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      sendMessage('error', null, { code: 'AUTH_TIMEOUT', message: 'Authentication timeout' });
      close(1008, 'Auth timeout');
    }
  }, 10000);

  socket.once('data', () => clearTimeout(authTimeout));
}

// ============================================================
// Create WebSocket server attached to an HTTP server
// ============================================================

function createWebSocketServer(httpServer) {
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.headers['upgrade']?.toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const ok = performHandshake(req, socket);
    if (!ok) return;

    socket.setTimeout(0);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10000);

    handleConnection(socket);
    logger.info('WS new connection', { ip: socket.remoteAddress });
  });

  logger.info('WebSocket server attached to HTTP server');
  return { sendToUser, broadcastToRole };
}

module.exports = { createWebSocketServer, sendToUser, broadcastToRole };
