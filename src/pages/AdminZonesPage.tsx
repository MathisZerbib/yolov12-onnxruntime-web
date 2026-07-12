import { useCallback, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { ArrowLeft, CheckCircle2, Crosshair, LockKeyhole, RefreshCw, Save, ScanLine, ShieldAlert } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { TransactionStatus, type TransactionState } from '@/components/transaction-status';
import { ROOMS } from '@/lib/globe-markers';
import { AUTH_API_URL } from '@/lib/wagmi';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { isPlatformAdmin, PLATFORM_ADMIN_ADDRESS, type DetectionZone, type DetectionZoneDraft } from '@/config/detection-zone';

const ZONE_KEYS: Array<keyof DetectionZoneDraft> = ['topLeftXBps', 'topLeftYBps', 'topRightXBps', 'topRightYBps', 'bottomRightXBps', 'bottomRightYBps', 'bottomLeftXBps', 'bottomLeftYBps'];
const CORNERS = [
  { label: 'Top left', x: 'topLeftXBps', y: 'topLeftYBps' },
  { label: 'Top right', x: 'topRightXBps', y: 'topRightYBps' },
  { label: 'Bottom right', x: 'bottomRightXBps', y: 'bottomRightYBps' },
  { label: 'Bottom left', x: 'bottomLeftXBps', y: 'bottomLeftYBps' },
] as const;

function toDraft(zone: DetectionZone): DetectionZoneDraft {
  return Object.fromEntries(ZONE_KEYS.map(key => [key, zone[key]])) as unknown as DetectionZoneDraft;
}

const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, value)));

