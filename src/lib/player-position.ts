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
  stakes: readonly [bigint, bigint, bigint, bigint];
  multiplierBps: readonly [bigint, bigint, bigint, bigint];
  claimed: boolean;
  nowSeconds: number;
}

export interface PlayerPositionSummary {
  stake: bigint;
  payout: bigint;
  lifecycle: PlayerPositionLifecycle;
  action: PlayerPositionAction;
}

export function orderedUniqueMarketIds(ids: readonly (bigint | undefined)[]): bigint[] {
  return [...new Set(ids.filter((id): id is bigint => id !== undefined))].sort((a, b) => a === b ? 0 : a > b ? -1 : 1);
}

export function summarizePlayerPosition(input: SummarizePlayerPositionInput): PlayerPositionSummary {
  const stake = input.stakes.reduce((sum, value) => sum + value, 0n);
  let payout = 0n;
  if (input.status === 5) payout = stake;
  if (input.status === 4 && input.winner >= 1 && input.winner <= 4) {
    const index = input.winner - 1;
    payout = input.stakes[index] * input.multiplierBps[index] / 10_000n;
  }

  if (input.claimed && payout > 0n) return { stake, payout, lifecycle: 'claimed', action: null };
  if (input.status === 4) return payout > 0n
    ? { stake, payout, lifecycle: 'claimable', action: 'claim' }
    : { stake, payout, lifecycle: 'lost', action: null };
  if (input.status === 5) return { stake, payout, lifecycle: 'claimable', action: 'claim' };
  if (input.status === 1) {
    if (input.nowSeconds < input.closeTime) return { stake, payout, lifecycle: 'betting', action: null };
    if (input.nowSeconds > input.resolveDeadline) return { stake, payout, lifecycle: 'refund_recovery', action: 'cancel_expired' };
    return { stake, payout, lifecycle: 'awaiting_result', action: null };
  }
  if (input.status === 2) return input.nowSeconds > input.challengeDeadline
    ? { stake, payout, lifecycle: 'finalizable', action: 'finalize' }
    : { stake, payout, lifecycle: 'proposed', action: null };
  if (input.status === 3) return { stake, payout, lifecycle: 'challenged', action: null };
  return { stake, payout, lifecycle: 'unknown', action: null };
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
