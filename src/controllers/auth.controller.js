'use strict';

const authService  = require('../services/auth.service');
const { authValidators } = require('../validators');
const { sendSuccess, sendError } = require('../middlewares');

async function register(req, res) {
  const data = authValidators.register(req.body);
  // Only ADMIN can create non-USER roles via API
  if (data.role && data.role !== 'USER' && req.user?.role !== 'ADMIN') {
    data.role = 'USER';
  }
  const result = await authService.register(data, { ip: req.socket.remoteAddress });
  sendSuccess(res, 201, { message: 'Registration successful', user: result.user });
}

async function login(req, res) {
  const validated = authValidators.login(req.body);
  const result = await authService.login(validated, { ip: req.socket.remoteAddress });
  sendSuccess(res, 200, { message: 'Login successful', token: result.token, user: result.user });
}

async function logout(req, res) {
  await authService.logout(req.user, { ip: req.socket.remoteAddress });
  sendSuccess(res, 200, { message: 'Logged out successfully' });
}

async function getProfile(req, res) {
  const user = await authService.getProfile(req.user.user_id);
  sendSuccess(res, 200, { user });
}

module.exports = { register, login, logout, getProfile };
