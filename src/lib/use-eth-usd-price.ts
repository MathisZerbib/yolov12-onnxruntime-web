import { useEffect, useState } from 'react';
import { fetchEthUsdSpot, getCachedEthUsdSpot } from '@/lib/eth-usd';

export type EthUsdPrice = number | null | undefined;

export function useEthUsdPrice(): EthUsdPrice {
  const [price, setPrice] = useState<EthUsdPrice>(() => getCachedEthUsdSpot() ?? undefined);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetchEthUsdSpot()
        .then((nextPrice) => { if (active) setPrice(nextPrice); })
        .catch(() => { if (active) setPrice(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return price;
}
