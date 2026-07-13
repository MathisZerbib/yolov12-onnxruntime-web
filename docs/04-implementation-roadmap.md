# 04 — Implementation Roadmap

This document provides a phased plan to take Crossflow from its current state to a fully functional prediction market. Each phase builds on the previous one.

---

## Current Implementation Status

### Complete (Production-Ready for Testnet)

| Area | Status | Key Files |
|------|--------|-----------|
| Wallet connection (WalletConnect + injected) | Done | `src/lib/wagmi.ts` |
| SIWE authentication + sessions | Done | `worker/index.ts` |
| HLS live streaming in room view | Done | `src/pages/RoomPage.tsx` |
| YOLOv12 ONNX inference (WebGPU/WASM) | Done | `src/lib/object-detector.ts` |
| Trapezoid zone admin (D1 + on-chain) | Done | `src/pages/AdminZonesPage.tsx` |
| Vehicle counting (enter/leave ROI) | Done | `src/lib/traffic-counter.ts` |
| Inference manifest submission + validation | Done | `worker/index.ts` |
| Room operator lease coordination | Done | `worker/room-coordinator.ts` |
| On-chain betting (`bet`) | Done | `src/components/place-position-button.tsx` |
| Market state polling + UI | Done | `src/lib/room-market.ts` |
| Automated market creation (Worker DO + cron) | Done | `worker/market-rounds.ts` |
| Contract deployment admin flow | Done | `src/components/admin/contract-deployment-panel.tsx` |
| Contract Solidity test suite | Done | `contracts/TrafficPredictionMarket.t.sol` |
| Profile / Activity / Leaderboard | Done | `src/pages/ProfilePage.tsx`, etc. |
| Admin pause / role rotation | Done | `src/components/admin/smart-contract-control-panel.tsx` |

### Incomplete (Blocking Full Game Loop)

| Area | Status | Impact |
|------|--------|--------|
| Oracle `proposeResult` automation | Not started | Rounds never resolve |
| Claim winnings UI | Not started | Winners cannot collect payouts |
| Challenge submission UI | Not started | No dispute mechanism for users |
| On-chain settlement pipeline | Partial | Betting works; resolution is manual |
| Contract address consistency | Needs reconciliation | Config drift across files |
| Production Worker deployment | Not in CI | Manual deploy only |
| Stream source attestation | Not started | Trust boundary documented but unenforced |
| NYC/London stream URLs | Incorrect feeds | Mislabeled Caltrans streams |

### Legacy / Cleanup

| Area | Status | Notes |
|------|--------|-------|
| POC components (camera-stream, video-upload) | Orphaned | Not in routes; safe to remove |
| WebSocket / real-time push | Not planned | HTTP polling is intentional |
| MJPEG streaming | Not applicable | Uses HLS |

---

## Phase 1: Local Development Baseline

**Goal:** Any developer can run the full stack and place a bet on testnet.

### Tasks

- [ ] **1.1** Clone repo, `npm install`, create `.env.development.local`
- [ ] **1.2** Create `.dev.vars` with `MARKET_OPERATOR_PRIVATE_KEY`
- [ ] **1.3** Run `npm run db:migrate:local`
- [ ] **1.4** Run `npm run dev` — verify frontend (:5173) and worker (:8787) start
- [ ] **1.5** Connect wallet on Arbitrum Sepolia, complete SIWE auth
- [ ] **1.6** Deploy contract via `/admin/contracts` (or use existing deployment)
- [ ] **1.7** Reconcile contract address across all config files
- [ ] **1.8** Configure zones in `/admin/zones` and publish on-chain for `tokyo`
- [ ] **1.9** Set `AUTO_MARKET_ROOMS=tokyo` in `wrangler.jsonc` (start with one room)
- [ ] **1.10** Trigger scheduler: `curl http://localhost:8787/cdn-cgi/handler/scheduled`
- [ ] **1.11** Navigate to `/room/tokyo` — verify market shows `open` phase
- [ ] **1.12** Place a test bet (0.001 ETH minimum)
- [ ] **1.13** Run operator detection flow: acquire lease → start detection → stop → submit manifest
- [ ] **1.14** Run `npm run check` — all gates pass

### Verification Checklist

```
[ ] Wallet connects on Arbitrum Sepolia
[ ] SIWE session established (check /profile)
[ ] Market phase shows "open" on /room/tokyo
[ ] Bet transaction confirms on Arbiscan
[ ] Detection runs with WebGPU or WASM
[ ] Inference manifest appears on /activity
[ ] npm run check passes
```

