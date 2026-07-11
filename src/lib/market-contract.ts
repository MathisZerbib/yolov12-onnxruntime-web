export const trafficMarketAbi = [{ type: 'function', name: 'bet', stateMutability: 'payable', inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'outcome', type: 'uint8' }], outputs: [] }] as const;
export const marketContractAddress = import.meta.env.VITE_MARKET_CONTRACT_ADDRESS as `0x${string}` | undefined;
export const activeMarketId = BigInt(import.meta.env.VITE_ACTIVE_MARKET_ID ?? '0');
