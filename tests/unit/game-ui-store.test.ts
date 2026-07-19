import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BET_DRAFT, useGameUiStore } from '@/stores/game-ui-store';

describe('game UI store', () => {
  beforeEach(() => {
    localStorage.clear();
    useGameUiStore.setState({ roomDrafts: {} });
  });

  it('keeps independent drafts per room', () => {
    useGameUiStore.getState().setOutcome('tokyo', 2);
    useGameUiStore.getState().setStake('paris', '0.5');
    expect(useGameUiStore.getState().roomDrafts.tokyo).toEqual({ ...DEFAULT_BET_DRAFT, outcome: 2 });
    expect(useGameUiStore.getState().roomDrafts.paris).toEqual({ ...DEFAULT_BET_DRAFT, stake: '0.5' });
  });

  it('clamps outcomes and sanitizes stake input', () => {
    useGameUiStore.getState().setOutcome('tokyo', 99.9);
    useGameUiStore.getState().setStake('tokyo', 'ETH 1.2.3abc');
    expect(useGameUiStore.getState().roomDrafts.tokyo).toEqual({ outcome: 3, stake: '1.23' });
  });

  it('limits draft length and clears a room without touching others', () => {
    useGameUiStore.getState().setStake('tokyo', '1'.repeat(40));
    useGameUiStore.getState().setStake('paris', '0.1');
    expect(useGameUiStore.getState().roomDrafts.tokyo.stake).toHaveLength(24);
    useGameUiStore.getState().clearRoomDraft('tokyo');
    expect(useGameUiStore.getState().roomDrafts.tokyo).toBeUndefined();
    expect(useGameUiStore.getState().roomDrafts.paris.stake).toBe('0.1');
  });
});
