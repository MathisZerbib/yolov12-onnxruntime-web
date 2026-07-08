export type RoundStatus = 'idle' | 'betting' | 'processing' | 'result';
export type RoundPhase = RoundStatus;

export const GAME_CONFIG = {
  NETWORK: {
    CHAIN_ID: 421614,
    NAME: "Arbitrum Sepolia",
    RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
  },

  BETTING: {
    MIN_ETH: 0.001,
    MAX_ETH: 10,
    HOUSE_EDGE: 0.97,
    PRESETS: [0.001, 0.01, 0.05, 0.1, 0.5, 1] as const,
  },
  ETH_USD_PRICE: 3850,
} as const;

export const BET_TYPES = [
  {
    id: 0 as const,
    name: "UNDER",
    mult: 2.0,
    multDisplay: "2.00x",
    description: "Count below target",
    color: "#EF4444",
    colorClass: "text-red-500",
    bgClass: "bg-red-500/15",
    borderClass: "border-red-500/30",
    ringSelected: "ring-red-500/30",
  },
  {
    id: 1 as const,
    name: "RANGE",
    mult: 3.0,
    multDisplay: "3.00x",
    description: "Count within range",
    color: "#3B82F6",
    colorClass: "text-blue-500",
    bgClass: "bg-blue-500/15",
    borderClass: "border-blue-500/30",
    ringSelected: "ring-blue-500/30",
  },
  {
    id: 2 as const,
    name: "OVER",
    mult: 2.0,
    multDisplay: "2.00x",
    description: "Count above target",
    color: "#22C55E",
    colorClass: "text-green-500",
    bgClass: "bg-green-500/15",
    borderClass: "border-green-500/30",
    ringSelected: "ring-green-500/30",
  },
  {
    id: 3 as const,
    name: "EXACT",
    mult: 10.0,
    multDisplay: "10.00x",
    description: "Exact vehicle count",
    color: "#EAB308",
    colorClass: "text-yellow-500",
    bgClass: "bg-yellow-500/15",
    borderClass: "border-yellow-500/30",
    ringSelected: "ring-yellow-500/30",
  },
] as const;