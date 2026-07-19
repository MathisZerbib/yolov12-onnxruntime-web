import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransactionStatus } from '@/components/transaction-status';

describe('TransactionStatus', () => {
  it('explains a wallet signature request', () => {
    render(<TransactionStatus state="AWAITING_SIGNATURE" />);
    expect(screen.getByText('AWAITING SIGNATURE')).toBeInTheDocument();
    expect(screen.getByText('Review the request in your wallet.')).toBeInTheDocument();
  });

  it('shows confirmed copy and a safe explorer link', () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    render(<TransactionStatus state="CONFIRMED" hash={hash} confirmedText="Bet confirmed." />);
    expect(screen.getByText('Bet confirmed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View transaction' })).toHaveAttribute(
      'href',
      `https://sepolia.arbiscan.io/tx/${hash}`,
    );
  });

  it('uses an explicit detail when provided', () => {
    render(<TransactionStatus state="FAILED" detail="The market closed." />);
    expect(screen.getByText('The market closed.')).toBeInTheDocument();
  });
});
