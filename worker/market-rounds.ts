import { DurableObject } from 'cloudflare:workers';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  toBytes,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

const MARKET_ROLE = keccak256(toBytes('MARKET_ROLE'));
const RETRY_DELAY_MS = 30_000;
const UINT32_MAX = 4_294_967_295;

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
  { type: 'function', name: 'roomZones', stateMutability: 'view', inputs: [{ name: 'roomId', type: 'bytes32' }], outputs: [
    { name: '', type: 'uint16[8]' }, { name: 'version', type: 'uint32' }, { name: 'configHash', type: 'bytes32' }
  ] },
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
  error?: string;
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
    bettingWindowSeconds: boundedInteger(env.MARKET_BETTING_WINDOW_SECONDS, 'betting window', 60, 86_400),
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
    };
  }
  const enabled = config.enabledRooms.includes(roomId);
  if (!enabled) return {
    roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
    lowerBound: null, upperBound: null, exactTarget: null, feeBps: null, totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'],
    nextRoundExpectedAt: null, staleAfter: serverTime + 10, error: 'Continuous rounds are not enabled for this room yet',
  };

  try {
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 8_000, retryCount: 2 }) });
    const marketId = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'latestMarketIdByRoom', args: [roomKey] });
    if (marketId === 0n) return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
      lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: serverTime + 30, staleAfter: serverTime + 10,
      error: 'Preparing the first round',
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
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    console.error(JSON.stringify({ event: 'market_state_read_failed', roomId, roomKey, contractAddress: config.contractAddress, error: errorMessage, stack: error instanceof Error ? error.stack : undefined }));
    return {
      roomId, roomKey, enabled, serverTime, phase: 'unavailable', marketId: null, closeTime: null, resolveDeadline: null,
      lowerBound: config.lowerBound, upperBound: config.upperBound, exactTarget: config.exactTarget, feeBps: config.feeBps,
      totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'], nextRoundExpectedAt: serverTime + 30, staleAfter: serverTime + 10,
      error: 'Could not synchronize this room with Arbitrum Sepolia',
    };
  }
}

/**
 * One instance is intentionally keyed by the MARKET_ROLE account. The EOA nonce
 * is the coordination atom, so all room creation transactions are serialized here.
 */
export class MarketScheduler extends DurableObject<Env> {
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

  async reconcile(): Promise<{ checked: number; created: number; errors: number }> {
    let config: MarketConfig;
    try {
      config = getMarketConfig(this.env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'market_scheduler_misconfigured', error: error instanceof Error ? error.message : 'unknown' }));
      await this.ctx.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
      return { checked: 0, created: 0, errors: 1 };
    }

    let created = 0;
    let errors = 0;
    let nextAlarm = Number.POSITIVE_INFINITY;
    for (const roomId of config.enabledRooms) {
      try {
        const result = await this.ensureBettingRound(config, roomId);
        if (result.created) created++;
        if (result.closeTime) nextAlarm = Math.min(nextAlarm, result.closeTime * 1_000 + 1_000);
      } catch (error) {
        errors++;
        const message = error instanceof Error ? error.message : 'Unknown scheduler error';
        this.record(roomId, null, null, null, message);
        console.error(JSON.stringify({ event: 'market_round_reconcile_failed', roomId, error: message }));
        nextAlarm = Math.min(nextAlarm, Date.now() + RETRY_DELAY_MS);
      }
    }
    if (Number.isFinite(nextAlarm)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, nextAlarm));
    return { checked: config.enabledRooms.length, created, errors };
  }

  private async ensureBettingRound(config: MarketConfig, roomId: string): Promise<{ created: boolean; marketId: string; closeTime: number }> {
    const operatorPrivateKey = getOperatorPrivateKey(this.env);
    const account = privateKeyToAccount(operatorPrivateKey);
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
    const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
    const roomKey = keccak256(toBytes(roomId));

    let authorizedOperator: Hex;
    let latestMarketId: bigint;

    // First verify contract connectivity with a simpler call
    let nextMarketId: bigint;
    try {
      nextMarketId = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'nextMarketId' });
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

    let latestMarketId: bigint = 0n;
    if (nextMarketId > 1n) {
      const candidateId = nextMarketId - 1n;
      try {
        const marketTuple = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [candidateId] }) as readonly [
          `0x${string}`, bigint, bigint, bigint, bigint, bigint,
          number, number, number, number, number, number, number,
          number, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
          bigint, bigint
        ];
        const roomKeyFromMarket = marketTuple[0] as `0x${string}`;
        if (roomKeyFromMarket.toLowerCase() === roomKey.toLowerCase()) {
          latestMarketId = candidateId;
          const closeTime = Number(marketTuple[1]);
          const status = marketTuple[13] as number;
          if (status === 1 && closeTime > Math.floor(Date.now() / 1_000)) {
            this.record(roomId, latestMarketId.toString(), closeTime, null, null);
            return { created: false, marketId: latestMarketId.toString(), closeTime };
          }
        }
      } catch {
        // Candidate market does not belong to this room or does not exist; continue to create.
      }
    }

    const pending = this.ctx.storage.sql.exec<{ tx_hash: string; close_time: number; updated_at: number }>(
      'SELECT tx_hash,close_time,updated_at FROM room_state WHERE room_id=? AND market_id IS NULL AND tx_hash IS NOT NULL', roomId,
    ).toArray()[0];
    if (pending && Date.now() - pending.updated_at < 120_000) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: pending.tx_hash as Hex });
        if (receipt.status === 'success') {
          const confirmedId = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'latestMarketIdByRoom', args: [roomKey] });
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
    const closeTime = now + config.bettingWindowSeconds;
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
    const txHash = await walletClient.writeContract(simulation.request);
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
    const marketId = await publicClient.readContract({ address: config.contractAddress, abi: trafficMarketAbi, functionName: 'latestMarketIdByRoom', args: [roomKey] });
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