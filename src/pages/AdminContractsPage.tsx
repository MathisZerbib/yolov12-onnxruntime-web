import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { ContractDeploymentPanel } from '@/components/admin/contract-deployment-panel';
import { SmartContractControlPanel } from '@/components/admin/smart-contract-control-panel';

export default function AdminContractsPage() {
  return <main className="account-page admin-page"><header><Link to="/admin"><ArrowLeft /> Admin</Link><b>CROSSFLOW / CONTRACTS</b><WalletButton /></header><section className="admin-content"><div className="admin-heading"><div><span><KeyRound /> Deployment custody</span><h1>Contract & role wallets</h1><p>Import or generate encrypted operational wallets, deploy safely, and manage the live protocol through guarded on-chain actions.</p></div></div><SmartContractControlPanel /><ContractDeploymentPanel /></section></main>;
}