### Estimated Effort: 2–4 hours (first time)

---

## Phase 2: Oracle Result Proposal

**Goal:** After betting closes, an oracle submits the vehicle count and the market moves to `proposed` phase.

### Design Decision Required

Choose one approach:

| Option | Pros | Cons |
|--------|------|------|
| **A. Manual oracle UI** | Simple, testnet-appropriate | Requires human operator |
| **B. Manifest → oracle automation** | Semi-automated | Browser manifests are not trustless |
| **C. Independent attestation service** | Production-grade | Significant new infrastructure |

**Recommendation for testnet:** Option A (manual oracle UI). Option C for production.

### Tasks (Option A — Manual Oracle UI)

- [ ] **2.1** Create `/admin/oracle` page (admin-only, ORACLE_ROLE wallet)
- [ ] **2.2** Display markets in `awaiting_result` phase with countdown to resolve deadline
- [ ] **2.3** Show linked inference manifests for the room (from D1 `inference_manifests`)
- [ ] **2.4** Input field for `finalCount` + auto-computed `evidenceHash` from selected manifest
- [ ] **2.5** Implement `proposeResult(marketId, finalCount, evidenceHash)` via Wagmi
- [ ] **2.6** Display transaction status and confirmation
- [ ] **2.7** Verify market phase transitions to `proposed` on `/room/:id`
- [ ] **2.8** Add tests for evidence hash computation (must match contract expectations)

### Key Contract Function

```solidity
function proposeResult(
    uint256 marketId,
    uint32 finalCount,
    bytes32 evidenceHash
) external onlyRole(ORACLE_ROLE);
```

### Evidence Hash Format

Should commit to: room ID, round timestamps, model hash, zone config hash, final count, oracle signer. See `contracts/README.md` for canonical manifest structure.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/pages/AdminOraclePage.tsx` | New — oracle proposal UI |
| `src/lib/evidence-hash.ts` | New — canonical hash computation |
| `src/App.tsx` | Add `/admin/oracle` route |
| `src/pages/AdminPage.tsx` | Link to oracle page |

### Estimated Effort: 1–2 days

---

## Phase 3: Result Finalization & Claims

**Goal:** Winners can claim payouts after the challenge window expires.

### Tasks

- [ ] **3.1** Add `finalizeResult(marketId)` call — can be triggered by anyone after 15-min challenge window
- [ ] **3.2** Option A: Worker cron auto-finalizes expired proposals
- [ ] **3.3** Option B: Manual finalize button on admin page
- [ ] **3.4** Create claim UI component on `RoomPage` (visible when phase === `resolved`)
- [ ] **3.5** Read user's bet positions from contract (`getBets` or event logs)
- [ ] **3.6** Calculate expected payout (pari-mutuel formula)
- [ ] **3.7** Implement `claim(marketId)` via Wagmi
- [ ] **3.8** Handle edge cases: no winners (refund), already claimed, cancelled markets
- [ ] **3.9** Show claim history on `/profile`

### Key Contract Functions

```solidity
function finalizeResult(uint256 marketId) external;
function claim(uint256 marketId) external;
```

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/components/claim-winnings-button.tsx` | New — claim UI |
| `src/lib/market-contract.ts` | Add read functions for user bets |
| `src/pages/RoomPage.tsx` | Show claim button when resolved |
| `src/pages/ProfilePage.tsx` | Claim history section |
| `worker/market-rounds.ts` | Optional: auto-finalize in cron |

### Estimated Effort: 2–3 days

---

## Phase 4: Challenge & Dispute Flow

**Goal:** Users can challenge proposed results; dispute resolver can uphold or reject.

### Tasks

- [ ] **4.1** Wire `ChallengeTimeline` component to real market state
- [ ] **4.2** Create challenge submission UI (bonded — requires ETH deposit)
- [ ] **4.3** Implement `challengeResult(marketId, evidenceHash)` via Wagmi
- [ ] **4.4** Create `/admin/disputes` page for DISPUTE_ROLE wallet
- [ ] **4.5** Display challenged markets with both evidence hashes
- [ ] **4.6** Implement `resolveChallenge(marketId, upheld)` — uphold or reject
- [ ] **4.7** Handle `cancelStaleChallenge` after 7-day timeout
- [ ] **4.8** Update RoomPage phase display for `challenged` state

### Key Contract Functions

