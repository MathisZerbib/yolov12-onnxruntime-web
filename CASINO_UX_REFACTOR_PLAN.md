# Crossflow Playability & Backoffice Refactor Plan

Status values: `[ ]` pending · `[~]` active · `[x]` complete

## Outcomes

- Make a live round immediately understandable and playable on phone, tablet, and desktop.
- Keep vehicle inference smooth while UI state remains predictable and testable.
- Turn `/admin` into a guided operational overview with clear readiness and next actions.
- Preserve wallet custody, on-chain truth, and the existing autonomous market scheduler.

## Architecture rules

- Zustand owns durable UI/session state: selected outcome per room, stake draft per room, player-panel mode, and admin workflow progress.
- TanStack Query/Wagmi remain the source of truth for remote and on-chain state.
- Detector frames, canvases, trackers, and animation-frame data stay in refs/workers; never publish raw detections to the global store.
- Store selectors must be narrow. Components subscribe only to the fields/actions they render.
- Persist only harmless preferences and drafts. Never persist private keys, keystore passwords, leases, transaction promises, or server responses.

## Work plan

### 1. State foundation

- [x] Repair ONNX Runtime asset delivery in development and production so detection readiness is reliable.
- [x] Add Zustand and create a typed, versioned game UI store with safe local persistence.
- [x] Move room bet selection and amount drafts from the monolithic room component into narrow store selectors.
- [x] Add bounded validation and room cleanup semantics.

### 2. Player game loop

- [x] Extract a memoized betting console with explicit OPEN / WAITING / STALE / UNAVAILABLE states.
- [x] Add fast stake presets, potential-return feedback, selection confirmation, and a single dominant action.
- [x] Keep the live HUD and count feedback isolated from bet-form rerenders.
- [x] Improve detection start readiness, retry recovery, and zone visibility messaging.

### 3. Responsive adaptation

- [x] Desktop: preserve simultaneous video, round context, and betting controls.
- [x] Tablet: use a balanced two-stage layout without compressed controls.
- [x] Phone: stack the broadcast first and provide a sticky, thumb-reachable bet dock; preserve all core actions.
- [x] Enforce 44px targets, safe-area padding, overflow handling, landscape behavior, and reduced-motion fallbacks.

### 4. Admin control plane

- [x] Add a readiness overview for contract compatibility, operator automation, zones, and enabled rooms.
- [x] Present the safest next action first and link directly to the relevant workflow.
- [x] Improve responsive admin navigation and operational status language.

### 5. Quality gates

- [x] Lint, TypeScript, Worker types, 14 Solidity tests, production build, Worker dry-run, Solidity compile, and dependency audit.
- [x] Add and statically verify 320px, phone landscape, tablet, desktop, coarse-pointer, safe-area, and reduced-motion rules. Live browser automation was unavailable in this environment.
- [x] Record final implementation notes and remaining deployment-only actions in this plan.

## Final implementation notes

- ONNX Runtime `.mjs` and `.wasm` files are now served by a real Vite plugin in development and copied to `dist/ort-wasm` for production. Both endpoints return the correct MIME types.
- The detector now exposes a recoverable retry action instead of leaving the player with a dead loading state after initialization failure.
- Legacy contracts without `latestMarketIdByRoom` remain autonomous through indexed `MarketCreated` discovery; native registry deployments use the direct pointer.
- Zone publication remains an intentional admin-authorized action. The backoffice readiness panel identifies missing zones and links directly to the editor.

## Autonomous lifecycle hardening

- [x] Deduplicate concurrent scheduler reconciliation calls inside the Durable Object.
- [x] Skip rooms without an on-chain zone without counting them as scheduler failures or emitting repeated error logs.
- [x] Return a stable, non-retryable setup state for unready rooms so frontend polling does not wake the scheduler repeatedly.
- [x] Verify ready rooms continue creating rounds while an unready room is isolated.
- [ ] Provision a distinct `MARKET_ORACLE_PRIVATE_KEY` and an independent attestation source before automating `proposeResult`. Reusing the operator key or trusting an arbitrary player browser would violate the contract's role separation and make settlement unsafe.

## Guaranteed payout model

- [x] Replace pool-dependent claims with contract-enforced total returns: UNDER 1.5×, RANGE 1.75×, OVER 2×, EXACT 3×.
- [x] Reserve the worst-case liability for every open market and reject uncovered bets on-chain.
- [x] Keep cancelled-round refunds, challenge refunds, protocol fees, and concurrent-room liabilities solvent.
- [x] Add permissionless bankroll funding and admin-only withdrawal of genuinely unencumbered liquidity.
- [x] Show guaranteed returns before betting and expose direct claims in the player profile.
- [x] Add admin bankroll, locked-payout, and funding controls.
- [x] Make the admin deployment workflow automatically validate the Worker signer, deploy, seed the bankroll, batch-publish every saved zone, update frontend/Worker addresses, and wake the scheduler.
- [ ] Execute the wallet-signed deployment workflow on Arbitrum Sepolia.

## Non-goals for this pass

- Do not move inference frame data into Zustand.
- Do not redesign or weaken contract custody and role separation.
- Do not fake odds, market state, transaction success, or detection confidence.
