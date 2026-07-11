import { createConfig, http } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { walletConnect } from 'wagmi/connectors';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
if (!projectId) throw new Error('VITE_WALLETCONNECT_PROJECT_ID is required');

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia],
  connectors: [walletConnect({ projectId, showQrModal: true, metadata: {
    name: 'Crossflow', description: 'On-chain traffic prediction markets', url: window.location.origin, icons: [],
  } })],
  multiInjectedProviderDiscovery: true,
  transports: { [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc') },
});

export const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL ?? '';
