# 03 — Dependencies & Setup

## System Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | Required for Vite 8, Wrangler 4 |
| npm | 9+ | Package manager |
| Modern browser | Chrome/Edge/Firefox latest | WebGPU preferred for inference |
| Cloudflare account | — | Required for Worker deployment |
| WalletConnect project | — | Free at [cloud.walletconnect.com](https://cloud.walletconnect.com) |
| Arbitrum Sepolia tETH | — | For contract deploy + betting |

---

## NPM Dependencies

### Production (`dependencies`)

| Package | Version | Purpose |
|---------|---------|---------|
| `react` / `react-dom` | 19.2.0 | UI framework |
| `react-router-dom` | ^7.18.1 | Client-side routing |
| `wagmi` | ^3.7.1 | Wallet connection + contract writes |
| `viem` | ^2.55.0 | Ethereum ABI, encoding, SIWE |
| `@tanstack/react-query` | ^5.101.2 | Query client (minimal usage) |
| `onnxruntime-web` | ^1.23.0 | Browser ONNX inference |
| `hls.js` | ^1.6.16 | HLS live stream playback |
| `motion` | ^12.42.2 | Animations |
| `cobe` | ^2.0.1 | 3D globe on landing page |
| `next-themes` | ^0.4.6 | Dark/light theme toggle |
| `@radix-ui/*` | various | Accessible UI primitives (shadcn) |
| `tailwind-merge`, `clsx`, `class-variance-authority` | — | Tailwind utility helpers |
| `lucide-react` | ^0.548.0 | Icons |
| `react-dropzone` | ^14.3.8 | File upload (legacy POC) |

### Development (`devDependencies`)

| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | ^8.1.4 | Build tool + dev server |
| `@vitejs/plugin-react` | ^6.0.3 | React HMR |
| `typescript` | ^5 | Type checking |
| `wrangler` | ^4.110.0 | Cloudflare Worker dev/deploy |
| `@cloudflare/workers-types` | ^5 | Worker type definitions |
| `hardhat` | ^3.9.1 | Solidity test runner |
| `solc` | 0.8.24 | Solidity compiler |
| `@openzeppelin/contracts` | ^5.6.1 | AccessControl, Pausable |
| `concurrently` | ^10.0.3 | Run Vite + Worker together |
| `eslint` + plugins | ^9 | Linting |
| `tailwindcss` | ^4 | CSS framework |

### Install

```bash
npm install
```

---

## Environment Variables

### Frontend (Vite)

File: `.env.development.local` (gitignored)

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `VITE_WALLETCONNECT_PROJECT_ID` | **Yes** | `abc123...` | WalletConnect — app throws at startup if missing |
| `VITE_AUTH_API_URL` | **Yes** | `http://localhost:8787` | Cloudflare Worker base URL |
| `VITE_MARKET_CONTRACT_ADDRESS` | Recommended | `0x1b7b...` | Overrides legacy default in `market-contract.ts` |
| `BASE_PATH` | CI only | `/yolov12-onnxruntime-web/` | GitHub Pages base path |

**Template:**
```bash
cat > .env.development.local << 'EOF'
VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
VITE_AUTH_API_URL=http://localhost:8787
VITE_MARKET_CONTRACT_ADDRESS=0xYourDeployedContractAddress
EOF
```

### Worker (`wrangler.jsonc` vars)

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_ORIGIN` | `http://localhost:5173` | CORS allowlist for frontend |
| `ENVIRONMENT` | `development` | Environment label |
| `APPROVED_MODEL_SHA256` | `a708b431...` | Model hash — must match `public/models/model-metadata.json` |
| `MARKET_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Arbitrum Sepolia RPC |
| `MARKET_CONTRACT_ADDRESS` | `0x1b7b024f...` | Deployed contract address |
| `AUTO_MARKET_ROOMS` | `tokyo,sydney,sf,paris,nyc,london` | Rooms for automated market creation |
| `MARKET_BETTING_WINDOW_SECONDS` | `300` | 5-minute betting window |
| `MARKET_RESOLUTION_WINDOW_SECONDS` | `600` | 10-minute resolution window |
| `MARKET_LOWER_BOUND` | `10` | Under threshold |
| `MARKET_UPPER_BOUND` | `30` | Over threshold |
| `MARKET_EXACT_TARGET` | `20` | Exact target count |
| `MARKET_FEE_BPS` | `200` | 2% protocol fee |

### Worker Secrets

| Secret | Required | Format | Purpose |
|--------|----------|--------|---------|
| `MARKET_OPERATOR_PRIVATE_KEY` | **Yes** | 64 hex chars, **no `0x` prefix** | MARKET_ROLE EOA for `createMarket` automation |

**Local development:**
```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars:
# MARKET_OPERATOR_PRIVATE_KEY=abcdef1234567890...
```

**Production:**
```bash
npx wrangler secret put MARKET_OPERATOR_PRIVATE_KEY
```

> **Security:** Never put private keys in `wrangler.jsonc`, `VITE_*` variables, source control, or logs.

---

## Contract Address Reconciliation

Multiple config files may reference different contract addresses. After every deployment, update **all** of these:

| File | Variable |
|------|----------|
| `.env.development.local` | `VITE_MARKET_CONTRACT_ADDRESS` |
| `wrangler.jsonc` | `MARKET_CONTRACT_ADDRESS` |
| `worker-configuration.d.ts` | Auto-regenerated via `npm run worker:types` |

**Known addresses in codebase:**

| Address | Context |
|---------|---------|
| `0xDe5D11Af502eA4E11c8eA02F2ff22cd6a41b0139` | Legacy default in `market-contract.ts`, README, TESTNET_SETUP |
| `0x1b7b024f40f48ae95d948d4e7c13ba4e64126edd` | Current `wrangler.jsonc` |
| Auto-updated | `/admin/contracts` deploy UI writes to env + wrangler via Vite plugin |

Verify consistency at `/admin/explorer` after deployment.

---

## Local Development Setup

### Step 1: Install & Configure

```bash
git clone <repository-url>
cd yolov12-onnxruntime-web
npm install

# Frontend env
cp .env.development.local.example .env.development.local  # or create manually
# Add VITE_WALLETCONNECT_PROJECT_ID and VITE_AUTH_API_URL

# Worker secrets
cp .dev.vars.example .dev.vars
# Add MARKET_OPERATOR_PRIVATE_KEY
```

### Step 2: Database Migrations

```bash
npm run db:migrate:local
```

Applies SQL migrations from `worker/migrations/` to local D1:
- `0001_auth.sql` — Nonces, sessions
- `0002_security.sql` — Rate limiting
- `0003_room_zones.sql` — Zone storage
- `0004_trapezoid_zones.sql` — Trapezoid geometry columns

### Step 3: Run Development Stack

```bash
npm run dev
```

This runs concurrently:
- **Vite** on `http://localhost:5173`
- **Wrangler** on `http://localhost:8787` with the scheduled-event test endpoint
- **Local scheduler simulator**, which waits for Wrangler and reconciles automatically

Individual services:
```bash
npm run dev:web   # Frontend only
npm run dev:api   # Worker only
```

### Step 4: First-Time Chain Setup

If no contract is deployed yet, follow [04 — Implementation Roadmap](./04-implementation-roadmap.md) Phase 1.

Quick version:
1. Connect platform admin wallet (`0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e`)
2. Go to `/admin/contracts` → generate role wallets → deploy
3. Set `MARKET_OPERATOR_PRIVATE_KEY` to the market operator role key
4. Go to `/admin/zones` → configure and publish zones on-chain
5. Keep `npm run dev` running; it triggers the local scheduler automatically. A deployed Worker uses Cloudflare Cron and needs no local process.

---

## Build & Verification Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `npm run dev` | Full stack local development |
| `dev:scheduler` | `npm run dev:scheduler` | Internal local Cron simulation (normally started by `dev`) |
| `build` | `npm run build` | Production build → `dist/` |
| `preview` | `npm run preview` | Preview production build (with COEP) |
| `lint` | `npm run lint` | ESLint |
| `contract:test` | `npm run contract:test` | Hardhat Solidity tests |
| `contract:artifact` | `npm run contract:artifact` | Build ABI + bytecode → `public/contracts/` |
| `contract:compile` | `npm run contract:compile` | Alternate solc compile |
| `db:migrate:local` | `npm run db:migrate:local` | Apply D1 migrations locally |
| `worker:check` | `npm run worker:check` | Worker dry-run deploy validation |
| `worker:typecheck` | `npm run worker:typecheck` | Worker TypeScript check |
| `worker:types` | `npm run worker:types` | Regenerate `worker-configuration.d.ts` |
| `check` | `npm run check` | Full CI gate (lint, types, tests, build, audit) |

**Recommended before any release:**
```bash
npm run check
```

---

## Production Deployment

### Frontend (GitHub Pages)

Automated via `.github/workflows/deploy.yml` on push to `main`.

Manual:
```bash
BASE_PATH=/yolov12-onnxruntime-web/ npm run build
# Deploy dist/ to static hosting
```

Set in GitHub Actions secrets / environment:
- `VITE_WALLETCONNECT_PROJECT_ID`
- `VITE_AUTH_API_URL` (production Worker URL)
- `VITE_MARKET_CONTRACT_ADDRESS`

### Worker (Cloudflare)

```bash
# 1. Create production D1 database
npx wrangler d1 create crossflow-auth
# Update database_id in wrangler.jsonc

# 2. Apply remote migrations
npx wrangler d1 migrations apply crossflow-auth --remote

# 3. Set production vars in wrangler.jsonc
#    APP_ORIGIN = https://your-frontend-url
#    MARKET_CONTRACT_ADDRESS = 0x...

# 4. Set secrets
npx wrangler secret put MARKET_OPERATOR_PRIVATE_KEY

# 5. Deploy
npx wrangler deploy
```

### Contract (Arbitrum Sepolia)

Via admin UI (`/admin/contracts`) or external tooling. After deploy:
1. Update all contract address references (see above)
2. Publish zones for each room
3. Fund MARKET_ROLE wallet with tETH
4. Verify source on Arbiscan (chain ID 421614)

---

## ONNX Model Assets

| File | Size | Purpose |
|------|------|---------|
| `public/models/yolov12n.onnx` | ~12 MB | YOLOv12 nano detection model |
| `public/models/model-metadata.json` | — | Input dims, class names, SHA-256 hash |

Model SHA-256: `a708b431b48e98647c5d469699b57809a0048de1d81bfe77e1b809c070b11be0`

Must match `APPROVED_MODEL_SHA256` in Worker config. The browser verifies hash before caching via `caches.open('crossflow-approved-models-v1')`.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `VITE_WALLETCONNECT_PROJECT_ID is required` | Missing env var | Add to `.env.development.local` |
| `MARKET_OPERATOR_PRIVATE_KEY is missing or invalid` | Missing `.dev.vars` | Create `.dev.vars` with 64-char hex key (no 0x) |
| `Round service is unavailable` | Worker not running | Run `npm run dev:api` or `npm run dev` |
| `Market automation requires a deployed trapezoid-compatible contract` | Legacy or empty contract address | Deploy new contract via `/admin/contracts` |
| `Only the platform admin wallet can set zones` | Wrong wallet connected | Connect `0x2a1F44Ce...` and complete SIWE |
| CORS errors | `APP_ORIGIN` mismatch | Set Worker `APP_ORIGIN` to match frontend URL |
| HLS stream fails in production | COEP blocking cross-origin | Ensure stream origin sends CORS headers, or use proxy |
| ONNX WASM fallback slow | No WebGPU | Test on Chrome/Edge with WebGPU enabled |
