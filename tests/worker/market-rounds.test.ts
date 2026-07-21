import { describe, expect, it } from 'vitest';
import {
  getAutomationOperatorAddress,
  hasSettlementLiability,
  marketIdRange,
  nextRoundAlarmSeconds,
  settlementDecision,
  schedulerNamespace,
  shouldKeepExistingMarket,
  stringifyLogEvent,
} from '../../worker/market-rounds';

const settlementMarket = {
  status: 1,
  closeTime: 100n,
  resolveDeadline: 200n,
  challengeDeadline: 300n,
  disputeDeadline: 400n,
  roomId: '0x' as `0x${string}`,
};

describe('market scheduler policy', () => {
  it('opens a rolling replacement before the current betting window closes', () => {
    expect(shouldKeepExistingMarket(1, 130, 100, true)).toBe(true);
    expect(shouldKeepExistingMarket(1, 110, 100, true)).toBe(false);
    expect(shouldKeepExistingMarket(1, 99, 100, true)).toBe(false);
    expect(shouldKeepExistingMarket(2, 130, 100, true)).toBe(false);
    expect(shouldKeepExistingMarket(3, 130, 100, true)).toBe(false);
  });

  it('rolls a legacy room forward as soon as its betting window closes', () => {
    expect(shouldKeepExistingMarket(1, 101, 100, false)).toBe(true);
    expect(shouldKeepExistingMarket(1, 100, 100, false)).toBe(false);
    expect(shouldKeepExistingMarket(1, 99, 100, false)).toBe(false);
    expect(shouldKeepExistingMarket(2, 101, 100, false)).toBe(false);
    expect(shouldKeepExistingMarket(3, 101, 100, false)).toBe(false);
    expect(shouldKeepExistingMarket(4, 99, 100, false)).toBe(false);
    expect(shouldKeepExistingMarket(5, 99, 100, false)).toBe(false);
  });

  it('serializes nested bigint log fields without throwing', () => {
    expect(stringifyLogEvent({ marketId: 599n, receipt: { blockNumber: 12n }, pools: [1n, 2n] }))
      .toBe('{"marketId":"599","receipt":{"blockNumber":"12"},"pools":["1","2"]}');
  });

  it('schedules rolling reconciliation at the lead boundary', () => {
    expect(nextRoundAlarmSeconds(1_000, true, 900)).toBe(990);
    expect(nextRoundAlarmSeconds(1_000, false, 900)).toBe(1_001);
    expect(nextRoundAlarmSeconds(1_000, false, 1_100)).toBe(1_130);
  });

  it('derives the operator address without exposing the private key', () => {
    const address = getAutomationOperatorAddress({ MARKET_OPERATOR_PRIVATE_KEY: '1'.padStart(64, '0') });
    expect(address).toMatch(/^0x[0-9A-Fa-f]{40}$/);
    expect(() => getAutomationOperatorAddress({ MARKET_OPERATOR_PRIVATE_KEY: 'invalid' })).toThrow(/missing or invalid/);
  });

  it('uses the same strict deadline boundaries as the settlement contract', () => {
    expect(settlementDecision(settlementMarket, 100)).toEqual({ action: null, nextActionAt: 101, terminal: false });
    expect(settlementDecision(settlementMarket, 150).action).toBe('proposeResult');
    expect(settlementDecision(settlementMarket, 200).action).toBe('cancelExpired');

    expect(settlementDecision({ ...settlementMarket, status: 2 }, 300)).toEqual({ action: null, nextActionAt: 301, terminal: false });
    expect(settlementDecision({ ...settlementMarket, status: 2 }, 301).action).toBe('finalizeResult');

    expect(settlementDecision({ ...settlementMarket, status: 3 }, 400)).toEqual({ action: null, nextActionAt: 401, terminal: false });
    expect(settlementDecision({ ...settlementMarket, status: 3 }, 401).action).toBe('cancelStaleChallenge');
  });

  it('removes resolved, cancelled, and invalid market states from the settlement queue', () => {
    for (const status of [0, 4, 5]) {
      expect(settlementDecision({ ...settlementMarket, status }, 1_000)).toEqual({
        action: null,
        nextActionAt: null,
        terminal: true,
      });
    }
  });

  it('builds gap-free cursor ranges that recover overwritten historical IDs', () => {
    const recentHistory = marketIdRange(1_067n, 1_195n);
    expect(recentHistory).toHaveLength(128);
    expect(recentHistory[0]).toBe(1_067n);
    expect(recentHistory.at(-1)).toBe(1_194n);
    expect(recentHistory).toContain(1_146n);
    expect(marketIdRange(1_195n, 1_195n)).toEqual([]);
  });

  it('namespaces durable cursors by chain and contract', () => {
    expect(schedulerNamespace(421_614, '0x00000000000000000000000000000000000000aA'))
      .toBe('421614:0x00000000000000000000000000000000000000aa');
  });

  it('tracks player pools and challenged-market bonds as settlement liabilities', () => {
    expect(hasSettlementLiability({ status: 1, totalPool: 1n })).toBe(true);
    expect(hasSettlementLiability({ status: 3, totalPool: 0n })).toBe(true);
    expect(hasSettlementLiability({ status: 1, totalPool: 0n })).toBe(false);
    expect(hasSettlementLiability({ status: 2, totalPool: 0n })).toBe(false);
  });
});
