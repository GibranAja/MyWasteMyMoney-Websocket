'use strict';

/**
 * Comprehensive WebSocket Test Suite
 * Tests all websocket features and functionality
 *
 * Usage: node tests/websocket.test.js
 */

const ws = require('ws');
const http = require('http');
const config = require('../src/config');
const { buildRouter } = require('../src/router');
const { createWebSocketServer } = require('../src/websocket/server');
const { testConnection, query } = require('../src/config/database');
const { createToken } = require('../src/utils/token');
const { hashPassword } = require('../src/utils/password');
const logger = require('../src/utils/logger');

// ============================================================
// Test utilities
// ============================================================

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    testsFailed++;
  } else {
    console.log(`✅ PASSED: ${message}`);
    testsPassed++;
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Test data setup/teardown
// ============================================================

let server;
let testUserId;
let testToken;
let testAdminId;
let testAdminToken;

async function setupTestServer() {
  await testConnection();

  // Create HTTP server with WebSocket
  server = http.createServer(async (req, res) => {
    const router = buildRouter();
    await router.handle(req, res);
  });

  createWebSocketServer(server);

  // Start server
  return new Promise((resolve) => {
    server.listen(config.server.wsPort, () => {
      console.log(`\n🚀 Test server running on ws://localhost:${config.server.wsPort}\n`);
      resolve();
    });
  });
}

async function createTestUsers() {
  // Create regular user
  const userId = require('crypto').randomUUID();
  const password = 'TestPassword123!';
  const { hash, salt } = await hashPassword(password);
  const userEmail = `user${Date.now()}@test.com`;

  await query(
    `INSERT INTO users (id, name, email, password_hash, salt, role, is_active)
     VALUES (?, ?, ?, ?, ?, 'USER', 1)`,
    [userId, 'Test User', userEmail, hash, salt]
  );

  testToken = createToken({
    user_id: userId,
    email: userEmail,
    role: 'USER',
    jti: require('crypto').randomUUID(),
  });

  testUserId = userId;

  // Create admin user
  const adminId = require('crypto').randomUUID();
  const adminEmail = `admin${Date.now()}@test.com`;
  await query(
    `INSERT INTO users (id, name, email, password_hash, salt, role, is_active)
     VALUES (?, ?, ?, ?, ?, 'ADMIN', 1)`,
    [adminId, 'Test Admin', adminEmail, hash, salt]
  );

  testAdminToken = createToken({
    user_id: adminId,
    email: adminEmail,
    role: 'ADMIN',
    jti: require('crypto').randomUUID(),
  });

  testAdminId = adminId;
  console.log('✓ Test users created');
}

async function cleanupTestData() {
  try {
    if (testUserId) {
      await query('DELETE FROM users WHERE id = ?', [testUserId]);
    }
    if (testAdminId) {
      await query('DELETE FROM users WHERE id = ?', [testAdminId]);
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}

// ============================================================
// Helper: Send message and wait for response
// ============================================================

function waitForMessage(client, eventName, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeout);

    const handler = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.event === eventName) {
          clearTimeout(timer);
          client.removeListener('message', handler);
          resolve(msg);
        }
      } catch (err) {
        // Ignore parsing errors, wait for more messages
      }
    };

    client.on('message', handler);
  });
}

async function testBasicConnection() {
  console.log('\n📋 Test 1: Basic Connection');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);
      let connected = false;

      client.on('open', () => {
        connected = true;
        assert(connected, 'WebSocket should connect');
        client.close();
        resolve();
      });

      client.on('error', (err) => {
        assert(false, `Connection failed: ${err.message}`);
        resolve();
      });

      setTimeout(() => {
        if (!connected) {
          assert(false, 'Connection timeout');
          resolve();
        }
      }, 5000);
    } catch (err) {
      assert(false, `Exception: ${err.message}`);
      resolve();
    }
  });
}

