import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Binary, ScanLine } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { usePublicClient } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { keccak256, toBytes } from 'viem';

export default function AdminExplorerPage() {
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [compatible, setCompatible] = useState<boolean | null>(null);
  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'latestMarketIdByRoom', args: [keccak256(toBytes('__compat_check__'))] }).then(() => {
      if (!cancelled) setCompatible(true);
    }).catch(() => { if (!cancelled) setCompatible(false); });
    return () => { cancelled = true; };
  }, [publicClient]);
  return <main className="account-page admin-page"><header><Link to="/admin"><ArrowLeft /> Admin</Link><b>CROSSFLOW / EXPLORER</b><WalletButton /></header><section className="admin-content"><div className="admin-heading"><div><span><Binary /> Deployment inspection</span><h1>Contract explorer</h1><p>The exact Arbitrum Sepolia address currently configured in the application.</p></div></div><section className={`admin-contract-card ${compatible === false ? 'legacy' : 'compatible'}`}><ScanLine /><div><span>Configured contract</span><code>{marketContractAddress}</code><small>{compatible === null ? 'Checking automated-round interface…' : compatible ? 'Per-room automation registry detected' : 'This deployment predates automated per-room rounds and must be replaced.'}</small></div><a href={`https://sepolia.arbiscan.io/address/${marketContractAddress}`} target="_blank" rel="noreferrer">Open Arbiscan <ArrowUpRight /></a></section></section></main>;
}
