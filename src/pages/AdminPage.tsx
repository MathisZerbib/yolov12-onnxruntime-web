import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Crosshair, KeyRound, LockKeyhole, Rocket, ScanLine, ShieldCheck } from 'lucide-react';
import { usePublicClient } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { keccak256, toBytes } from 'viem';
import { WalletButton } from '@/components/wallet-button';
import { PLATFORM_ADMIN_ADDRESS } from '@/config/detection-zone';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';

export default function AdminPage() {
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [compatible, setCompatible] = useState<boolean | null>(null);
  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    setCompatible(null);
    publicClient.readContract({
      address: marketContractAddress,
      abi: trafficMarketAbi,
      functionName: 'roomZones',
      args: [keccak256(toBytes('__compat_check__'))],
    }).then(() => {
      if (!cancelled) setCompatible(true);
    }).catch((error) => {
      if (!cancelled) {
        const msg = error instanceof Error ? error.message : '';
        setCompatible(!msg.includes('function not found') && !msg.includes('missing revert data'));
      }
    });
    return () => { cancelled = true; };
  }, [publicClient]);

  return <main className="account-page admin-page"><header><Link to="/"><ArrowLeft /> Markets</Link><b>CROSSFLOW / ADMIN</b><WalletButton /></header><section className="admin-content">
    <div className="admin-heading"><div><span><LockKeyhole /> Arbitrum Sepolia control plane</span><h1>Protocol administration</h1><p>Configure verifiable camera geometry, manage the role-wallet kit, and inspect the exact contract address used by the application.</p></div><code>{PLATFORM_ADMIN_ADDRESS}</code></div>
    <section className={`admin-contract-card ${compatible ? 'compatible' : 'legacy'}`}><ScanLine /><div><span>Currently used contract</span><a href={`https://sepolia.arbiscan.io/address/${marketContractAddress}`} target="_blank" rel="noreferrer">{marketContractAddress}<ArrowUpRight /></a><small>{compatible === null ? 'Checking interface on Arbitrum Sepolia…' : compatible ? 'Current trapezoid-zone interface' : 'Legacy rectangle-zone interface · redeployment required for draggable trapezoids'}</small></div>{compatible === false && <Link className="admin-contract-redeploy" to="/admin/contracts#redeploy"><Rocket /> Redeploy new contract</Link>}<i>{compatible ? 'READY' : compatible === null ? 'CHECKING' : 'LEGACY'}</i></section>
    <div className="admin-module-grid"><Link to="/admin/zones"><Crosshair /><span><b>Detection zones</b><small>Play live streams, drag four-corner trapezoids, and constrain counting lines.</small></span><ArrowUpRight /></Link><Link to="/admin/contracts"><KeyRound /><span><b>Contract & role wallets</b><small>Generate encrypted testnet role keystores and deploy through the admin wallet.</small></span><ArrowUpRight /></Link><Link to="/admin/explorer"><ShieldCheck /><span><b>Explorer</b><small>Inspect the configured deployment before opening its Arbiscan record.</small></span><ArrowUpRight /></Link></div>
  </section></main>;
}
