import { TransactionStatus, type TransactionState } from '@/components/transaction-status';
import { formatEthUsd } from '@/lib/eth-usd';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import {
  claimableMarketIds,
  nextPositionRefreshDelayMs,
  orderedUniqueMarketIds,
  playerPositionLabel,
  summarizePlayerPosition,
  type PlayerPositionAction,
  type PlayerPositionLifecycle,
} from '@/lib/player-position';
import { useEthUsdPrice } from '@/lib/use-eth-usd-price';
import { CheckCircle2, Coins, Loader2, RefreshCw, RotateCcw, ShieldAlert, Timer, WalletCards } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatEther, parseAbiItem } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';

const POSITION_OPENED_EVENT = parseAbiItem('event PositionOpened(uint256 indexed marketId, address indexed account, uint8 indexed outcome, uint256 amount)');

interface PlayerPosition {
  marketId: bigint;
  status: number;
  finalCount: number;
  stake: bigint;
  payout: bigint;
  profit: bigint;
  lifecycle: PlayerPositionLifecycle;
  action: PlayerPositionAction;
  nextTransitionAt: number | null;
}

function displayEth(value: bigint): string {
  const exact = formatEther(value);
  const [whole, fraction = ''] = exact.split('.');
  const visibleFraction = fraction.slice(0, 8).replace(/0+$/, '');
  if (visibleFraction) return `${whole}.${visibleFraction}`;
  if (value > 0n && whole === '0') return '<0.00000001';
  return whole;
}

function lifecycleActionLabel(action: PlayerPositionAction): string {
  if (action === 'claim') return 'Claim to wallet';
  if (action === 'cancel_expired') return 'Unlock refund';
  if (action === 'finalize') return 'Finalize result';
  return '';
}

function lifecycleStateLabel(lifecycle: PlayerPositionLifecycle): string {
  if (lifecycle === 'claimed') return 'Claimed';
  if (lifecycle === 'lost') return 'Lost';
  if (lifecycle === 'challenged') return 'Challenged';
  return 'Pending';
}

