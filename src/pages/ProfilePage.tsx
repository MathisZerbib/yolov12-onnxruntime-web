import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Camera, ShieldCheck, Wallet } from 'lucide-react';
import { AUTH_API_URL } from '@/lib/wagmi';
import { WalletButton } from '@/components/wallet-button';
import { PlayerClaims } from '@/components/player-claims';

interface Profile { address: string; manifests: number; vehiclesVerified: number; roomsOperated: number; recent: Array<{ room_id: string; created_at: number; manifest_sha256: string }> }
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => { fetch(`${AUTH_API_URL}/profile`, { credentials: 'include' }).then(response => response.ok ? response.json() : null).then(setProfile); }, []);
  return <main className="account-page"><header><Link to="/"><ArrowLeft /> Markets</Link><b>CROSSFLOW / PROFILE</b><WalletButton /></header><section className="account-content"><PlayerClaims />{!profile ? <div className="account-empty"><Wallet /><h1>Sign in to view operator history</h1><p>Your wallet winnings remain available above without creating a custodial account.</p></div> : <><div className="profile-heading"><span className="profile-avatar">{profile.address.slice(2,4).toUpperCase()}</span><div><h1>{profile.address.slice(0,8)}…{profile.address.slice(-6)}</h1><p><ShieldCheck /> Authenticated on Arbitrum Sepolia</p></div></div><div className="profile-stats"><div><span>Verified rounds</span><b>{profile.manifests}</b></div><div><span>Vehicles verified</span><b>{profile.vehiclesVerified}</b></div><div><span>Rooms operated</span><b>{profile.roomsOperated}</b></div></div><section className="activity-table"><h2>Proof activity</h2>{profile.recent.length === 0 ? <p>No proofs yet. Acquire a room and complete a detection round.</p> : profile.recent.map(item => <div key={item.manifest_sha256}><Camera /><span><b>{item.room_id}</b><small>{new Date(item.created_at * 1000).toLocaleString()}</small></span><code>{item.manifest_sha256.slice(0,12)}…</code></div>)}</section></>}</section></main>;
}
