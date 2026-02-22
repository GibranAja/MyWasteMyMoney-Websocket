'use strict';

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT = config.server.env === 'production' ? LEVELS.info : LEVELS.debug;

function log(level, message, meta = {}) {
  if (LEVELS[level] > CURRENT) return;
  const entry = {
    ts:    new Date().toISOString(),
    level,
    msg:   message,
    ...meta,
  };
  const out = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(out + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
}

module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  info:  (msg, meta) => log('info',  msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};
