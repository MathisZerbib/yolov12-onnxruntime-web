# 07 — Testing, Use Cases, and Delivery

## Quality strategy

Crossflow has four automated test layers. Each layer owns a different failure boundary:

| Layer | Command | Runtime | Purpose |
|---|---|---|---|
| Unit and component | `npm run test:unit` | Happy DOM | Deterministic UI, formatting, state, and traffic-counting behavior |
| Worker integration | `npm run test:worker` | Cloudflare `workerd` | Real D1 migrations, Durable Objects, CORS, auth boundaries, and HTTP responses |
| Contract | `npm run contract:test` | Hardhat Solidity runner | Roles, zones, rolling markets, solvency, settlement, challenge, refund, and payout invariants |
| Browser | `npm run test:e2e` | Chromium | Built user journeys, all routes, responsive overflow, and serious WCAG failures |

`npm run check` is the release gate. It runs linting, generated-binding validation, both TypeScript projects, coverage thresholds, Worker integration tests, Solidity tests, artifact generation, production build, Worker dry-run, direct Solidity compilation, and the production dependency audit. Browser cases run as a separate CI job after this gate.

## Automated use-case matrix

| Area | Use case | Expected result | Coverage |
|---|---|---|---|
| Market discovery | Open the home market and choose Paris | Selected room opens and round #42 is rendered from a deterministic API fixture | Browser |
| Routing | Open every public and admin route directly | A meaningful page heading renders; no blank lazy route | Browser |
| Accessibility | Scan the home task flow against WCAG 2 A/AA and 2.1 A/AA | No critical or serious Axe violations | Browser |
| Responsive layout | Open home and `/room/tokyo` at 390×844, then the room at 568×320 | Pages remain inside the viewport; the room stacks without crushing the stream | Browser |
| Result presentation | Render win/loss settlement feedback | A focus-managed viewport-centered dialog shows ETH and live approximate USD, outside the betting panel | Component |
| Round lifecycle | Reach the rolling-market lead boundary | Scheduler creates a replacement instead of holding an expired market | Worker unit |
| Legacy round lifecycle | Close a non-rolling market | Scheduler advances only after close and never holds the expired market indefinitely | Worker unit |
| Structured Worker logs | Log market tuples and receipts containing nested `bigint` values | Values serialize as decimal strings without changing scheduler control flow | Worker unit |
| Deployment scheduler | Inspect Cloudflare after a Worker release | CI fails unless the live one-minute Cron Trigger is attached | Unit + deployment smoke |
| Round timing | Render an absolute next-round deadline | Countdown decreases from 00:30 to 00:25 and never resets on each display tick | Unit |
| Round recovery | No deterministic next-round timestamp exists | UI says the next round is opening instead of showing a fake 30-second loop | Unit |
| Traffic counting | Vehicle starts outside, enters, then exits | One count and one count event are produced | Unit |
| Traffic filtering | Person enters the detection region | No vehicle track or count is produced | Unit |
| Detection zones | Check point inclusion, configuration changes, and reset | Polygon geometry is respected and stale tracks are cleared | Unit |
| Bet drafts | Edit outcomes/stakes in two rooms | Drafts remain room-scoped, sanitized, clamped, persisted, and independently clearable | Unit |
| Transaction feedback | Await signature, confirm, or fail | Correct status copy and safe Arbiscan link render | Component |
| Player positions | Read open, expired, proposed, won, lost, cancelled, and claimed positions | No position is hidden; expired rounds expose refund recovery and mature proposals expose finalization | Unit + profile UI |
| CORS | Send an allowed preflight | Credentialed CORS headers are returned | Worker integration |
| Auth challenge | Request SIWE nonce from the app origin | Arbitrum Sepolia challenge is created in migrated D1 storage | Worker integration |
| Auth abuse | Use a foreign origin or invalid wallet | Request is rejected with 403 or 400 | Worker integration |
| Session boundary | Access profile, lease, or manifest without a session | Request is rejected with 401 | Worker integration |
| Public data | Read activity, leaderboard, or configured room zone | Empty feeds and canonical versioned zone return successfully | Worker integration |
| Room concurrency | Acquire and contend for a detector lease | First operator owns the lease; second operator receives contention | Durable Object integration |
| Smart contract | Exercise roles, zones, rolling rounds, liabilities, result/challenge/finalize/claim paths | All on-chain invariants pass | 17 Solidity tests |