```solidity
function challengeResult(uint256 marketId, bytes32 evidenceHash) external payable;
function resolveChallenge(uint256 marketId, bool upheld) external onlyRole(DISPUTE_ROLE);
function cancelStaleChallenge(uint256 marketId) external;
```

### Estimated Effort: 3–4 days

---

## Phase 5: Production Hardening

**Goal:** Deploy to production with proper security, monitoring, and reliability.

### Tasks

#### Infrastructure
- [ ] **5.1** Create production D1 database, update `database_id` in `wrangler.jsonc`
- [ ] **5.2** Deploy Worker to Cloudflare production
- [ ] **5.3** Add Worker deploy to CI pipeline
- [ ] **5.4** Configure production `APP_ORIGIN` and `VITE_AUTH_API_URL`
- [ ] **5.5** Set up Cloudflare observability / alerting

#### Security
- [ ] **5.6** Move `MARKET_OPERATOR_PRIVATE_KEY` to Cloudflare secret (production)
- [ ] **5.7** Plan KMS/MPC for oracle and market operator signing
- [ ] **5.8** Commission independent smart contract audit
- [ ] **5.9** Deploy admin behind multisig (contract supports 2-day transfer delay)
- [ ] **5.10** Review rate limiting and session security

#### Streams & Detection
- [ ] **5.11** Replace incorrect NYC/London stream URLs
- [ ] **5.12** Add stream health monitoring (detect offline feeds)
- [ ] **5.13** Test ONNX inference on device matrix (desktop, mobile, WASM)
- [ ] **5.14** Configure HLS CORS proxy if needed for COEP production builds

#### Config Cleanup
- [ ] **5.15** Remove legacy POC components
- [ ] **5.16** Reconcile all contract address references
- [ ] **5.17** Update root README to reflect current architecture
- [ ] **5.18** Enable all 6 rooms in `AUTO_MARKET_ROOMS` after zone setup

### Estimated Effort: 1–2 weeks

---

## Phase 6: Production Oracle (Future)

**Goal:** Trustless result attestation for mainnet deployment.

This phase is intentionally deferred. Browser inference manifests are **not sufficient** for production settlement.

### Requirements (from `contracts/README.md`)

- [ ] Independent source-stream segment hash capture
- [ ] Threshold oracle signer set (not single browser wallet)
- [ ] Multiple independent detector attestations aggregated
- [ ] Content-addressed evidence storage (IPFS/Arweave)
- [ ] Verifiable compute or TEE attestation
- [ ] Independent security audit passed
- [ ] Multisig admin, distinct role addresses
- [ ] Mainnet deployment (not Sepolia)

### Estimated Effort: 4–8 weeks (separate project)

---

## Priority Matrix

| Phase | Priority | Blocks | Effort |
|-------|----------|--------|--------|
| Phase 1: Local baseline | **P0** | Everything | 2–4 hours |
| Phase 2: Oracle proposal | **P0** | Round resolution | 1–2 days |
| Phase 3: Claims | **P0** | Payout collection | 2–3 days |
| Phase 4: Challenges | **P1** | Dispute mechanism | 3–4 days |
| Phase 5: Production hardening | **P1** | Production deploy | 1–2 weeks |
| Phase 6: Production oracle | **P2** | Mainnet | 4–8 weeks |

---

## End-to-End Test Scenario

After Phases 1–3, this full loop should work:

```
1. Admin deploys contract, publishes Tokyo zone
2. Scheduler creates market → phase: open
3. User A bets 0.01 ETH on OVER
4. User B bets 0.02 ETH on RANGE
5. Betting window closes → phase: awaiting_result
6. Operator runs detection, submits manifest (count: 25)
7. Oracle proposes result (count: 25, evidenceHash) → phase: proposed
8. 15-minute challenge window passes
9. Anyone calls finalizeResult → phase: resolved
10. User A (OVER winner) claims payout
11. Scheduler creates next market → phase: open
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| HLS stream goes offline | High | Room unusable | Stream health monitoring, fallback URLs |
| Arbitrum Sepolia RPC slow | Medium | Tx failures | Retry logic in Worker, multiple RPC endpoints |
| WebGPU unavailable on mobile | Medium | Slow inference | WASM fallback, set expectations in UI |
| Contract address drift | High (current) | Wrong contract calls | Reconciliation checklist after deploy |
| Browser manifest spoofing | High | False results | Phase 6 independent attestation |
| MARKET_OPERATOR key leak | Low | Unauthorized market creation | Cloudflare secrets, rotate role |
