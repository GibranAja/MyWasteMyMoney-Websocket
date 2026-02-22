'use strict';

const authCtrl   = require('./controllers/auth.controller');
const wasteCtrl  = require('./controllers/waste.controller');
const rewardCtrl = require('./controllers/reward.controller');
const notifCtrl  = require('./controllers/notification.controller');
const {
  authenticate, requireRole,
  runMiddleware, sendError,
} = require('./middlewares');

// ============================================================
// Simple trie-based router
// ============================================================

class Router {
  constructor() {
    this.routes = []; // [{ method, pattern, paramNames, handler, middlewares }]
  }

  add(method, path, middlewares, handler) {
    // Convert /path/:id/action to regex
    const paramNames = [];
    const pattern = path.replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method: method.toUpperCase(),
      regex: new RegExp(`^${pattern}$`),
      paramNames,
      handler,
      middlewares,
    });
  }

  async handle(req, res) {
    const url    = new URL(req.url, `http://localhost`);
    const path   = url.pathname.replace(/\/$/, '') || '/';
    req.query    = Object.fromEntries(url.searchParams.entries());
    req.params   = {};

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = path.match(route.regex);
      if (!match) continue;

      // Extract path params
      route.paramNames.forEach((name, i) => {
        req.params[name] = match[i + 1];
      });

      // Run middlewares then handler
      try {
        await runMiddleware(route.middlewares, req, res);
        if (!res.headersSent) {
          await route.handler(req, res);
        }
      } catch (err) {
        if (res.headersSent) return;
        const status   = err.httpStatus || 500;
        const code     = err.errorCode  || 'INTERNAL_ERROR';
        const message  = status < 500 ? err.message : 'An unexpected error occurred';
        const metadata = err.metadata   || {};
        sendError(res, status, code, message, metadata);
      }
      return;
    }

    sendError(res, 404, 'NOT_FOUND', `Cannot ${req.method} ${path}`);
  }
}

function buildRouter() {
  const r = new Router();
  const auth     = [authenticate];
  const admin    = [authenticate, requireRole('ADMIN')];
  const verifier = [authenticate, requireRole('VERIFIER', 'ADMIN')];
  const user     = [authenticate, requireRole('USER', 'ADMIN', 'VERIFIER')];

  // ---- Auth ----
  r.add('POST', '/api/auth/register', [],   authCtrl.register);
  r.add('POST', '/api/auth/login',    [],   authCtrl.login);
  r.add('POST', '/api/auth/logout',   auth, authCtrl.logout);
  r.add('GET',  '/api/auth/profile',  auth, authCtrl.getProfile);

  // ---- Waste submissions ----
  r.add('POST', '/api/submissions',                 [authenticate, requireRole('USER')], wasteCtrl.submit);
  r.add('GET',  '/api/submissions',                 auth, wasteCtrl.listMine);
  r.add('GET',  '/api/submissions/pending',         verifier, wasteCtrl.listPending);
  r.add('GET',  '/api/submissions/:id',             auth, wasteCtrl.getOne);
  r.add('POST', '/api/submissions/:id/verify',      verifier, wasteCtrl.verify);

  // ---- Rewards ----
  r.add('GET',  '/api/rewards',                     [],   rewardCtrl.list);
  r.add('POST', '/api/rewards',                     admin, rewardCtrl.create);
  r.add('PUT',  '/api/rewards/:id',                 admin, rewardCtrl.update);
  r.add('POST', '/api/rewards/:id/redeem',          [authenticate, requireRole('USER')], rewardCtrl.redeem);
  r.add('GET',  '/api/rewards/my-redemptions',      auth, rewardCtrl.myRedemptions);

  // ---- Notifications ----
  r.add('GET',  '/api/notifications',               auth, notifCtrl.list);
  r.add('PUT',  '/api/notifications/read-all',      auth, notifCtrl.markAllRead);
  r.add('PUT',  '/api/notifications/:id/read',      auth, notifCtrl.markRead);

  // ---- Health ----
  r.add('GET', '/health', [], (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }));
  });

  return r;
}

module.exports = { buildRouter };