export default function AdminZonesPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const { address, chainId, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [zones, setZones] = useState<Record<string, DetectionZone>>({});
  const [selectedRoomId, setSelectedRoomId] = useState(ROOMS[0].id);
  const [draft, setDraft] = useState<DetectionZoneDraft | null>(null);
  const [sessionAddress, setSessionAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [zoneHash, setZoneHash] = useState<`0x${string}`>();
  const [zoneTxState, setZoneTxState] = useState<TransactionState>();
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [streamAspectRatio, setStreamAspectRatio] = useState(16 / 9);
  const [zoneContractCompatible, setZoneContractCompatible] = useState<boolean | null>(null);

  const refreshSession = useCallback(async () => {
    const response = await fetch(`${AUTH_API_URL}/auth/session`, { credentials: 'include' }).catch(() => null);
    if (!response?.ok) { setSessionAddress(''); return; }
    const session = await response.json() as { address?: string };
    setSessionAddress(session.address ?? '');
  }, []);

  const loadZones = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(ROOMS.map(async room => {
      const response = await fetch(`${AUTH_API_URL}/rooms/${room.id}/zone`, { credentials: 'include' });
      if (!response.ok) return null;
      return response.json() as Promise<DetectionZone>;
    })).catch(() => []);
    const available: Record<string, DetectionZone> = {};
    for (const zone of results) if (zone) available[zone.roomId] = zone;
    setZones(available);
    setLoading(false);
  }, []);

  useEffect(() => { void loadZones(); void refreshSession(); }, [loadZones, refreshSession]);
  const selectedZone = zones[selectedRoomId];
  useEffect(() => {
    if (!selectedZone) { setDraft(null); return; }
    setDraft(toDraft(selectedZone));
    setNotice('');
  }, [selectedZone]);

  const adminWallet = isPlatformAdmin(address);
  const authenticatedAdmin = adminWallet && sessionAddress.toLowerCase() === address?.toLowerCase();
  const dirty = Boolean(draft && selectedZone && ZONE_KEYS.some(key => draft[key] !== selectedZone[key]));
  const validDraft = Boolean(draft && draft.topLeftXBps < draft.topRightXBps && draft.bottomLeftXBps < draft.bottomRightXBps &&
    draft.topLeftYBps < draft.bottomLeftYBps && draft.topRightYBps < draft.bottomRightYBps);
  const configuredContract = marketContractAddress;
  const selectedRoom = ROOMS.find(room => room.id === selectedRoomId)!;

  useEffect(() => {
    if (!configuredContract || !publicClient) { setZoneContractCompatible(false); return; }
    let cancelled = false;
    setZoneContractCompatible(null);
    publicClient.getCode({ address: configuredContract }).then(code => {
      if (!cancelled) setZoneContractCompatible(Boolean(code?.toLowerCase().includes('a0d9a4b5')));
    }).catch(() => { if (!cancelled) setZoneContractCompatible(false); });
    return () => { cancelled = true; };
  }, [configuredContract, publicClient]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setStreamReady(false);
    hlsRef.current?.destroy(); hlsRef.current = null;
    video.removeAttribute('src'); video.load();
    const ready = () => { if (!cancelled) { setStreamReady(true); if (video.videoWidth && video.videoHeight) setStreamAspectRatio(video.videoWidth / video.videoHeight); } };
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = selectedRoom.streamUrl; video.addEventListener('loadedmetadata', ready, { once: true }); void video.play().catch(() => undefined);
    } else {
      void import('hls.js/light').then(({ default: HlsRuntime }) => {
        if (cancelled || !HlsRuntime.isSupported()) return;
        const hls = new HlsRuntime({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(selectedRoom.streamUrl); hls.attachMedia(video);
        hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => { ready(); void video.play().catch(() => undefined); });
        hlsRef.current = hls;
      });
    }
    return () => { cancelled = true; video.removeEventListener('loadedmetadata', ready); hlsRef.current?.destroy(); hlsRef.current = null; };
  }, [selectedRoom]);

  function updateCorner(index: number, x: number, y: number) {
    setDraft(current => {
      if (!current) return current;
      const next = { ...current };
      if (index === 0) { next.topLeftXBps = clamp(x, 0, next.topRightXBps - 100); next.topLeftYBps = clamp(y, 0, next.bottomLeftYBps - 100); }
      if (index === 1) { next.topRightXBps = clamp(x, next.topLeftXBps + 100, 10_000); next.topRightYBps = clamp(y, 0, next.bottomRightYBps - 100); }
      if (index === 2) { next.bottomRightXBps = clamp(x, next.bottomLeftXBps + 100, 10_000); next.bottomRightYBps = clamp(y, next.topRightYBps + 100, 10_000); }
      if (index === 3) { next.bottomLeftXBps = clamp(x, 0, next.bottomRightXBps - 100); next.bottomLeftYBps = clamp(y, next.topLeftYBps + 100, 10_000); }
      return next;
    });
  }

  function moveDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (dragTarget === null || !draft) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width * 10_000, 0, 10_000);
    const y = clamp((event.clientY - rect.top) / rect.height * 10_000, 0, 10_000);
    updateCorner(dragTarget, x, y);
  }

  async function saveZone() {
    if (!draft || !selectedZone || !authenticatedAdmin || !validDraft) return;
    setSaving(true); setNotice('');
    try {
      const response = await fetch(`${AUTH_API_URL}/rooms/${selectedRoomId}/zone`, {
        method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, expectedVersion: selectedZone.version }),
      });
      const result = await response.json() as DetectionZone & { error?: string; current?: DetectionZone };
      if (!response.ok) {
        if (response.status === 409 && result.current) setZones(current => ({ ...current, [selectedRoomId]: result.current! }));
        throw new Error(result.error ?? 'Zone update failed');
      }
      setZones(current => ({ ...current, [selectedRoomId]: result }));
      setNotice(`Detector zone v${result.version} is active. Its hash is now bound to every proof.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Zone update failed');
    } finally { setSaving(false); }
  }

  async function waitForReceipt(hash: `0x${string}`, setState: (state: TransactionState) => void) {
    if (!publicClient) throw new Error('Arbitrum Sepolia RPC is unavailable');
    setState('PENDING');
    return publicClient.waitForTransactionReceipt({ hash, confirmations: 1, onReplaced: () => setState('REPLACED') });
  }

  async function publishZoneOnChain() {
    if (!configuredContract || !zoneContractCompatible || !selectedZone || dirty || !authenticatedAdmin || chainId !== arbitrumSepolia.id) return;
    setZoneTxState('AWAITING_SIGNATURE'); setNotice('');
    try {
      const hash = await writeContractAsync({ address: configuredContract, abi: trafficMarketAbi, functionName: 'setRoomZone', args: [selectedZone.roomKey, [
        selectedZone.topLeftXBps, selectedZone.topLeftYBps, selectedZone.topRightXBps, selectedZone.topRightYBps,
        selectedZone.bottomRightXBps, selectedZone.bottomRightYBps, selectedZone.bottomLeftXBps, selectedZone.bottomLeftYBps]], chainId: arbitrumSepolia.id });
      setZoneHash(hash); setZoneTxState('SUBMITTED');
      const receipt = await waitForReceipt(hash, setZoneTxState);
      if (receipt.status !== 'success') throw new Error('Zone transaction reverted');
      setZoneTxState('CONFIRMED');
      setNotice(`Zone ${selectedZone.configHash.slice(0, 12)}… is now registered on-chain.`);
    } catch (error) {
      setZoneTxState('FAILED');
      setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Zone transaction failed');
    }
  }

  return <main className="account-page admin-page">
    <header><Link to="/"><ArrowLeft /> Markets</Link><b>CROSSFLOW / CONTROL PLANE</b><WalletButton /></header>
    <section className="admin-content">
      <div className="admin-heading"><div><span><LockKeyhole /> Fixed-admin control</span><h1>Detection zone control plane</h1><p>Define exactly where vehicle centroids are eligible and where a crossing is counted. Coordinates are canonical integer basis points across browser, Worker, and EVM.</p></div><code>{PLATFORM_ADMIN_ADDRESS}</code></div>
      <div className={`active-contract ${zoneContractCompatible ? 'compatible' : 'legacy'}`}><ScanLine /><div><span>Contract currently used by the app</span><Link to="/admin/contracts">{configuredContract}</Link><small>{zoneContractCompatible ? 'Trapezoid-zone interface detected' : zoneContractCompatible === null ? 'Checking deployed interface…' : 'Legacy rectangle-zone deployment — open Contract & role wallets to deploy the update'}</small></div></div>

      <div className={`admin-access ${authenticatedAdmin ? 'granted' : 'restricted'}`}>
        {authenticatedAdmin ? <CheckCircle2 /> : <ShieldAlert />}
        <div><b>{authenticatedAdmin ? 'Admin session verified' : !isConnected ? 'Connect the platform admin wallet' : !adminWallet ? 'This wallet is not authorized' : 'Verify the admin session'}</b><span>{authenticatedAdmin ? 'Worker mutations and wallet-signed contract actions are unlocked.' : 'Only the fixed address above can change a detection zone. Use the wallet widget to connect and sign in.'}</span></div>
        {adminWallet && !authenticatedAdmin && <button onClick={refreshSession}><RefreshCw /> Recheck session</button>}
      </div>

      <section className="zone-console">
        <nav>{ROOMS.map(room => <button key={room.id} className={selectedRoomId === room.id ? 'active' : ''} onClick={() => setSelectedRoomId(room.id)}><i />{room.name}<small>{zones[room.id] ? `v${zones[room.id].version}` : 'not configured'}</small></button>)}</nav>
        <div className="zone-editor">
          <header><div><span>Selected camera</span><h2>{ROOMS.find(room => room.id === selectedRoomId)?.name}</h2></div>{selectedZone && <span className="zone-version">ZONE V{selectedZone.version}</span>}</header>
          {loading || !draft || !selectedZone ? <div className="zone-loading">Loading canonical zone…</div> : <>
            <div className="zone-preview live-zone-preview" style={{ aspectRatio: streamAspectRatio }} aria-label="Live draggable detection zone editor">
              <video ref={videoRef} autoPlay muted playsInline />
              {!streamReady && <span className="stream-waiting">Connecting live stream…</span>}
              <svg viewBox="0 0 10000 10000" preserveAspectRatio="none" onPointerMove={moveDrag} onPointerUp={() => setDragTarget(null)} onPointerCancel={() => setDragTarget(null)}>
                <defs><pattern id="zone-scan-texture" width="420" height="420" patternUnits="userSpaceOnUse" patternTransform="rotate(24)"><line x1="0" y1="0" x2="0" y2="420" /></pattern></defs>
                <polygon className="preview-zone" points={`${draft.topLeftXBps},${draft.topLeftYBps} ${draft.topRightXBps},${draft.topRightYBps} ${draft.bottomRightXBps},${draft.bottomRightYBps} ${draft.bottomLeftXBps},${draft.bottomLeftYBps}`} />
                <polygon className="preview-zone-texture" points={`${draft.topLeftXBps},${draft.topLeftYBps} ${draft.topRightXBps},${draft.topRightYBps} ${draft.bottomRightXBps},${draft.bottomRightYBps} ${draft.bottomLeftXBps},${draft.bottomLeftYBps}`} />
                {CORNERS.map((corner, index) => <g key={corner.label} className="corner-handle" transform={`translate(${draft[corner.x]},${draft[corner.y]})`} onPointerDown={event => { event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId); setDragTarget(index); }}><circle r="230" /><text y="70" textAnchor="middle">{index + 1}</text></g>)}
              </svg>
              <span className="preview-grid" />
              <span className="preview-label"><Crosshair /> drag corners · vehicles count after entering and leaving</span>
            </div>
            <div className="trapezoid-fields">{CORNERS.map((corner, index) => <fieldset key={corner.label}><legend>{corner.label}</legend><label>X <input type="number" min="0" max="100" step="0.1" value={draft[corner.x] / 100} onChange={event => updateCorner(index, Number(event.target.value) * 100, draft[corner.y])} /></label><label>Y <input type="number" min="0" max="100" step="0.1" value={draft[corner.y] / 100} onChange={event => updateCorner(index, draft[corner.x], Number(event.target.value) * 100)} /></label></fieldset>)}</div>
            <div className="zone-proof"><ScanLine /><div><span>Canonical configuration hash</span><code>{selectedZone.configHash}</code></div></div>
            <div className="zone-actions"><button className="zone-save" disabled={!authenticatedAdmin || !dirty || !validDraft || saving} onClick={saveZone}><Save />{saving ? 'Saving…' : dirty ? 'Save detector zone' : 'Detector zone saved'}</button><button disabled={!authenticatedAdmin || !configuredContract || !zoneContractCompatible || dirty || zoneTxState === 'PENDING' || zoneTxState === 'AWAITING_SIGNATURE'} onClick={publishZoneOnChain}><LockKeyhole /> {zoneContractCompatible ? 'Publish saved zone on-chain' : 'Updated contract required'}</button></div>
            {zoneTxState && <TransactionStatus state={zoneTxState} hash={zoneHash} confirmedText="Detection zone recorded on-chain." />}
          </>}
        </div>
      </section>

      {notice && <p className="admin-notice" role="status">{notice}</p>}
    </section>
  </main>;
}
