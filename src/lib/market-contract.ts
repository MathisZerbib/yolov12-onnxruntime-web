import { keccak256, toBytes } from 'viem';

export const MARKET_STATUS = { NONE: 0, OPEN: 1, PROPOSED: 2, CHALLENGED: 3, RESOLVED: 4, CANCELLED: 5 } as const;

export const trafficMarketAbi = [
  { type: 'function', name: 'latestMarketIdByRoom', stateMutability: 'view', inputs: [{ name: 'roomId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'roleAccount', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'outcomePools', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'outcome', type: 'uint8' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'getMarket', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [
    { name: 'roomId', type: 'bytes32' }, { name: 'closeTime', type: 'uint64' }, { name: 'resolveDeadline', type: 'uint64' },
    { name: 'claimDeadline', type: 'uint64' }, { name: 'challengeDeadline', type: 'uint64' }, { name: 'disputeDeadline', type: 'uint64' },
    { name: 'lowerBound', type: 'uint32' }, { name: 'upperBound', type: 'uint32' }, { name: 'exactTarget', type: 'uint32' },
    { name: 'finalCount', type: 'uint32' }, { name: 'zoneVersion', type: 'uint32' }, { name: 'feeBps', type: 'uint16' },
    { name: 'winner', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'evidenceHash', type: 'bytes32' },
    { name: 'zoneConfigHash', type: 'bytes32' }, { name: 'challengerEvidenceHash', type: 'bytes32' },
    { name: 'challenger', type: 'address' }, { name: 'totalPool', type: 'uint256' }, { name: 'winningPool', type: 'uint256' },
  ] }] },
  { type: 'function', name: 'createMarket', stateMutability: 'nonpayable', inputs: [
    { name: 'roomId', type: 'bytes32' }, { name: 'closeTime', type: 'uint64' }, { name: 'resolveDeadline', type: 'uint64' },
    { name: 'lowerBound', type: 'uint32' }, { name: 'upperBound', type: 'uint32' }, { name: 'exactTarget', type: 'uint32' },
    { name: 'feeBps', type: 'uint16' },
  ], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'nextMarketId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'roomZones', stateMutability: 'view', inputs: [{ name: 'roomId', type: 'bytes32' }], outputs: [
    { name: '', type: 'uint16[8]' }, { name: 'version', type: 'uint32' }, { name: 'configHash', type: 'bytes32' }
  ] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'hasRole', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'setRoomZone', stateMutability: 'nonpayable', inputs: [
    { name: 'roomId', type: 'bytes32' },
    { name: 'geometry', type: 'uint16[8]' },
  ], outputs: [] },
  { type: 'function', name: 'isMarketBettable', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'protocolFees', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'availableLiquidity', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'lockedPayouts', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'fundLiquidity', stateMutability: 'payable', inputs: [], outputs: [] },
  { type: 'function', name: 'bet', stateMutability: 'payable', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'outcome', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'account', type: 'address' }, { name: 'outcome', type: 'uint8' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'claimed', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'claimAll', stateMutability: 'nonpayable', inputs: [{ name: 'marketIds', type: 'uint256[]' }], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelExpired', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'finalizeResult', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'multiplierBps', stateMutability: 'pure', inputs: [{ name: 'outcome', type: 'uint8' }], outputs: [{ name: '', type: 'uint16' }] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'unpause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'upgradeToAndCall', stateMutability: 'payable', inputs: [
    { name: 'newImplementation', type: 'address' }, { name: 'data', type: 'bytes' }
  ], outputs: [] },
  { type: 'function', name: 'proxiableUUID', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
  { type: 'function', name: 'UPGRADE_INTERFACE_VERSION', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'rotateOperationalRole', stateMutability: 'nonpayable', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'newAccount', type: 'address' }], outputs: [] },
  { type: 'function', name: 'rotateAllOperationalRoles', stateMutability: 'nonpayable', inputs: [{ name: 'oracle', type: 'address' }, { name: 'marketOperator', type: 'address' }, { name: 'disputeResolver', type: 'address' }], outputs: [] },
  { type: 'error', name: 'InvalidMarket', inputs: [] },
  { type: 'error', name: 'InvalidConfiguration', inputs: [] },
  { type: 'error', name: 'MarketClosed', inputs: [] },
  { type: 'error', name: 'MarketNotClosed', inputs: [] },
  { type: 'error', name: 'MarketNotClaimable', inputs: [] },
  { type: 'error', name: 'InvalidStake', inputs: [] },
  { type: 'error', name: 'AlreadyClaimed', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
  { type: 'error', name: 'UnauthorizedZoneAdmin', inputs: [] },
  { type: 'error', name: 'StaleZoneConfiguration', inputs: [] },
  { type: 'error', name: 'ActiveMarketExists', inputs: [{ name: 'marketId', type: 'uint256' }] },
  { type: 'error', name: 'InsufficientLiquidity', inputs: [{ name: 'required', type: 'uint256' }, { name: 'available', type: 'uint256' }] },
] as const;
export const DEFAULT_TESTNET_MARKET_ADDRESS = '0xDe5D11Af502eA4E11c8eA02F2ff22cd6a41b0139' as const;
export const marketContractAddress = (import.meta.env.VITE_MARKET_CONTRACT_ADDRESS || DEFAULT_TESTNET_MARKET_ADDRESS) as `0x${string}`;
export function marketRoomKey(roomId: string): `0x${string}` { return keccak256(toBytes(roomId)); }
