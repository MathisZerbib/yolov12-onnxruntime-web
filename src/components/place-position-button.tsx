import { useEffect, useRef, useState } from 'react';
import { parseEther } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { GAME_CONFIG } from '@/config/game-config';
import { marketContractAddress, marketRoomKey, trafficMarketAbi } from '@/lib/market-contract';
import type { RoomMarketState } from '@/lib/room-market';
import { TransactionStatus, type TransactionState } from './transaction-status';

interface PlacePositionButtonProps {
  roomId: string;
  market: RoomMarketState | null;
  stale: boolean;
  outcome: number;
  amount: string;
  onConfirmed?: () => void;
}

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

function friendlyTransactionError(cause: unknown): string {
  const message = cause instanceof Error ? messageFromError(cause) : String(cause);
  if (message.includes('MarketClosed')) return 'This round locked while you were confirming. Your draft is ready for the next round.';
  if (message.includes('InvalidMarket') || message.includes('ActiveMarket')) return 'This round is no longer accepting bets.';
  if (message.includes('InvalidStake')) return 'Enter a valid stake within the allowed range.';
  if (message.toLowerCase().includes('user rejected')) return 'The wallet request was cancelled.';
  return 'The position could not be submitted. Refresh the round and try again.';
}

function messageFromError(error: Error): string {
  const cause = error as Error & { shortMessage?: string };
  return cause.shortMessage ?? cause.message;
}

export function PlacePositionButton({ roomId, market, stale, outcome, amount, onConfirmed }: PlacePositionButtonProps) {
  const { address, isConnected, chainId } = useAccount();
  const [error, setError] = useState('');
  const [hash, setHash] = useState<`0x${string}`>();
  const [txState, setTxState] = useState<TransactionState>();
  const submissionLock = useRef(false);
  const submittedMarketId = useRef<string | null>(null);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });

  const amountValid = AMOUNT_PATTERN.test(amount) && Number(amount) >= Number(GAME_CONFIG.BETTING.MIN_ETH) && Number(amount) <= Number(GAME_CONFIG.BETTING.MAX_ETH);
  const canonicalRoom = Boolean(market && market.roomKey.toLowerCase() === marketRoomKey(roomId).toLowerCase());
  const marketOpen = Boolean(market?.marketId && market.phase === 'open' && canonicalRoom && !stale);
  const transactionBusy = txState === 'AWAITING_SIGNATURE' || txState === 'PENDING' || txState === 'SUBMITTED';

  useEffect(() => {
    if (!hash || !publicClient) return;
    let cancelled = false;
    setTxState(current => current === 'REPLACED' ? 'REPLACED' : 'PENDING');
    publicClient.waitForTransactionReceipt({ hash, confirmations: 1, onReplaced: ({ transaction }) => {
      if (!cancelled) { setHash(transaction.hash); setTxState('REPLACED'); }
    }}).then((receipt) => {
      if (cancelled) return;
      const confirmed = receipt.status === 'success';
      setTxState(confirmed ? 'CONFIRMED' : 'FAILED');
      if (confirmed) onConfirmed?.();
    }).catch((cause) => {
      if (!cancelled) setTxState(String(cause).includes('not found') ? 'DROPPED' : 'FAILED');
    }).finally(() => { submissionLock.current = false; });
    return () => { cancelled = true; };
  }, [hash, onConfirmed, publicClient]);

  useEffect(() => {
    if (transactionBusy) return;
    setError('');
    if (submittedMarketId.current !== market?.marketId) {
      setHash(undefined);
      setTxState(undefined);
      submittedMarketId.current = null;
    }
  }, [address, market?.marketId, transactionBusy]);

  async function place() {
    if (submissionLock.current || transactionBusy) return;
    setError('');
    if (!address || !publicClient || !market?.marketId || !marketOpen) {
      setError('Opening a fresh game. Your bet draft is preserved—try again in a moment.');
      return;
    }
    if (!amountValid) { setError(`Stake must be between ${GAME_CONFIG.BETTING.MIN_ETH} and ${GAME_CONFIG.BETTING.MAX_ETH} ETH.`); return; }
    submissionLock.current = true;
    submittedMarketId.current = market.marketId;
    setTxState('AWAITING_SIGNATURE');
    try {
      const args = [BigInt(market.marketId), outcome + 1] as const;
      const value = parseEther(amount);
      await publicClient.simulateContract({ account: address, address: marketContractAddress, abi: trafficMarketAbi, functionName: 'bet', args, value });
      const submittedHash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'bet', args, value, chainId: arbitrumSepolia.id });
      setHash(submittedHash);
      setTxState('SUBMITTED');
    } catch (cause) {
      submissionLock.current = false;
      setError(friendlyTransactionError(cause));
      setTxState('FAILED');
    }
  }

  const label = !isConnected ? 'Connect wallet to bet'
    : chainId !== arbitrumSepolia.id ? 'Switch to Arbitrum Sepolia'
      : stale ? 'Refreshing round…'
        : !market?.enabled ? 'Rounds coming soon'
          : !marketOpen ? 'Opening your game…'
              : !amountValid ? 'Enter a valid stake'
                : txState === 'AWAITING_SIGNATURE' ? 'Confirm in wallet…'
                  : txState === 'PENDING' || txState === 'SUBMITTED' ? 'Position pending…'
                    : txState === 'CONFIRMED' ? 'Position opened' : `Place on round #${market.marketId}`;

  return <>
    <button className="place-position" disabled={!isConnected || chainId !== arbitrumSepolia.id || !marketOpen || !amountValid || transactionBusy} onClick={() => void place()}>{label}</button>
    {txState && <TransactionStatus state={txState} hash={hash} />}
    {error && <p className="contract-error" role="alert">{error}</p>}
  </>;
}
