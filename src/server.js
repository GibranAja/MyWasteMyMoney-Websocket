'use strict';

const http = require('http');
const config = require('./config');
const { testConnection } = require('./config/database');
const { buildRouter } = require('./router');
const {
  requestId, securityHeaders, bodyParser, rateLimit,
} = require('./middlewares');
const { createWebSocketServer } = require('./websocket/server');
const logger = require('./utils/logger');

async function main() {
  // Verify DB connectivity before accepting traffic
  await testConnection();

  const router = buildRouter();

  const server = http.createServer(async (req, res) => {
    // Global middleware pipeline
    try {
      await new Promise((resolve, reject) => {
        let done = false;
        function next(err) {
          if (done) return;
          if (err) { done = true; return reject(err); }
          resolve();
        }
        requestId(req, res, next);
      });
      await new Promise((resolve, reject) => {
        securityHeaders(req, res, err => err ? reject(err) : resolve());
      });
      await new Promise((resolve, reject) => {
        bodyParser(req, res, err => err ? reject(err) : resolve());
      });
      await rateLimit(req, res, () => {});
      await router.handle(req, res);
    } catch (err) {
      logger.error('Unhandled server error', { err: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }));
      }
    }
  });

  // Attach WebSocket server to same HTTP server (same port)
  createWebSocketServer(server);

  server.listen(config.server.port, () => {
    logger.info(`HTTP + WebSocket server listening`, { port: config.server.port, env: config.server.env });
  });

  // Graceful shutdown
  const shutdown = async signal => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000); // Force kill after 10s
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', err => {
    logger.error('Uncaught exception', { err: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    process.exit(1);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
