import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Medal, ShieldCheck } from 'lucide-react';
import { AUTH_API_URL } from '@/lib/wagmi';
import { WalletButton } from '@/components/wallet-button';

interface Leader { address: string; proofs: number; vehicles: number; rooms: number }
export default function LeaderboardPage() {
  const [leaders, setLeaders] = useState<Leader[]>([]);
  useEffect(() => { fetch(`${AUTH_API_URL}/leaderboard`).then(response => response.ok ? response.json() : []).then(setLeaders); }, []);
  return <main className="account-page"><header><Link to="/"><ArrowLeft /> Markets</Link><b>CROSSFLOW / LEADERBOARD</b><WalletButton /></header><section className="account-content"><div className="leader-heading"><Medal /><div><h1>Proof operators</h1><p>Ranked by approved vehicle-count manifests—not betting volume.</p></div></div><div className="leader-table"><div className="leader-row leader-labels"><span>Rank / operator</span><span>Proofs</span><span>Vehicles</span><span>Rooms</span></div>{leaders.length === 0 ? <div className="leader-empty">The leaderboard opens after the first verified round.</div> : leaders.map((leader,index) => <div className="leader-row" key={leader.address}><span><b>{String(index+1).padStart(2,'0')}</b><i>{leader.address.slice(0,7)}…{leader.address.slice(-5)}</i>{index < 3 && <ShieldCheck />}</span><strong>{leader.proofs}</strong><strong>{leader.vehicles}</strong><strong>{leader.rooms}</strong></div>)}</div></section></main>;
}
