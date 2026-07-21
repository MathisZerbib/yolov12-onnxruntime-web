export type PlayerPositionLifecycle =
  | 'betting'
  | 'awaiting_result'
  | 'refund_recovery'
  | 'proposed'
  | 'finalizable'
  | 'challenged'
  | 'claimable'
  | 'claimed'
  | 'lost'
  | 'unknown';

export type PlayerPositionAction = 'claim' | 'cancel_expired' | 'finalize' | null;

interface SummarizePlayerPositionInput {
  status: number;
  winner: number;
  closeTime: number;
  resolveDeadline: number;
  challengeDeadline: number;
  disputeDeadline: number;
  stakes: readonly [bigint, bigint, bigint, bigint];
  multiplierBps: readonly [bigint, bigint, bigint, bigint];
  claimed: boolean;
  nowSeconds: number;
}

export interface PlayerPositionSummary {
  stake: bigint;
  payout: bigint;
  profit: bigint;
  lifecycle: PlayerPositionLifecycle;
  action: PlayerPositionAction;
  nextTransitionAt: number | null;
}

export const POSITION_REFRESH_INTERVAL_MS = 30_000;

export function nextPositionRefreshDelayMs(
  positions: readonly Pick<PlayerPositionSummary, 'lifecycle' | 'nextTransitionAt'>[],
  nowMs: number,
): number | null {
  const unresolved = positions.filter((position) => [
    'betting', 'awaiting_result', 'refund_recovery', 'proposed', 'finalizable', 'challenged',
  ].includes(position.lifecycle));
  if (unresolved.length === 0) return null;

  const nextTransitionMs = unresolved.reduce<number | null>((earliest, position) => {
    if (position.nextTransitionAt === null) return earliest;
    const transitionMs = position.nextTransitionAt * 1_000;
    return earliest === null ? transitionMs : Math.min(earliest, transitionMs);
  }, null);
  if (nextTransitionMs === null) return POSITION_REFRESH_INTERVAL_MS;
  return Math.max(1_000, Math.min(POSITION_REFRESH_INTERVAL_MS, nextTransitionMs - nowMs));
}

export function orderedUniqueMarketIds(ids: readonly (bigint | undefined)[]): bigint[] {
  return [...new Set(ids.filter((id): id is bigint => id !== undefined))].sort((a, b) => a === b ? 0 : a > b ? -1 : 1);
}

export function claimableMarketIds(
  positions: readonly { marketId: bigint; lifecycle: PlayerPositionLifecycle }[],
): bigint[] {
  return positions.filter((position) => position.lifecycle === 'claimable').map((position) => position.marketId);
}

export function summarizePlayerPosition(input: SummarizePlayerPositionInput): PlayerPositionSummary {
  const stake = input.stakes.reduce((sum, value) => sum + value, 0n);
  let payout = 0n;
  if (input.status === 5) payout = stake;
  if (input.status === 4 && input.winner >= 1 && input.winner <= 4) {
    const index = input.winner - 1;
    payout = input.stakes[index] * input.multiplierBps[index] / 10_000n;
  }

  let profit = 0n;
  if (input.status === 4) {
    profit = payout - stake;
  }

  if (input.claimed && payout > 0n) return { stake, payout, profit, lifecycle: 'claimed', action: null, nextTransitionAt: null };
  if (input.status === 4) return payout > 0n
    ? { stake, payout, profit, lifecycle: 'claimable', action: 'claim', nextTransitionAt: null }
    : { stake, payout, profit, lifecycle: 'lost', action: null, nextTransitionAt: null };
  if (input.status === 5) return { stake, payout, profit, lifecycle: 'claimable', action: 'claim', nextTransitionAt: null };
  if (input.status === 1) {
    if (input.nowSeconds < input.closeTime) return { stake, payout, profit, lifecycle: 'betting', action: null, nextTransitionAt: input.closeTime };
    if (input.nowSeconds > input.resolveDeadline) return { stake, payout, profit, lifecycle: 'refund_recovery', action: 'cancel_expired', nextTransitionAt: null };
    return { stake, payout, profit, lifecycle: 'awaiting_result', action: null, nextTransitionAt: input.resolveDeadline + 1 };
  }
  if (input.status === 2) return input.nowSeconds > input.challengeDeadline
    ? { stake, payout, profit, lifecycle: 'finalizable', action: 'finalize', nextTransitionAt: null }
    : { stake, payout, profit, lifecycle: 'proposed', action: null, nextTransitionAt: input.challengeDeadline + 1 };
  if (input.status === 3) return {
    stake,
    payout,
    profit,
    lifecycle: 'challenged',
    action: null,
    nextTransitionAt: input.disputeDeadline > input.nowSeconds ? input.disputeDeadline + 1 : null,
  };
  return { stake, payout, profit, lifecycle: 'unknown', action: null, nextTransitionAt: null };
}

export function playerPositionLabel(lifecycle: PlayerPositionLifecycle, finalCount: number, marketStatus?: number): string {
  if (lifecycle === 'betting') return 'Betting window is still open';
  if (lifecycle === 'awaiting_result') return 'Waiting for verified on-chain result';
  if (lifecycle === 'refund_recovery') return 'Settlement expired · refund can be unlocked';
  if (lifecycle === 'proposed') return 'Result proposed · challenge window open';
  if (lifecycle === 'finalizable') return 'Challenge window ended · ready to finalize';
  if (lifecycle === 'challenged') return 'Result challenged · awaiting resolver';
  if (lifecycle === 'claimable') return marketStatus === 5 ? 'Cancelled round refund' : `Final count ${finalCount}`;
  if (lifecycle === 'claimed') return marketStatus === 5 ? 'Refund claimed' : `Claimed · final count ${finalCount}`;
  if (lifecycle === 'lost') return `Finalized loss · final count ${finalCount}`;
  return 'On-chain state unavailable';
}
