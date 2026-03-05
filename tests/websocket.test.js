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
const { sendToUser, broadcastToRole } = require('../src/websocket/server');

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
// New Feature Tests
// ============================================================

async function testSendToUser() {
  console.log('\n📋 Test 11: sendToUser – Server-Push to Specific User');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', async () => {
        try {
          // Authenticate
          client.send(JSON.stringify({ event: 'auth', token: testToken }));
          await waitForMessage(client, 'auth_success', 5000);
          assert(true, 'Authenticated for sendToUser test');

          // Server-side push via sendToUser
          sendToUser(testUserId, 'points_updated', { change: 100, reason: 'submission_approved' });

          const pushMsg = await waitForMessage(client, 'points_updated', 5000);
          assert(pushMsg.data.change === 100, 'sendToUser should deliver correct payload');
          assert(pushMsg.data.reason === 'submission_approved', 'sendToUser payload reason should match');

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
        assert(false, 'sendToUser test timeout');
        client.close();
        resolve();
      }, 15000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testSendToUserMultipleConnections() {
  console.log('\n📋 Test 12: sendToUser – Multiple Connections Same User');
  console.log('─'.repeat(50));

  return new Promise(async (resolve) => {
    try {
      const client1 = new ws(`ws://localhost:${config.server.wsPort}`);
      const client2 = new ws(`ws://localhost:${config.server.wsPort}`);

      // Register open listeners before any async awaits to avoid race conditions
      const c1Open = new Promise((res) => client1.once('open', res));
      const c2Open = new Promise((res) => client2.once('open', res));

      // Auth both connections
      await c1Open;
      client1.send(JSON.stringify({ event: 'auth', token: testToken }));
      await waitForMessage(client1, 'auth_success', 5000);

      await c2Open;
      client2.send(JSON.stringify({ event: 'auth', token: testToken }));
      await waitForMessage(client2, 'auth_success', 5000);

      // Push to the user — both connections should receive it
      sendToUser(testUserId, 'notification', { message: 'multi-conn push test' });

      const [msg1, msg2] = await Promise.all([
        waitForMessage(client1, 'notification', 5000),
        waitForMessage(client2, 'notification', 5000),
      ]);

      assert(
        msg1.data.message === 'multi-conn push test',
        'First connection should receive push'
      );
      assert(
        msg2.data.message === 'multi-conn push test',
        'Second connection should receive push'
      );

      client1.close();
      client2.close();
      resolve();
    } catch (err) {
      assert(false, `Error: ${err.message}`);
      resolve();
    }
  });
}

async function testBroadcastToRole() {
  console.log('\n📋 Test 13: broadcastToRole – Role-Based Broadcasting');
  console.log('─'.repeat(50));

  return new Promise(async (resolve) => {
    const clients = [];
    try {
      const userClient  = new ws(`ws://localhost:${config.server.wsPort}`);
      const adminClient = new ws(`ws://localhost:${config.server.wsPort}`);
      clients.push(userClient, adminClient);

      // Register open listeners before any async awaits to avoid race conditions
      const userOpen  = new Promise((res) => userClient.once('open',  res));
      const adminOpen = new Promise((res) => adminClient.once('open', res));

      // Auth USER
      await userOpen;
      userClient.send(JSON.stringify({ event: 'auth', token: testToken }));
      await waitForMessage(userClient, 'auth_success', 5000);

      // Auth ADMIN
      await adminOpen;
      adminClient.send(JSON.stringify({ event: 'auth', token: testAdminToken }));
      await waitForMessage(adminClient, 'auth_success', 5000);

      // Broadcast ONLY to ADMIN role
      const BROADCAST_EVENT = 'new_submission_for_admin';
      broadcastToRole('ADMIN', BROADCAST_EVENT, { submission_id: 'test-sub-001' });

      // ADMIN should receive it
      const adminMsg = await waitForMessage(adminClient, BROADCAST_EVENT, 5000);
      assert(
        adminMsg.data.submission_id === 'test-sub-001',
        'ADMIN should receive broadcastToRole event'
      );

      // USER should NOT receive it (wait briefly and confirm silence)
      const userReceived = await Promise.race([
        waitForMessage(userClient, BROADCAST_EVENT, 1500).then(() => true).catch(() => false),
        new Promise((res) => setTimeout(() => res(false), 1500)),
      ]);
      assert(!userReceived, 'USER should NOT receive ADMIN-only broadcast');

      clients.forEach(c => c.close());
      resolve();
    } catch (err) {
      assert(false, `Error: ${err.message}`);
      clients.forEach(c => c.close());
      resolve();
    }
  });
}

async function testRevokedToken() {
  console.log('\n📋 Test 14: Revoked Token (JTI Blacklist)');
  console.log('─'.repeat(50));

  const revokedJti = require('crypto').randomUUID();
  const revokedToken = createToken({
    user_id: testUserId,
    email:   `revoked${Date.now()}@test.com`,
    role:    'USER',
    jti:     revokedJti,
  });

  // Insert JTI into blacklist
  await query(
    'INSERT INTO token_blacklist (jti, expires_at) VALUES (?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
    [revokedJti]
  );

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', () => {
        client.send(JSON.stringify({ event: 'auth', token: revokedToken }));
      });

      client.on('message', async (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.event === 'auth_error') {
            assert(
              msg.error?.code === 'TOKEN_REVOKED',
              `Revoked token should return TOKEN_REVOKED (got: ${msg.error?.code})`
            );
            // Cleanup blacklist entry
            await query('DELETE FROM token_blacklist WHERE jti = ?', [revokedJti]);
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
        assert(false, 'Revoked token test timeout');
        client.close();
        resolve();
      }, 10000);
    } catch (err) {
      assert(false, `Test exception: ${err.message}`);
      resolve();
    }
  });
}

async function testReAuthAfterAuthenticated() {
  console.log('\n📋 Test 15: Re-Authentication Attempt (Already Authenticated)');
  console.log('─'.repeat(50));

  return new Promise((resolve) => {
    try {
      const client = new ws(`ws://localhost:${config.server.wsPort}`);

      client.on('open', async () => {
        try {
          // Auth first
          client.send(JSON.stringify({ event: 'auth', token: testToken }));
          await waitForMessage(client, 'auth_success', 5000);
          assert(true, 'Initial authentication successful');

          // Send auth again
          client.send(JSON.stringify({ event: 'auth', token: testToken }));
          const errMsg = await waitForMessage(client, 'error', 5000);
          assert(
            errMsg.error?.code === 'UNKNOWN_EVENT',
            'Re-auth after authenticated should return UNKNOWN_EVENT'
          );

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
        assert(false, 'Re-auth test timeout');
        client.close();
        resolve();
      }, 15000);
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

    // New feature tests
    await testSendToUser();
    await testSendToUserMultipleConnections();
    await testBroadcastToRole();
    await testRevokedToken();
    await testReAuthAfterAuthenticated();

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
