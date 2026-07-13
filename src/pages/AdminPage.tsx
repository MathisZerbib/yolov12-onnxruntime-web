import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Crosshair, KeyRound, LockKeyhole, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import { usePublicClient } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { keccak256, toBytes } from 'viem';
import { WalletButton } from '@/components/wallet-button';
import { PLATFORM_ADMIN_ADDRESS } from '@/config/detection-zone';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { AUTH_API_URL } from '@/lib/wagmi';
import { ROOMS } from '@/lib/globe-markers';

interface AdminReadiness {
  zones: number;
  automated: number;
  checked: boolean;
}

export default function AdminPage() {
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [compatible, setCompatible] = useState<boolean | null>(null);
  const [readiness, setReadiness] = useState<AdminReadiness>({ zones: 0, automated: 0, checked: false });
  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    setCompatible(null);
    Promise.all([publicClient.readContract({
      address: marketContractAddress, abi: trafficMarketAbi, functionName: 'latestMarketIdByRoom', args: [keccak256(toBytes('__compat_check__'))],
    }), publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'availableLiquidity' })]).then(() => {
      if (!cancelled) setCompatible(true);
    }).catch(() => { if (!cancelled) setCompatible(false); });
    return () => { cancelled = true; };
  }, [publicClient]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(ROOMS.map(async (room) => {
      const [zone, market] = await Promise.all([
        fetch(`${AUTH_API_URL}/rooms/${room.id}/zone`, { credentials: 'include', signal: controller.signal }).then((response) => response.ok),
        fetch(`${AUTH_API_URL}/rooms/${room.id}/market`, { credentials: 'include', signal: controller.signal }).then(async (response) => response.ok ? response.json() as Promise<{ enabled?: boolean }> : null),
      ]);
      return { zone, automated: market?.enabled === true };
    })).then((rooms) => setReadiness({ zones: rooms.filter((room) => room.zone).length, automated: rooms.filter((room) => room.automated).length, checked: true })).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setReadiness((current) => ({ ...current, checked: true }));
    });
    return () => controller.abort();
  }, []);

  return <main className="account-page admin-page"><header><Link to="/"><ArrowLeft /> Markets</Link><b>CROSSFLOW / ADMIN</b><WalletButton /></header><section className="admin-content">
    <div className="admin-heading"><div><span><LockKeyhole /> Arbitrum Sepolia control plane</span><h1>Protocol administration</h1><p>Configure verifiable camera geometry, manage the role-wallet kit, and inspect the exact contract address used by the application.</p></div><code>{PLATFORM_ADMIN_ADDRESS}</code></div>
    <section className={`admin-contract-card ${compatible ? 'compatible' : 'legacy'}`}><ScanLine /><div><span>Currently used contract</span><a href={`https://sepolia.arbiscan.io/address/${marketContractAddress}`} target="_blank" rel="noreferrer">{marketContractAddress}<ArrowUpRight /></a><small>{compatible === null ? 'Checking fixed-return liquidity interface…' : compatible ? 'Fixed returns and bankroll coverage detected' : 'Redeployment required for guaranteed fixed returns'}</small></div>{compatible === false && <Link className="admin-contract-redeploy" to="/admin/contracts#redeploy">Redeploy fixed-return contract <ArrowUpRight /></Link>}<i>{compatible === null ? 'CHECKING' : compatible ? 'FUNDED ODDS' : 'UPGRADE'}</i></section>
    <section className="admin-readiness" aria-labelledby="readiness-title"><header><div><span>Operational readiness</span><h2 id="readiness-title">What needs attention</h2></div><b>{readiness.checked ? `${readiness.zones}/${ROOMS.length} rooms ready` : 'Checking…'}</b></header><div className="readiness-grid"><article className="ready"><CheckCircle2 /><div><b>Market scheduler</b><span>Autonomous compatibility mode is online.</span></div></article><article className={readiness.zones === ROOMS.length ? 'ready' : 'attention'}>{readiness.zones === ROOMS.length ? <CheckCircle2 /> : <TriangleAlert />}<div><b>Detection zones</b><span>{readiness.checked ? `${readiness.zones} published · ${ROOMS.length - readiness.zones} need configuration` : 'Checking room geometry…'}</span></div>{readiness.zones < ROOMS.length && <Link to="/admin/zones">Configure <ArrowUpRight /></Link>}</article><article className={readiness.automated === ROOMS.length ? 'ready' : 'attention'}>{readiness.automated === ROOMS.length ? <CheckCircle2 /> : <TriangleAlert />}<div><b>Automated rooms</b><span>{readiness.checked ? `${readiness.automated} of ${ROOMS.length} enabled in the worker` : 'Checking round manager…'}</span></div></article></div></section>
    <div className="admin-module-grid"><Link to="/admin/zones"><Crosshair /><span><b>Detection zones</b><small>Play live streams, drag four-corner trapezoids, and constrain counting lines.</small></span><ArrowUpRight /></Link><Link to="/admin/contracts"><KeyRound /><span><b>Contract & role wallets</b><small>Generate encrypted testnet role keystores and deploy through the admin wallet.</small></span><ArrowUpRight /></Link><Link to="/admin/explorer"><ShieldCheck /><span><b>Explorer</b><small>Inspect the configured deployment before opening its Arbiscan record.</small></span><ArrowUpRight /></Link></div>
  </section></main>;
}
