import { Check, Circle, CircleX, Loader2, RefreshCw } from 'lucide-react';

export type TransactionState = 'AWAITING_SIGNATURE' | 'SUBMITTED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REPLACED' | 'DROPPED';

export function TransactionStatus({ state, hash, confirmedText = 'Position recorded on-chain.' }: { state: TransactionState; hash?: `0x${string}`; confirmedText?: string }) {
  const terminal = state === 'CONFIRMED' || state === 'FAILED' || state === 'DROPPED';
  const icon = state === 'CONFIRMED' ? <Check /> : state === 'FAILED' || state === 'DROPPED' ? <CircleX /> : state === 'REPLACED' ? <RefreshCw /> : state === 'AWAITING_SIGNATURE' ? <Circle /> : <Loader2 className="animate-spin" />;
  return <div className={`tx-status state-${state.toLowerCase()}`} aria-live="polite">{icon}<div><b>{state.replace(/_/g, ' ')}</b><span>{terminal ? state === 'CONFIRMED' ? confirmedText : 'The transaction did not complete.' : state === 'AWAITING_SIGNATURE' ? 'Review the request in your wallet.' : 'Waiting for an Arbitrum Sepolia receipt.'}</span>{hash && <a href={`https://sepolia.arbiscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View transaction</a>}</div></div>;
}
