import { isPlatformAdmin } from '@/config/detection-zone';
import { AUTH_API_URL } from '@/lib/wagmi';
import { Check, ChevronDown, CircleAlert, Copy, ExternalLink, Loader2, LockKeyhole, LogOut, RefreshCw, ShieldCheck, UserRound, Wallet, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatUnits } from 'viem';
import { useAccount, useBalance, useConnect, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import Counter from './Counter';

type AuthState = 'checking' | 'idle' | 'signing' | 'authenticated' | 'error' | 'offline';
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function WalletButton() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const accountWidgetRef = useRef<HTMLDivElement>(null);
  const { address, chainId, connector, isConnected } = useAccount();
  const balance = useBalance({ address, chainId: arbitrumSepolia.id });
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();

  useEffect(() => {
    if (!isConnected) { setAuthState('idle'); return; }
    fetch(`${AUTH_API_URL}/auth/session`, { credentials: 'include' })
      .then(async response => {
        if (!response.ok) { setAuthState('idle'); return; }
        const session = await response.json() as { address?: string };
        setAuthState(session.address?.toLowerCase() === address?.toLowerCase() ? 'authenticated' : 'idle');
      })
      .catch(() => setAuthState('offline'));
  }, [isConnected, address]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!accountWidgetRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); setWalletPickerOpen(false); } };
    window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const authenticate = useCallback(async (walletAddress: `0x${string}`) => {
    setAuthState('signing');
    try {
      const nonceResponse = await fetch(`${AUTH_API_URL}/auth/nonce`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: walletAddress, chainId: arbitrumSepolia.id }) });
      if (!nonceResponse.ok) throw new Error('challenge');
      const { message } = await nonceResponse.json() as { message: string };
      const signature = await signMessageAsync({ message });
      const verifyResponse = await fetch(`${AUTH_API_URL}/auth/verify`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }) });
      if (!verifyResponse.ok) throw new Error('verification');
      setAuthState('authenticated');
    } catch (error) {
      setAuthState(error instanceof TypeError ? 'offline' : 'error');
    }
  }, [signMessageAsync]);

  async function signOut() {
    try { await fetch(`${AUTH_API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { /* local session expires server-side */ }
    setAccountOpen(false); disconnect();
  }

  const connected = isConnected && address;
  return <div className="account-widget" ref={accountWidgetRef}>
    {!connected ? <button className="wallet-button" onClick={() => setWalletPickerOpen(true)}><Wallet /> Connect wallet</button> :
      <button className={`wallet-account-trigger ${authState === 'authenticated' ? 'verified' : ''}`} aria-haspopup="dialog" aria-expanded={accountOpen} onClick={() => setAccountOpen(value => !value)}>
        <span className="wallet-identicon">{address.slice(2,4).toUpperCase()}</span><span><b>{shortAddress(address)}</b><small>{balance.data ? `${Number(formatUnits(balance.data.value, balance.data.decimals)).toFixed(5)} ETH` : 'Arbitrum Sepolia'}</small></span><i /><ChevronDown />
      </button>}

    {connected && accountOpen && <section className="wallet-account-panel" role="dialog" aria-label="Wallet account">
      <header><span className="wallet-identicon large">{address.slice(2,4).toUpperCase()}</span><div><b>{shortAddress(address)}</b><span>{connector?.name ?? 'Browser wallet'}</span></div><button onClick={() => setAccountOpen(false)} aria-label="Close account"><X /></button></header>
      <div className="wallet-balance"><span>Total balance</span><strong>{balance.data ? <Counter value={Number(formatUnits(balance.data.value, balance.data.decimals))} fontSize={28} padding={2} gap={3} textColor="inherit" fontWeight={900} gradientHeight={0} places={[1000, 100, 10, 1, '.', 0.1, 0.01, 0.001, 0.0001, 0.00001]} /> : '—'} <small>ETH</small></strong><em>Arbitrum Sepolia</em></div>
      <div className={`auth-health ${authState}`}>
        {authState === 'authenticated' ? <ShieldCheck /> : authState === 'signing' || authState === 'checking' ? <Loader2 className="animate-spin" /> : <CircleAlert />}
        <div><b>{authState === 'authenticated' ? 'Session verified' : authState === 'offline' ? 'Authentication service offline' : authState === 'signing' ? 'Waiting for signature' : 'Signature required'}</b><span>{authState === 'authenticated' ? 'Proof publishing and betting unlocked.' : authState === 'offline' ? 'Start the full app with npm run dev.' : 'Sign once. No transaction or gas fee.'}</span></div>
      </div>
      {chainId !== arbitrumSepolia.id ? <button className="account-primary" onClick={() => switchChainAsync({ chainId: arbitrumSepolia.id })}><RefreshCw /> Switch network</button> : authState !== 'authenticated' && <button className="account-primary" disabled={authState === 'signing'} onClick={() => authenticate(address)}><ShieldCheck /> {authState === 'error' ? 'Try authentication again' : authState === 'offline' ? 'Check service again' : 'Verify wallet session'}</button>}
      <div className="wallet-quick-actions"><button onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check /> : <Copy />}<span>{copied ? 'Copied' : 'Copy address'}</span></button><a href={`https://sepolia.arbiscan.io/address/${address}`} target="_blank" rel="noreferrer"><ExternalLink /><span>Explorer</span></a></div>
      <nav><Link to="/profile" onClick={() => setAccountOpen(false)}><UserRound /> Profile</Link><Link to="/activity" onClick={() => setAccountOpen(false)}><RefreshCw /> Activity</Link>{isPlatformAdmin(address) && <Link to="/admin" onClick={() => setAccountOpen(false)}><LockKeyhole /> Admin console</Link>}</nav>
      <button className="wallet-disconnect" onClick={signOut}><LogOut /> Disconnect wallet</button>
    </section>}

    {walletPickerOpen && <div className="wallet-picker-backdrop" role="presentation" onMouseDown={() => setWalletPickerOpen(false)}><section className="wallet-picker" role="dialog" aria-modal="true" aria-label="Choose a wallet" onMouseDown={(event) => event.stopPropagation()}><header><div><b>Connect a wallet</b><span>Choose an installed extension or connect securely by QR.</span></div><button autoFocus onClick={() => setWalletPickerOpen(false)} aria-label="Close"><X /></button></header><div className="wallet-options">{connectors.map((item) => <button key={item.uid} disabled={connecting} onClick={async () => { try { await connectAsync({ connector: item, chainId: arbitrumSepolia.id }); setWalletPickerOpen(false); setAccountOpen(true); } catch { /* wallet reports cancellation */ } }}><span className="wallet-option-icon">{item.icon ? <img src={item.icon} alt="" /> : <Wallet />}</span><span><b>{item.name}</b><small>{item.type === 'injected' ? 'Detected browser extension' : 'Mobile wallet or QR code'}</small></span><ChevronDown /></button>)}</div><div className="wallet-safety"><ShieldCheck /><span><b>Safe connection</b>Crossflow will never request your seed phrase, private key, or wallet backup.</span></div></section></div>}
  </div>;
}
