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
const MARKET_SCAN_BATCH_SIZE = 128n;
const MAX_SETTLEMENT_TXS_PER_RUN = 8;
const PENDING_TX_GRACE_SECONDS = 120;
const UINT32_MAX = 4_294_967_295;
const AUTOMATION_REGISTRY_SELECTOR = 'a70502d5';
const ROLLING_MARKETS_SELECTOR = '15727a61';
const MARKET_CREATED_EVENT = parseAbiItem('event MarketCreated(uint256 indexed marketId, bytes32 indexed roomId, uint64 closeTime, uint32 lowerBound, uint32 upperBound, uint32 exactTarget, uint32 zoneVersion, bytes32 zoneConfigHash)');

class SchedulerConfigurationError extends Error {}

export function stringifyLogEvent(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item) ?? 'null';
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function getLogLevel(env: Env): LogLevel {
  const level = (env.LOG_LEVEL as LogLevel) || 'info';
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  return validLevels.includes(level) ? level : 'info';
}

function shouldLog(currentLevel: LogLevel, messageLevel: LogLevel): boolean {
  const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return levels[messageLevel] >= levels[currentLevel];
}

export function logEvent(env: Env, level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(getLogLevel(env), level)) return;
  const logData = data !== undefined ? stringifyLogEvent({ event: message, ...data }) : message;
  if (level === 'error') console.error(logData);
  else if (level === 'warn') console.warn(logData);
  else console.log(logData);
}

