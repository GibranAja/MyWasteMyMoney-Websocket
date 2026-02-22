'use strict';

const crypto = require('crypto');
const config = require('../config');

const SECRET = config.security.tokenSecret;

/**
 * Base64URL encode a buffer or string.
 */
function b64url(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return buf.toString('base64url');
}

/**
 * Base64URL decode to a string.
 */
function b64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

/**
 * Create a signed token.
 * Structure: base64url(header).base64url(payload).HMAC-SHA256-signature
 */
function createToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'WMT' }));
  const body   = b64url(JSON.stringify(payload));
  const signable = `${header}.${body}`;
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(signable)
    .digest('base64url');
  return `${signable}.${sig}`;
}

/**
 * Verify and decode a token.
 * Throws descriptive errors on failure.
 */
function verifyToken(token) {
  if (typeof token !== 'string') throw Object.assign(new Error('Token missing'), { code: 'TOKEN_MISSING' });

  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Token malformed'), { code: 'TOKEN_INVALID' });

  const [header, body, sig] = parts;
  const signable = `${header}.${body}`;

  // Constant-time comparison to prevent timing attacks
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(signable)
    .digest('base64url');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf   = Buffer.from(sig,      'utf8');

  if (expectedBuf.length !== actualBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw Object.assign(new Error('Token signature invalid'), { code: 'TOKEN_INVALID' });
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body));
  } catch (_) {
    throw Object.assign(new Error('Token payload corrupt'), { code: 'TOKEN_INVALID' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw Object.assign(new Error('Token expired'), { code: 'TOKEN_EXPIRED' });
  }

  return payload;
}

/**
 * Issue a full auth token for a user.
 */
function issueAuthToken(user) {
  const now = Math.floor(Date.now() / 1000);
  return createToken({
    jti:       crypto.randomUUID(),
    user_id:   user.id,
    role:      user.role,
    iat:       now,
    exp:       now + config.security.tokenExpiry,
  });
}

module.exports = { createToken, verifyToken, issueAuthToken };
