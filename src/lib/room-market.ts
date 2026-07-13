import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_API_URL } from './wagmi';

export type PlayerMarketPhase = 'open' | 'awaiting_result' | 'proposed' | 'challenged' | 'resolved' | 'cancelled' | 'unavailable';

export interface RoomMarketState {
  roomId: string;
  roomKey: `0x${string}`;
  enabled: boolean;
  serverTime: number;
  phase: PlayerMarketPhase;
  marketId: string | null;
  closeTime: number | null;
  resolveDeadline: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  exactTarget: number | null;
  feeBps: number | null;
  totalPoolWei: string;
  outcomePoolsWei: [string, string, string, string];
  nextRoundExpectedAt: number | null;
  staleAfter: number;
  roundDurationSeconds?: number;
  error?: string;
}

interface RoomMarketSnapshot {
  market: RoomMarketState | null;
  loading: boolean;
  stale: boolean;
  error: string;
  syncedAt: number;
}

const POLL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;

export function useRoomMarket(roomId: string | undefined) {
  const [snapshot, setSnapshot] = useState<RoomMarketSnapshot>({ market: null, loading: true, stale: false, error: '', syncedAt: 0 });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setSnapshot(current => ({ ...current, loading: current.market === null, error: '' }));
    try {
      const response = await fetch(`${AUTH_API_URL}/rooms/${encodeURIComponent(roomId)}/market`, {
        credentials: 'include',
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null) as RoomMarketState | { error?: string } | null;
      if (!response.ok || !body || !('phase' in body)) throw new Error(body?.error || 'Round service is unavailable');
      if (sequence !== requestSequence.current) return;
      const market = body as RoomMarketState;
      setSnapshot({ market, loading: false, stale: market.staleAfter <= market.serverTime, error: market.error ?? '', syncedAt: Date.now() });
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'Round synchronization timed out'
        : error instanceof Error ? error.message : 'Round synchronization failed';
      setSnapshot(current => ({ ...current, loading: false, stale: current.market !== null, error: message }));
    } finally {
      window.clearTimeout(timeout);
    }
  }, [roomId]);

  useEffect(() => {
    const sequenceRef = requestSequence;
    setSnapshot({ market: null, loading: true, stale: false, error: '', syncedAt: 0 });
    void refresh();
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      sequenceRef.current++;
      window.clearInterval(poll);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);

  return { ...snapshot, refresh };
}
