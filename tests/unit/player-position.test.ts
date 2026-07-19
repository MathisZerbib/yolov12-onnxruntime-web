import { describe, expect, it } from 'vitest';
import { orderedUniqueMarketIds, playerPositionLabel, summarizePlayerPosition } from '@/lib/player-position';

const base = {
  winner: 0,
  closeTime: 100,
  resolveDeadline: 200,
  challengeDeadline: 300,
  stakes: [1_000n, 0n, 0n, 0n] as const,
  multiplierBps: [15_000n, 17_500n, 20_000n, 30_000n] as const,
  claimed: false,
  nowSeconds: 150,
};

describe('player position lifecycle', () => {
  it('keeps an unfinalized position visible and makes an expired round recoverable', () => {
    expect(summarizePlayerPosition({ ...base, status: 1 }).lifecycle).toBe('awaiting_result');
    expect(summarizePlayerPosition({ ...base, status: 1, nowSeconds: 201 })).toMatchObject({
      stake: 1_000n,
      payout: 0n,
      lifecycle: 'refund_recovery',
      action: 'cancel_expired',
    });
  });

  it.each([
    [1, [1_000n, 0n, 0n, 0n] as const, 1_500n],
    [2, [0n, 1_000n, 0n, 0n] as const, 1_750n],
    [3, [0n, 0n, 1_000n, 0n] as const, 2_000n],
    [4, [0n, 0n, 0n, 1_000n] as const, 3_000n],
  ])('calculates the fixed-return win for outcome %i', (winner, stakes, payout) => {
    expect(summarizePlayerPosition({ ...base, status: 4, winner, stakes })).toMatchObject({ payout, lifecycle: 'claimable', action: 'claim' });
  });

  it('retains a finalized loss in position history', () => {
    expect(summarizePlayerPosition({ ...base, status: 4, winner: 2 })).toMatchObject({
      payout: 0n,
      lifecycle: 'lost',
      action: null,
    });
  });

  it('returns every stake when a round is cancelled', () => {
    const summary = summarizePlayerPosition({ ...base, status: 5, stakes: [1_000n, 2_000n, 0n, 0n] });
    expect(summary).toMatchObject({ stake: 3_000n, payout: 3_000n, lifecycle: 'claimable', action: 'claim' });
    expect(playerPositionLabel(summary.lifecycle, 0, 5)).toBe('Cancelled round refund');
    expect(playerPositionLabel('claimable', 0, 4)).toBe('Final count 0');
  });

  it('allows permissionless finalization after the challenge deadline', () => {
    expect(summarizePlayerPosition({ ...base, status: 2, nowSeconds: 300 }).lifecycle).toBe('proposed');
    expect(summarizePlayerPosition({ ...base, status: 2, nowSeconds: 301 })).toMatchObject({ lifecycle: 'finalizable', action: 'finalize' });
  });

  it('does not hide older claim IDs behind an arbitrary 50-position limit', () => {
    const ids = Array.from({ length: 75 }, (_, index) => BigInt(index + 1));
    expect(orderedUniqueMarketIds([...ids, 1n, undefined])).toHaveLength(75);
    expect(orderedUniqueMarketIds(ids)[0]).toBe(75n);
    expect(orderedUniqueMarketIds(ids).at(-1)).toBe(1n);
  });
});
