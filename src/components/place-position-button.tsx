import { useEffect, useState } from 'react';
import { parseEther } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { AUTH_API_URL } from '@/lib/wagmi';
import { activeMarketId, marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { TransactionStatus, type TransactionState } from './transaction-status';

export function PlacePositionButton({ outcome, amount }: { outcome: number; amount: number }) {
  const { address, isConnected, chainId } = useAccount();
  const [error, setError] = useState('');
  const [hash, setHash] = useState<`0x${string}`>();
  const [txState, setTxState] = useState<TransactionState>();
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const configured = Boolean(marketContractAddress && activeMarketId > 0n);

  // A market must actually exist and be Open before a bet can succeed.
  // Status enum: None=0, Open=2. Betting on a non-open market reverts on-chain.
  useEffect(() => {
    if (!publicClient || !configured) { setMarketOpen(null); return; }
    let cancelled = false;
    publicClient.readContract({
      address: marketContractAddress,
      abi: trafficMarketAbi,
      functionName: 'getMarket',
      args: [activeMarketId],
    }).then((market) => {
      if (cancelled) return;
      // viem returns a struct as an object keyed by field name
      const status = Number((market as { status?: number }).status ?? 0);
      setMarketOpen(status === 2);
    }).catch(() => { if (!cancelled) setMarketOpen(null); });
    return () => { cancelled = true; };
  }, [publicClient, configured]);

  useEffect(() => {
    if (!hash || !publicClient) return;
    let cancelled = false;
    setTxState(current => current === 'REPLACED' ? 'REPLACED' : 'PENDING');
    publicClient.waitForTransactionReceipt({ hash, confirmations: 1, onReplaced: ({ transaction }) => {
      if (!cancelled) { setHash(transaction.hash); setTxState('REPLACED'); }
    }}).then((receipt) => { if (!cancelled) setTxState(receipt.status === 'success' ? 'CONFIRMED' : 'FAILED'); })
      .catch((cause) => { if (!cancelled) setTxState(String(cause).includes('not found') ? 'DROPPED' : 'FAILED'); });
    return () => { cancelled = true; };
  }, [hash, publicClient]);

  async function place() {
    setError(''); setTxState('AWAITING_SIGNATURE');
    const session = await fetch(`${AUTH_API_URL}/auth/session`, { credentials: 'include' });
    const sessionData = session.ok ? await session.json() as { address?: string } : null;
    if (!sessionData?.address || sessionData.address.toLowerCase() !== address?.toLowerCase()) { setError('Sign in with this wallet first'); setTxState(undefined); return; }
    if (!marketContractAddress || activeMarketId === 0n) { setError('Market contract is not configured'); setTxState(undefined); return; }
    try {
      const submittedHash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'bet', args: [activeMarketId, outcome + 1], value: parseEther(String(amount)), chainId: arbitrumSepolia.id });
      setHash(submittedHash); setTxState('SUBMITTED');
    } catch (cause) { setError(cause instanceof Error ? cause.message.split('\n')[0] : 'Transaction rejected'); setTxState('FAILED'); }
  }
  const marketNotOpen = configured && marketOpen === false;
  const label = !configured ? 'Contract deployment required' : !isConnected ? 'Connect wallet to bet' : chainId !== arbitrumSepolia.id ? 'Switch network to bet' : marketNotOpen ? `Market #${activeMarketId.toString()} not open` : txState === 'AWAITING_SIGNATURE' ? 'Confirm in wallet…' : txState === 'PENDING' || txState === 'SUBMITTED' ? 'Transaction pending…' : txState === 'CONFIRMED' ? 'Position opened' : 'Place position';
  return <><button className="place-position" disabled={!configured || marketNotOpen || txState === 'AWAITING_SIGNATURE' || txState === 'PENDING' || txState === 'SUBMITTED'} onClick={place}>{label}</button>{txState && <TransactionStatus state={txState} hash={hash} />}{error && <p className="contract-error">{error}</p>}{marketNotOpen && <p className="contract-error">Market #{activeMarketId.toString()} does not exist or is not open. Create it via the MARKET_ROLE wallet (createMarket) before betting.</p>}</>;
}
