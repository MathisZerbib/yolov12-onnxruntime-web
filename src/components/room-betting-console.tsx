import { memo, useCallback, useState } from 'react';
import { formatEther, parseEther } from 'viem';
import { ShieldCheck } from 'lucide-react';
import { BET_TYPES, GAME_CONFIG } from '@/config/game-config';
import { ChallengeTimeline } from '@/components/challenge-timeline';
import { PlacePositionButton } from '@/components/place-position-button';
import type { RoomMarketState } from '@/lib/room-market';
import { DEFAULT_BET_DRAFT, useGameUiStore } from '@/stores/game-ui-store';

interface RoomBettingConsoleProps {
  roomId: string;
  market: RoomMarketState | null;
  marketLoading: boolean;
  marketStale: boolean;
  marketError: string;
  secondsRemaining: number;
  onRefresh: () => void;
  onPositionConfirmed: () => void;
}

interface ConfirmedBet {
  marketId: string;
  prediction: string;
  predictionDetail: string;
  stake: string;
  multiplier: number;
  totalReturn: string;
  profit: string;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return formatCountdown(seconds);
}

function estimatedClaim(market: RoomMarketState | null, outcome: number, stake: string): string | null {
  if (!market?.marketId || market.phase !== 'open' || !/^\d+(?:\.\d{1,18})?$/.test(stake)) return null;
  try {
    const stakeWei = parseEther(stake);
    if (stakeWei <= 0n) return null;
    const multiplierBps = BigInt(Math.round((GAME_CONFIG.BETTING.MULTIPLIERS[outcome] ?? 1) * 10_000));
    return Number(formatEther(stakeWei * multiplierBps / 10_000n)).toFixed(4);
  } catch { return null; }
}

