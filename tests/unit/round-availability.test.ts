import { describe, expect, it } from 'vitest';
import type { RoomMarketState } from '@/lib/room-market';
import { estimatedServerTime, formatCountdown, formatRoundUnavailable } from '@/lib/round-availability';

function market(overrides: Partial<RoomMarketState> = {}): RoomMarketState {
  return {
    roomId: 'tokyo',
    roomKey: `0x${'1'.repeat(64)}`,
    enabled: true,
    serverTime: 1_000,
    receivedAtMs: 100_000,
    phase: 'awaiting_result',
    marketId: '7',
    closeTime: 1_000,
    resolveDeadline: 1_600,
    lowerBound: 10,
    upperBound: 30,
    exactTarget: 20,
    feeBps: 200,
    totalPoolWei: '0',
    outcomePoolsWei: ['0', '0', '0', '0'],
    nextRoundExpectedAt: null,
    staleAfter: 1_010,
    ...overrides,
  };
}

describe('round availability presentation', () => {
  it('formats countdown boundaries safely', () => {
    expect(formatCountdown(-1)).toBe('00:00');
    expect(formatCountdown(0.1)).toBe('00:01');
    expect(formatCountdown(65)).toBe('01:05');
  });

  it('advances server time from the snapshot receipt time', () => {
    expect(estimatedServerTime(market(), 105_500)).toBe(1_005.5);
  });

  it('counts down from a stable absolute deadline instead of resetting to 30 seconds', () => {
    const state = market({ nextRoundExpectedAt: 1_030 });
    expect(formatRoundUnavailable(state, '', 100_000)).toBe('Next round in 00:30');
    expect(formatRoundUnavailable(state, '', 105_000)).toBe('Next round in 00:25');
    expect(formatRoundUnavailable(state, '', 130_000)).toBe('Opening the next round…');
  });

  it('prioritizes fetch errors only when no market snapshot exists', () => {
    expect(formatRoundUnavailable(null, 'API offline')).toBe('API offline');
    expect(formatRoundUnavailable(market(), 'API offline')).toBe('Opening the next round…');
    expect(formatRoundUnavailable(null)).toBe('Awaiting market feed');
  });
});
