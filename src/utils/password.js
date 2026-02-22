'use strict';

const crypto = require('crypto');
const config = require('../config');

const { pbkdf2Iterations, pbkdf2KeyLen, pbkdf2Digest, saltBytes } = config.security;

/**
 * Generate a random hex salt.
 */
function generateSalt() {
  return crypto.randomBytes(saltBytes).toString('hex');
}

/**
 * Hash a password with PBKDF2.
 * @returns {Promise<{hash: string, salt: string}>}
 */
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    if (!salt) salt = generateSalt();
    crypto.pbkdf2(password, salt, pbkdf2Iterations, pbkdf2KeyLen, pbkdf2Digest, (err, derivedKey) => {
      if (err) return reject(err);
      resolve({ hash: derivedKey.toString('hex'), salt });
    });
  });
}

/**
 * Verify a plain password against stored hash+salt.
 * Uses timingSafeEqual to prevent timing attacks.
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, storedHash, salt) {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash,       'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, generateSalt };
