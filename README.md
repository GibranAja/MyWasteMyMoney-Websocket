# Waste Management Platform — Backend

A production-grade waste disposal & recycling reward platform backend built with **pure Node.js + MySQL**.  
No Zod, Joi, Winston, Passport, Socket.IO, or similar frameworks. Everything is implemented manually.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Folder Structure](#folder-structure)
3. [Database Schema](#database-schema)
4. [Security Design](#security-design)
5. [WebSocket Protocol](#websocket-protocol)
6. [REST API Reference](#rest-api-reference)
7. [Setup & Running](#setup--running)
8. [Data Flow Examples](#data-flow-examples)

---

## Architecture Overview

### Layer Responsibilities

```
HTTP Request
    │
    ▼
[server.js]          ← Creates HTTP server, attaches WS, runs global middleware
    │
    ▼
[middlewares/]       ← requestId → securityHeaders → bodyParser → rateLimit
    │
    ▼
[router.js]          ← Manual regex-based routing, injects route-level middleware
    │
    ▼
[controllers/]       ← Parse validated input, call service, format response
    │
    ▼
[services/]          ← Business logic, orchestrates repos, sends events
    │
    ▼
[repositories/]      ← Parameterised SQL queries, DB access only
    │
    ▼
[MySQL Database]
```

**Why each layer?**
- **Controllers**: Thin adapters between HTTP world and pure business logic. No SQL here.
- **Services**: Own the "what happens" — transactions, event emission, audit logging. Framework-agnostic.
- **Repositories**: Centralise all DB access. Easy to swap storage layer. All queries use parameterised statements.
- **Middlewares**: Cross-cutting concerns (auth, rate limiting, security headers) applied once.
- **Validators**: Schema-based validation without external libs — returns cleaned data or throws `ValidationError`.
- **WebSocket**: Isolated server that shares WS events with services via exported functions.
- **Utils**: Pure functions (token signing, password hashing, logging, error classes).

---

## Folder Structure

```
waste-management/
├── package.json
├── .env.example
├── sql/
│   └── schema.sql                   ← Full DB schema + seed data
└── src/
    ├── server.js                    ← Entry point
    ├── router.js                    ← URL routing
    ├── config/
    │   ├── index.js                 ← Env config loader
    │   └── database.js              ← MySQL pool + query helpers
    ├── controllers/
    │   ├── auth.controller.js
    │   ├── waste.controller.js
    │   ├── reward.controller.js
    │   └── notification.controller.js
    ├── services/
    │   ├── auth.service.js
    │   ├── waste.service.js
    │   ├── reward.service.js
    │   └── notification.service.js
    ├── repositories/
    │   ├── user.repository.js
    │   ├── waste.repository.js
    │   ├── reward.repository.js
    │   ├── notification.repository.js
    │   └── auditLog.repository.js
    ├── middlewares/
    │   └── index.js                 ← auth, RBAC, rate limit, body parse, headers
    ├── validators/
    │   ├── schema.js                ← Validation primitives (field builders)
    │   └── index.js                 ← Feature-specific validators
    ├── websocket/
    │   └── server.js                ← RFC 6455 WebSocket implementation
    └── utils/
        ├── token.js                 ← HMAC-signed tokens
        ├── password.js              ← PBKDF2 hashing
        ├── errors.js                ← Structured error classes
        ├── logger.js                ← JSON structured logger
        └── migrate.js               ← DB migration runner
```

---

## Database Schema

### Tables & Relationships

```
users (id PK)
  ↑ FK
waste_submissions (user_id) ─── waste_types (id FK)
  ↑ FK
submission_verifications (submission_id, verifier_id → users.id)

users (id PK)
  ↑ FK
reward_redemptions (user_id, reward_id → rewards.id)

users (id PK)
  ↑ FK
notifications (user_id)

audit_logs (actor_id → users.id, nullable)
token_blacklist (jti)
rate_limit_store (key_hash)
```

### Indexing Strategy

| Table | Index | Reason |
|-------|-------|--------|
| `users` | `email` UNIQUE | Login lookup |
| `users` | `role` | Filter by role |
| `waste_submissions` | `user_id` | User's submissions |
| `waste_submissions` | `status` | Pending queue |
| `token_blacklist` | `expires_at` | Cleanup expired tokens |
| `notifications` | `user_id, is_read` | Unread count queries |
| `audit_logs` | `actor_id, action_type, created_at` | Reporting |

---

## Security Design

### Token System (Manual JWT-equivalent)

**Format:** `base64url(header).base64url(payload).HMAC-SHA256`

**Payload fields:**
```json
{
  "jti": "uuid",          ← unique token ID (for blacklisting)
  "user_id": "uuid",
  "role": "USER",
  "iat": 1700000000,      ← issued at (unix)
  "exp": 1700086400       ← expires at (unix)
}
```

**Replay attack prevention:** `jti` is stored in `token_blacklist` on logout. Every request checks the blacklist.

**Timing-safe comparison:** Uses `crypto.timingSafeEqual()` for both token verification and password comparison.

### Password Hashing

- Algorithm: **PBKDF2-SHA512**
- Iterations: **100,000**
- Key length: **64 bytes**
- Salt: **32 random bytes** per user (stored in DB)

### Rate Limiting

DB-backed per IP + endpoint, sliding window. Fails **open** (never blocks on DB error).

### SQL Injection Prevention

All queries use **parameterised statements** via `mysql2`'s `execute()`. No string concatenation in SQL.

### Input Validation

Custom schema validator (`validators/schema.js`) that:
- Validates type, length, format
- Strips unknown fields (prevents mass assignment)
- Throws structured `ValidationError` with per-field messages

### XSS Safety

- All responses are `application/json` with `X-Content-Type-Options: nosniff`
- No user input is reflected as HTML
- Output is always `JSON.stringify()` — no template injection possible

### Request Body Limit

Default **1 MB** — configurable via `MAX_BODY_SIZE` env var.

---

## WebSocket Protocol

### Connection Flow

```
Client                          Server
  │                               │
  │─── HTTP Upgrade ──────────────▶
  │◀── 101 Switching Protocols ───│
  │                               │
  │─── { event: "auth",           │
  │      token: "..." } ──────────▶  ← Must be first message
  │                               │    Verified within 10 seconds
  │◀── { event: "auth_success",   │
  │      data: { user_id, role }} │
  │                               │
  │    (now subscribed)           │
  │                               │
  │◀── { event: "points_updated", │
  │      data: {...},             │    ← Server pushes events
  │      ts: "ISO8601" }          │
```

### Auth Failure

```json
{ "event": "auth_error", "error": { "code": "TOKEN_EXPIRED", "message": "Token expired" } }
```
Connection is closed with code **1008** on auth failure.

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `auth` | `{ token: string }` | Must be first message |
| `ping` | `{}` | Keepalive |
| `subscribe` | `{ channel: string }` | Subscribe to channels (future) |

### Server → Client Events

| Event | Triggered by | Payload |
|-------|-------------|---------|
| `auth_success` | Successful auth | `{ user_id, role }` |
| `points_updated` | Submission approved or reward redeemed | `{ submission_id?, points_earned?, change?, reward_name? }` |
| `submission_status_changed` | Submission verified | `{ submission_id, status, notes?, points_earned? }` |
| `reward_redeemed` | Successful redemption | `{ redemption_id, reward_id, reward_name, points_used }` |
| `new_submission_for_admin` | New waste submission | `{ submission_id, user_id, waste_type, weight_kg, location, submitted_at }` |
| `notification` | Any of the above | `{ notification: { id, type, message, created_at } }` |
| `pong` | Client ping | `{ ts: unix_ms }` |

---

## REST API Reference

### Base URL: `http://localhost:3000`

All protected endpoints require: `Authorization: Bearer <token>`

All error responses follow:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "metadata": {}
  }
}
```

---

### Authentication

#### POST /api/auth/register
Register a new user.

**Request:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "SecurePass1"
}
```

**Validation rules:**
- `name`: string, 2–100 chars
- `email`: valid email, max 254 chars
- `password`: string, 8–128 chars, must contain letter + digit

**Response 201:**
```json
{
  "message": "Registration successful",
  "user": {
    "id": "uuid",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "USER",
    "points_balance": 0
  }
}
```

**Errors:** `422 VALIDATION_ERROR`, `409 CONFLICT`

---

#### POST /api/auth/login

**Request:**
```json
{ "email": "jane@example.com", "password": "SecurePass1" }
```

**Response 200:**
```json
{
  "message": "Login successful",
  "token": "eyJ...",
  "user": { "id": "uuid", "name": "Jane Doe", "email": "jane@example.com", "role": "USER", "points_balance": 150 }
}
```

**Errors:** `401 AUTH_ERROR`

---

#### POST /api/auth/logout
🔒 Requires auth.

**Response 200:**
```json
{ "message": "Logged out successfully" }
```

---

#### GET /api/auth/profile
🔒 Requires auth.

**Response 200:**
```json
{
  "user": { "id": "uuid", "name": "Jane", "email": "jane@example.com", "role": "USER", "points_balance": 300, "created_at": "..." }
}
```

---

### Waste Submissions

#### POST /api/submissions
🔒 Role: USER

**Request:**
```json
{
  "waste_type_id": 1,
  "weight_kg": 5.5,
  "location": "Jl. Sudirman No. 1, Jakarta",
  "photo_ref": "uploads/abc123.jpg"
}
```

**Validation:** waste_type_id (int ≥ 1), weight_kg (0.001–100000), location (3–500 chars), photo_ref (optional)

**Response 201:**
```json
{
  "message": "Submission created",
  "submission": {
    "id": "uuid",
    "user_id": "uuid",
    "waste_type_id": 1,
    "waste_type_name": "Plastic",
    "weight_kg": 5.5,
    "location": "Jl. Sudirman...",
    "status": "PENDING",
    "submitted_at": "2025-01-01T00:00:00Z"
  }
}
```

---

#### GET /api/submissions
🔒 Requires auth. Returns authenticated user's submissions.

**Query params:** `page`, `limit`, `status` (PENDING|APPROVED|REJECTED)

---

#### GET /api/submissions/pending
🔒 Role: VERIFIER, ADMIN

Returns all PENDING submissions (queue for verifiers).

---

#### GET /api/submissions/:id
🔒 Requires auth. USER can only view own submissions.

---

#### POST /api/submissions/:id/verify
🔒 Role: VERIFIER, ADMIN

**Request:**
```json
{ "action": "APPROVED", "notes": "Weight and type verified." }
```

**Response 200:**
```json
{
  "message": "Submission verified",
  "result": {
    "submission_id": "uuid",
    "status": "APPROVED",
    "points_earned": 55
  }
}
```

**Side effects:** User points incremented, WebSocket events fired, notification created.

---

### Rewards

#### GET /api/rewards
Public endpoint. Lists available rewards.

**Query:** `status` (ACTIVE|INACTIVE), `page`, `limit`

**Response 200:**
```json
{
  "rewards": [
    {
      "id": "uuid",
      "name": "Grab Voucher 50k",
      "description": "...",
      "required_points": 500,
      "stock": 10,
      "status": "ACTIVE"
    }
  ]
}
```

---

#### POST /api/rewards
🔒 Role: ADMIN

**Request:**
```json
{
  "name": "Grab Voucher 50k",
  "description": "Grab e-money voucher worth Rp 50.000",
  "required_points": 500,
  "stock": 100
}
```

---

#### PUT /api/rewards/:id
🔒 Role: ADMIN

All fields optional in body. Partial update supported.

---

#### POST /api/rewards/:id/redeem
🔒 Role: USER

No request body needed. Uses authenticated user's identity.

**Response 200:**
```json
{
  "message": "Reward redeemed successfully",
  "result": {
    "redemption_id": "uuid",
    "reward_id": "uuid",
    "points_used": 500
  }
}
```

**Errors:** `400 INSUFFICIENT_POINTS`, `400 OUT_OF_STOCK`, `404 NOT_FOUND`

Entire operation runs inside a **MySQL transaction** with row-level locks.

---

#### GET /api/rewards/my-redemptions
🔒 Requires auth.

---

### Notifications

#### GET /api/notifications
🔒 Requires auth.

**Query:** `page`, `limit`, `unread=true`

**Response 200:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "type": "POINTS_EARNED",
      "message": "Your submission was approved! You earned 55 points.",
      "is_read": 0,
      "created_at": "..."
    }
  ]
}
```

---

#### PUT /api/notifications/:id/read
🔒 Requires auth. Marks single notification as read.

---

#### PUT /api/notifications/read-all
🔒 Requires auth. Marks all user notifications as read.

---

### Health Check

#### GET /health
No auth required.

```json
{ "status": "ok", "ts": "2025-01-01T00:00:00.000Z" }
```

---

## Setup & Running

### Prerequisites

- Node.js >= 18
- MySQL >= 8.0
- npm

### Install

```bash
cd waste-management
cp .env.example .env
# Edit .env with your DB credentials and a strong TOKEN_SECRET
npm install
```

### Initialize Database

```bash
mysql -u root -p -e "CREATE DATABASE waste_management CHARACTER SET utf8mb4;"
npm run db:migrate
```

### Start Server

```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

The HTTP and WebSocket server run on the **same port** (default: 3000).

- HTTP API: `http://localhost:3000/api/...`
- WebSocket: `ws://localhost:3000`

---

## Data Flow Examples

### User Submits Waste → Verifier Approves → User Gets Points

```
1. USER  POST /api/submissions         → DB: waste_submissions (PENDING)
                                       → WS: broadcast VERIFIER 'new_submission_for_admin'

2. VERIFIER POST /api/submissions/:id/verify { action: "APPROVED" }
           → DB transaction:
              UPDATE waste_submissions SET status = 'APPROVED', points_earned = 55
              UPDATE users SET points_balance = points_balance + 55
              INSERT submission_verifications
           → INSERT audit_log
           → INSERT notifications
           → WS: sendToUser(userId, 'points_updated', { points_earned: 55 })
           → WS: sendToUser(userId, 'submission_status_changed', { status: 'APPROVED' })

3. USER  GET /api/notifications         → sees "You earned 55 points"
```

### User Redeems Reward (Race-Condition Safe)

```
1. USER  POST /api/rewards/:id/redeem
   
   BEGIN TRANSACTION
     SELECT * FROM rewards WHERE id = ? FOR UPDATE     ← locks reward row
     SELECT * FROM users WHERE id = ? FOR UPDATE       ← locks user row
     check stock > 0 and balance >= required_points
     UPDATE rewards SET stock = stock - 1
     UPDATE users SET points_balance = points_balance - 500
     INSERT reward_redemptions
   COMMIT
   
   → INSERT audit_log
   → INSERT notification
   → WS: 'reward_redeemed' + 'points_updated'

   If two requests hit simultaneously:
   → Second transaction waits for row lock
   → If stock = 0 after first commits, second throws OutOfStockError
```

### WebSocket Client (JavaScript example)

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  ws.send(JSON.stringify({ event: 'auth', token: 'YOUR_JWT_TOKEN' }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  switch (msg.event) {
    case 'auth_success':
      console.log('Connected as', msg.data.role);
      break;
    case 'points_updated':
      console.log('Points updated!', msg.data);
      break;
    case 'submission_status_changed':
      console.log('Submission status changed:', msg.data.status);
      break;
    case 'reward_redeemed':
      console.log('Reward redeemed:', msg.data.reward_name);
      break;
    case 'notification':
      console.log('New notification:', msg.data.notification.message);
      break;
  }
};
```

---

## Error Codes Reference

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 422 | Input validation failed (includes `metadata.fields`) |
| `AUTH_ERROR` | 401 | Invalid credentials or missing token |
| `TOKEN_EXPIRED` | 401 | Token has expired |
| `TOKEN_INVALID` | 401 | Token signature mismatch or malformed |
| `TOKEN_REVOKED` | 401 | Token was logged out |
| `FORBIDDEN` | 403 | Insufficient role permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate resource (e.g., email) |
| `INSUFFICIENT_POINTS` | 400 | User doesn't have enough points |
| `OUT_OF_STOCK` | 400 | Reward stock is 0 |
| `REWARD_INACTIVE` | 400 | Reward is disabled |
| `ALREADY_PROCESSED` | 400 | Submission already verified |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeds size limit |
| `INVALID_JSON` | 400 | Request body is not valid JSON |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