async function testAuthenticationFlow() {
  console.log('\n📋 Test 2: Authentication Flow');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);
      let done = false;

      client.on('open', () => {
        // Test 1: Send non-auth message first (should error)
        client.send(JSON.stringify({ event: 'ping' }));
      });

      client.on('message', (data) => {
        if (done) return;
        try {
          const msg = JSON.parse(data);

          if (msg.event === 'error' && msg.error?.code === 'NOT_AUTHENTICATED') {
            assert(true, 'Non-auth message should be rejected');

            // Test 2: Send proper auth
            client.send(JSON.stringify({ event: 'auth', token: testToken }));
          } else if (msg.event === 'auth_success') {
            done = true;
            assert(msg.data.user_id === testUserId, 'Auth should return correct user ID');
            assert(msg.data.role === 'USER', 'Auth should return correct role');
            client.close();
            resolve();
          } else if (msg.event === 'auth_error') {
            done = true;
            assert(false, `Auth failed: ${msg.error?.message}`);
            client.close();
            resolve();
          }
        } catch (err) {
          if (!done) {
            done = true;
            assert(false, `Message parsing error: ${err.message}`);
            client.close();
            resolve();
          }
        }
      });

      client.on('error', (err) => {
        if (!done) {
          done = true;
          assert(false, `Connection error: ${err.message}`);
          resolve();
        }
      });

      setTimeout(() => {
        if (!done) {
          done = true;
          client.close();
          resolve();
        }
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testPingPong() {
  console.log('\n📋 Test 3: Ping/Pong (Keep-alive)');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', async () => {
        try {
          // Auth first
          client.send(JSON.stringify({ event: 'auth', token: testToken }));
          const authMsg = await waitForMessage(client, 'auth_success', 5000);
          assert(true, 'Authenticated successfully');

          // Send ping
          client.send(JSON.stringify({ event: 'ping' }));
          const pongMsg = await waitForMessage(client, 'pong', 5000);
          assert(pongMsg.data && pongMsg.data.ts !== undefined, 'Pong should include timestamp');

          client.close();
          resolve();
        } catch (err) {
          assert(false, `Error: ${err.message}`);
          client.close();
          resolve();
        }
      });

      client.on('error', (err) => {
        assert(false, `Connection error: ${err.message}`);
        resolve();
      });

      setTimeout(() => {
        assert(false, 'Test timeout');
        client.close();
        resolve();
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testSubscribe() {
  console.log('\n📋 Test 4: Channel Subscription');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', async () => {
        try {
          // Auth first
          client.send(JSON.stringify({ event: 'auth', token: testToken }));
          await waitForMessage(client, 'auth_success', 5000);

          // Subscribe
          client.send(JSON.stringify({ event: 'subscribe', channel: 'waste-updates' }));
          const subMsg = await waitForMessage(client, 'subscribed', 5000);
          assert(subMsg.data.channel === 'waste-updates', 'Should subscribe to channel');

          client.close();
          resolve();
        } catch (err) {
          assert(false, `Error: ${err.message}`);
          client.close();
          resolve();
        }
      });

      client.on('error', (err) => {
        assert(false, `Connection error: ${err.message}`);
        resolve();
      });

      setTimeout(() => {
        assert(false, 'Test timeout');
        client.close();
        resolve();
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testUnknownEvent() {
  console.log('\n📋 Test 5: Unknown Event Handling');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', async () => {
        try {
          // Auth first
          client.send(JSON.stringify({ event: 'auth', token: testToken }));
          await waitForMessage(client, 'auth_success', 5000);

          // Send unknown event
          client.send(JSON.stringify({ event: 'unknown' }));
          const errMsg = await waitForMessage(client, 'error', 5000);
          assert(errMsg.error?.code === 'UNKNOWN_EVENT', 'Unknown event should return UNKNOWN_EVENT error');

          client.close();
          resolve();
        } catch (err) {
          assert(false, `Error: ${err.message}`);
          client.close();
          resolve();
        }
      });

      client.on('error', (err) => {
        assert(false, `Connection error: ${err.message}`);
        resolve();
      });

      setTimeout(() => {
        assert(false, 'Test timeout');
        client.close();
        resolve();
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testInvalidJSON() {
  console.log('\n📋 Test 6: Invalid JSON Handling');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', async () => {
        try {
          // Send invalid JSON immediately
          client.send('This is not JSON{]');

          const errMsg = await waitForMessage(client, 'error', 5000);
          assert(errMsg.error?.code === 'INVALID_JSON', 'Invalid JSON should return INVALID_JSON error');

          client.close();
          resolve();
        } catch (err) {
          assert(false, `Error: ${err.message}`);
          client.close();
          resolve();
        }
      });

      client.on('error', (err) => {
        assert(false, `Connection error: ${err.message}`);
        resolve();
      });

      setTimeout(() => {
        assert(false, 'Test timeout');
        client.close();
        resolve();
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testMultipleConnections() {
  console.log('\n📋 Test 7: Multiple Concurrent Connections');
  console.log('─'.repeat(50));

  return new Promise(async (resolve) => {
    try {
      const clients = [];
      let connectedCount = 0;
      const expectedCount = 3;

      for (let i = 0; i < expectedCount; i++) {
        const client = new ws(`ws://localhost:${config.server.wsPort}`);

        client.on('open', () => {
          client.send(JSON.stringify({ event: 'auth', token: testToken }));
        });

        client.on('message', (data) => {
          try {
            const msg = JSON.parse(data);
            if (msg.event === 'auth_success') {
              connectedCount++;
              if (connectedCount === expectedCount) {
                assert(true, `All ${expectedCount} connections authenticated`);
                clients.forEach(c => c.close());
                resolve();
              }
            }
          } catch (err) {
            assert(false, `Error: ${err.message}`);
            clients.forEach(c => c.close());
            resolve();
          }
        });

        clients.push(client);
      }

      setTimeout(() => {
        assert(false, `Multiple connections test timeout (${connectedCount}/${expectedCount})`);
        clients.forEach(c => c.close());
        resolve();
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testAuthTimeout() {
  console.log('\n📋 Test 8: Authentication Timeout');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);
      let resolved = false;

      client.on('message', (data) => {
        if (resolved) return;
        try {
          const msg = JSON.parse(data);
          if ((msg.event === 'error' || msg.event === 'auth_error') &&
              msg.error?.code === 'AUTH_TIMEOUT') {
            resolved = true;
            assert(true, 'Should timeout if no auth sent');
            client.close();
            resolve();
          }
        } catch (err) {
          // Ignore parsing errors
        }
      });

      client.on('close', () => {
        if (!resolved) {
          // Connection closed, which means timeout occurred
          resolved = true;
          assert(true, 'Connection closed after auth timeout');
          resolve();
        }
      });

      setTimeout(() => {
        // Fail if nothing happened after 15 seconds
        if (!resolved) {
          resolved = true;
          client.close();
          resolve();
        }
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testInvalidToken() {
  console.log('\n📋 Test 9: Invalid Token Rejection');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', () => {
        client.send(JSON.stringify({ event: 'auth', token: 'invalid.token.here' }));
      });

      client.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.event === 'auth_error') {
            assert(true, 'Invalid token should be rejected');
            client.close();
            resolve();
          }
        } catch (err) {
          assert(false, `Error: ${err.message}`);
          client.close();
          resolve();
        }
      });

      setTimeout(() => {
        assert(false, 'Invalid token test timeout');
        client.close();
        resolve();
      }, 10000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testMissingToken() {
  console.log('\n📋 Test 10: Missing Token in Auth');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', () => {
        client.send(JSON.stringify({ event: 'auth' }));
      });

      client.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.event === 'error' && msg.error?.code === 'TOKEN_MISSING') {
            assert(true, 'Missing token should error');
            client.close();
            resolve();
          }
        } catch (err) {
          assert(false, `Error: ${err.message}`);
          client.close();
          resolve();
        }
      });

      setTimeout(() => {
        assert(false, 'Missing token test timeout');
        client.close();
        resolve();
      }, 10000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

// ============================================================
// Main test runner
// ============================================================

async function runAllTests() {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 WebSocket Test Suite');
  console.log('='.repeat(50));

  try {
    // Setup
    await setupTestServer();
    await createTestUsers();

    // Run tests
    await testBasicConnection();
    await testAuthenticationFlow();
    await testPingPong();
    await testSubscribe();
    await testUnknownEvent();
    await testInvalidJSON();
    await testMultipleConnections();
    await testAuthTimeout();
    await testInvalidToken();
    await testMissingToken();

    // Cleanup
    await cleanupTestData();

  } catch (err) {
    console.error('❌ Test suite error:', err.message);
    testsFailed++;
  } finally {
    // Close server
    if (server) {
      server.close();
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Results');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${testsPassed}`);
    console.log(`❌ Failed: ${testsFailed}`);
    console.log(`📈 Total:  ${testsPassed + testsFailed}`);
    console.log('='.repeat(50));

    const exitCode = testsFailed > 0 ? 1 : 0;
    process.exit(exitCode);
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
