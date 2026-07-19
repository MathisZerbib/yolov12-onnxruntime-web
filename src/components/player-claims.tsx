import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Coins, Loader2, RefreshCw, RotateCcw, ShieldAlert, Timer, WalletCards } from 'lucide-react';
import { formatEther, parseAbiItem } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { TransactionStatus, type TransactionState } from '@/components/transaction-status';
import {
  playerPositionLabel,
  orderedUniqueMarketIds,
  summarizePlayerPosition,
  type PlayerPositionAction,
  type PlayerPositionLifecycle,
} from '@/lib/player-position';
import { formatEthUsd } from '@/lib/eth-usd';
import { useEthUsdPrice } from '@/lib/use-eth-usd-price';

const POSITION_OPENED_EVENT = parseAbiItem('event PositionOpened(uint256 indexed marketId, address indexed account, uint8 indexed outcome, uint256 amount)');

interface PlayerPosition {
  marketId: bigint;
  status: number;
  finalCount: number;
  stake: bigint;
  payout: bigint;
  lifecycle: PlayerPositionLifecycle;
  action: PlayerPositionAction;
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
          };
          const stakes = [under, range, over, exact] as [bigint, bigint, bigint, bigint];
          const summary = summarizePlayerPosition({
            status: data.status,
            winner: data.winner,
            closeTime: Number(data.closeTime),
            resolveDeadline: Number(data.resolveDeadline),
            challengeDeadline: Number(data.challengeDeadline),
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

  if (!isConnected) return <section className="player-claims"><header><WalletCards /><div><h2>Winnings</h2><p>Connect your wallet to find every on-chain position.</p></div></header></section>;

  const available = positions.filter((position) => position.lifecycle === 'claimable').reduce((sum, position) => sum + position.payout, 0n);
  const availableEth = formatEther(available);
  const availableUsd = typeof ethUsdPrice === 'number' ? formatEthUsd(availableEth, ethUsdPrice) : null;
  const unresolved = positions.filter((position) => ['betting', 'awaiting_result', 'refund_recovery', 'proposed', 'finalizable', 'challenged'].includes(position.lifecycle)).length;

  return <section className="player-claims">
    <header><Coins /><div><h2>Winnings</h2><p>Finalized payouts and expired-round refunds are paid directly by the contract.</p><button className="claims-refresh" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? 'is-spinning' : ''} /> Refresh positions</button></div><strong><span>{displayEth(available)} ETH claimable</span><small>{availableUsd ? `≈ ${availableUsd} USD` : unresolved > 0 ? `${unresolved} position${unresolved === 1 ? '' : 's'} pending` : 'No pending settlement'}</small></strong></header>
    {chainId !== arbitrumSepolia.id
      ? <p className="claims-empty">Switch to Arbitrum Sepolia to manage these positions.</p>
      : loading && positions.length === 0
        ? <p className="claims-empty"><Loader2 className="is-spinning" /> Scanning every on-chain position…</p>
        : positions.length === 0 && !error
          ? <p className="claims-empty">No on-chain positions were found for this wallet.</p>
          : <div className="claims-list">{positions.map((position) => <article key={position.marketId.toString()} data-state={position.lifecycle}>
            <span>{position.lifecycle === 'claimed' ? <CheckCircle2 /> : position.lifecycle === 'refund_recovery' ? <RotateCcw /> : position.lifecycle === 'lost' ? <ShieldAlert /> : position.lifecycle === 'claimable' ? <Coins /> : <Timer />}<span><b>Round #{position.marketId.toString()}</b><small>{playerPositionLabel(position.lifecycle, position.finalCount, position.status)}</small></span></span>
            <strong><span>{displayEth(position.payout > 0n ? position.payout : position.stake)} ETH</span><small>{position.payout > 0n ? 'payout' : 'stake'}</small></strong>
            {position.action
              ? <button disabled={submitting !== null} onClick={() => void submit(position)}>{submitting?.marketId === position.marketId ? 'Confirming…' : lifecycleActionLabel(position.action)}</button>
              : <i className={`claim-state ${position.lifecycle}`}>{lifecycleStateLabel(position.lifecycle)}</i>}
          </article>)}</div>}
    {txState && <TransactionStatus state={txState} hash={hash} confirmedText={confirmedText} />}
    {error && <p className="contract-error" role="alert">Position scan: {error}</p>}
  </section>;
}
