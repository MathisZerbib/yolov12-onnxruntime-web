# 05 — Backend API Reference

The Cloudflare Worker (`crossflow-auth`) exposes a REST API on port 8787 (local) or the deployed Worker URL (production). All integration is HTTP — there are no WebSocket endpoints.

---

## Base URL

| Environment | URL |
|-------------|-----|
| Local | `http://localhost:8787` |
| Production | `https://crossflow-auth.<account>.workers.dev` |

Frontend reads this from `VITE_AUTH_API_URL` (exported as `AUTH_API_URL` in `src/lib/wagmi.ts`).

---

## CORS & Origin

- Worker checks `Origin` header against `APP_ORIGIN` config var
- Credentials (cookies) are included in cross-origin requests (`credentials: 'include'`)
- Local default: `APP_ORIGIN=http://localhost:5173`

---

## Authentication Endpoints

### POST `/auth/nonce`

Request a SIWE challenge nonce.

**Auth:** Origin check only

**Request:**
```json
{ "address": "0x..." }
```

**Response:**
```json
{
  "nonce": "random-string",
  "message": "crossflow.app wants you to sign in with your Ethereum account:\n0x...\n\n..."
}
```

**Rate limit:** 30 requests/minute per IP

---

### POST `/auth/verify`

Verify SIWE signature and create session.

**Auth:** Origin check only

**Request:**
```json
{
  "message": "crossflow.app wants you to sign in...",
  "signature": "0x..."
}
```

**Response:** Sets `Set-Cookie: session=<token>` (HttpOnly, 7-day TTL)

```json
{ "address": "0x...", "authenticated": true }
```

**Validation:**
- Chain ID must be 421614 (Arbitrum Sepolia)
- Nonce must exist and not be expired (5 min TTL)
- Signature verified via viem `verifyMessage`

---

### GET `/auth/session`

Check current session status.

**Auth:** Session cookie

**Response:**
```json
{ "address": "0x...", "authenticated": true }
```

Or `{ "authenticated": false }` if no valid session.

---

### POST `/auth/logout`

Clear session cookie.

**Auth:** Session cookie

**Response:** `{ "authenticated": false }`

---

## User Endpoints

### GET `/profile`

Authenticated user profile with proof statistics.

**Auth:** Session cookie required

**Response:**
```json
{
  "address": "0x...",
  "manifestCount": 5,
  "totalVehiclesCounted": 142,
  "recentManifests": [
    {
      "id": "...",
      "roomId": "tokyo",
      "finalCount": 23,
      "createdAt": 1700000000,
      "modelSha256": "a708b431...",
      "executionProvider": "webgpu"
    }
  ]
}
```

---

### GET `/leaderboard`

Public operator leaderboard.

**Auth:** None

**Response:**
```json
{
  "operators": [
    {
      "address": "0x...",
      "manifestCount": 12,
      "totalVehiclesCounted": 340
    }
  ]
}
```

---

### GET `/activity`

Recent inference manifests (public).

**Auth:** None

**Response:**
```json
{
  "manifests": [
    {
      "id": "...",
      "operatorAddress": "0x...",
      "roomId": "tokyo",
      "finalCount": 23,
      "createdAt": 1700000000,
      "executionProvider": "webgpu",
      "durationMs": 45000
    }
  ]
}
```

---

## Room Endpoints

### GET `/rooms/:roomId/market`

Current market state for a room. Primary endpoint polled by `useRoomMarket`.

**Auth:** None

**Response:**
```json
{
  "roomId": "tokyo",
  "roomKey": "0x...",
  "enabled": true,
  "serverTime": 1700000000,
  "phase": "open",
  "marketId": "1",
  "closeTime": 1700000300,
  "resolveDeadline": 1700000900,
  "lowerBound": 10,
  "upperBound": 30,
  "exactTarget": 20,
  "feeBps": 200,
  "totalPoolWei": "10000000000000000",
  "outcomePoolsWei": ["0", "5000000000000000", "5000000000000000", "0"],
  "nextRoundExpectedAt": null,
  "staleAfter": 1700000308
}
```

**Phase values:** `open` | `awaiting_result` | `proposed` | `challenged` | `resolved` | `cancelled` | `unavailable`

**Polling:** Frontend polls every 5 seconds via `useRoomMarket` hook.

---

### GET `/rooms/:roomId/zone`

Get detection zone configuration for a room.

**Auth:** None

**Response:**
```json
{
  "roomId": "tokyo",
  "roomKey": "0x...",
  "topLeftXBps": 1000,
  "topLeftYBps": 2500,
  "topRightXBps": 9000,
  "topRightYBps": 2500,
  "bottomRightXBps": 9500,
  "bottomRightYBps": 9500,
  "bottomLeftXBps": 500,
  "bottomLeftYBps": 9500,
  "version": 1,
  "configHash": "0x...",
  "updatedAt": 1700000000,
  "updatedBy": "0x..."
}
```

