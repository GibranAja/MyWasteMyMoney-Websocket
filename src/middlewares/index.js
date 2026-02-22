'use strict';

const crypto   = require('crypto');
const config   = require('../config');
const { verifyToken } = require('../utils/token');
const { query } = require('../config/database');
const {
  AuthError, ForbiddenError, RateLimitError, AppError,
} = require('../utils/errors');
const logger = require('../utils/logger');

// ============================================================
// Request ID
// ============================================================
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// ============================================================
// Security headers
// ============================================================
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',          'DENY');
  res.setHeader('X-XSS-Protection',         '1; mode=block');
  res.setHeader('Referrer-Policy',          'no-referrer');
  res.setHeader('Cache-Control',            'no-store');
  next();
}

// ============================================================
// Body parsing with size limit
// ============================================================
function bodyParser(req, res, next) {
  if (req.method === 'GET' || req.method === 'DELETE') {
    req.body = {};
    return next();
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    req.body = {};
    return next();
  }

  const maxSize = config.server.maxBodySize;
  let data = '';
  let size = 0;

  req.on('data', chunk => {
    size += chunk.length;
    if (size > maxSize) {
      req.destroy();
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    }
    data += chunk.toString();
  });

  req.on('end', () => {
    if (!data) { req.body = {}; return next(); }
    try {
      req.body = JSON.parse(data);
      next();
    } catch (_) {
      sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
    }
  });

  req.on('error', () => sendError(res, 400, 'REQUEST_ERROR', 'Failed to read request body'));
}

// ============================================================
// Rate limiting (DB-backed, sliding window)
// ============================================================
async function rateLimit(req, res, next) {
  const ip  = req.socket.remoteAddress || 'unknown';
  const key = crypto.createHash('sha256').update(`rl:${ip}:${req.url}`).digest('hex');
  const { windowMs, maxRequests } = config.rateLimit;
  const windowSec = windowMs / 1000;

  try {
    // Upsert with atomic increment
    await query(
      `INSERT INTO rate_limit_store (key_hash, count, window_end)
       VALUES (?, 1, DATE_ADD(NOW(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE
         count = IF(window_end < NOW(), 1, count + 1),
         window_end = IF(window_end < NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), window_end)`,
      [key, windowSec, windowSec]
    );

    const [[row]] = await query(
      'SELECT count, window_end FROM rate_limit_store WHERE key_hash = ?',
      [key]
    );

    if (row && row.count > maxRequests) {
      throw new RateLimitError();
    }

    next();
  } catch (err) {
    if (err instanceof RateLimitError) {
      return sendError(res, 429, 'RATE_LIMIT_EXCEEDED', err.message);
    }
    // If rate limit DB fails, fail open (don't block requests)
    logger.warn('Rate limit check failed', { err: err.message });
    next();
  }
}

// ============================================================
// Authentication
// ============================================================
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'AUTH_ERROR', 'Authorization header required');
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);

    // Check blacklist (logout)
    const [[bl]] = await query(
      'SELECT jti FROM token_blacklist WHERE jti = ?',
      [payload.jti]
    );
    if (bl) return sendError(res, 401, 'TOKEN_REVOKED', 'Token has been revoked');

    req.user = payload;
    next();
  } catch (err) {
    const code = err.code || 'AUTH_ERROR';
    return sendError(res, 401, code, err.message);
  }
}

// ============================================================
// RBAC
// ============================================================
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'AUTH_ERROR', 'Not authenticated');
    if (!roles.includes(req.user.role)) {
      return sendError(res, 403, 'FORBIDDEN', `Requires role: ${roles.join(' or ')}`);
    }
    next();
  };
}

// ============================================================
// Error handler
// ============================================================
function errorHandler(err, req, res) {
  logger.error('Unhandled error', { reqId: req.id, err: err.message, stack: err.stack });

  if (err instanceof AppError) {
    res.writeHead(err.httpStatus, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(err.toJSON()));
  }

  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }));
}

// ============================================================
// Helper: send error response
// ============================================================
function sendError(res, status, code, message, metadata = {}) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code, message, metadata } }));
  }
}

// ============================================================
// Helper: send success response
// ============================================================
function sendSuccess(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ============================================================
// Middleware pipeline runner
// ============================================================
function runMiddleware(middlewares, req, res) {
  return new Promise((resolve, reject) => {
    let i = 0;
    function next(err) {
      if (err) return reject(err);
      if (i >= middlewares.length) return resolve();
      const mw = middlewares[i++];
      try {
        const result = mw(req, res, next);
        if (result && typeof result.catch === 'function') {
          result.catch(next);
        }
      } catch (e) {
        next(e);
      }
    }
    next();
  });
}

module.exports = {
  requestId,
  securityHeaders,
  bodyParser,
  rateLimit,
  authenticate,
  requireRole,
  errorHandler,
  sendError,
  sendSuccess,
  runMiddleware,
};
