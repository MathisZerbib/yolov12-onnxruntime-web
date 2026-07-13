import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { GAME_CONFIG } from '@/config/game-config';

interface RoomBetDraft {
  outcome: number;
  stake: string;
}

interface GameUiState {
  roomDrafts: Record<string, RoomBetDraft>;
  setOutcome: (roomId: string, outcome: number) => void;
  setStake: (roomId: string, stake: string) => void;
  clearRoomDraft: (roomId: string) => void;
}

export const DEFAULT_BET_DRAFT: Readonly<RoomBetDraft> = {
  outcome: 0,
  stake: String(GAME_CONFIG.BETTING.MIN_ETH),
};

const normalizeStakeDraft = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 24);

export const useGameUiStore = create<GameUiState>()(persist(
  (set) => ({
    roomDrafts: {},
    setOutcome: (roomId, outcome) => set((state) => ({
      roomDrafts: {
        ...state.roomDrafts,
        [roomId]: { ...(state.roomDrafts[roomId] ?? DEFAULT_BET_DRAFT), outcome: Math.max(0, Math.min(3, Math.trunc(outcome))) },
      },
    })),
    setStake: (roomId, stake) => set((state) => ({
      roomDrafts: {
        ...state.roomDrafts,
        [roomId]: { ...(state.roomDrafts[roomId] ?? DEFAULT_BET_DRAFT), stake: normalizeStakeDraft(stake) },
      },
    })),
    clearRoomDraft: (roomId) => set((state) => {
      const roomDrafts = { ...state.roomDrafts };
      delete roomDrafts[roomId];
      return { roomDrafts };
    }),
  }),
  {
    name: 'crossflow-game-ui',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({ roomDrafts: state.roomDrafts }),
  },
));
