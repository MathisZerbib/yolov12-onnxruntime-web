import { DurableObject } from 'cloudflare:workers';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbiItem,
  toBytes,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

const MARKET_ROLE = keccak256(toBytes('MARKET_ROLE'));
const RETRY_DELAY_MS = 30_000;
const CONFIG_RETRY_DELAY_MS = 120_000;
const NEXT_ROUND_LEAD_SECONDS = 10;
const UINT32_MAX = 4_294_967_295;
const AUTOMATION_REGISTRY_SELECTOR = 'a70502d5';
const ROLLING_MARKETS_SELECTOR = '15727a61';
const MARKET_CREATED_EVENT = parseAbiItem('event MarketCreated(uint256 indexed marketId, bytes32 indexed roomId, uint64 closeTime, uint32 lowerBound, uint32 upperBound, uint32 exactTarget, uint32 zoneVersion, bytes32 zoneConfigHash)');

class SchedulerConfigurationError extends Error {}

// ABI from the deployed contract artifact, with named tuple outputs preserved
const trafficMarketAbi = [
  { type: 'function', name: 'latestMarketIdByRoom', stateMutability: 'view', inputs: [{ name: 'roomId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'roleAccount', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'outcomePools', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'outcome', type: 'uint8' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'getMarket', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [
    { name: 'roomId', type: 'bytes32' }, { name: 'closeTime', type: 'uint64' }, { name: 'resolveDeadline', type: 'uint64' },
    { name: 'claimDeadline', type: 'uint64' }, { name: 'challengeDeadline', type: 'uint64' }, { name: 'disputeDeadline', type: 'uint64' },
    { name: 'lowerBound', type: 'uint32' }, { name: 'upperBound', type: 'uint32' }, { name: 'exactTarget', type: 'uint32' },
    { name: 'finalCount', type: 'uint32' }, { name: 'zoneVersion', type: 'uint32' }, { name: 'feeBps', type: 'uint16' },
    { name: 'winner', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'evidenceHash', type: 'bytes32' },
    { name: 'zoneConfigHash', type: 'bytes32' }, { name: 'challengerEvidenceHash', type: 'bytes32' },
    { name: 'challenger', type: 'address' }, { name: 'totalPool', type: 'uint256' }, { name: 'winningPool', type: 'uint256' },
  ] },
  { type: 'function', name: 'createMarket', stateMutability: 'nonpayable', inputs: [
    { name: 'roomId', type: 'bytes32' }, { name: 'closeTime', type: 'uint64' }, { name: 'resolveDeadline', type: 'uint64' },
    { name: 'lowerBound', type: 'uint32' }, { name: 'upperBound', type: 'uint32' }, { name: 'exactTarget', type: 'uint32' },
    { name: 'feeBps', type: 'uint16' },
  ], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'nextMarketId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'MIN_BETTING_PERIOD', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint64' }] },
  { type: 'function', name: 'roomZones', stateMutability: 'view', inputs: [{ name: 'roomId', type: 'bytes32' }], outputs: [
    { name: 'topLeftXBps', type: 'uint16' }, { name: 'topLeftYBps', type: 'uint16' },
    { name: 'topRightXBps', type: 'uint16' }, { name: 'topRightYBps', type: 'uint16' },
    { name: 'bottomRightXBps', type: 'uint16' }, { name: 'bottomRightYBps', type: 'uint16' },
    { name: 'bottomLeftXBps', type: 'uint16' }, { name: 'bottomLeftYBps', type: 'uint16' },
    { name: 'version', type: 'uint32' }, { name: 'configHash', type: 'bytes32' },
  ] },
  { type: 'error', name: 'InvalidConfiguration', inputs: [] },
  { type: 'error', name: 'ActiveMarketExists', inputs: [{ name: 'marketId', type: 'uint256' }] },
] as const;

interface MarketConfig {
  contractAddress: `0x${string}`;
  rpcUrl: string;
  enabledRooms: string[];
  bettingWindowSeconds: number;
  resolutionWindowSeconds: number;
  lowerBound: number;
  upperBound: number;
  exactTarget: number;
  feeBps: number;
}

