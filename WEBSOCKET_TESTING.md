# WebSocket Testing Guide

Panduan lengkap untuk menguji semua fitur WebSocket pada Waste Management Backend.

## Daftar Isi
1. [Setup](#setup)
2. [Testing Otomatis](#testing-otomatis)
3. [Testing Manual](#testing-manual)
4. [Fitur yang Diuji](#fitur-yang-diuji)
5. [Troubleshooting](#troubleshooting)

---

## Setup

### Prasyarat
```bash
# 1. Install dependencies
npm install

# 2. Setup database dan jalankan migration
npm run db:migrate

# 3. Pastikan server berjalan
npm run dev
```

---

## Testing Otomatis

### Menjalankan Test Suite

```bash
# Jalankan semua test WebSocket
node tests/websocket.test.js
```

**Output yang diharapkan:**
```
==================================================
🧪 WebSocket Test Suite
==================================================

🚀 Test server running on ws://localhost:3001

📋 Test 1: Basic Connection
--------------------------------------------------
✅ PASSED: WebSocket should connect

📋 Test 2: Authentication Flow
--------------------------------------------------
✅ PASSED: Non-auth message should be rejected
✅ PASSED: Auth should return correct user ID
✅ PASSED: Auth should return correct role

[... lebih banyak test ...]

==================================================
📊 Test Results
==================================================
✅ Passed: 10
❌ Failed: 0
📈 Total:  10
==================================================
```

### Test Cases yang Dijalankan

| # | Test | Deskripsi |
|---|------|-----------|
| 1 | Basic Connection | Koneksi WebSocket standar |
| 2 | Authentication Flow | Autentikasi dengan token JWT |
| 3 | Ping/Pong | Keep-alive mechanism |
| 4 | Channel Subscription | Subscribe ke channel updates |
| 5 | Unknown Event | Error handling untuk event tidak dikenal |
| 6 | Invalid JSON | Error handling untuk JSON invalid |
| 7 | Multiple Connections | Multiple socket connections simultan |
| 8 | Authentication Timeout | Timeout jika tidak auth dalam 10 detik |
| 9 | Invalid Token | Reject token invalid |
| 10 | Missing Token | Require token di auth event |

---

## Testing Manual

### Opsi 1: Menggunakan `wscat`

Install WebSocket CLI:
```bash
npm install -g wscat
```

#### Test 1: Koneksi Dasar
```bash
wscat -c ws://localhost:3001
# Output: Connected (press CTRL+C to quit)
```

#### Test 2: Autentikasi

Pertama, dapatkan token dari API login:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password"
  }'
```

Dari response, copy `token`. Kemudian di wscat:
```
# Kirim auth event
{"event":"auth","token":"YOUR_TOKEN_HERE"}

# Expected response:
{"event":"auth_success","data":{"user_id":"...","role":"USER"},"ts":"2026-02-22T..."}
```

#### Test 3: Ping/Pong
```
# Kirim ping
{"event":"ping"}

# Expected response:
{"event":"pong","data":{"ts":1708000000},"ts":"2026-02-22T..."}
```

#### Test 4: Subscribe Channel
```
# Subscribe ke channel
{"event":"subscribe","channel":"waste-updates"}

# Expected response:
{"event":"subscribed","data":{"channel":"waste-updates"},"ts":"2026-02-22T..."}
```

#### Test 5: Error - Tidak Authenticated
```
# Kirim event tanpa auth terlebih dahulu di connection baru
{"event":"ping"}

# Expected response:
{"event":"error","error":{"code":"NOT_AUTHENTICATED","message":"Send auth event first"},"ts":"2026-02-22T..."}
```

#### Test 6: Error - Token Missing
```
# Kirim auth tanpa token
{"event":"auth"}

# Expected response:
{"error":{"code":"TOKEN_MISSING","message":"Token required"}}
```

---

### Opsi 2: Menggunakan Node.js Client Script

Buat file `test-ws-manual.js`:

```javascript
const ws = require('ws');

const client = new ws('ws://localhost:3001');

client.on('open', () => {
  console.log('✓ Connected to WebSocket');

  // Test 1: Send auth
  const token = 'YOUR_TOKEN_HERE';
  client.send(JSON.stringify({
    event: 'auth',
    token: token
  }));
});

client.on('message', (data) => {
  console.log('📨 Received:', data);
  const msg = JSON.parse(data);

  if (msg.event === 'auth_success') {
    console.log('✓ Authenticated');

    // Test 2: Send ping
    setTimeout(() => {
      client.send(JSON.stringify({ event: 'ping' }));
      console.log('📤 Sent ping');
    }, 500);

    // Test 3: Subscribe
    setTimeout(() => {
      client.send(JSON.stringify({
        event: 'subscribe',
        channel: 'waste-updates'
      }));
      console.log('📤 Sent subscribe');
    }, 1000);
  }
});

client.on('error', (err) => {
  console.error('✗ Error:', err.message);
});

client.on('close', () => {
  console.log('✓ Connection closed');
});

// Keep alive
setInterval(() => {
  if (client.readyState === ws.OPEN) {
    console.log('📤 Keep-alive ping');
  }
}, 30000);
```

Jalankan:
```bash
node test-ws-manual.js
```

---

### Opsi 3: Menggunakan Browser DevTools

1. **Buka browser dan jalankan di console:**

```javascript
// Buat koneksi
const ws = new WebSocket('ws://localhost:3001');

// Event handlers
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Received:', e.data);
ws.onerror = (e) => console.error('Error:', e);
ws.onclose = () => console.log('Closed');

// Test: Send auth
ws.send(JSON.stringify({
  event: 'auth',
  token: 'YOUR_TOKEN_HERE'
}));

// Test: Ping
ws.send(JSON.stringify({ event: 'ping' }));

// Test: Subscribe
ws.send(JSON.stringify({
  event: 'subscribe',
  channel: 'waste-updates'
}));
```

---

### Opsi 4: Menggunakan Postman

1. **Buka Postman**
2. **Pilih WebSocket request**
3. **URL:** `ws://localhost:3001`
4. **Connect**
5. **Kirim message:**
   ```json
   {"event":"auth","token":"YOUR_TOKEN_HERE"}
   ```

---

## Fitur yang Diuji

### ✅ Authentication (Autentikasi)
- [x] Koneksi tanpa token → error
- [x] Auth pertama harus dilakukan sebelum event lain
- [x] Token valid → auth_success
- [x] Token invalid → auth_error
- [x] Token missing → error
- [x] Timeout jika tidak auth (10 detik)

### ✅ Keep-Alive (Ping/Pong)
- [x] Server mengirim ping setiap 30 detik
- [x] Client bisa mengirim ping event
- [x] Server merespond dengan pong
- [x] Pong include timestamp

### ✅ Subscriptions (Channel)
- [x] Subscribe ke channel specific
- [x] Receive confirmation
- [x] (Future) Receive messages dari channel

### ✅ Error Handling
- [x] Invalid JSON → error INVALID_JSON
- [x] Unknown event → error UNKNOWN_EVENT
- [x] Non-authenticated event → error NOT_AUTHENTICATED
- [x] Token revoked (blacklist) → error TOKEN_REVOKED

### ✅ Connection Management
- [x] Multiple connections dari user sama
- [x] Connection close handling
- [x] Socket error handling
- [x] Graceful reconnection

### ✅ Message Format
- [x] Setiap message punya timestamp
- [x] Format: `{event, data/error, ts}`
- [x] RFC 6455 WebSocket protocol compliance

---

## Integration dengan Business Logic

### Notifikasi Waste Submission

Ketika waste submission diverifikasi, sistem kirim notifikasi via WebSocket:

```javascript
// Di waste.controller.js saat verify()
const { sendToUser } = require('../websocket/server');

sendToUser(userId, 'submission_verified', {
  submissionId: id,
  status: 'APPROVED',
  pointsEarned: points
});
```

**Client menerima:**
```json
{
  "event": "submission_verified",
  "data": {
    "submissionId": "uuid",
    "status": "APPROVED",
    "pointsEarned": 100
  },
  "ts": "2026-02-22T..."
}
```

### Broadcast ke Verifiers

Ketika waste submission baru datang:

```javascript
// Di waste.controller.js saat submit()
const { broadcastToRole } = require('../websocket/server');

broadcastToRole('VERIFIER', 'new_submission', {
  submissionId: id,
  userId: userId,
  wasteType: type,
  weight: weight_kg
});
```

---

## Performance Testing

### Test Load dengan Multiple Connections

```bash
# Menggunakan autocannon atau artillery
npm install -g autocannon

# Test WebSocket dengan 10 concurrent connections
# (Perlu custom setup untuk WebSocket)
```

---

## Monitoring di Production

### Log Messages

Server akan log:
```
[DB] Connection pool initialised
[WS] WS new connection {ip: 192.168.1.1}
[WS] WS authenticated {userId: uuid, role: USER}
[WS] WS connection closed {userId: uuid, reason: Client closed}
```

### Metrics untuk Monitor

- Total active connections
- Connections per user
- Message throughput (msg/sec)
- Auth failure rate
- Average message latency

---

## Troubleshooting

### ❌ Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:3001
```

**Solusi:**
- Pastikan server sudah jalan: `npm run dev`
- Check port 3001 tidak di-block: `lsof -i :3001`
- Verify WebSocket server terikat: `netstat -an | grep 3001`

### ❌ Auth Failed: Token Revoked

```
{"event":"auth_error","error":{"code":"TOKEN_REVOKED"}}
```

**Solusi:**
- Token mungkin sudah ter-logout
- Dapatkan token baru dari `/api/auth/login`
- Check database `token_blacklist` table

### ❌ Auth Timeout

Connection closed otomatis setelah 10 detik tanpa auth.

**Solusi:**
- Pastikan kirim `auth` event dalam 10 detik
- Format message: `{"event":"auth","token":"..."}`

### ❌ Connection Drops Frequently

**Solusi:**
- Check network stability
- Verify server resources (CPU, memory)
- Monitor WebSocket frame size
- Enable keep-alive pings (setiap 30 detik)

### ❌ Multiple Connections Issue

Jika satu user buka multiple tabs:
- Server mendukung multiple concurrent connections
- Notifikasi dikirim ke SEMUA connections user tersebut
- Jika satu connection mati, yang lain tetap aktif

---

## Quick Reference

### Semua Event Types

**Client ke Server:**
- `auth` - Authenticate dengan token
- `ping` - Ping server (keep-alive)
- `subscribe` - Subscribe ke channel

**Server ke Client:**
- `auth_success` - Auth berhasil
- `auth_error` - Auth gagal
- `pong` - Pong response
- `subscribed` - Subscribe confirmed
- `error` - Error response
- `submission_verified` - Waste submission verified
- `submission_rejected` - Waste submission rejected
- `reward_available` - Reward tersedia
- `notification` - General notification

---

## Catatan Teknis

- **Protocol:** RFC 6455 (Native WebSocket)
- **Port:** 3001 (configurable via WS_PORT env var)
- **Ping Interval:** 30 detik
- **Auth Timeout:** 10 detik
- **Max Frame Size:** 64 MB (default)
- **Concurrent Connections:** Unlimited (tergantung resources)

---
