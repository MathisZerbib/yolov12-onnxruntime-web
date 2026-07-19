import type { RoomMarketState } from './room-market';

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function estimatedServerTime(market: RoomMarketState, nowMs = Date.now()): number {
  if (market.receivedAtMs === undefined) return nowMs / 1_000;
  return market.serverTime + Math.max(0, nowMs - market.receivedAtMs) / 1_000;
}

export function formatRoundUnavailable(
  market: RoomMarketState | null,
  fetchError = '',
  nowMs = Date.now(),
): string {
  if (fetchError && !market?.marketId) return fetchError;
  if (!market) return 'Awaiting market feed';
  if (market.nextRoundExpectedAt) {
    const seconds = market.nextRoundExpectedAt - estimatedServerTime(market, nowMs);
    if (seconds > 0) return `Next round in ${formatCountdown(seconds)}`;
  }
  return 'Opening the next round…';
}