export interface Market {
  roomId: `0x${string}`;
  closeTime: bigint;
  resolveDeadline: bigint;
  claimDeadline: bigint;
  challengeDeadline: bigint;
  disputeDeadline: bigint;
  lowerBound: number;
  upperBound: number;
  exactTarget: number;
  finalCount: number;
  zoneVersion: number;
  feeBps: number;
  winner: number;
  status: number;
  evidenceHash: `0x${string}`;
  zoneConfigHash: `0x${string}`;
  challengerEvidenceHash: `0x${string}`;
  challenger: `0x${string}`;
  totalPool: bigint;
  winningPool: bigint;
}

export type PlayerMarketPhase = 'open' | 'awaiting_result' | 'proposed' | 'challenged' | 'resolved' | 'cancelled' | 'unavailable';

export interface RoomMarketState {
  roomId: string;
  roomKey: Hex;
  enabled: boolean;
  serverTime: number;
  phase: PlayerMarketPhase;
  marketId: string | null;
  closeTime: number | null;
  resolveDeadline: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  exactTarget: number | null;
  feeBps: number | null;
  totalPoolWei: string;
  outcomePoolsWei: [string, string, string, string];
  nextRoundExpectedAt: number | null;
  staleAfter: number;
  roundDurationSeconds?: number;
  error?: string;
  retryable?: boolean;
}

function boundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return parsed;
}

function getOperatorPrivateKey(env: { MARKET_OPERATOR_PRIVATE_KEY?: string }): Hex {
  const secretKey = env.MARKET_OPERATOR_PRIVATE_KEY;
  const normalizedSecret = typeof secretKey === 'string' ? secretKey.replace(/^0x/, '') : '';
  if (!/^[0-9a-fA-F]{64}$/.test(normalizedSecret)) throw new Error('MARKET_OPERATOR_PRIVATE_KEY is missing or invalid');
  return `0x${normalizedSecret}` as Hex;
}

export function getAutomationOperatorAddress(env: { MARKET_OPERATOR_PRIVATE_KEY?: string }): `0x${string}` {
  return privateKeyToAccount(getOperatorPrivateKey(env)).address;
}

function getMarketConfig(env: Env): MarketConfig {
  if (!isAddress(env.MARKET_CONTRACT_ADDRESS)) throw new Error('Market automation requires a deployed trapezoid-compatible contract');
  const enabledRooms = env.AUTO_MARKET_ROOMS.split(',').map(room => room.trim()).filter(room => /^[a-z0-9-]{1,64}$/.test(room));
  const lowerBound = boundedInteger(env.MARKET_LOWER_BOUND, 'lower bound', 0, UINT32_MAX);
  const upperBound = boundedInteger(env.MARKET_UPPER_BOUND, 'upper bound', lowerBound, UINT32_MAX);
  const exactTarget = boundedInteger(env.MARKET_EXACT_TARGET, 'exact target', lowerBound, upperBound);
  return {
    contractAddress: getAddress(env.MARKET_CONTRACT_ADDRESS),
    rpcUrl: env.MARKET_RPC_URL,
    enabledRooms,
    bettingWindowSeconds: boundedInteger(env.MARKET_BETTING_WINDOW_SECONDS, 'betting window', 15, 86_400),
    resolutionWindowSeconds: boundedInteger(env.MARKET_RESOLUTION_WINDOW_SECONDS, 'resolution window', 60, 86_400),
    lowerBound,
    upperBound,
    exactTarget,
    feeBps: boundedInteger(env.MARKET_FEE_BPS, 'fee', 0, 1_000),
  };
}

function phaseFor(status: number, closeTime: number, nowSeconds: number): PlayerMarketPhase {
  if (status === 1) return nowSeconds < closeTime ? 'open' : 'awaiting_result';
  if (status === 2) return 'proposed';
  if (status === 3) return 'challenged';
  if (status === 4) return 'resolved';
  if (status === 5) return 'cancelled';
  return 'unavailable';
}

