export const ETH_USD_SPOT_URL = 'https://api.coinbase.com/v2/prices/ETH-USD/spot';

interface CoinbaseSpotResponse {
  data?: { amount?: string; currency?: string };
}

let cachedSpot: { price: number; expiresAt: number } | null = null;
let pendingSpot: Promise<number> | null = null;

export function getCachedEthUsdSpot(now = Date.now()): number | null {
  return cachedSpot && cachedSpot.expiresAt > now ? cachedSpot.price : null;
}

export async function fetchEthUsdSpot(fetcher: typeof fetch = fetch, now = Date.now()): Promise<number> {
  const cached = getCachedEthUsdSpot(now);
  if (cached !== null) return cached;
  if (pendingSpot) return pendingSpot;

  pendingSpot = fetcher(ETH_USD_SPOT_URL, { headers: { accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`ETH/USD spot request failed (${response.status})`);
      const payload = await response.json() as CoinbaseSpotResponse;
      const price = Number(payload.data?.amount);
      if (payload.data?.currency !== 'USD' || !Number.isFinite(price) || price <= 0) throw new Error('ETH/USD spot response was invalid');
      cachedSpot = { price, expiresAt: now + 60_000 };
      return price;
    })
    .finally(() => { pendingSpot = null; });

  return pendingSpot;
}

export function formatEthUsd(ethAmount: string, spotPrice: number): string {
  const eth = Number(ethAmount);
  if (!Number.isFinite(eth) || eth < 0 || !Number.isFinite(spotPrice) || spotPrice <= 0) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(eth * spotPrice);
}

export function resetEthUsdSpotForTests(): void {
  cachedSpot = null;
  pendingSpot = null;
}