// Backward-compatible wrappers
export function logDebug(env: Env, message: string, data?: unknown): void { logEvent(env, 'debug', message, data); }
export function logInfo(env: Env, message: string, data?: unknown): void { logEvent(env, 'info', message, data); }
export function logWarn(env: Env, message: string, data?: unknown): void { logEvent(env, 'warn', message, data); }
export function logError(env: Env, message: string, data?: unknown): void { logEvent(env, 'error', message, data); }

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
  { type: 'function', name: 'proposeResult', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'finalCount', type: 'uint32' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'zoneConfigHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'finalizeResult', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelExpired', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelStaleChallenge', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'nextMarketId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'MIN_BETTING_PERIOD', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint64' }] },
  { type: 'function', name: 'roomZones', stateMutability: 'view', inputs: [{ name: 'roomId', type: 'bytes32' }], outputs: [
    { name: '', type: 'uint16[8]' }, { name: 'version', type: 'uint32' }, { name: 'configHash', type: 'bytes32' }
  ] },
  { type: 'error', name: 'InvalidConfiguration', inputs: [] },
  { type: 'error', name: 'ActiveMarketExists', inputs: [{ name: 'marketId', type: 'uint256' }] },
  { type: 'error', name: 'Unauthorized', inputs: [] },
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

type MarketTuple = readonly [
  `0x${string}`, bigint, bigint, bigint, bigint, bigint,
  number, number, number, number, number, number, number,
  number, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
  bigint, bigint,
];

export type SettlementAction = 'cancelExpired' | 'finalizeResult' | 'cancelStaleChallenge' | 'proposeResult';

export interface SettlementDecision {
  action: SettlementAction | null;
  nextActionAt: number | null;
  terminal: boolean;
}

export function settlementDecision(
  market: Pick<Market, 'status' | 'resolveDeadline' | 'challengeDeadline' | 'disputeDeadline' | 'closeTime' | 'roomId'>,
  chainNowSeconds: number,
): SettlementDecision {
  if (market.status === 1) {
    const deadline = Number(market.resolveDeadline);
    if (chainNowSeconds >= deadline)
      return { action: 'cancelExpired', nextActionAt: chainNowSeconds, terminal: false };
    if (chainNowSeconds > Number(market.closeTime))
      return { action: 'proposeResult', nextActionAt: chainNowSeconds, terminal: false };
    return { action: null, nextActionAt: Number(market.closeTime) + 1, terminal: false };
  }
  if (market.status === 2) {
    const deadline = Number(market.challengeDeadline);
    return chainNowSeconds > deadline
      ? { action: 'finalizeResult', nextActionAt: chainNowSeconds, terminal: false }
      : { action: null, nextActionAt: deadline + 1, terminal: false };
  }
  if (market.status === 3) {
    const deadline = Number(market.disputeDeadline);
    return chainNowSeconds > deadline
      ? { action: 'cancelStaleChallenge', nextActionAt: chainNowSeconds, terminal: false }
      : { action: null, nextActionAt: deadline + 1, terminal: false };
  }
  return { action: null, nextActionAt: null, terminal: true };
}

function marketFromTuple(tuple: MarketTuple): Market {
  return {
    roomId: tuple[0], closeTime: tuple[1], resolveDeadline: tuple[2], claimDeadline: tuple[3],
    challengeDeadline: tuple[4], disputeDeadline: tuple[5], lowerBound: tuple[6], upperBound: tuple[7],
    exactTarget: tuple[8], finalCount: tuple[9], zoneVersion: tuple[10], feeBps: tuple[11], winner: tuple[12],
    status: tuple[13], evidenceHash: tuple[14], zoneConfigHash: tuple[15], challengerEvidenceHash: tuple[16],
    challenger: tuple[17], totalPool: tuple[18], winningPool: tuple[19],
  };
}

export function marketIdRange(startInclusive: bigint, endExclusive: bigint): bigint[] {
  const ids: bigint[] = [];
  for (let marketId = startInclusive; marketId < endExclusive; marketId++) ids.push(marketId);
  return ids;
}

export function schedulerNamespace(chainId: number, contractAddress: `0x${string}`): string {
  return `${chainId}:${contractAddress.toLowerCase()}`;
}

export function hasSettlementLiability(market: Pick<Market, 'status' | 'totalPool'>): boolean {
  // A challenged market also holds the challenger's bond outside totalPool.
  return market.totalPool > 0n || market.status === 3;
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

export function shouldKeepExistingMarket(
  status: number,
  closeTime: number,
  nowSeconds: number,
  supportsRollingMarkets: boolean,
): boolean {
  // Legacy deployments allow the room pointer to advance only after the
  // current betting window closes. Settlement can continue on the old ID.
  if (!supportsRollingMarkets) return status === 1 && closeTime > nowSeconds;
  return status === 1 && closeTime > nowSeconds + NEXT_ROUND_LEAD_SECONDS;
}

export function nextRoundAlarmSeconds(closeTime: number, supportsRollingMarkets: boolean, nowSeconds: number): number {
  return supportsRollingMarkets
    ? closeTime - NEXT_ROUND_LEAD_SECONDS
    : Math.max(closeTime + 1, nowSeconds + RETRY_DELAY_MS / 1_000);
}

async function inspectAutomationContract(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`,
): Promise<{ hasRoomRegistry: boolean; supportsRollingMarkets: boolean }> {
  const code = await publicClient.getCode({ address: contractAddress });
  if (!code || code === '0x') throw new SchedulerConfigurationError(`No contract is deployed at ${contractAddress}`);
  let targetCode = code;
  const normalizedCode = code.toLowerCase();
  if (normalizedCode.includes('608060405260')) {
    try {
      const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
      const implAddressRaw = await publicClient.request({ method: 'eth_getStorageAt', params: [contractAddress, implSlot, 'latest'] }) as `0x${string}`;
      const implAddress = `0x${implAddressRaw.slice(-40)}` as `0x${string}`;
      if (implAddress !== '0x0000000000000000000000000000000000000000') {
        const implCode = await publicClient.getCode({ address: implAddress });
        if (implCode && implCode !== '0x') targetCode = implCode;
      }
    } catch {
      // Fallback to proxy bytecode if storage read fails
    }
  }
  const normalizedTargetCode = targetCode.toLowerCase();
  return {
    hasRoomRegistry: normalizedTargetCode.includes(AUTOMATION_REGISTRY_SELECTOR),
    supportsRollingMarkets: normalizedTargetCode.includes(ROLLING_MARKETS_SELECTOR),
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
    if (Number(roomZone[1]) === 0) return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null,
      resolveDeadline: null, lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: null, staleAfter: serverTime + 30,
      error: 'This room is waiting for its one-time on-chain zone publication', retryable: false,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
    if (marketId === 0n) return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null,
      resolveDeadline: null, lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: null, staleAfter: serverTime + 10,
      error: 'Preparing the first round',
      retryable: true,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
    const [marketResult, underPool, rangePool, overPool, exactPool] = await Promise.all([
      publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [marketId] }),
      ...([1, 2, 3, 4] as const).map(outcome => publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'outcomePools', args: [marketId, outcome] })),
    ]);
    logDebug(env, 'market_read_raw', { roomId, marketId: marketId.toString(), marketResultType: typeof marketResult, marketResultLength: Array.isArray(marketResult) ? marketResult.length : 'n/a' });
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
    logDebug(env, 'read_market_state', { roomId, marketId: marketId.toString(), status, phase, closeTime, serverTime, staleAfter: serverTime + 10 });
    return {
      roomId, roomKey, enabled, serverTime, phase, marketId: marketId.toString(), closeTime,
      resolveDeadline, lowerBound, upperBound, exactTarget, feeBps, totalPoolWei: totalPool.toString(),
      outcomePoolsWei: [underPool.toString(), rangePool.toString(), overPool.toString(), exactPool.toString()],
      nextRoundExpectedAt: phase === 'open' ? closeTime : null, staleAfter: serverTime + 10,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    const configurationError = error instanceof SchedulerConfigurationError;
    if (!configurationError) logError(env, 'market_state_read_failed', { roomId, roomKey, contractAddress: config.contractAddress, error: errorMessage });
    return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
      lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: null, staleAfter: serverTime + 10,
      error: configurationError ? errorMessage : 'Could not synchronize this room with Arbitrum Sepolia', retryable: !configurationError,
      roundDurationSeconds: config.bettingWindowSeconds,
    };
  }
}

/**
 * One instance is intentionally keyed by the MARKET_ROLE account. The EOA nonce
 * is the coordination atom, so all room creation transactions are serialized here.
 */
interface ReconcileResult {
  checked: number;
  created: number;
  skipped: number;
  settled: number;
  indexed: number;
  errors: number;
}

interface TrackedMarketRow {
  [key: string]: string | number | null;
  market_id: string;
  status: number;
  next_action_at: number | null;
  pending_action: SettlementAction | null;
  tx_hash: string | null;
  tx_sent_at: number | null;
}

export class MarketScheduler extends DurableObject<Env> {
  private reconcileInFlight: Promise<ReconcileResult> | null = null;

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
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS tracked_market (
        market_id TEXT PRIMARY KEY,
        room_key TEXT NOT NULL,
        status INTEGER NOT NULL,
        close_time INTEGER NOT NULL,
        resolve_deadline INTEGER NOT NULL,
        challenge_deadline INTEGER NOT NULL,
        dispute_deadline INTEGER NOT NULL,
        next_action_at INTEGER,
        pending_action TEXT,
        tx_hash TEXT,
        tx_sent_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      )`);
      this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS tracked_market_due ON tracked_market(next_action_at,status)');
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS scheduler_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
    });
  }

  async reconcile(): Promise<ReconcileResult> {
    if (this.reconcileInFlight) return this.reconcileInFlight;
    this.reconcileInFlight = this.runReconciliation().finally(() => { this.reconcileInFlight = null; });
    return this.reconcileInFlight;
  }

  private async runReconciliation(): Promise<ReconcileResult> {
    let config: MarketConfig;
    try {
      config = getMarketConfig(this.env);
    } catch (error) {
      logError(this.env, 'market_scheduler_misconfigured', { error: error instanceof Error ? error.message : 'unknown' });
      await this.ctx.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
      return { checked: 0, created: 0, skipped: 0, settled: 0, indexed: 0, errors: 1 };
    }

    logInfo(this.env, 'reconcile_start', { rooms: config.enabledRooms.length, contract: config.contractAddress, rpc: config.rpcUrl });

    const capabilityClient = createPublicClient({ chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 8_000, retryCount: 2 }) });
    let contractCapabilities: { hasRoomRegistry: boolean; supportsRollingMarkets: boolean };
    try {
      contractCapabilities = await inspectAutomationContract(capabilityClient, config.contractAddress);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Contract capability check failed';
      logWarn(this.env, 'market_scheduler_blocked', { contractAddress: config.contractAddress, error: message });
      // RPC and deployment faults must not disable the precise retry path.
      // The Cron Trigger remains an independent watchdog.
      await this.ctx.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
      return { checked: 0, created: 0, skipped: 0, settled: 0, indexed: 0, errors: 1 };
    }
    logDebug(this.env, 'contract_capabilities', { hasRoomRegistry: contractCapabilities.hasRoomRegistry, supportsRollingMarkets: contractCapabilities.supportsRollingMarkets });
    this.ensureSchedulerNamespace(config);

    let created = 0;
    let skipped = 0;
    let settled = 0;
    let indexed = 0;
    let errors = 0;
    let nextAlarm = Number.POSITIVE_INFINITY;
    for (const roomId of config.enabledRooms) {
      try {
        const result = await this.ensureBettingRound(config, roomId);
        logInfo(this.env, 'ensure_result', { roomId, created: result.created, marketId: result.marketId, closeTime: result.closeTime });
        if (result.created) created++;
        if (result.closeTime) {
          nextAlarm = Math.min(nextAlarm, nextRoundAlarmSeconds(
            result.closeTime,
            contractCapabilities.supportsRollingMarkets,
            Math.floor(Date.now() / 1_000),
          ) * 1_000);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown scheduler error';
        this.record(roomId, null, null, null, message);
        if (error instanceof SchedulerConfigurationError) {
          skipped++;
          nextAlarm = Math.min(nextAlarm, Date.now() + CONFIG_RETRY_DELAY_MS);
        } else {
          errors++;
          logError(this.env, 'market_round_reconcile_failed', { roomId, error: message });
          nextAlarm = Math.min(nextAlarm, Date.now() + RETRY_DELAY_MS);
        }
      }
    }

    let chainNowSeconds = Math.floor(Date.now() / 1_000);
    try {
      chainNowSeconds = Number((await capabilityClient.getBlock({ blockTag: 'latest' })).timestamp);
      const backfill = await this.indexOutstandingMarkets(config, capabilityClient, chainNowSeconds);
      indexed = backfill.indexed;
      if (backfill.remaining) nextAlarm = Math.min(nextAlarm, Date.now() + 1_000);
    } catch (error) {
      errors++;
      logError(this.env, 'market_settlement_index_failed', { error: error instanceof Error ? error.message : 'unknown' });
      nextAlarm = Math.min(nextAlarm, Date.now() + RETRY_DELAY_MS);
    }

    try {
      const settlementResult = await this.processDueSettlements(config, capabilityClient, chainNowSeconds);
      settled = settlementResult.settled;
      errors += settlementResult.errors;
    } catch (error) {
      errors++;
      logError(this.env, 'market_settlement_reconcile_failed', { error: error instanceof Error ? error.message : 'unknown' });
      nextAlarm = Math.min(nextAlarm, Date.now() + RETRY_DELAY_MS);
    }
    const nextSettlementAt = this.nextSettlementAt();
    if (nextSettlementAt !== null) {
      const delaySeconds = Math.max(1, nextSettlementAt - chainNowSeconds);
      nextAlarm = Math.min(nextAlarm, Date.now() + delaySeconds * 1_000);
    }

    const existingAlarm = await this.ctx.storage.getAlarm();
    if (existingAlarm !== null && existingAlarm > Date.now()) nextAlarm = Math.min(nextAlarm, existingAlarm);
    logInfo(this.env, 'reconcile_end', {
      created, skipped, settled, indexed, errors,
      nextAlarm: Number.isFinite(nextAlarm) ? new Date(nextAlarm).toISOString() : null,
    });
    if (Number.isFinite(nextAlarm)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, nextAlarm));
    return { checked: config.enabledRooms.length, created, skipped, settled, indexed, errors };
  }

  private meta(key: string): string | null {
    return this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM scheduler_meta WHERE key=?', key).toArray()[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO scheduler_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      value,
    );
  }

  private ensureSchedulerNamespace(config: MarketConfig): void {
    const expected = schedulerNamespace(arbitrumSepolia.id, config.contractAddress);
    const current = this.meta('scheduler_namespace');
    if (current === expected) return;
    if (current !== null) {
      // Market IDs and scan cursors are contract-local. Never reuse them after
      // an address/chain change.
      this.ctx.storage.sql.exec('DELETE FROM tracked_market');
      this.ctx.storage.sql.exec('DELETE FROM room_state');
      this.ctx.storage.sql.exec('DELETE FROM scheduler_meta');
      logWarn(this.env, 'market_scheduler_namespace_reset', { previous: current, next: expected });
    }
    this.setMeta('scheduler_namespace', expected);
  }

  private nextSettlementAt(): number | null {
    return this.ctx.storage.sql.exec<{ next_action_at: number | null }>(
      'SELECT MIN(next_action_at) AS next_action_at FROM tracked_market WHERE next_action_at IS NOT NULL',
    ).toArray()[0]?.next_action_at ?? null;
  }

  private syncTrackedMarket(marketId: bigint, market: Market, chainNowSeconds: number): void {
    const decision = settlementDecision(market, chainNowSeconds);
    if (decision.terminal || (decision.action !== null && !hasSettlementLiability(market))) {
      this.ctx.storage.sql.exec('DELETE FROM tracked_market WHERE market_id=?', marketId.toString());
      return;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO tracked_market(
        market_id,room_key,status,close_time,resolve_deadline,challenge_deadline,dispute_deadline,
        next_action_at,pending_action,tx_hash,tx_sent_at,attempts,last_error,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,0,NULL,?)
      ON CONFLICT(market_id) DO UPDATE SET
        room_key=excluded.room_key,status=excluded.status,close_time=excluded.close_time,
        resolve_deadline=excluded.resolve_deadline,challenge_deadline=excluded.challenge_deadline,
        dispute_deadline=excluded.dispute_deadline,
        next_action_at=CASE
          WHEN tracked_market.status=excluded.status AND tracked_market.tx_hash IS NOT NULL THEN tracked_market.next_action_at
          ELSE excluded.next_action_at
        END,
        pending_action=CASE WHEN tracked_market.status=excluded.status THEN tracked_market.pending_action ELSE NULL END,
        tx_hash=CASE WHEN tracked_market.status=excluded.status THEN tracked_market.tx_hash ELSE NULL END,
        tx_sent_at=CASE WHEN tracked_market.status=excluded.status THEN tracked_market.tx_sent_at ELSE NULL END,
        last_error=CASE WHEN tracked_market.status=excluded.status THEN tracked_market.last_error ELSE NULL END,
        updated_at=excluded.updated_at`,
      marketId.toString(), market.roomId.toLowerCase(), market.status, Number(market.closeTime),
      Number(market.resolveDeadline), Number(market.challengeDeadline), Number(market.disputeDeadline),
      decision.nextActionAt, Date.now(),
    );
  }

  private async readMarket(
    publicClient: ReturnType<typeof createPublicClient>,
    contractAddress: `0x${string}`,
    marketId: bigint,
  ): Promise<Market> {
    const tuple = await publicClient.readContract({
      address: contractAddress,
      abi: trafficMarketAbi,
      functionName: 'getMarket',
      args: [marketId],
    }) as MarketTuple;
    return marketFromTuple(tuple);
  }

  private async scanMarketIds(
    config: MarketConfig,
    publicClient: ReturnType<typeof createPublicClient>,
    marketIds: bigint[],
    chainNowSeconds: number,
  ): Promise<number> {
    if (marketIds.length === 0) return 0;
    const enabledRoomKeys = new Set(config.enabledRooms.map((roomId) => keccak256(toBytes(roomId)).toLowerCase()));
    const results = await publicClient.multicall({
      allowFailure: true,
      contracts: marketIds.map((marketId) => ({
        address: config.contractAddress,
        abi: trafficMarketAbi,
        functionName: 'getMarket' as const,
        args: [marketId] as const,
      })),
    });

    let indexed = 0;
    for (let index = 0; index < marketIds.length; index++) {
      const marketId = marketIds[index];
      const result = results[index];
      let market: Market;
      if (result.status === 'success') {
        market = marketFromTuple(result.result as MarketTuple);
      } else {
        // A transient failure must not create a permanent hole in the cursor.
        market = await this.readMarket(publicClient, config.contractAddress, marketId);
      }
      if (enabledRoomKeys.has(market.roomId.toLowerCase())) this.syncTrackedMarket(marketId, market, chainNowSeconds);
      indexed++;
    }
    return indexed;
  }

  private async indexOutstandingMarkets(
    config: MarketConfig,
    publicClient: ReturnType<typeof createPublicClient>,
    chainNowSeconds: number,
  ): Promise<{ indexed: number; remaining: boolean }> {
    const currentNextMarketId = await publicClient.readContract({
      address: config.contractAddress,
      abi: trafficMarketAbi,
      functionName: 'nextMarketId',
    });
    let indexedHead = BigInt(this.meta('indexed_head') ?? currentNextMarketId.toString());
    let historyBefore = BigInt(this.meta('history_before') ?? currentNextMarketId.toString());
    if (this.meta('indexed_head') === null) this.setMeta('indexed_head', indexedHead.toString());
    if (this.meta('history_before') === null) this.setMeta('history_before', historyBefore.toString());

    let indexed = 0;
    if (indexedHead < currentNextMarketId) {
      const end = indexedHead + MARKET_SCAN_BATCH_SIZE < currentNextMarketId
        ? indexedHead + MARKET_SCAN_BATCH_SIZE
        : currentNextMarketId;
      indexed += await this.scanMarketIds(config, publicClient, marketIdRange(indexedHead, end), chainNowSeconds);
      indexedHead = end;
      this.setMeta('indexed_head', indexedHead.toString());
    }

    if (historyBefore > 1n) {
      const start = historyBefore > MARKET_SCAN_BATCH_SIZE ? historyBefore - MARKET_SCAN_BATCH_SIZE : 1n;
      indexed += await this.scanMarketIds(config, publicClient, marketIdRange(start, historyBefore), chainNowSeconds);
      historyBefore = start;
      this.setMeta('history_before', historyBefore.toString());
    }

    const remaining = indexedHead < currentNextMarketId || historyBefore > 1n;
    logInfo(this.env, 'market_settlement_indexed', { indexed, indexedHead, currentNextMarketId, historyBefore, remaining });
    return { indexed, remaining };
  }

  private scheduleSettlementRetry(marketId: string, chainNowSeconds: number, message: string, clearPending = false): void {
    this.ctx.storage.sql.exec(
      `UPDATE tracked_market SET next_action_at=?,last_error=?,attempts=attempts+1,
       pending_action=CASE WHEN ? THEN NULL ELSE pending_action END,
       tx_hash=CASE WHEN ? THEN NULL ELSE tx_hash END,
       tx_sent_at=CASE WHEN ? THEN NULL ELSE tx_sent_at END,updated_at=? WHERE market_id=?`,
      chainNowSeconds + RETRY_DELAY_MS / 1_000, message, clearPending ? 1 : 0, clearPending ? 1 : 0,
      clearPending ? 1 : 0, Date.now(), marketId,
    );
  }

  private async processDueSettlements(
    config: MarketConfig,
    publicClient: ReturnType<typeof createPublicClient>,
    initialChainNowSeconds: number,
  ): Promise<{ settled: number; errors: number }> {
    const rows = this.ctx.storage.sql.exec<TrackedMarketRow>(
      `SELECT market_id,status,next_action_at,pending_action,tx_hash,tx_sent_at FROM tracked_market
       WHERE next_action_at IS NOT NULL AND next_action_at<=? ORDER BY next_action_at,CAST(market_id AS INTEGER)
       LIMIT ?`,
      initialChainNowSeconds,
      MAX_SETTLEMENT_TXS_PER_RUN,
    ).toArray();
    if (rows.length === 0) return { settled: 0, errors: 0 };

    const account = privateKeyToAccount(getOperatorPrivateKey(this.env));
    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2 }),
    });
    let settled = 0;
    let errors = 0;

    for (const row of rows) {
      const marketId = BigInt(row.market_id);
      let chainNowSeconds = initialChainNowSeconds;
      try {
        chainNowSeconds = Number((await publicClient.getBlock({ blockTag: 'latest' })).timestamp);
        if (row.tx_hash) {
          try {
            const receipt = await publicClient.getTransactionReceipt({ hash: row.tx_hash as Hex });
            if (receipt.status === 'success') {
              const market = await this.readMarket(publicClient, config.contractAddress, marketId);
              this.ctx.storage.sql.exec('UPDATE tracked_market SET tx_hash=NULL, pending_action=NULL, tx_sent_at=NULL WHERE market_id=?', marketId.toString());
              this.syncTrackedMarket(marketId, market, chainNowSeconds);
              settled++;
              logInfo(this.env, 'market_settlement_confirmed', { marketId, action: row.pending_action, txHash: row.tx_hash });
              continue;
            }
            this.scheduleSettlementRetry(marketId.toString(), chainNowSeconds, `Settlement transaction reverted: ${row.tx_hash}`, true);
            errors++;
            continue;
          } catch (receiptError) {
            const market = await this.readMarket(publicClient, config.contractAddress, marketId);
            const freshDecision = settlementDecision(market, chainNowSeconds);
            if (freshDecision.terminal || freshDecision.action !== row.pending_action) {
              this.syncTrackedMarket(marketId, market, chainNowSeconds);
              settled++;
              continue;
            }
            if (row.tx_sent_at !== null && chainNowSeconds - row.tx_sent_at < PENDING_TX_GRACE_SECONDS) {
              this.scheduleSettlementRetry(
                marketId.toString(),
                chainNowSeconds,
                receiptError instanceof Error ? receiptError.message : 'Settlement receipt is not indexed yet',
              );
              continue;
            }
            this.scheduleSettlementRetry(marketId.toString(), chainNowSeconds, 'Settlement transaction was dropped; retrying', true);
            continue;
          }
        }

        const market = await this.readMarket(publicClient, config.contractAddress, marketId);
        this.syncTrackedMarket(marketId, market, chainNowSeconds);
        const decision = settlementDecision(market, chainNowSeconds);
        if (decision.terminal || decision.action === null) continue;
        if (!hasSettlementLiability(market)) {
          // Keep zero-pool Open/Proposed markets indexed until their deadline
          // so late bets and challenge bonds cannot be missed. Once the action
          // is due and there is still no liability, no gas-funded tx is needed.
          this.ctx.storage.sql.exec('DELETE FROM tracked_market WHERE market_id=?', marketId.toString());
          continue;
        }

        let txHash: Hex;
        if (decision.action === 'proposeResult') {
          const plainRoomId = config.enabledRooms.find((r) => keccak256(toBytes(r)).toLowerCase() === market.roomId.toLowerCase());
          if (!plainRoomId) {
            this.scheduleSettlementRetry(marketId.toString(), chainNowSeconds, 'Room mapping missing for manifest lookup');
            errors++;
            continue;
          }
          const manifestRow = await this.env.DB.prepare(
            'SELECT payload, manifest_sha256 FROM inference_manifests WHERE room_id=? ORDER BY created_at DESC LIMIT 1'
          ).bind(plainRoomId).first<{ payload: string; manifest_sha256: string }>();
          if (!manifestRow) {
            this.ctx.storage.sql.exec(
              'UPDATE tracked_market SET next_action_at=?,updated_at=? WHERE market_id=?',
              chainNowSeconds + 60, Date.now(), marketId.toString(),
            );
            continue;
          }
          let manifest: { finalVehicleCount?: number; zone?: { configHash?: string } };
          try { manifest = JSON.parse(manifestRow.payload); } catch { manifest = {}; }
          const finalCount = Number(manifest.finalVehicleCount ?? 0);
          const evidenceHash = `0x${manifestRow.manifest_sha256}` as `0x${string}`;
          if (finalCount < 0) {
            this.scheduleSettlementRetry(marketId.toString(), chainNowSeconds, 'Manifest final count is invalid');
            errors++;
            continue;
          }
          const simulation = await publicClient.simulateContract({
            account,
            address: config.contractAddress,
            abi: trafficMarketAbi,
            functionName: 'proposeResult',
            args: [marketId, finalCount, evidenceHash, market.zoneConfigHash],
          });
          const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
          txHash = await walletClient.writeContract({ ...simulation.request, nonce });
        } else {
          const simulation = await publicClient.simulateContract({
            account,
            address: config.contractAddress,
            abi: trafficMarketAbi,
            functionName: decision.action,
            args: [marketId],
          });
          const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
          txHash = await walletClient.writeContract({ ...simulation.request, nonce });
        }
        this.ctx.storage.sql.exec(
          `UPDATE tracked_market SET pending_action=?,tx_hash=?,tx_sent_at=?,next_action_at=?,
           last_error=NULL,attempts=attempts+1,updated_at=? WHERE market_id=?`,
          decision.action, txHash, chainNowSeconds, chainNowSeconds + RETRY_DELAY_MS / 1_000, Date.now(), marketId.toString(),
        );
        logInfo(this.env, 'market_settlement_tx_sent', { marketId, action: decision.action, txHash });
        // Do not block this singleton on receipts: it must remain available to
        // create the next room rounds. The persisted hash is reconciled by the
        // next alarm/Cron invocation.
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown settlement error';
        this.scheduleSettlementRetry(marketId.toString(), chainNowSeconds, message);
        errors++;
        logError(this.env, 'market_settlement_failed', { marketId, error: message });
      }
    }
    return { settled, errors };
  }

  private async ensureBettingRound(config: MarketConfig, roomId: string): Promise<{ created: boolean; marketId: string; closeTime: number }> {
    const operatorPrivateKey = getOperatorPrivateKey(this.env);
    const account = privateKeyToAccount(operatorPrivateKey);
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
    const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
    const roomKey = keccak256(toBytes(roomId));
    const capabilities = await inspectAutomationContract(publicClient, config.contractAddress);
    logInfo(this.env, 'ensure_start', { roomId, roomKey, operator: account.address, capabilities });

    let authorizedOperator: Hex;
    // First verify contract connectivity with a simpler call
    let nextMarketId: bigint;
    let contractMinimumBettingPeriod: bigint;
    try {
      [nextMarketId, contractMinimumBettingPeriod] = await Promise.all([
        publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'nextMarketId' }),
        publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'MIN_BETTING_PERIOD' }),
      ]);
      logDebug(this.env, 'contract_connectivity_ok', { roomId, nextMarketId: nextMarketId.toString(), minBettingPeriod: contractMinimumBettingPeriod.toString() });
    } catch (connectivityError) {
      const connectivityErrorMsg = connectivityError instanceof Error ? connectivityError.message : 'unknown';
      logError(this.env, 'contract_connectivity_failed', {
        roomId,
        contractAddress: config.contractAddress,
        error: connectivityErrorMsg
      });
      throw new Error(`Cannot reach contract at ${config.contractAddress}: ${connectivityErrorMsg}`);
    }

    try {
      authorizedOperator = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'roleAccount', args: [MARKET_ROLE] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown';
      logError(this.env, 'contract_read_failed', {
        roomId,
        roomKey,
        contractAddress: config.contractAddress,
        operatorAddress: account.address,
        error: errorMessage,
        nextMarketId: nextMarketId.toString(),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Failed to read contract state for room ${roomId}: ${errorMessage}`);
    }
    if (authorizedOperator.toLowerCase() !== account.address.toLowerCase()) throw new Error(`Configured MARKET_ROLE is ${authorizedOperator}, not the automation signer ${account.address}`);

    const roomZone = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'roomZones', args: [roomKey] });
    logDebug(this.env, 'room_zone_raw', { roomId, roomKey, roomZoneLength: Array.isArray(roomZone) ? roomZone.length : 'not_array', roomZone });
    const zoneVersion = Number(roomZone[1]);
    if (zoneVersion === 0) {
      logWarn(this.env, 'no_zone_published', { roomId, zoneVersion });
      throw new SchedulerConfigurationError(`On-chain detection zone is missing for ${roomId}. Publish the saved zone from /admin/zones before enabling automated rounds.`);
    }
    logDebug(this.env, 'zone_published', { roomId, zoneVersion });

    const latestMarketId = await findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry);
    logDebug(this.env, 'latest_market_id', { roomId, latestMarketId: latestMarketId.toString(), hasRoomRegistry: capabilities.hasRoomRegistry });
    if (latestMarketId > 0n) {
      try {
        const marketTuple = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [latestMarketId] }) as readonly [
          `0x${string}`, bigint, bigint, bigint, bigint, bigint,
          number, number, number, number, number, number, number,
          number, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
          bigint, bigint
        ];
        this.syncTrackedMarket(latestMarketId, marketFromTuple(marketTuple), Math.floor(Date.now() / 1_000));
        logDebug(this.env, 'market_tuple_raw', { roomId, marketId: latestMarketId.toString(), tupleLength: marketTuple.length, roomIdFromTuple: marketTuple[0], status: marketTuple[13], closeTime: marketTuple[1] });
        const roomKeyFromMarket = marketTuple[0] as `0x${string}`;
        const status = marketTuple[13] as number;
        const closeTime = Number(marketTuple[1]);
        logDebug(this.env, 'existing_market_check', { roomId, marketId: latestMarketId.toString(), status, closeTime, roomKeyMatch: roomKeyFromMarket.toLowerCase() === roomKey.toLowerCase() });
        if (roomKeyFromMarket.toLowerCase() === roomKey.toLowerCase()) {
          if (shouldKeepExistingMarket(status, closeTime, Math.floor(Date.now() / 1_000), capabilities.supportsRollingMarkets)) {
            this.record(roomId, latestMarketId.toString(), closeTime, null, null);
            logInfo(this.env, 'existing_market_active', { roomId, marketId: latestMarketId.toString(), status, closeTime });
            return { created: false, marketId: latestMarketId.toString(), closeTime };
          }
          logInfo(this.env, 'existing_market_terminal', { roomId, marketId: latestMarketId.toString(), status });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        logWarn(this.env, 'existing_market_read_failed', { roomId, marketId: latestMarketId.toString(), error: message });
        // A failed read or log must never be interpreted as permission to
        // create a duplicate. Reconciliation will retry this room safely.
        throw new Error(`Could not verify market ${latestMarketId} for ${roomId}: ${message}`);
      }
    }

    const pending = this.ctx.storage.sql.exec<{ tx_hash: string; close_time: number; updated_at: number }>(
      'SELECT tx_hash,close_time,updated_at FROM room_state WHERE room_id=? AND market_id IS NULL AND tx_hash IS NOT NULL', roomId,
    ).toArray()[0];
    logDebug(this.env, 'pending_tx_check', { roomId, hasPending: Boolean(pending), pendingAge: pending ? Date.now() - pending.updated_at : null });
    if (pending && Date.now() - pending.updated_at < 120_000) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: pending.tx_hash as Hex });
        if (receipt.status === 'success') {
          const confirmedId = await findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry);
          if (confirmedId !== 0n) {
            this.record(roomId, confirmedId.toString(), pending.close_time, pending.tx_hash, null);
            logInfo(this.env, 'pending_tx_confirmed', { roomId, txHash: pending.tx_hash, confirmedId: confirmedId.toString() });
            return { created: false, marketId: confirmedId.toString(), closeTime: pending.close_time };
          }
            logInfo(this.env, 'pending_tx_success_but_no_market', { roomId, txHash: pending.tx_hash });
        } else {
          logWarn(this.env, 'pending_tx_reverted', { roomId, txHash: pending.tx_hash, receiptStatus: receipt.status });
        }
      } catch (err) {
        logDebug(this.env, 'pending_tx_still_pending', { roomId, txHash: pending.tx_hash, error: err instanceof Error ? err.message : 'unknown' });
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
    logInfo(this.env, 'create_market_plan', { roomId, now, effectiveBettingWindow, closeTime, resolveDeadline, minPeriod: contractMinimumBettingPeriod.toString() });
    const simulation = await publicClient.simulateContract({
      account,
      address: config.contractAddress,
      abi: trafficMarketAbi,
      functionName: 'createMarket',
      args: [roomKey, BigInt(closeTime), BigInt(resolveDeadline), config.lowerBound, config.upperBound, config.exactTarget, config.feeBps],
    });
    logDebug(this.env, 'create_market_simulation_success', {
      roomId,
      closeTime,
      resolveDeadline,
      lowerBound: config.lowerBound,
      upperBound: config.upperBound,
      exactTarget: config.exactTarget,
      feeBps: config.feeBps
    });
    const MAX_NONCE_RETRIES = 4;
    let txHash: Hex | undefined;
    for (let nonceRetry = 0; nonceRetry < MAX_NONCE_RETRIES; nonceRetry++) {
      try {
        const currentNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
        txHash = await walletClient.writeContract({
          ...simulation.request,
          nonce: currentNonce,
        });
        break;
      } catch (writeError) {
        const message = writeError instanceof Error ? writeError.message : 'unknown';
        const nonceTooLow = /nonce too low|nonce is lower than the current nonce/i.test(message) || /nonce provided.*lower than the current nonce/i.test(message);
        const activeExists = /ActiveMarketExists/i.test(message);
        if (activeExists) {
          logWarn(this.env, 'market_already_exists', { roomId, error: message });
          const confirmedId = await findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry);
          if (confirmedId !== 0n) {
            const createdMarket = await this.readMarket(publicClient, config.contractAddress, confirmedId);
            this.syncTrackedMarket(confirmedId, createdMarket, Math.floor(Date.now() / 1_000));
            this.record(roomId, confirmedId.toString(), Number(createdMarket.closeTime), null, null);
            return { created: false, marketId: confirmedId.toString(), closeTime: Number(createdMarket.closeTime) };
          }
        }
        if (nonceTooLow && nonceRetry < MAX_NONCE_RETRIES - 1) {
          logWarn(this.env, 'nonce_too_low_retry', { roomId, attempt: nonceRetry + 1, error: message });
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        throw writeError;
      }
    }
    if (!txHash) throw new Error(`Failed to send market creation transaction for ${roomId} after ${MAX_NONCE_RETRIES} nonce retries`);
    logInfo(this.env, 'create_market_tx_sent', { roomId, txHash });
    this.record(roomId, null, closeTime, txHash, null);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 45_000 });
    if (receipt.status !== 'success') {
      logError(this.env, 'tx_reverted', { roomId, txHash, receipt });
      throw new Error(`Market creation reverted: ${txHash}`);
    }
    const marketId = await findLatestMarketId(publicClient, config.contractAddress, roomKey, capabilities.hasRoomRegistry);
    if (marketId === 0n) {
      logError(this.env, 'market_pointer_not_updated', {
        roomId,
        roomKey,
        txHash,
        contractAddress: config.contractAddress,
        message: 'Transaction succeeded but contract state not updated'
      });
      throw new Error(`Market creation confirmed without updating the room pointer: ${txHash}`);
    }
    this.record(roomId, marketId.toString(), closeTime, txHash, null);
    const createdMarket = await this.readMarket(publicClient, config.contractAddress, marketId);
    this.syncTrackedMarket(marketId, createdMarket, Math.floor(Date.now() / 1_000));
    logInfo(this.env, 'market_round_created', { roomId, marketId: marketId.toString(), closeTime, txHash });
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
    logInfo(this.env, 'scheduler_alarm_triggered');
    try {
      await this.reconcile();
    } catch (error) {
      logError(this.env, 'market_scheduler_alarm_failed', { error: error instanceof Error ? error.message : 'unknown' });
      await this.ctx.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
    }
  }
}