async function inspectAutomationContract(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`,
): Promise<{ hasRoomRegistry: boolean; supportsRollingMarkets: boolean }> {
  const code = await publicClient.getCode({ address: contractAddress });
  if (!code || code === '0x') throw new SchedulerConfigurationError(`No contract is deployed at ${contractAddress}`);
  const normalizedCode = code.toLowerCase();
  return {
    hasRoomRegistry: normalizedCode.includes(AUTOMATION_REGISTRY_SELECTOR),
    supportsRollingMarkets: normalizedCode.includes(ROLLING_MARKETS_SELECTOR),
  };
}

async function findLatestMarketId(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`,
  roomKey: Hex,
  hasRoomRegistry: boolean,
): Promise<bigint> {
  if (hasRoomRegistry) {
    return publicClient.readContract({ address: contractAddress, abi: trafficMarketAbi, functionName: 'latestMarketIdByRoom', args: [roomKey] });
  }

  // Older deployments did not store a per-room pointer. MarketCreated has both
  // values indexed, so it is a canonical and inexpensive compatibility index.
  const logs = await publicClient.getLogs({
    address: contractAddress,
    event: MARKET_CREATED_EVENT,
    args: { roomId: roomKey },
    fromBlock: 0n,
    toBlock: 'latest',
  });
  return logs.reduce((latest, log) => {
    const marketId = log.args.marketId ?? 0n;
    return marketId > latest ? marketId : latest;
  }, 0n);
}

export async function readRoomMarketState(env: Env, roomId: string): Promise<RoomMarketState> {
  const serverTime = Math.floor(Date.now() / 1_000);
  const roomKey = keccak256(toBytes(roomId));
  let config: MarketConfig;
  try {
    config = getMarketConfig(env);
  } catch (error) {
    return {
      roomId, roomKey, enabled: false, serverTime, phase: 'unavailable', marketId: null, closeTime: null,
      resolveDeadline: null, lowerBound: null, upperBound: null, exactTarget: null, feeBps: null, totalPoolWei: '0',
      outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: null, staleAfter: serverTime + 10,
      error: error instanceof Error ? error.message : 'Market automation is unavailable',
      retryable: false,
    };
  }
  const enabled = config.enabledRooms.includes(roomId);
  if (!enabled) return {
    roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
    lowerBound: null, upperBound: null, exactTarget: null, feeBps: null, totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'],
    nextRoundExpectedAt: null, staleAfter: serverTime + 10, error: 'Continuous rounds are not enabled for this room yet',
    retryable: false,
  };

  try {
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 8_000, retryCount: 2 }) });
    const capabilities = await inspectAutomationContract(publicClient, config.contractAddress);
    const [marketId, roomZone] = await Promise.all([
      findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry),
      publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'roomZones', args: [roomKey] }),
    ]);
    if (Number(roomZone[8]) === 0) return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
      lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: null, staleAfter: serverTime + 30,
      error: 'This room is waiting for its one-time on-chain zone publication', retryable: false,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
    if (marketId === 0n) return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
      lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: serverTime + 30, staleAfter: serverTime + 10,
      error: 'Preparing the first round',
      retryable: true,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
    const [marketResult, underPool, rangePool, overPool, exactPool] = await Promise.all([
      publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [marketId] }),
      ...([1, 2, 3, 4] as const).map(outcome => publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'outcomePools', args: [marketId, outcome] })),
    ]);
    const market = marketResult as readonly [
      `0x${string}`, bigint, bigint, bigint, bigint, bigint,
      number, number, number, number, number, number, number,
      number, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
      bigint, bigint
    ];
    const closeTime = Number(market[1]);
    const resolveDeadline = Number(market[2]);
    const lowerBound = market[6];
    const upperBound = market[7];
    const exactTarget = market[8];
    const feeBps = market[11];
    const status = market[13] as number;
    const totalPool = market[18];
    const phase = phaseFor(status, closeTime, serverTime);
    return {
      roomId, roomKey, enabled, serverTime, phase, marketId: marketId.toString(), closeTime,
      resolveDeadline, lowerBound, upperBound, exactTarget, feeBps, totalPoolWei: totalPool.toString(),
      outcomePoolsWei: [underPool.toString(), rangePool.toString(), overPool.toString(), exactPool.toString()],
      nextRoundExpectedAt: phase === 'open' ? closeTime : serverTime + 30, staleAfter: serverTime + 10,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    const configurationError = error instanceof SchedulerConfigurationError;
    if (!configurationError) console.error(JSON.stringify({ event: 'market_state_read_failed', roomId, roomKey, contractAddress: config.contractAddress, error: errorMessage }));
    return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
      lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: serverTime + 30, staleAfter: serverTime + 10,
      error: configurationError ? errorMessage : 'Could not synchronize this room with Arbitrum Sepolia', retryable: !configurationError,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
  }
}

