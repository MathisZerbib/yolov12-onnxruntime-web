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

export type BetResultState = 'win' | 'loss' | 'refund';

interface BetResultDialogProps {
  state: BetResultState;
  finalCount: number;
  settled: boolean;
  totalReturn?: string;
  stake?: string;
  onContinue: () => void;
}

export function BetResultDialog({ state, finalCount, settled, totalReturn, stake, onContinue }: BetResultDialogProps) {
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const title = state === 'win' ? 'YOU WIN' : state === 'loss' ? 'YOU LOST' : 'ROUND REFUNDED';
  const detail = state === 'win'
    ? settled
      ? `${totalReturn ?? 'Your payout'} ETH is ready to claim`
      : `Detected ${finalCount} vehicles · payout finalizing`
    : state === 'loss'
      ? `Final count: ${finalCount}`
      : `${stake ?? 'Your stake'} ETH is ready to reclaim`;

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
          <span>Round result</span>
          <DialogTitle className="bet-result-title">{title}</DialogTitle>
          <DialogDescription className="bet-result-detail">{detail}</DialogDescription>
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
