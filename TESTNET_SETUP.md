# Testnet Setup Guide

## Quick Start

1. **Start the frontend:**
   ```bash
   npm run dev
   ```

2. **Start the Cloudflare worker (in another terminal):**
   ```bash
   npx wrangler dev
   ```

3. **Update types (if needed):**
   ```bash
   npx wrangler types
   ```

4. **Trigger the market scheduler manually:**
   ```bash
   curl "http://localhost:8787/cdn-cgi/handler/scheduled"
   ```
   
   Or run the helper script to auto-trigger every 2 minutes:
   ```bash
   ./scripts/trigger-scheduler.sh
   ```

5. **Configure your admin wallet:**
   - Set `PLATFORM_ADMIN_ADDRESS` in `.env.development.local`
   - Connect that wallet in the browser
   - Navigate to `/admin` to verify admin access

## Current Configuration

- **Contract**: `0xDe5D11Af502eA4E11c8eA02F2ff22cd6a41b0139` (Arbitrum Sepolia)
- **Status**: This is the legacy rectangle-zone deployment
- **Auto-market rooms**: All 6 rooms (tokyo, sydney, sf, paris, nyc, london)
- **Market parameters**: 10-30 vehicles, target 20, 5min betting window

## Deploying the New Trapezoid-Compatible Contract

To remove the "LEGACY" warning and enable draggable trapezoid zones:

### Step 1: Prepare Role Wallets

1. Go to `/admin/contracts` in the app
2. Either:
   - **Generate** 3 new encrypted testnet wallets (minimum 16-char password)
   - **Import** 3 existing encrypted Web3 V3 keystores
3. **Download all backups** before proceeding
4. Confirm offline backup checkbox

### Step 2: Deploy Contract

1. Connect your **platform admin wallet**
2. Ensure you're on **Arbitrum Sepolia**
3. Click **"One-click redeploy with prepared roles"**
4. Wait for transaction confirmation (~30 seconds)

**Auto-funding role wallets:** By default the deployer's admin wallet tops up each prepared role wallet with testnet ETH (up to 0.05 ETH per role) if it is running low. This is required for the market operator, oracle, and dispute resolver to pay gas for on-chain actions. Uncheck "Auto-fund role wallets" in the panel if you prefer to fund them manually from a faucet.

**Note:** The deployment creates 3 role wallets. You can see their addresses in the deployment panel. Save the private keys somewhere safe if you want to use them for `MARKET_OPERATOR_PRIVATE_KEY`.

### Step 3: Set Up Worker Secrets

After deploying, you need to provide the market operator private key for local development:

**Option A: Use one of the deployed role wallets (if you have the private key)**
```bash
# Download the encrypted keystores from the deployment panel
# Extract private keys using ethers.js or similar tool

# Then create .dev.vars:
echo "MARKET_OPERATOR_PRIVATE_KEY=your_key_without_0x" > .dev.vars
```

**Option B: Use a separate testnet wallet**
1. Create a new wallet in MetaMask or similar
2. Export the private key
3. Fund it with tETH on Arbitrum Sepolia
4. Create `.dev.vars`:
```bash
echo "MARKET_OPERATOR_PRIVATE_KEY=your_private_key_here" > .dev.vars
```

**Option C: Development convenience (NOT for production)**
```bash
# Copy the example
cp .dev.vars.example .dev.vars

# Edit with your preferred text editor and add the key
nano .dev.vars
```

### Step 4: Automatic Configuration

✨ **Restart the worker and the rest updates automatically!**

After deployment, when you restart the worker:
1. Frontend env (`VITE_MARKET_CONTRACT_ADDRESS`) was already updated by the browser
2. Worker config (`wrangler.jsonc` → `MARKET_CONTRACT_ADDRESS`) was already updated
3. The previous deployment page reloaded automatically

No manual file editing needed!

### Step 5: Configure Zones

1. Navigate to `/admin/zones`
2. For each room, define trapezoid detection zones by dragging the 4 corners
3. Save each zone
4. Click **"Publish saved zone on-chain"** to register the zone geometry

### Step 6: Set Detection Zone Hash (Backend)

For each room, call `setRoomZone` from the admin wallet or update the backend config.

## Production Checklist

- [ ] Deploy new trapezoid-compatible contract
- [ ] Set `MARKET_CONTRACT_ADDRESS` in worker config (auto-updated)
- [ ] Set `VITE_MARKET_CONTRACT_ADDRESS` in frontend env (auto-updated)
- [ ] Configure `MARKET_OPERATOR_PRIVATE_KEY` secret in wrangler
- [ ] Enable all desired rooms in `AUTO_MARKET_ROOMS`
- [ ] Set market parameters (bounds, target, windows)
- [ ] Configure platform admin address
- [ ] Deploy zones for each room
- [ ] Verify contract shows as "compatible" in `/admin/explorer`

## Troubleshooting

**"MARKET_OPERATOR_PRIVATE_KEY is missing or invalid"**
- Create `.dev.vars` with `MARKET_OPERATOR_PRIVATE_KEY=...`
- The key must be 64 hex characters (no 0x prefix)
- Restart the worker after adding the key

**"Market automation requires a deployed trapezoid-compatible contract"**
- The worker `MARKET_CONTRACT_ADDRESS` is empty or points to legacy contract
- Solution: Deploy new contract and update wrangler.jsonc

**"Legacy rectangle-zone deployment"**
- Frontend detects old contract bytecode
- Solution: Redeploy contract via `/admin/contracts`

**"Only the platform admin wallet can set zones"**
- Connect the wallet matching `PLATFORM_ADMIN_ADDRESS`
- Verify SIWE session at `/admin`

**RPC timeouts**
- Arbitrum Sepolia RPC can be slow
- The worker retries automatically; increase timeout in `market-rounds.ts` if needed