/**
 * One instance is intentionally keyed by the MARKET_ROLE account. The EOA nonce
 * is the coordination atom, so all room creation transactions are serialized here.
 */
export class MarketScheduler extends DurableObject<Env> {
  private reconcileInFlight: Promise<{ checked: number; created: number; skipped: number; errors: number }> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room_state (
        room_id TEXT PRIMARY KEY,
        market_id TEXT,
        close_time INTEGER,
        tx_hash TEXT,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      )`);
    });
  }

  async reconcile(): Promise<{ checked: number; created: number; skipped: number; errors: number }> {
    if (this.reconcileInFlight) return this.reconcileInFlight;
    this.reconcileInFlight = this.runReconciliation().finally(() => { this.reconcileInFlight = null; });
    return this.reconcileInFlight;
  }

  private async runReconciliation(): Promise<{ checked: number; created: number; skipped: number; errors: number }> {
    let config: MarketConfig;
    try {
      config = getMarketConfig(this.env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'market_scheduler_misconfigured', error: error instanceof Error ? error.message : 'unknown' }));
      await this.ctx.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
      return { checked: 0, created: 0, skipped: 0, errors: 1 };
    }

    const capabilityClient = createPublicClient({ chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 8_000, retryCount: 2 }) });
    let contractCapabilities: { hasRoomRegistry: boolean; supportsRollingMarkets: boolean };
    try {
      contractCapabilities = await inspectAutomationContract(capabilityClient, config.contractAddress);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Contract capability check failed';
      console.warn(JSON.stringify({ event: 'market_scheduler_blocked', contractAddress: config.contractAddress, error: message }));
      await this.ctx.storage.deleteAlarm();
      return { checked: 0, created: 0, skipped: 0, errors: 1 };
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;
    let nextAlarm = Number.POSITIVE_INFINITY;
    for (const roomId of config.enabledRooms) {
      try {
        const result = await this.ensureBettingRound(config, roomId);
        if (result.created) created++;
        if (result.closeTime) {
          const lead = contractCapabilities.supportsRollingMarkets ? NEXT_ROUND_LEAD_SECONDS : -1;
          nextAlarm = Math.min(nextAlarm, (result.closeTime - lead) * 1_000);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown scheduler error';
        this.record(roomId, null, null, null, message);
        if (error instanceof SchedulerConfigurationError) {
          skipped++;
          nextAlarm = Math.min(nextAlarm, Date.now() + CONFIG_RETRY_DELAY_MS);
        } else {
          errors++;
          console.error(JSON.stringify({ event: 'market_round_reconcile_failed', roomId, error: message }));
          nextAlarm = Math.min(nextAlarm, Date.now() + RETRY_DELAY_MS);
        }
      }
    }
    if (Number.isFinite(nextAlarm)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, nextAlarm));
    return { checked: config.enabledRooms.length, created, skipped, errors };
  }

  private async ensureBettingRound(config: MarketConfig, roomId: string): Promise<{ created: boolean; marketId: string; closeTime: number }> {
    const operatorPrivateKey = getOperatorPrivateKey(this.env);
    const account = privateKeyToAccount(operatorPrivateKey);
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
    const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
    const roomKey = keccak256(toBytes(roomId));
    const capabilities = await inspectAutomationContract(publicClient, config.contractAddress);

    let authorizedOperator: Hex;
    // First verify contract connectivity with a simpler call
    let nextMarketId: bigint;
    let contractMinimumBettingPeriod: bigint;
    try {
      [nextMarketId, contractMinimumBettingPeriod] = await Promise.all([
        publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'nextMarketId' }),
        publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'MIN_BETTING_PERIOD' }),
      ]);
    } catch (connectivityError) {
      const connectivityErrorMsg = connectivityError instanceof Error ? connectivityError.message : 'unknown';
      console.error(JSON.stringify({
        event: 'contract_connectivity_failed',
        roomId,
        contractAddress: config.contractAddress,
        error: connectivityErrorMsg
      }));
      throw new Error(`Cannot reach contract at ${config.contractAddress}: ${connectivityErrorMsg}`);
    }

    try {
      authorizedOperator = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'roleAccount', args: [MARKET_ROLE] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown';
      console.error(JSON.stringify({
        event: 'contract_read_failed',
        roomId,
        roomKey,
        contractAddress: config.contractAddress,
        operatorAddress: account.address,
        error: errorMessage,
        nextMarketId: nextMarketId.toString(),
        stack: error instanceof Error ? error.stack : undefined
      }));
      throw new Error(`Failed to read contract state for room ${roomId}: ${errorMessage}`);
    }
    if (authorizedOperator.toLowerCase() !== account.address.toLowerCase()) throw new Error(`Configured MARKET_ROLE is ${authorizedOperator}, not the automation signer ${account.address}`);

    const roomZone = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'roomZones', args: [roomKey] });
    const zoneVersion = Number(roomZone[8]);
    if (zoneVersion === 0) {
      throw new SchedulerConfigurationError(`On-chain detection zone is missing for ${roomId}. Publish the saved zone from /admin/zones before enabling automated rounds.`);
    }

    let latestMarketId = await findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry);
    if (latestMarketId > 0n) {
      try {
        const marketTuple = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [latestMarketId] }) as readonly [
          `0x${string}`, bigint, bigint, bigint, bigint, bigint,
          number, number, number, number, number, number, number,
          number, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
          bigint, bigint
        ];
        const roomKeyFromMarket = marketTuple[0] as `0x${string}`;
        if (roomKeyFromMarket.toLowerCase() === roomKey.toLowerCase()) {
          const closeTime = Number(marketTuple[1]);
          const status = marketTuple[13] as number;
          const leadSeconds = capabilities.supportsRollingMarkets ? NEXT_ROUND_LEAD_SECONDS : 0;
          if (status === 1 && closeTime > Math.floor(Date.now() / 1_000) + leadSeconds) {
            this.record(roomId, latestMarketId.toString(), closeTime, null, null);
            return { created: false, marketId: latestMarketId.toString(), closeTime };
          }
        }
      } catch {
        // A stale compatibility log must not prevent the next round.
        latestMarketId = 0n;
      }
    }

    const pending = this.ctx.storage.sql.exec<{ tx_hash: string; close_time: number; updated_at: number }>(
      'SELECT tx_hash,close_time,updated_at FROM room_state WHERE room_id=? AND market_id IS NULL AND tx_hash IS NOT NULL', roomId,
    ).toArray()[0];
    if (pending && Date.now() - pending.updated_at < 120_000) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: pending.tx_hash as Hex });
        if (receipt.status === 'success') {
          const confirmedId = await findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry);
          if (confirmedId !== 0n) {
            this.record(roomId, confirmedId.toString(), pending.close_time, pending.tx_hash, null);
            return { created: false, marketId: confirmedId.toString(), closeTime: pending.close_time };
          }
        }
      } catch {
        // The transaction is still pending or the RPC has not indexed it yet.
        return { created: false, marketId: 'pending', closeTime: Math.floor(Date.now() / 1_000) + 15 };
      }
    }

    const now = Math.floor(Date.now() / 1_000);
    // Deployments may enforce a larger minimum than the current Worker config.
    // Two seconds absorb RPC/block timestamp drift at the exact boundary.
    const effectiveBettingWindow = Math.max(config.bettingWindowSeconds, Number(contractMinimumBettingPeriod) + 2);
    const closeTime = now + effectiveBettingWindow;
    const resolveDeadline = closeTime + config.resolutionWindowSeconds;
    const simulation = await publicClient.simulateContract({
      account,
      address: config.contractAddress,
      abi: trafficMarketAbi,
      functionName: 'createMarket',
      args: [roomKey, BigInt(closeTime), BigInt(resolveDeadline), config.lowerBound, config.upperBound, config.exactTarget, config.feeBps],
    });
    console.log(JSON.stringify({
      event: 'create_market_simulation_success',
      roomId,
      closeTime,
      resolveDeadline,
      lowerBound: config.lowerBound,
      upperBound: config.upperBound,
      exactTarget: config.exactTarget,
      feeBps: config.feeBps
    }));
    const MAX_NONCE_RETRIES = 4;
    let txHash: Hex | undefined;
    for (let nonceRetry = 0; nonceRetry < MAX_NONCE_RETRIES; nonceRetry++) {
      try {
        const currentNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'latest' });
        txHash = await walletClient.writeContract({
          ...simulation.request,
          nonce: currentNonce,
        });
        break;
      } catch (writeError) {
        const message = writeError instanceof Error ? writeError.message : 'unknown';
        const nonceTooLow = /nonce too low|nonce is lower than the current nonce/i.test(message) || /nonce provided.*lower than the current nonce/i.test(message);
        if (nonceTooLow && nonceRetry < MAX_NONCE_RETRIES - 1) {
          console.warn(JSON.stringify({ event: 'nonce_too_low_retry', roomId, attempt: nonceRetry + 1, error: message }));
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        throw writeError;
      }
    }
    if (!txHash) throw new Error(`Failed to send market creation transaction for ${roomId} after ${MAX_NONCE_RETRIES} nonce retries`);
    console.log(JSON.stringify({
      event: 'create_market_tx_sent',
      roomId,
      txHash
    }));
    this.record(roomId, null, closeTime, txHash, null);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 45_000 });
    if (receipt.status !== 'success') {
      console.error(JSON.stringify({
        event: 'tx_reverted',
        roomId,
        txHash,
        receipt
      }));
      throw new Error(`Market creation reverted: ${txHash}`);
    }
    const marketId = await findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry);
    if (marketId === 0n) {
      console.error(JSON.stringify({
        event: 'market_pointer_not_updated',
        roomId,
        roomKey,
        txHash,
        contractAddress: config.contractAddress,
        message: 'Transaction succeeded but contract state not updated'
      }));
      throw new Error(`Market creation confirmed without updating the room pointer: ${txHash}`);
    }
    this.record(roomId, marketId.toString(), closeTime, txHash, null);
    console.log(JSON.stringify({ event: 'market_round_created', roomId, marketId: marketId.toString(), closeTime, txHash }));
    return { created: true, marketId: marketId.toString(), closeTime };
  }

  private record(roomId: string, marketId: string | null, closeTime: number | null, txHash: string | null, error: string | null): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO room_state(room_id,market_id,close_time,tx_hash,last_error,updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(room_id) DO UPDATE SET market_id=excluded.market_id,close_time=excluded.close_time,
       tx_hash=COALESCE(excluded.tx_hash,room_state.tx_hash),last_error=excluded.last_error,updated_at=excluded.updated_at`,
      roomId, marketId, closeTime, txHash, error, Date.now(),
    );
  }

  async alarm(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      console.error(JSON.stringify({ event: 'market_scheduler_alarm_failed', error: error instanceof Error ? error.message : 'unknown' }));
      await this.ctx.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
    }
  }
}
