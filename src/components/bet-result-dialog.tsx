import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Trophy, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatEthUsd } from '@/lib/eth-usd';
import type { EthUsdPrice } from '@/lib/use-eth-usd-price';

export type BetResultState = 'win' | 'loss' | 'refund';

interface BetResultDialogProps {
  state: BetResultState;
  finalCount: number;
  settled: boolean;
  totalReturn?: string;
  stake?: string;
  ethUsdPrice?: EthUsdPrice;
  onContinue: () => void;
}

export function BetResultDialog({ state, finalCount, settled, totalReturn, stake, ethUsdPrice, onContinue }: BetResultDialogProps) {
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const title = state === 'win' ? 'YOU WIN' : state === 'loss' ? 'YOU LOST' : 'ROUND REFUNDED';
  const detail = state === 'win'
    ? settled
      ? `${totalReturn ?? 'Your payout'} ETH is ready to claim`
      : `Result on-chain · awaiting finalization`
    : state === 'loss'
      ? settled
        ? `Final count: ${finalCount}`
        : `Result on-chain · awaiting finalization`
      : `${stake ?? 'Your stake'} ETH is ready to reclaim`;
  const resultAmount = state === 'win' ? totalReturn : stake;
  const amountLabel = state === 'win' ? settled ? 'Payout' : 'Potential payout' : state === 'loss' ? settled ? 'Stake lost' : 'Stake at risk' : 'Refund';
  const usdAmount = resultAmount && typeof ethUsdPrice === 'number' ? formatEthUsd(resultAmount, ethUsdPrice) : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onContinue(); }}>
      <DialogContent
        className={`bet-result-modal ${state}`}
        role="alertdialog"
        aria-live="assertive"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          continueButtonRef.current?.focus();
        }}
      >
        <span className="bet-result-icon" aria-hidden="true">
          {state === 'win' ? <Trophy /> : state === 'loss' ? <XCircle /> : <RotateCcw />}
        </span>
        <div className="bet-result-copy">
          <span>{settled ? 'Finalized on-chain' : 'Result proposed on-chain · finalizing'}</span>
          <DialogTitle className="bet-result-title">{title}</DialogTitle>
          <DialogDescription className="bet-result-detail">{detail}</DialogDescription>
        </div>
        <div className="bet-result-money" aria-label={`${amountLabel} in ETH and US dollars`}>
          <span>{amountLabel}</span>
          <strong>{resultAmount ?? '—'} ETH</strong>
          <b>{usdAmount ? `≈ ${usdAmount} USD` : ethUsdPrice === undefined ? 'Updating USD value…' : 'USD rate unavailable'}</b>
        </div>
        <div className="bet-result-actions">
          {settled && state !== 'loss' && (
            <DialogClose asChild>
              <Link to="/profile">Claim funds</Link>
            </DialogClose>
          )}
          <DialogClose asChild>
            <button ref={continueButtonRef} type="button">Continue</button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
