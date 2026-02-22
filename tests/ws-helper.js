#!/usr/bin/env node
'use strict';

/**
 * Interactive WebSocket Test Helper
 * Membimbing pengguna untuk test WebSocket secara manual
 *
 * Usage: node tests/ws-helper.js
 */

const readline = require('readline');
const ws = require('ws');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let client = null;
let authenticated = false;

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',    // Cyan
    success: '\x1b[32m', // Green
    error: '\x1b[31m',   // Red
    warning: '\x1b[33m', // Yellow
    reset: '\x1b[0m',
  };

  console.log(`${colors[type] || ''}${message}${colors.reset}`);
}

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function menu() {
  console.clear();
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  WebSocket Interactive Test Helper         ║');
  console.log('╚════════════════════════════════════════════╝\n');

  console.log('1. Connect to WebSocket Server');
  console.log('2. Send Auth (Authenticate)');
  console.log('3. Send Ping/Pong Test');
  console.log('4. Subscribe to Channel');
  console.log('5. Send Custom Message');
  console.log('6. List Available Commands');
  console.log('7. Show Connection Info');
  console.log('8. Disconnect');
  console.log('9. Exit\n');

  const choice = await prompt('Pilih menu (1-9): ');
  return choice.trim();
}

async function connectWebSocket() {
  const url = await prompt('WebSocket URL (default: ws://localhost:3001): ');
  const wsUrl = url || 'ws://localhost:3001';

  return new Promise((resolve) => {
    try {
      client = new ws(wsUrl);

      client.on('open', () => {
        authenticated = false;
        log('\n✓ Connected to WebSocket server', 'success');
        log(`URL: ${wsUrl}\n`);
        resolve();
      });

      client.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          log('\n📨 Received Message:', 'info');
          console.log(JSON.stringify(msg, null, 2));
          console.log();
        } catch (err) {
          log(`\n❌ Failed to parse message: ${err.message}\n`, 'error');
        }
      });

      client.on('error', (err) => {
        log(`\n❌ WebSocket Error: ${err.message}\n`, 'error');
        resolve();
      });

      client.on('close', () => {
        authenticated = false;
        log('\n⚠ Connection closed\n', 'warning');
      });

      setTimeout(() => {
        if (client && client.readyState !== ws.OPEN) {
          log('\n❌ Connection timeout\n', 'error');
          resolve();
        }
      }, 5000);

    } catch (err) {
      log(`\n❌ Connection failed: ${err.message}\n`, 'error');
      resolve();
    }
  });
}

async function authenticate() {
  if (!client || client.readyState !== ws.OPEN) {
    log('\n❌ Not connected to server. Connect first.\n', 'error');
    return;
  }

  const token = await prompt('\nEnter JWT token: ');
  if (!token) {
    log('❌ Token cannot be empty\n', 'error');
    return;
  }

  const msg = {
    event: 'auth',
    token: token,
  };

  log('\n📤 Sending auth event...', 'info');
  console.log(JSON.stringify(msg, null, 2));
  console.log();

  client.send(JSON.stringify(msg));

  // Wait for response
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log('⚠ No response from server (timeout)\n', 'warning');
      resolve();
    }, 3000);

    const originalOn = client.once;
    client.once = function(event, callback) {
      if (event === 'message') {
        const wrapper = (data) => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(data);
            if (parsed.event === 'auth_success') {
              authenticated = true;
              log('✓ Authentication successful!', 'success');
              log(`User: ${parsed.data.user_id}\nRole: ${parsed.data.role}\n`);
            } else if (parsed.event === 'auth_error') {
              log('❌ Authentication failed!', 'error');
              log(`Error: ${parsed.error.message}\n`);
            }
          } catch (err) {
            // Ignore parse errors
          }
          callback(data);
          resolve();
        };
        originalOn.call(this, event, wrapper);
      } else {
        originalOn.call(this, event, callback);
      }
    };
  });
}

async function pingPongTest() {
  if (!client || client.readyState !== ws.OPEN) {
    log('\n❌ Not connected to server. Connect first.\n', 'error');
    return;
  }

  if (!authenticated) {
    log('\n❌ Not authenticated. Authenticate first.\n', 'error');
    return;
  }

  const msg = { event: 'ping' };

  log('\n📤 Sending ping event (keep-alive test)...', 'info');
  console.log(JSON.stringify(msg, null, 2));
  console.log();

  client.send(JSON.stringify(msg));

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log('⚠ No pong response (timeout)\n', 'warning');
      resolve();
    }, 3000);

    const originalOn = client.once;
    client.once = function(event, callback) {
      if (event === 'message') {
        const wrapper = (data) => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(data);
            if (parsed.event === 'pong') {
              log('✓ Pong received!', 'success');
              log(`Timestamp: ${parsed.data.ts}\n`);
            }
          } catch (err) {
            // Ignore parse errors
          }
          callback(data);
          resolve();
        };
        originalOn.call(this, event, wrapper);
      } else {
        originalOn.call(this, event, callback);
      }
    };
  });
}