function RoomBettingConsoleComponent({ roomId, market, marketLoading, marketStale, marketError, secondsRemaining, onRefresh, onPositionConfirmed }: RoomBettingConsoleProps) {
  const selectedType = useGameUiStore((state) => state.roomDrafts[roomId]?.outcome ?? DEFAULT_BET_DRAFT.outcome);
  const ethAmount = useGameUiStore((state) => state.roomDrafts[roomId]?.stake ?? DEFAULT_BET_DRAFT.stake);
  const setOutcome = useGameUiStore((state) => state.setOutcome);
  const setStake = useGameUiStore((state) => state.setStake);
  const [confirmedBet, setConfirmedBet] = useState<ConfirmedBet | null>(null);
  const selectedBet = BET_TYPES.find((type) => type.id === selectedType) ?? BET_TYPES[0];
  const claimEstimate = estimatedClaim(market, selectedType, ethAmount);
  const stakeValue = Number(ethAmount);
  const returnValue = claimEstimate ? Number(claimEstimate) : 0;
  const profitEstimate = claimEstimate && Number.isFinite(stakeValue) ? Math.max(0, returnValue - stakeValue).toFixed(4) : null;
  const guaranteedMultiplier = GAME_CONFIG.BETTING.MULTIPLIERS[selectedType] ?? 1;
  const roundDuration = market?.roundDurationSeconds ?? 300;
  const open = market?.phase === 'open' && !marketStale;
  const elapsedPercent = open ? Math.min(100, Math.max(0, (roundDuration - secondsRemaining) / roundDuration * 100)) : 100;
  const roundStatus = marketLoading ? 'SYNCING' : open ? 'OPEN' : market?.phase === 'proposed' ? 'REVIEW' : market?.phase === 'challenged' ? 'DISPUTED' : 'WAITING';
  const roundTiming = marketLoading ? 'Synchronizing round…' : open
    ? `Bets lock in ${formatCountdown(secondsRemaining)}`
    : market?.phase === 'awaiting_result' || market?.phase === 'proposed' || market?.phase === 'challenged'
      ? 'Result settling · next round queues automatically'
      : 'Preparing the next round automatically…';
  const outcomeDescription = (typeId: number, fallback: string) => {
    if (!market || market.lowerBound === null || market.upperBound === null || market.exactTarget === null) return fallback;
    if (typeId === 0) return `Below ${market.lowerBound}`;
    if (typeId === 1) return `${market.lowerBound}–${market.upperBound}, except ${market.exactTarget}`;
    if (typeId === 2) return `Above ${market.upperBound}`;
    return `Exactly ${market.exactTarget}`;
  };
  const selectedPredictionDetail = outcomeDescription(selectedType, selectedBet.description);
  const handleConfirmed = useCallback(() => {
    if (market?.marketId && claimEstimate && profitEstimate) setConfirmedBet({
      marketId: market.marketId,
      prediction: selectedBet.name,
      predictionDetail: selectedPredictionDetail,
      stake: ethAmount,
      multiplier: guaranteedMultiplier,
      totalReturn: claimEstimate,
      profit: profitEstimate,
    });
    onRefresh();
    onPositionConfirmed();
  }, [claimEstimate, ethAmount, guaranteedMultiplier, market?.marketId, onPositionConfirmed, onRefresh, profitEstimate, selectedBet.name, selectedPredictionDetail]);
  const multiple = (outcome: number) => {
    const claim = estimatedClaim(market, outcome, ethAmount);
    const stake = Number(ethAmount);
    return claim && stake > 0 ? `${(Number(claim) / stake).toFixed(2)}×` : '—';
  };

  return <aside className="room-ticket" aria-label="Bet slip">
    <div className="round-header"><div><span>{market?.marketId ? `ROUND #${market.marketId}` : 'LIVE ROUND'}</span><b>{roundTiming}</b></div><i data-state={roundStatus.toLowerCase()}>{roundStatus}</i></div>
    <section className="round-clock" aria-label="Round timing"><div><span>Round duration</span><b>{formatDuration(roundDuration)}</b></div><div><span>Betting closes in</span><b>{open ? formatCountdown(secondsRemaining) : 'Closed'}</b></div><div className="round-progress" aria-hidden="true"><i style={{ transform: `scaleX(${elapsedPercent / 100})` }} /></div><p>Each round runs for {formatDuration(roundDuration)}. Your bet must confirm before the countdown reaches 00:00.</p></section>
    <div className="ticket-title"><h1>How many vehicles cross the zone?</h1><p>Choose one result before betting closes. Returns are fixed and bankroll-backed.</p></div>
    {(marketError || market?.error || marketStale) && <div className="round-sync-warning" role="status"><span>{marketStale ? 'Round data is stale. Refresh before betting.' : marketError || market?.error}</span><button onClick={onRefresh}>Refresh</button></div>}
    <div className="ticket-block"><label>Choose outcome</label><div className="room-outcomes">{BET_TYPES.map((type) => <button key={type.id} disabled={!open} aria-pressed={selectedType === type.id} className={selectedType === type.id ? 'active' : ''} onClick={() => setOutcome(roomId, type.id)}><span>{type.name}<small>{outcomeDescription(type.id, type.description)}</small></span><b>{multiple(type.id)} guaranteed</b></button>)}</div></div>
    <div className="ticket-block"><div className="ticket-label"><label htmlFor="room-stake">Stake</label><span>Fixed return · bankroll backed</span></div><div className="ticket-amount"><input id="room-stake" aria-label="ETH stake" type="text" inputMode="decimal" autoComplete="off" value={ethAmount} onChange={(event) => setStake(roomId, event.target.value)} /><span>ETH</span></div><div className="room-presets">{GAME_CONFIG.BETTING.PRESETS.slice(1, 5).map((preset) => <button key={preset} onClick={() => setStake(roomId, String(preset))}>{preset}</button>)}</div></div>
    <PlacePositionButton roomId={roomId} market={market} stale={marketStale} outcome={selectedType} amount={ethAmount} onConfirmed={handleConfirmed} />
    {confirmedBet && confirmedBet.marketId === market?.marketId && <section className="bet-recap is-confirmed" aria-labelledby="bet-recap-title"><header><span id="bet-recap-title">Bet recap</span><b>CONFIRMED · ROUND #{confirmedBet.marketId}</b></header><dl><div><dt>Your prediction</dt><dd>{confirmedBet.prediction}<small>{confirmedBet.predictionDetail}</small></dd></div><div><dt>Your stake</dt><dd>{confirmedBet.stake} ETH</dd></div><div><dt>Guaranteed multiplier</dt><dd>{confirmedBet.multiplier.toFixed(2)}×</dd></div><div className="recap-return"><dt>If you win</dt><dd>{confirmedBet.totalReturn} ETH<small>Stake returned + {confirmedBet.profit} ETH profit</small></dd></div></dl></section>}
    {(market?.phase === 'proposed' || market?.phase === 'challenged') && <ChallengeTimeline />}
    <p className="ticket-fineprint"><ShieldCheck /> Settlement secured on {GAME_CONFIG.NETWORK.NAME}</p>
  </aside>;
}

export const RoomBettingConsole = memo(RoomBettingConsoleComponent);
