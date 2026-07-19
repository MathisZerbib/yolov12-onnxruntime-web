import { describe, expect, it } from 'vitest';
import {
  getAutomationOperatorAddress,
  nextRoundAlarmSeconds,
  shouldKeepExistingMarket,
} from '../../worker/market-rounds';

describe('market scheduler policy', () => {
  it('opens a rolling replacement before the current betting window closes', () => {
    expect(shouldKeepExistingMarket(1, 130, 100, true)).toBe(true);
    expect(shouldKeepExistingMarket(1, 110, 100, true)).toBe(false);
    expect(shouldKeepExistingMarket(1, 99, 100, true)).toBe(false);
    expect(shouldKeepExistingMarket(2, 130, 100, true)).toBe(false);
    expect(shouldKeepExistingMarket(3, 130, 100, true)).toBe(false);
  });

  it('waits for non-rolling markets to reach a terminal state', () => {
    expect(shouldKeepExistingMarket(1, 99, 100, false)).toBe(true);
    expect(shouldKeepExistingMarket(2, 99, 100, false)).toBe(true);
    expect(shouldKeepExistingMarket(3, 99, 100, false)).toBe(true);
    expect(shouldKeepExistingMarket(4, 99, 100, false)).toBe(false);
    expect(shouldKeepExistingMarket(5, 99, 100, false)).toBe(false);
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
