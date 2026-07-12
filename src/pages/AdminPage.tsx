import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Crosshair, KeyRound, LockKeyhole, ScanLine, ShieldCheck } from 'lucide-react';
import { usePublicClient } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { WalletButton } from '@/components/wallet-button';
import { PLATFORM_ADMIN_ADDRESS } from '@/config/detection-zone';
import { marketContractAddress } from '@/lib/market-contract';

export default function AdminPage() {
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [compatible, setCompatible] = useState<boolean | null>(null);
  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    publicClient.getCode({ address: marketContractAddress }).then(code => {
      if (!cancelled) setCompatible(Boolean(code?.toLowerCase().includes('a0d9a4b5')));
    }).catch(() => { if (!cancelled) setCompatible(false); });
    return () => { cancelled = true; };
  }, [publicClient]);

  return <main className="account-page admin-page"><header><Link to="/"><ArrowLeft /> Markets</Link><b>CROSSFLOW / ADMIN</b><WalletButton /></header><section className="admin-content">
    <div className="admin-heading"><div><span><LockKeyhole /> Arbitrum Sepolia control plane</span><h1>Protocol administration</h1><p>Configure verifiable camera geometry, manage the role-wallet kit, and inspect the exact contract address used by the application.</p></div><code>{PLATFORM_ADMIN_ADDRESS}</code></div>
    <section className={`admin-contract-card ${compatible ? 'compatible' : 'legacy'}`}><ScanLine /><div><span>Currently used contract</span><a href={`https://sepolia.arbiscan.io/address/${marketContractAddress}`} target="_blank" rel="noreferrer">{marketContractAddress}<ArrowUpRight /></a><small>{compatible === null ? 'Checking interface on Arbitrum Sepolia…' : compatible ? 'Current trapezoid-zone interface' : 'Legacy rectangle-zone interface · redeployment required for draggable trapezoids'}</small></div><i>{compatible ? 'READY' : compatible === null ? 'CHECKING' : 'LEGACY'}</i></section>
    <div className="admin-module-grid"><Link to="/admin/zones"><Crosshair /><span><b>Detection zones</b><small>Play live streams, drag four-corner trapezoids, and constrain counting lines.</small></span><ArrowUpRight /></Link><Link to="/admin/contracts"><KeyRound /><span><b>Contract & role wallets</b><small>Generate encrypted testnet role keystores and deploy through the admin wallet.</small></span><ArrowUpRight /></Link><Link to="/admin/explorer"><ShieldCheck /><span><b>Explorer</b><small>Inspect the configured deployment before opening its Arbiscan record.</small></span><ArrowUpRight /></Link></div>
  </section></main>;
}