---

### PUT `/rooms/:roomId/zone`

Save detection zone configuration (admin only).

**Auth:** Session cookie + platform admin wallet

**Request:**
```json
{
  "topLeftXBps": 1000,
  "topLeftYBps": 2500,
  "topRightXBps": 9000,
  "topRightYBps": 2500,
  "bottomRightXBps": 9500,
  "bottomRightYBps": 9500,
  "bottomLeftXBps": 500,
  "bottomLeftYBps": 9500
}
```

**Response:** Updated zone object (same shape as GET)

**Validation:**
- All values 0–10000 (basis points)
- Caller must be platform admin (`0x2a1F44Ce...`)
- Increments `version` on each save

---

### POST `/rooms/:roomId/lease`

Acquire operator lease for inference.

**Auth:** Session cookie required

**Response:**
```json
{
  "leaseToken": "uuid-token",
  "expiresAt": 1700000120,
  "roomId": "tokyo"
}
```

**Rules:**
- 120-second exclusive lease
- Rejects if another operator holds active lease
- Managed by `RoomCoordinator` Durable Object

---

### DELETE `/rooms/:roomId/lease`

Release operator lease early.

**Auth:** Session cookie + valid lease token

**Response:** `{ "released": true }`

---

### GET `/rooms/:roomId/lease`

Check current lease status.

**Auth:** Session cookie

**Response:**
```json
{
  "active": true,
  "leaseToken": "uuid-token",
  "expiresAt": 1700000120,
  "operatorAddress": "0x..."
}
```

---

## Inference Endpoints

### POST `/inference/manifests`

Submit inference proof manifest.

**Auth:** Session cookie + valid lease token

**Request:**
```json
{
  "roomId": "tokyo",
  "leaseToken": "uuid-token",
  "windowStart": 1700000000,
  "windowEnd": 1700000060,
  "finalCount": 23,
  "model": {
    "name": "yolov12n",
    "sha256": "a708b431b48e98647c5d469699b57809a0048de1d81bfe77e1b809c070b11be0",
    "inputWidth": 640,
    "inputHeight": 640
  },
  "executionProvider": "webgpu",
  "zoneVersion": 1,
  "zoneConfigHash": "0x...",
  "timing": {
    "preprocessMs": 5,
    "inferenceMs": 45,
    "postprocessMs": 3,
    "totalMs": 53
  }
}
```

**Response:**
```json
{
  "id": "manifest-uuid",
  "accepted": true,
  "finalCount": 23
}
```

**Validation rules:**
- `model.sha256` must match `APPROVED_MODEL_SHA256`
- `executionProvider` must be `webgpu` or `wasm`
- `leaseToken` must be valid and not expired
- `zoneConfigHash` must match current D1 zone (atomic check)
- Window duration ≤ 120 seconds
- Submission within 60 seconds of `windowEnd`

---

## Cron / Scheduled

### GET `/cdn-cgi/handler/scheduled`

Triggers the market scheduler (local dev simulation of cron).

**Auth:** None (local only)

Also triggered automatically every minute in production via the `wrangler.jsonc` Cron Trigger: `* * * * *`.

---

## D1 Database Schema

Migrations in `worker/migrations/`:

### `0001_auth.sql`
- `nonces` — SIWE nonces (address, nonce, expires_at)
- `sessions` — Auth sessions (token, address, expires_at)

### `0002_security.sql`
- `rate_limits` — IP-based rate limiting

### `0003_room_zones.sql`
- `room_zones` — Zone configuration per room

### `0004_trapezoid_zones.sql`
- Adds trapezoid geometry columns (8 basis-point coordinates)
- `inference_manifests` — Submitted proof manifests

---

## Durable Objects

### RoomCoordinator

- **Binding:** `ROOMS`
- **Class:** `worker/room-coordinator.ts`
- **Key:** Room ID (e.g., `tokyo`)
- **State:** SQLite (per-object)
- **Purpose:** Exclusive operator lease management

### MarketScheduler

- **Binding:** `MARKET_SCHEDULER`
- **Class:** `worker/market-rounds.ts`
- **Key:** MARKET_ROLE EOA address
- **State:** SQLite (per-object)
- **Purpose:** Serialized `createMarket` transaction automation

---

## Error Responses

All errors return JSON:

```json
{ "error": "Human-readable error message" }
```

Common HTTP status codes:

| Code | Meaning |
|------|---------|
| 400 | Invalid request body or parameters |
| 401 | Missing or invalid session |
| 403 | Insufficient permissions (not admin) |
| 404 | Room or resource not found |
| 409 | Lease conflict (another operator active) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Local Development Tips

```bash
# Start worker only
npm run dev:api

# Start the full local stack, including automatic scheduled-event simulation
npm run dev

# Apply D1 migrations
npm run db:migrate:local

# Typecheck worker
npm run worker:typecheck

# Regenerate env types
npm run worker:types
```
