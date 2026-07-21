import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, Clock, ExternalLink, Radio } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { AUTH_API_URL } from '@/lib/wagmi';

interface Activity { id: string; address: string; room_id: string; manifest_sha256: string; created_at: number; vehicles: number }
export default function ActivityPage() {
  const [items, setItems] = useState<Activity[] | null>(null);
  useEffect(() => { fetch(`${AUTH_API_URL}/activity`).then(response => response.ok ? response.json() : []).then(setItems).catch(() => setItems([])); }, []);
  return <main className="account-page activity-page"><header><Link to="/"><ArrowLeft /> Markets</Link><b>CROSSFLOW / ACTIVITY</b><WalletButton /></header><section className="account-content"><div className="activity-heading"><div><span><Radio/> Live protocol feed</span><h1>Market activity</h1><p>Recent verified inference proofs and settlement events across every room.</p></div><aside><Clock/><span>Challenge window<b>1 minute</b></span></aside></div><div className="activity-feed"><div className="feed-labels"><span>Event</span><span>Operator</span><span>Result</span><span>Proof</span><span>Time</span></div>{items === null ? <div className="feed-loading"><i/><i/><i/></div> : items.length === 0 ? <div className="leader-empty">No verified protocol activity yet.</div> : items.map(item => <article key={item.id}><span className="feed-event"><CheckCircle2/><span><b>Proof accepted</b><small>{item.room_id} room</small></span></span><code>{item.address.slice(0,7)}…{item.address.slice(-5)}</code><strong>{item.vehicles} vehicles</strong><code>{item.manifest_sha256.slice(0,9)}… <ExternalLink/></code><time>{new Date(item.created_at*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></article>)}</div><div className="activity-note"><Camera/><p>Manifests shown here passed session, room-lease, model-hash, and schema verification. “Accepted” does not mean the challenge window has finalized on-chain.</p></div></section></main>;
}
