import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEthUsdSpot, formatEthUsd, resetEthUsdSpotForTests } from '@/lib/eth-usd';

describe('ETH/USD pricing', () => {
  beforeEach(() => resetEthUsdSpotForTests());

  it('validates and caches the public spot response', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { amount: '3500.25', currency: 'USD' } }),
    } as Response));

    await expect(fetchEthUsdSpot(fetcher, 1_000)).resolves.toBe(3500.25);
    await expect(fetchEthUsdSpot(fetcher, 2_000)).resolves.toBe(3500.25);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('formats an ETH amount as an approximate USD value', () => {
    expect(formatEthUsd('0.002', 3500)).toBe('$7.00');
    expect(formatEthUsd('not-a-number', 3500)).toBe('—');
  });
});
