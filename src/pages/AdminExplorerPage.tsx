import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Binary, ScanLine } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { marketContractAddress } from '@/lib/market-contract';

export default function AdminExplorerPage() {
  return <main className="account-page admin-page"><header><Link to="/admin"><ArrowLeft /> Admin</Link><b>CROSSFLOW / EXPLORER</b><WalletButton /></header><section className="admin-content"><div className="admin-heading"><div><span><Binary /> Deployment inspection</span><h1>Contract explorer</h1><p>The exact Arbitrum Sepolia address currently configured in the application.</p></div></div><section className="admin-contract-card legacy"><ScanLine /><div><span>Configured contract</span><code>{marketContractAddress}</code><small>Legacy rectangle-zone deployment. The trapezoid-aware replacement must be deployed from Contract & role wallets.</small></div><a href={`https://sepolia.arbiscan.io/address/${marketContractAddress}`} target="_blank" rel="noreferrer">Open Arbiscan <ArrowUpRight /></a></section></section></main>;
}