export function PlayerClaims() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const { writeContractAsync } = useWriteContract();
  const ethUsdPrice = useEthUsdPrice();
  const [positions, setPositions] = useState<PlayerPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<{ marketId: bigint; action: PlayerPositionAction } | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [hash, setHash] = useState<`0x${string}`>();
  const [txState, setTxState] = useState<TransactionState>();
  const [confirmedText, setConfirmedText] = useState('Winnings sent to your wallet.');
  const [error, setError] = useState('');
  const scanVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const scanVersion = ++scanVersionRef.current;
    if (!address || !publicClient) { setPositions([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [logs, rawMultipliers] = await Promise.all([
        publicClient.getLogs({ address: marketContractAddress, event: POSITION_OPENED_EVENT, args: { account: address }, fromBlock: 0n, toBlock: 'latest' }),
        Promise.all(([1, 2, 3, 4] as const).map((outcome) => publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'multiplierBps', args: [outcome] }))),
      ]);
      const multiplierBps = rawMultipliers.map((value) => BigInt(value)) as [bigint, bigint, bigint, bigint];
      const marketIds = orderedUniqueMarketIds(logs.map((log) => log.args.marketId));
      const rows: PlayerPosition[] = [];
      const nowSeconds = Math.floor(Date.now() / 1_000);

      // Keep every position discoverable while limiting concurrent RPC pressure.
      for (let offset = 0; offset < marketIds.length; offset += 10) {
        const batch = await Promise.all(marketIds.slice(offset, offset + 10).map(async (marketId) => {
          const [market, alreadyClaimed, under, range, over, exact] = await Promise.all([
            publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [marketId] }),
            publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claimed', args: [marketId, address] }),
            ...([1, 2, 3, 4] as const).map((outcome) => publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'positions', args: [marketId, address, outcome] })),
          ]);
          const data = market as {
            status: number;
            winner: number;
            finalCount: number;
            closeTime: bigint;
            resolveDeadline: bigint;
            challengeDeadline: bigint;
            disputeDeadline: bigint;
          };
          const stakes = [under, range, over, exact] as [bigint, bigint, bigint, bigint];
          const summary = summarizePlayerPosition({
            status: data.status,
            winner: data.winner,
            closeTime: Number(data.closeTime),
            resolveDeadline: Number(data.resolveDeadline),
            challengeDeadline: Number(data.challengeDeadline),
            disputeDeadline: Number(data.disputeDeadline),
            stakes,
            multiplierBps,
            claimed: alreadyClaimed,
            nowSeconds,
          });
          return { marketId, status: data.status, finalCount: data.finalCount, ...summary };
        }));
        rows.push(...batch.filter((row) => row.stake > 0n));
      }
      if (scanVersion === scanVersionRef.current) setPositions(rows);
    } catch (cause) {
      if (scanVersion === scanVersionRef.current) setError(cause instanceof Error ? cause.message : 'Could not load wallet positions');
    } finally { if (scanVersion === scanVersionRef.current) setLoading(false); }
  }, [address, publicClient]);

  useEffect(() => {
    setPositions([]);
    setTxState(undefined);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!address || !publicClient || loading) return;
    const delay = nextPositionRefreshDelayMs(positions, Date.now());
    if (delay === null) return;
    const timeout = window.setTimeout(() => { void refresh(); }, delay);
    return () => window.clearTimeout(timeout);
  }, [address, loading, positions, publicClient, refresh]);

  async function submit(position: PlayerPosition) {
    if (!publicClient || !address || !position.action) return;
    setSubmitting({ marketId: position.marketId, action: position.action });
    setError('');
    setTxState('AWAITING_SIGNATURE');
    try {
      let transactionHash: `0x${string}`;
      if (position.action === 'claim') {
        await publicClient.simulateContract({ account: address, address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claim', args: [position.marketId] });
        transactionHash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claim', args: [position.marketId], chainId: arbitrumSepolia.id });
        setConfirmedText('Winnings sent directly to your wallet.');
      } else if (position.action === 'cancel_expired') {
        await publicClient.simulateContract({ account: address, address: marketContractAddress, abi: trafficMarketAbi, functionName: 'cancelExpired', args: [position.marketId] });
        transactionHash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'cancelExpired', args: [position.marketId], chainId: arbitrumSepolia.id });
        setConfirmedText('Refund unlocked. It is now ready to claim.');
      } else {
        await publicClient.simulateContract({ account: address, address: marketContractAddress, abi: trafficMarketAbi, functionName: 'finalizeResult', args: [position.marketId] });
        transactionHash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'finalizeResult', args: [position.marketId], chainId: arbitrumSepolia.id });
        setConfirmedText('Round finalized. Your claim status is updated.');
      }
      setHash(transactionHash);
      setTxState('PENDING');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
      setTxState(receipt.status === 'success' ? 'CONFIRMED' : 'FAILED');
      if (receipt.status === 'success') await refresh();
    } catch (cause) {
      setTxState('FAILED');
      setError(cause instanceof Error && cause.message.toLowerCase().includes('user rejected')
        ? 'Transaction cancelled in wallet.'
        : 'The contract action failed. Refresh the position and try again.');
    } finally { setSubmitting(null); }
  }

  async function claimAll() {
    if (!publicClient || !address) return;
    const candidates = claimableMarketIds(positions);
    console.log('[PlayerClaims] claimAll called', { candidates: candidates.map(String), wallet: address });
    if (candidates.length === 0) {
      console.warn('[PlayerClaims] claimAll aborted — zero candidates from frontend state');
      return;
    }
    setClaimingAll(true);
    setError('');
    setHash(undefined);
    setTxState('AWAITING_SIGNATURE');
    try {
      // Re-verify every market on-chain before the batch — if any single market is not
      // claimable (already claimed, wrong status, zero stake) the entire batch reverts.
      const verified: bigint[] = [];
      for (const marketId of candidates) {
        const [market, alreadyClaimed] = await Promise.all([
          publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [marketId] }),
          publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claimed', args: [marketId, address] }),
        ]);
        const data = market as { status: number };
        const wasClaimed = alreadyClaimed as boolean;
        console.log(`[PlayerClaims] market #${marketId} on-chain check → status=${data.status} (need 4|5), claimed=${wasClaimed}`);
        if (data.status !== 4 && data.status !== 5) {
          console.warn(`[PlayerClaims] market #${marketId} SKIPPED — status is ${data.status}, not Resolved(4) nor Cancelled(5)`);
          continue;
        }
        if (wasClaimed) {
          console.warn(`[PlayerClaims] market #${marketId} SKIPPED — already claimed on-chain`);
          continue;
        }
        verified.push(marketId);
        console.log(`[PlayerClaims] market #${marketId} VERIFIED — ready for batch claim`);
      }
      console.log(`[PlayerClaims] verification complete — ${verified.length}/${candidates.length} markets will be sent`, { verified: verified.map(String) });
      if (verified.length === 0) {
        setError('No claimable positions left — the list may be stale. Refresh and retry.');
        setTxState('FAILED');
        setClaimingAll(false);
        return;
      }
      console.log('[PlayerClaims] simulating claimAll on-chain...', { batch: verified.map(String) });
      await publicClient.simulateContract({ account: address, address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claimAll', args: [verified] });
      console.log('[PlayerClaims] simulation passed — requesting wallet signature');
      const transactionHash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claimAll', args: [verified], chainId: arbitrumSepolia.id });
      console.log('[PlayerClaims] transaction sent', { tx: transactionHash });
      setHash(transactionHash);
      setTxState('PENDING');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
      console.log('[PlayerClaims] receipt received', { status: receipt.status, gasUsed: receipt.gasUsed?.toString() });
      setTxState(receipt.status === 'success' ? 'CONFIRMED' : 'FAILED');
      if (receipt.status === 'success') {
        setConfirmedText(`${verified.length} ${verified.length === 1 ? 'claim was' : 'claims were'} paid directly to your wallet.`);
        await refresh();
      }
    } catch (cause) {
      console.error('[PlayerClaims] claimAll failed:', cause);
      setTxState('FAILED');
      setError(cause instanceof Error && cause.message.toLowerCase().includes('user rejected')
        ? 'Claim all was cancelled in the wallet.'
        : 'Claim all could not be completed. Refresh the positions and retry.');
    } finally {
      setClaimingAll(false);
    }
  }

  if (!isConnected) return <section className="player-claims"><header><WalletCards /><div><h2>Winnings</h2><p>Connect your wallet to find every on-chain position.</p></div></header></section>;

  const totalNetProfit = positions.filter((p) => ['claimable', 'claimed', 'lost'].includes(p.lifecycle)).reduce((sum, p) => sum + p.profit, 0n);
  const netProfitAbs = totalNetProfit < 0n ? -totalNetProfit : totalNetProfit;
  const netProfitDisplay = `${totalNetProfit < 0n ? '-' : totalNetProfit > 0n ? '+' : ''}${displayEth(netProfitAbs)} ETH`;
  const netProfitClass = totalNetProfit > 0n ? 'net-profit-win' : totalNetProfit < 0n ? 'net-profit-loss' : 'net-profit-refund';
  const netProfitEth = formatEther(totalNetProfit);
  const netProfitUsd = typeof ethUsdPrice === 'number' ? formatEthUsd(netProfitEth.startsWith('-') ? netProfitEth.slice(1) : netProfitEth, ethUsdPrice) : null;

  const available = positions.filter((position) => position.lifecycle === 'claimable').reduce((sum, position) => sum + position.payout, 0n);
  const claimableCount = claimableMarketIds(positions).length;
  const availableEth = formatEther(available);
  const availableUsd = typeof ethUsdPrice === 'number' ? formatEthUsd(availableEth, ethUsdPrice) : null;
  const unresolved = positions.filter((position) => ['betting', 'awaiting_result', 'refund_recovery', 'proposed', 'finalizable', 'challenged'].includes(position.lifecycle)).length;

  return <section className="player-claims">
    <div className="winnings-dashboard">
      <div className="dashboard-metrics">
        <div className="metric-box">
          <span>Total Winnings (Net)</span>
          <strong className={netProfitClass}>{netProfitDisplay}</strong>
          <small>{netProfitUsd ? `≈ ${totalNetProfit < 0n ? '-' : ''}${netProfitUsd} USD` : 'Updating USD value…'}</small>
        </div>
        <div className="metric-box">
          <span>Withdrawable Balance</span>
          <strong className="withdrawable-balance-val">{displayEth(available)} ETH</strong>
          <small>{availableUsd ? `≈ ${availableUsd} USD` : unresolved > 0 ? `${unresolved} position${unresolved === 1 ? '' : 's'} pending` : 'No pending settlement'}</small>
        </div>
      </div>
      <div className="dashboard-actions">
        <button className="claims-refresh" disabled={loading || claimingAll} onClick={() => void refresh()}><RefreshCw className={loading ? 'is-spinning' : ''} /> Refresh positions</button>
        <button className="withdraw-primary-btn" disabled={loading || claimingAll || claimableCount === 0 || submitting !== null} onClick={() => void claimAll()}><Coins /> {claimingAll ? 'Withdrawing…' : `Withdraw (${claimableCount})`}</button>
      </div>
    </div>
    {chainId !== arbitrumSepolia.id
      ? <p className="claims-empty">Switch to Arbitrum Sepolia to manage these positions.</p>
      : loading && positions.length === 0
        ? <p className="claims-empty"><Loader2 className="is-spinning" /> Scanning every on-chain position…</p>
        : positions.length === 0 && !error
          ? <p className="claims-empty">No on-chain positions were found for this wallet.</p>
          : <div className="claims-list">{positions.map((position) => <article key={position.marketId.toString()} data-state={position.lifecycle}>
            <span>{position.lifecycle === 'claimed' ? <CheckCircle2 /> : position.lifecycle === 'refund_recovery' ? <RotateCcw /> : position.lifecycle === 'lost' ? <ShieldAlert /> : position.lifecycle === 'claimable' ? <Coins /> : <Timer />}<span><b>Round #{position.marketId.toString()}</b><small>{playerPositionLabel(position.lifecycle, position.finalCount, position.status)}</small></span></span>
            <strong>
              {position.lifecycle === 'claimable' || position.lifecycle === 'claimed' ? (
                position.payout > position.stake ? (
                  <>
                    <span className="net-profit-win">+{displayEth(position.payout - position.stake)} ETH</span>
                    <small className="gross-details">won (gross {displayEth(position.payout)})</small>
                  </>
                ) : position.payout === position.stake ? (
                  <>
                    <span className="net-profit-refund">0.00 ETH</span>
                    <small className="gross-details">refund (gross {displayEth(position.payout)})</small>
                  </>
                ) : (
                  <>
                    <span className="net-profit-loss">-{displayEth(position.stake - position.payout)} ETH</span>
                    <small className="gross-details">loss (gross {displayEth(position.payout)})</small>
                  </>
                )
              ) : position.lifecycle === 'lost' ? (
                <>
                  <span className="net-profit-loss">-{displayEth(position.stake)} ETH</span>
                  <small>lost</small>
                </>
              ) : (
                <>
                  <span>{displayEth(position.stake)} ETH</span>
                  <small>stake at risk</small>
                </>
              )}
            </strong>
            {position.action && position.action !== 'claim'
              ? <button disabled={submitting !== null} onClick={() => void submit(position)}>{submitting?.marketId === position.marketId ? 'Confirming…' : lifecycleActionLabel(position.action)}</button>
              : <i className={`claim-state ${position.lifecycle === 'claimable' ? 'claimable' : position.lifecycle}`}>{position.lifecycle === 'claimable' ? 'Ready to withdraw' : lifecycleStateLabel(position.lifecycle)}</i>}
          </article>)}</div>}
    {txState && <TransactionStatus state={txState} hash={hash} confirmedText={confirmedText} />}
    {error && <p className="contract-error" role="alert">Position scan: {error}</p>}
  </section>;
}