## CI pipeline

`.github/workflows/ci.yml` runs on pull requests, `main`, and manual dispatch:

1. Install exactly from `package-lock.json` on Node 22.
2. Run the complete `npm run check` quality gate.
3. Upload the LCOV/JSON/text coverage artifact.
4. Install Chromium and run browser use cases.
5. Always upload the browser HTML report; retain traces, videos, and screenshots on failure.

Recommended branch protection for `main`:

- Require `Types, unit, Worker, contract, build`.
- Require `Browser use cases`.
- Require the branch to be up to date before merge.
- Block force pushes and direct pushes.

## Frontend continuous deployment

`.github/workflows/deploy.yml` runs only after a successful `main` CI workflow or by manual dispatch. Configure the `github-pages` environment with:

| Kind | Name | Value |
|---|---|---|
| Secret | `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect public project ID (kept as a secret to avoid accidental reuse) |
| Variable | `VITE_AUTH_API_URL` | Production Worker origin, for example `https://crossflow-auth.<account>.workers.dev` |
| Variable | `VITE_MARKET_CONTRACT_ADDRESS` | Current Arbitrum Sepolia contract address |

Set repository Pages source to **GitHub Actions**. The workflow validates configuration, builds with the repository base path, deploys the Pages artifact, and performs an HTTP smoke check against the emitted page URL.

## Worker and D1 continuous deployment

`.github/workflows/deploy-worker.yml` runs only after successful `main` CI or by manual dispatch. Configure the protected `production-worker` environment with:

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped token with Workers Scripts and D1 edit permissions |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| Secret | `CLOUDFLARE_D1_DATABASE_ID` | Production `crossflow-auth` D1 UUID |
| Variable | `CROSSFLOW_APP_ORIGIN` | Exact deployed frontend origin, without a trailing slash |

The workflow creates an ignored production Wrangler config at runtime, applies remote D1 migrations, deploys the Worker, verifies the live one-minute Cron Trigger through Cloudflare's schedules API, and probes `/activity` on the deployment URL. The market operator key is not copied through GitHub. Provision it once as a Cloudflare Worker secret:

```bash
npx wrangler secret put MARKET_OPERATOR_PRIVATE_KEY
```

Use required reviewers on `production-worker` if migrations and Worker code need a manual production approval.

## Smart-contract release boundary

CI compiles and tests the contract and regenerates the browser artifact, but it does not deploy a contract. Contract deployment changes immutable addresses, roles, and funded liquidity, so it remains a separately approved action through `/admin/contracts` or a controlled deployment wallet. After deployment, update both production environments with the same contract address and rerun the frontend and Worker workflows.

## Rollback

- Frontend: manually dispatch **Deploy frontend** with a previously healthy commit SHA in the `ref` input.
- Worker: use `npx wrangler versions list` and `npx wrangler rollback <VERSION_ID>` for an immediate runtime rollback, or manually dispatch **Deploy Worker** with a healthy commit SHA.
- D1: migrations must be forward-compatible and additive. Do not attempt an automatic destructive rollback; ship a corrective migration.
- Contract: contracts are not rolled back. Pause the affected deployment, deploy a reviewed replacement, update both release environments, and migrate operational roles deliberately.

## Local release rehearsal

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

The production dependency audit is currently clean. The fixed `adm-zip` override also removes the known Hardhat development-chain advisory while preserving all 17 Solidity tests.
