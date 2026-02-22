# WebSocket Testing - Quick Start Guide

## 🚀 Cara Cepat Mulai Test WebSocket

### 1️⃣ Testing Otomatis (Recommended)

Cara paling mudah dan cepat untuk test semua fitur secara otomatis:

```bash
# Terminal 1: Jalankan database migration (sekali saja)
npm run db:migrate

# Terminal 2: Jalankan server
npm run dev

# Terminal 3: Jalankan test suite
npm run test:websocket
```

**Output yang perlu terlihat: ✅ Passed (10+)**

---

### 2️⃣ Testing Manual Interaktif

Jika ingin test secara manual dengan interface interaktif:

```bash
# Terminal 1: Jalankan server terlebih dahulu
npm run dev

# Terminal 2: Jalankan interactive test helper
npm test:ws-interactive
```

**Menu yang akan muncul:**
```
1. Connect to WebSocket Server
2. Send Auth (Authenticate)
3. Send Ping/Pong Test
4. Subscribe to Channel
5. Send Custom Message
6. List Available Commands
7. Show Connection Info
8. Exit
```

---

### 3️⃣ Testing dengan CLI Tools

#### Menggunakan `wscat`

```bash
# Install (jika belum)
npm install -g wscat

# Connect ke server
wscat -c ws://localhost:3001

# Di wscat, kirim message:
{"event":"auth","token":"YOUR_TOKEN"}
```

#### Menggunakan curl + jq (untuk terminal Windows/Mac)

```bash
# 1. Dapatkan token dari login API
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"password"}'

# Copy token dari response

# 2. Pakai ws-helper untuk test
npm run test:ws-interactive
```

---

## 📋 Fitur-Fitur yang Ditest

Semua test mencakup:

| Fitur | Status | Deskripsi |
|-------|--------|-----------|
| Connection | ✅ | Koneksi WebSocket standar |
| Authentication | ✅ | Auth dengan JWT token |
| Keep-Alive | ✅ | Ping/Pong mechanism |
| Subscription | ✅ | Subscribe ke channels |
| Error Handling | ✅ | Invalid JSON, unknown events, dll |
| Multiple Connections | ✅ | Multiple socket simultan |
| Auth Timeout | ✅ | Timeout jika tidak auth |
| Token Validation | ✅ | Invalid/missing token |

---

## 🔍 Troubleshooting

### ❌ "Cannot find module 'ws'"

```bash
npm install
```

### ❌ "ECONNREFUSED" saat test

Pastikan server running:
```bash
npm run dev
```

### ❌ "Auth failed: Token revoked"

Database sudah ada token yang ter-logout. Jalankan:
```bash
npm run db:migrate  # Refresh database
```

### ❌ Test timeout

Server mungkin tidak respond. Check:
1. Server running? → `npm run dev`
2. Port terbuka? → `lsof -i :3001` (Mac/Linux)

---

## 📊 Expected Test Results

```
==================================================
🧪 WebSocket Test Suite
==================================================

✅ Passed: 10
❌ Failed: 0
📈 Total:  10
==================================================
```

**Jika ada failures:**
1. Check server logs
2. Verify database is migrated
3. Jika masih error, jalankan: `npm run db:migrate --force`

---

## 🎯 Next Steps

Setelah semua test passed:

1. **Integrate dengan aplikasi frontend**
   - Client terhubung ke `ws://localhost:3001`
   - Send auth event dengan JWT token
   - Subscribe ke channels yang diinginkan

2. **Monitor production**
   - Setup logging untuk WebSocket connections
   - Monitor memory usage untuk concurrent connections
   - Setup alerting jika connection drops

3. **Load testing** (optional)
   - Test dengan multiple concurrent connections
   - Measure memory/CPU usage
   - Optimize jika perlu

---

## 📚 Full Documentation

Lihat [WEBSOCKET_TESTING.md](./WEBSOCKET_TESTING.md) untuk dokumentasi lengkap.

---

**Pertanyaan?** Cek logs dengan:
```bash
# Tail server logs
npm run dev 2>&1 | grep -i "ws\|websocket"
```
