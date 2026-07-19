import { memo, useCallback, useEffect, useState } from 'react';
import { formatEther, parseEther } from 'viem';
import { ShieldCheck } from 'lucide-react';
import { usePublicClient } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { BET_TYPES, GAME_CONFIG } from '@/config/game-config';
import { ChallengeTimeline } from '@/components/challenge-timeline';
import { PlacePositionButton } from '@/components/place-position-button';
import { BetResultDialog } from '@/components/bet-result-dialog';
import type { RoomMarketState } from '@/lib/room-market';
import { DEFAULT_BET_DRAFT, useGameUiStore } from '@/stores/game-ui-store';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { useEthUsdPrice } from '@/lib/use-eth-usd-price';

interface RoomBettingConsoleProps {
  roomId: string;
  market: RoomMarketState | null;
  marketLoading: boolean;
  marketStale: boolean;
  marketError: string;
  personalSecondsRemaining: number | null;
  personalFinalCount: number | null;
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
  outcome: number;
  lowerBound: number;
  upperBound: number;
  exactTarget: number;
}

type BetResult = { state: 'win' | 'loss' | 'refund'; finalCount: number; settled: boolean };

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

function RoomBettingConsoleComponent({ roomId, market, marketLoading, marketStale, marketError, personalSecondsRemaining, personalFinalCount, onRefresh, onPositionConfirmed }: RoomBettingConsoleProps) {
  const selectedType = useGameUiStore((state) => state.roomDrafts[roomId]?.outcome ?? DEFAULT_BET_DRAFT.outcome);
  const ethAmount = useGameUiStore((state) => state.roomDrafts[roomId]?.stake ?? DEFAULT_BET_DRAFT.stake);
  const setOutcome = useGameUiStore((state) => state.setOutcome);
  const setStake = useGameUiStore((state) => state.setStake);
  const [confirmedBet, setConfirmedBet] = useState<ConfirmedBet | null>(null);
  const [betResult, setBetResult] = useState<BetResult | null>(null);
  const ethUsdPrice = useEthUsdPrice();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const selectedBet = BET_TYPES.find((type) => type.id === selectedType) ?? BET_TYPES[0];
  const claimEstimate = estimatedClaim(market, selectedType, ethAmount);
  const stakeValue = Number(ethAmount);
  const returnValue = claimEstimate ? Number(claimEstimate) : 0;
  const profitEstimate = claimEstimate && Number.isFinite(stakeValue) ? Math.max(0, returnValue - stakeValue).toFixed(4) : null;
  const guaranteedMultiplier = GAME_CONFIG.BETTING.MULTIPLIERS[selectedType] ?? 1;
  const roundDuration = 30;
  const open = market?.phase === 'open' && !marketStale;
  const personalRunActive = personalSecondsRemaining !== null && personalSecondsRemaining > 0;
  const gameLocked = confirmedBet !== null;
  const elapsedPercent = personalRunActive ? Math.min(100, Math.max(0, (roundDuration - personalSecondsRemaining) / roundDuration * 100)) : 0;
  const roundStatus = marketLoading ? 'SYNCING' : personalRunActive ? 'PLAYING' : open ? 'READY' : 'PREPARING';
  const roundTiming = personalRunActive ? `Your detector is live · ${formatCountdown(personalSecondsRemaining)}` : 'Bet to start your personal 30-second game';

  const outcomeDescription = (typeId: number, fallback: string) => {
    if (!market || market.lowerBound === null || market.upperBound === null || market.exactTarget === null) return fallback;
    if (typeId === 0) return `Below ${market.lowerBound}`;
    if (typeId === 1) return `${market.lowerBound}–${market.upperBound}, except ${market.exactTarget}`;
    if (typeId === 2) return `Above ${market.upperBound}`;
    return `Exactly ${market.exactTarget}`;
  };
  const selectedPredictionDetail = outcomeDescription(selectedType, selectedBet.description);
  const marketId = market?.marketId;
  const marketLowerBound = market?.lowerBound ?? 0;
  const marketUpperBound = market?.upperBound ?? 0;
  const marketExactTarget = market?.exactTarget ?? 0;
  const handleConfirmed = useCallback(() => {
    if (marketId && claimEstimate && profitEstimate) setConfirmedBet({
      marketId,
      prediction: selectedBet.name,
      predictionDetail: selectedPredictionDetail,
      stake: ethAmount,
      multiplier: guaranteedMultiplier,
      totalReturn: claimEstimate,
      profit: profitEstimate,
      outcome: selectedType + 1,
      lowerBound: marketLowerBound,
      upperBound: marketUpperBound,
      exactTarget: marketExactTarget,
    });
    setBetResult(null);
    onRefresh();
    onPositionConfirmed();
  }, [claimEstimate, ethAmount, guaranteedMultiplier, marketExactTarget, marketId, marketLowerBound, marketUpperBound, onPositionConfirmed, onRefresh, profitEstimate, selectedBet.name, selectedPredictionDetail, selectedType]);
  useEffect(() => {
    if (!confirmedBet || !publicClient || betResult?.settled) return;
    let cancelled = false;
    let timer: number | undefined;
    const checkResult = async () => {
      try {
        const result = await publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'getMarket', args: [BigInt(confirmedBet.marketId)] }) as { status: number; winner: number; finalCount: number };
        if (cancelled) return;
        if (result.status === 4) setBetResult({ state: result.winner === confirmedBet.outcome ? 'win' : 'loss', finalCount: result.finalCount, settled: true });
        else if (result.status === 5) setBetResult({ state: 'refund', finalCount: result.finalCount, settled: true });
        else timer = window.setTimeout(() => void checkResult(), 5_000);
      } catch { timer = window.setTimeout(() => void checkResult(), 8_000); }
    };
    void checkResult();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [betResult, confirmedBet, publicClient]);
  const detectedResult: BetResult | null = confirmedBet && personalFinalCount !== null ? {
    state: (personalFinalCount === confirmedBet.exactTarget ? 4
      : personalFinalCount < confirmedBet.lowerBound ? 1
        : personalFinalCount <= confirmedBet.upperBound ? 2 : 3) === confirmedBet.outcome ? 'win' : 'loss',
    finalCount: personalFinalCount,
    settled: false,
  } : null;
  const displayedResult = betResult ?? detectedResult;
  const handleContinue = useCallback(() => {
    setConfirmedBet(null);
    setBetResult(null);
  }, []);
  const multiple = (outcome: number) => {
    const claim = estimatedClaim(market, outcome, ethAmount);
    const stake = Number(ethAmount);
    return claim && stake > 0 ? `${(Number(claim) / stake).toFixed(2)}×` : '—';
  };

  return <>
  <aside className="room-ticket" aria-label="Bet slip">
    <div className="round-header"><div><span>{market?.marketId ? `ROUND #${market.marketId}` : 'LIVE ROUND'}</span><b>{roundTiming}</b></div><i data-state={roundStatus.toLowerCase()}>{roundStatus}</i></div>
    <section className={`round-clock ${personalRunActive ? 'is-playing' : 'is-ready'}`} aria-label="Personal game timing"><div><span>Your game duration</span><b>{formatDuration(roundDuration)}</b></div><div><span>{personalRunActive ? 'Time remaining' : 'Starts'}</span><b>{personalRunActive ? formatCountdown(personalSecondsRemaining) : 'After confirmation'}</b></div><div className="round-progress" aria-hidden="true"><i style={{ transform: `scaleX(${elapsedPercent / 100})` }} /></div><p>{personalRunActive ? 'Vehicle detection is running for your confirmed bet.' : 'There is no pre-bet countdown. Your own 30-second game starts when your transaction confirms.'}</p></section>
    <div className="ticket-title"><h1>How many vehicles cross the zone?</h1><p>Choose a result and bet when you are ready. Returns are fixed and bankroll-backed.</p></div>
    {(marketError || market?.error || marketStale) && <div className="round-sync-warning" role="status"><span>{marketStale ? 'Round data is stale. Refresh before betting.' : marketError || market?.error}</span><button onClick={onRefresh}>Refresh</button></div>}
    <div className="ticket-block"><label>Choose outcome</label><div className="room-outcomes">{BET_TYPES.map((type) => <button key={type.id} disabled={!open || gameLocked} aria-pressed={selectedType === type.id} className={selectedType === type.id ? 'active' : ''} onClick={() => setOutcome(roomId, type.id)}><span>{type.name}<small>{outcomeDescription(type.id, type.description)}</small></span><b>{multiple(type.id)} guaranteed</b></button>)}</div></div>
    <div className="ticket-block"><div className="ticket-label"><label htmlFor="room-stake">Stake</label><span>Fixed return · bankroll backed</span></div><div className="ticket-amount"><input id="room-stake" aria-label="ETH stake" disabled={gameLocked} type="text" inputMode="decimal" autoComplete="off" value={ethAmount} onChange={(event) => setStake(roomId, event.target.value)} /><span>ETH</span></div><div className="room-presets">{GAME_CONFIG.BETTING.PRESETS.slice(1, 5).map((preset) => <button key={preset} disabled={gameLocked} onClick={() => setStake(roomId, String(preset))}>{preset}</button>)}</div></div>
    {!gameLocked && <PlacePositionButton roomId={roomId} market={market} stale={marketStale} outcome={selectedType} amount={ethAmount} error={marketError || market?.error} onConfirmed={handleConfirmed} />}
    {gameLocked && !displayedResult && <section className="bet-awaiting" role="status" aria-live="polite"><span className="is-spinning" /><div><b>{personalRunActive ? 'YOUR GAME IS LIVE' : 'CALCULATING YOUR RESULT'}</b><small>{personalRunActive ? `${formatCountdown(personalSecondsRemaining!)} remaining · counting vehicles now` : 'Finishing the 30-second vehicle count…'}</small></div></section>}
    {confirmedBet && <section className="bet-recap is-confirmed" aria-labelledby="bet-recap-title"><header><span id="bet-recap-title">Bet recap</span><b>CONFIRMED · ROUND #{confirmedBet.marketId}</b></header><dl><div><dt>Your prediction</dt><dd>{confirmedBet.prediction}<small>{confirmedBet.predictionDetail}</small></dd></div><div><dt>Your stake</dt><dd>{confirmedBet.stake} ETH</dd></div><div><dt>Guaranteed multiplier</dt><dd>{confirmedBet.multiplier.toFixed(2)}×</dd></div><div className="recap-return"><dt>If you win</dt><dd>{confirmedBet.totalReturn} ETH<small>Stake returned + {confirmedBet.profit} ETH profit</small></dd></div></dl></section>}
    {(market?.phase === 'proposed' || market?.phase === 'challenged') && <ChallengeTimeline />}
    <p className="ticket-fineprint"><ShieldCheck /> Settlement secured on {GAME_CONFIG.NETWORK.NAME}</p>
  </aside>
  {displayedResult && <BetResultDialog state={displayedResult.state} finalCount={displayedResult.finalCount} settled={displayedResult.settled} totalReturn={confirmedBet?.totalReturn} stake={confirmedBet?.stake} ethUsdPrice={ethUsdPrice} onContinue={handleContinue} />}
  </>;
}

export const RoomBettingConsole = memo(RoomBettingConsoleComponent);