async function subscribeChannel() {
  if (!client || client.readyState !== ws.OPEN) {
    log('\n❌ Not connected to server. Connect first.\n', 'error');
    return;
  }

  if (!authenticated) {
    log('\n❌ Not authenticated. Authenticate first.\n', 'error');
    return;
  }

  const channel = await prompt('\nChannel name (default: waste-updates): ');
  const ch = channel || 'waste-updates';

  const msg = {
    event: 'subscribe',
    channel: ch,
  };

  log('\n📤 Subscribing to channel...', 'info');
  console.log(JSON.stringify(msg, null, 2));
  console.log();

  client.send(JSON.stringify(msg));

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log('⚠ No subscription confirmation (timeout)\n', 'warning');
      resolve();
    }, 3000);

    const originalOn = client.once;
    client.once = function(event, callback) {
      if (event === 'message') {
        const wrapper = (data) => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(data);
            if (parsed.event === 'subscribed') {
              log('✓ Successfully subscribed!', 'success');
              log(`Channel: ${parsed.data.channel}\n`);
            }
          } catch (err) {
            // Ignore parse errors
          }
          callback(data);
          resolve();
        };
        originalOn.call(this, event, wrapper);
      } else {
        originalOn.call(this, event, callback);
      }
    };
  });
}

async function sendCustomMessage() {
  if (!client || client.readyState !== ws.OPEN) {
    log('\n❌ Not connected to server. Connect first.\n', 'error');
    return;
  }

  const msgStr = await prompt('\nEnter message as JSON: ');

  try {
    const msg = JSON.parse(msgStr);
    log('\n📤 Sending message...', 'info');
    console.log(JSON.stringify(msg, null, 2));
    console.log();

    client.send(JSON.stringify(msg));

    // Wait for response
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log('⚠ Waiting for response...\n', 'warning');
        resolve();
      }, 2000);
    });

  } catch (err) {
    log(`\n❌ Invalid JSON: ${err.message}\n`, 'error');
  }
}

function showCommands() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Available WebSocket Commands              ║');
  console.log('╚════════════════════════════════════════════╝\n');

  console.log('Authentication:');
  console.log('  {"event":"auth","token":"YOUR_TOKEN_HERE"}');
  console.log();

  console.log('Keep-Alive:');
  console.log('  {"event":"ping"}');
  console.log();

  console.log('Subscribe:');
  console.log('  {"event":"subscribe","channel":"waste-updates"}');
  console.log();

  console.log('Test Commands:');
  console.log('  {"event":"unknown"}  <- Test error handling');
  console.log();
}

function showInfo() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Connection Information                    ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (!client) {
    log('Status: Not connected', 'warning');
  } else {
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const state = states[client.readyState];
    const statusColor = state === 'OPEN' ? 'success' : 'warning';

    log(`Status: ${state}`, statusColor);
    log(`Authenticated: ${authenticated ? 'Yes' : 'No'}`, authenticated ? 'success' : 'warning');
    log(`URL: ${client.url || 'N/A'}`);
  }
  console.log();
}

function disconnect() {
  if (client) {
    client.close();
    client = null;
    authenticated = false;
    log('\n✓ Disconnected\n', 'success');
  } else {
    log('\n⚠ Not connected\n', 'warning');
  }
}

async function main() {
  let running = true;

  while (running) {
    try {
      const choice = await menu();

      switch (choice) {
        case '1':
          await connectWebSocket();
          break;
        case '2':
          await authenticate();
          break;
        case '3':
          await pingPongTest();
          break;
        case '4':
          await subscribeChannel();
          break;
        case '5':
          await sendCustomMessage();
          break;
        case '6':
          showCommands();
          break;
        case '7':
          showInfo();
          break;
        case '8':
          disconnect();
          break;
        case '9':
          log('\nGoodbye! 👋\n', 'success');
          running = false;
          break;
        default:
          log('\n❌ Invalid choice. Please try again.\n', 'error');
      }

      if (running) {
        await prompt('Press Enter to continue...');
      }

    } catch (err) {
      log(`\n❌ Error: ${err.message}\n`, 'error');
    }
  }

  // Cleanup
  if (client && client.readyState === ws.OPEN) {
    client.close();
  }
  rl.close();
  process.exit(0);
}

// Handle process termination
process.on('SIGINT', () => {
  if (client && client.readyState === ws.OPEN) {
    client.close();
  }
  rl.close();
  process.exit(0);
});

main().catch((err) => {
  log(`Fatal error: ${err.message}`, 'error');
  process.exit(1);
});
