import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Coins, Loader2, WalletCards } from 'lucide-react';
import { formatEther, parseAbiItem } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { GAME_CONFIG } from '@/config/game-config';
import { TransactionStatus, type TransactionState } from '@/components/transaction-status';

const POSITION_OPENED_EVENT = parseAbiItem('event PositionOpened(uint256 indexed marketId, address indexed account, uint8 indexed outcome, uint256 amount)');

interface ClaimablePosition {
  marketId: bigint;
  status: number;
  finalCount: number;
  amount: bigint;
  claimed: boolean;
}

export function PlayerClaims() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const { writeContractAsync } = useWriteContract();
  const [positions, setPositions] = useState<ClaimablePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<bigint | null>(null);
  const [hash, setHash] = useState<`0x${string}`>();
  const [txState, setTxState] = useState<TransactionState>();
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!address || !publicClient) { setPositions([]); return; }
    setLoading(true);
    setError('');
    try {
      const logs = await publicClient.getLogs({ address: marketContractAddress, event: POSITION_OPENED_EVENT, args: { account: address }, fromBlock: 0n, toBlock: 'latest' });
      const marketIds = [...new Set(logs.map((log) => log.args.marketId).filter((id): id is bigint => id !== undefined))].sort((a, b) => a > b ? -1 : 1).slice(0, 50);
      const rows = await Promise.all(marketIds.map(async (marketId) => {
        const [market, alreadyClaimed, under, range, over, exact] = await Promise.all([
          publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [marketId] }),
          publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claimed', args: [marketId, address] }),
          ...([1, 2, 3, 4] as const).map((outcome) => publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'positions', args: [marketId, address, outcome] })),
        ]);
        const data = market as { status: number; winner: number; finalCount: number };
        const stakes = [under, range, over, exact] as bigint[];
        let amount = 0n;
        if (data.status === 5) amount = stakes.reduce((sum, stake) => sum + stake, 0n);
        if (data.status === 4 && data.winner > 0) {
          const winningStake = stakes[data.winner - 1] ?? 0n;
          const multiplierBps = BigInt(Math.round((GAME_CONFIG.BETTING.MULTIPLIERS[data.winner - 1] ?? 1) * 10_000));
          amount = winningStake * multiplierBps / 10_000n;
        }
        return { marketId, status: data.status, finalCount: data.finalCount, amount, claimed: alreadyClaimed };
      }));
      setPositions(rows.filter((row) => row.amount > 0n || row.claimed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load wallet positions');
    } finally { setLoading(false); }
  }, [address, publicClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function claim(position: ClaimablePosition) {
    if (!publicClient || !address || position.claimed || position.amount === 0n) return;
    setClaiming(position.marketId);
    setError('');
    setTxState('AWAITING_SIGNATURE');
    try {
      await publicClient.simulateContract({ account: address, address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claim', args: [position.marketId] });
      const transactionHash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'claim', args: [position.marketId], chainId: arbitrumSepolia.id });
      setHash(transactionHash);
      setTxState('PENDING');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
      setTxState(receipt.status === 'success' ? 'CONFIRMED' : 'FAILED');
      if (receipt.status === 'success') await refresh();
    } catch (cause) {
      setTxState('FAILED');
      setError(cause instanceof Error && cause.message.toLowerCase().includes('user rejected') ? 'Claim cancelled in wallet.' : 'The winnings could not be claimed. Refresh and try again.');
    } finally { setClaiming(null); }
  }

  if (!isConnected) return <section className="player-claims"><header><WalletCards /><div><h2>Winnings</h2><p>Connect your wallet to find claimable payouts.</p></div></header></section>;
  const available = positions.filter((position) => !position.claimed && position.amount > 0n).reduce((sum, position) => sum + position.amount, 0n);
  return <section className="player-claims"><header><Coins /><div><h2>Winnings</h2><p>Claims are paid directly from the contract to your connected wallet.</p></div><strong>{Number(formatEther(available)).toFixed(5)} ETH available</strong></header>{chainId !== arbitrumSepolia.id ? <p className="claims-empty">Switch to Arbitrum Sepolia to claim.</p> : loading ? <p className="claims-empty"><Loader2 className="is-spinning" /> Scanning your positions…</p> : positions.length === 0 ? <p className="claims-empty">No finalized winning positions or refunds yet.</p> : <div className="claims-list">{positions.map((position) => <article key={position.marketId.toString()}><span>{position.claimed ? <CheckCircle2 /> : <Coins />}<span><b>Round #{position.marketId.toString()}</b><small>{position.status === 5 ? 'Cancelled round refund' : `Final count ${position.finalCount}`}</small></span></span><strong>{formatEther(position.amount)} ETH</strong><button disabled={position.claimed || claiming !== null} onClick={() => void claim(position)}>{position.claimed ? 'Claimed' : claiming === position.marketId ? 'Claiming…' : 'Claim to wallet'}</button></article>)}</div>}{txState && <TransactionStatus state={txState} hash={hash} confirmedText="Winnings sent to your wallet." />}{error && <p className="contract-error" role="alert">{error}</p>}</section>;
}
