'use strict';

const userRepo  = require('../repositories/user.repository');
const auditRepo = require('../repositories/auditLog.repository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { issueAuthToken, verifyToken }  = require('../utils/token');
const { ConflictError, AuthError }     = require('../utils/errors');

async function register({ name, email, password, role = 'USER' }, { ip } = {}) {
  const existing = await userRepo.findByEmail(email);
  if (existing) throw new ConflictError('Email already registered');

  const { hash, salt } = await hashPassword(password);
  const user = await userRepo.create({ name, email, passwordHash: hash, salt, role });

  await auditRepo.writeAuditLog({
    actorId:    user.id,
    actionType: 'USER_REGISTERED',
    metadata:   { email, role },
    ipAddress:  ip,
  });

  return { user };
}

async function login({ email, password }, { ip } = {}) {
  const user = await userRepo.findByEmail(email);

  // Always run hash comparison to prevent user enumeration timing attacks
  const valid = user ? await verifyPassword(password, user.password_hash, user.salt) : false;

  await auditRepo.writeAuditLog({
    actorId:    user?.id || null,
    actionType: 'LOGIN_ATTEMPT',
    metadata:   { email, success: valid },
    ipAddress:  ip,
  });

  if (!user || !valid) throw new AuthError('Invalid email or password');
  if (!user.is_active)  throw new AuthError('Account is deactivated');

  const token = issueAuthToken(user);

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, points_balance: user.points_balance },
  };
}

async function logout(tokenPayload, { ip } = {}) {
  await userRepo.blacklistToken(tokenPayload.jti, tokenPayload.exp);
  await auditRepo.writeAuditLog({
    actorId:    tokenPayload.user_id,
    actionType: 'LOGOUT',
    metadata:   { jti: tokenPayload.jti },
    ipAddress:  ip,
  });
}

async function getProfile(userId) {
  const user = await userRepo.findById(userId);
  if (!user) throw new AuthError('User not found');
  return user;
}

module.exports = { register, login, logout, getProfile };
