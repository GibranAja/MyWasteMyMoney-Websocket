'use strict';

const fs = require('fs');
const path = require('path');

// Simple .env parser — no external deps
function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (_) {
    // .env is optional
  }
}

loadEnv(path.join(__dirname, '../../.env'));

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

function optional(key, defaultValue) {
  return process.env[key] || defaultValue;
}

module.exports = {
  server: {
    port:      parseInt(optional('PORT', '3000')),
    wsPort:    parseInt(optional('WS_PORT', '3001')),
    env:       optional('NODE_ENV', 'development'),
    maxBodySize: parseInt(optional('MAX_BODY_SIZE', '1048576')),
  },
  db: {
    host:     optional('DB_HOST', '127.0.0.1'),
    port:     parseInt(optional('DB_PORT', '3306')),
    user:     optional('DB_USER', 'root'),
    password: optional('DB_PASSWORD', ''),
    database: optional('DB_NAME', 'waste_management'),
    poolMin:  parseInt(optional('DB_POOL_MIN', '2')),
    poolMax:  parseInt(optional('DB_POOL_MAX', '10')),
    waitForConnections: true,
    queueLimit: 0,
  },
  security: {
    tokenSecret:  optional('TOKEN_SECRET', 'CHANGE_ME_IN_PRODUCTION_USE_LONG_RANDOM_STRING'),
    tokenExpiry:  parseInt(optional('TOKEN_EXPIRY_SECONDS', '86400')),
    pbkdf2Iterations: 100000,
    pbkdf2KeyLen:     64,
    pbkdf2Digest:     'sha512',
    saltBytes:        32,
  },
  rateLimit: {
    windowMs:    parseInt(optional('RATE_LIMIT_WINDOW_MS', '60000')),
    maxRequests: parseInt(optional('RATE_LIMIT_MAX_REQUESTS', '100')),
  },
};
