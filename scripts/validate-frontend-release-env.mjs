const required = [
  'VITE_WALLETCONNECT_PROJECT_ID',
  'VITE_AUTH_API_URL',
  'VITE_MARKET_CONTRACT_ADDRESS',
];

const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing frontend release configuration: ${missing.join(', ')}`);

new URL(process.env.VITE_AUTH_API_URL);
if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.VITE_MARKET_CONTRACT_ADDRESS)) {
  throw new Error('VITE_MARKET_CONTRACT_ADDRESS must be a 20-byte EVM address');
}

console.log('Frontend release environment is valid');
