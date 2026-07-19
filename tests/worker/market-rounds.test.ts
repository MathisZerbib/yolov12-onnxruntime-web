import { describe, expect, it } from 'vitest';
import {
  getAutomationOperatorAddress,
  nextRoundAlarmSeconds,
  shouldKeepExistingMarket,
  stringifyLogEvent,
} from '../../worker/market-rounds';

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
});
