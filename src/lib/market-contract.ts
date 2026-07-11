export const trafficMarketAbi = [
  { type: 'function', name: 'bet', stateMutability: 'payable', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'outcome', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'setRoomZone', stateMutability: 'nonpayable', inputs: [
    { name: 'roomId', type: 'bytes32' },
    { name: 'x1Bps', type: 'uint16' }, { name: 'y1Bps', type: 'uint16' },
    { name: 'x2Bps', type: 'uint16' }, { name: 'y2Bps', type: 'uint16' },
    { name: 'countingLineYBps', type: 'uint16' },
  ], outputs: [] },
] as const;
export const marketContractAddress = import.meta.env.VITE_MARKET_CONTRACT_ADDRESS as `0x${string}` | undefined;
export const activeMarketId = BigInt(import.meta.env.VITE_ACTIVE_MARKET_ID ?? '0');
