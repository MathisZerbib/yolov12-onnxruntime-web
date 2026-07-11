import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { getAddress, isAddress, type Abi } from 'viem';
import { ArrowLeft, CheckCircle2, Copy, Crosshair, LockKeyhole, RefreshCw, Rocket, Save, ScanLine, ShieldAlert } from 'lucide-react';
import { WalletButton } from '@/components/wallet-button';
import { TransactionStatus, type TransactionState } from '@/components/transaction-status';
import { ROOMS } from '@/lib/globe-markers';
import { AUTH_API_URL } from '@/lib/wagmi';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { isPlatformAdmin, PLATFORM_ADMIN_ADDRESS, type DetectionZone, type DetectionZoneDraft, zonePercent } from '@/config/detection-zone';

interface ContractArtifact {
  abi: Abi;
  bytecode: `0x${string}`;
}

const ZONE_FIELDS: Array<{ key: keyof DetectionZoneDraft; label: string }> = [
  { key: 'x1Bps', label: 'Left edge' },
  { key: 'y1Bps', label: 'Top edge' },
  { key: 'x2Bps', label: 'Right edge' },
  { key: 'y2Bps', label: 'Bottom edge' },
  { key: 'countingLineYBps', label: 'Counting line' },
];

export default function AdminZonesPage() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: arbitrumSepolia.id });
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [zones, setZones] = useState<Record<string, DetectionZone>>({});
  const [selectedRoomId, setSelectedRoomId] = useState(ROOMS[0].id);
  const [draft, setDraft] = useState<DetectionZoneDraft | null>(null);
  const [sessionAddress, setSessionAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [roleAddresses, setRoleAddresses] = useState({ oracle: '', marketOperator: '', disputeResolver: '' });
  const [deployHash, setDeployHash] = useState<`0x${string}`>();
  const [deployState, setDeployState] = useState<TransactionState>();
  const [deployedAddress, setDeployedAddress] = useState<`0x${string}`>();
  const [zoneHash, setZoneHash] = useState<`0x${string}`>();
  const [zoneTxState, setZoneTxState] = useState<TransactionState>();

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
    setDraft({ x1Bps: selectedZone.x1Bps, y1Bps: selectedZone.y1Bps, x2Bps: selectedZone.x2Bps, y2Bps: selectedZone.y2Bps, countingLineYBps: selectedZone.countingLineYBps });
    setNotice('');
  }, [selectedZone]);

  const adminWallet = isPlatformAdmin(address);
  const authenticatedAdmin = adminWallet && sessionAddress.toLowerCase() === address?.toLowerCase();
  const dirty = Boolean(draft && selectedZone && ZONE_FIELDS.some(field => draft[field.key] !== selectedZone[field.key]));
  const validDraft = Boolean(draft && draft.x1Bps >= 0 && draft.y1Bps >= 0 && draft.x2Bps <= 10_000 && draft.y2Bps <= 10_000 && draft.x1Bps < draft.x2Bps && draft.y1Bps < draft.y2Bps && draft.countingLineYBps >= draft.y1Bps && draft.countingLineYBps <= draft.y2Bps);
  const configuredContract = deployedAddress ?? marketContractAddress;

  const roleValidation = useMemo(() => {
    const raw = [roleAddresses.oracle, roleAddresses.marketOperator, roleAddresses.disputeResolver];
    if (!raw.every(value => isAddress(value))) return null;
    const normalized = raw.map(value => getAddress(value));
    if (new Set([PLATFORM_ADMIN_ADDRESS.toLowerCase(), ...normalized.map(value => value.toLowerCase())]).size !== 4) return null;
    return normalized as [`0x${string}`, `0x${string}`, `0x${string}`];
  }, [roleAddresses]);

  function updateDraft(key: keyof DetectionZoneDraft, percent: number) {
    setDraft(current => current ? { ...current, [key]: Math.round(percent * 100) } : current);
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

  async function deployContract() {
    if (!walletClient || !publicClient || !address || !authenticatedAdmin || !roleValidation || chainId !== arbitrumSepolia.id) return;
    setNotice(''); setDeployState('AWAITING_SIGNATURE');
    try {
      const artifactResponse = await fetch(`${import.meta.env.BASE_URL}contracts/TrafficPredictionMarket.json`, { cache: 'no-store' });
      if (!artifactResponse.ok) throw new Error('Deployment artifact is unavailable');
      const artifact = await artifactResponse.json() as ContractArtifact;
      const hash = await walletClient.deployContract({ account: address, abi: artifact.abi, bytecode: artifact.bytecode, args: [PLATFORM_ADMIN_ADDRESS, ...roleValidation] });
      setDeployHash(hash); setDeployState('SUBMITTED');
      const receipt = await waitForReceipt(hash, setDeployState);
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Contract deployment reverted');
      setDeployedAddress(receipt.contractAddress); setDeployState('CONFIRMED');
      setNotice(`Contract deployed at ${receipt.contractAddress}. Publish each room zone before creating markets.`);
    } catch (error) {
      setDeployState('FAILED');
      setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Contract deployment failed');
    }
  }

  async function publishZoneOnChain() {
    if (!configuredContract || !selectedZone || dirty || !authenticatedAdmin || chainId !== arbitrumSepolia.id) return;
    setZoneTxState('AWAITING_SIGNATURE'); setNotice('');
    try {
      const hash = await writeContractAsync({ address: configuredContract, abi: trafficMarketAbi, functionName: 'setRoomZone', args: [selectedZone.roomKey, selectedZone.x1Bps, selectedZone.y1Bps, selectedZone.x2Bps, selectedZone.y2Bps, selectedZone.countingLineYBps], chainId: arbitrumSepolia.id });
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
            <div className="zone-preview" aria-label="Detection zone preview">
              <span className="preview-grid" />
              <span className="preview-zone" style={{ left: `${draft.x1Bps / 100}%`, top: `${draft.y1Bps / 100}%`, width: `${(draft.x2Bps - draft.x1Bps) / 100}%`, height: `${(draft.y2Bps - draft.y1Bps) / 100}%` }} />
              <span className="preview-line" style={{ left: `${draft.x1Bps / 100}%`, top: `${draft.countingLineYBps / 100}%`, width: `${(draft.x2Bps - draft.x1Bps) / 100}%` }} />
              <span className="preview-label"><Crosshair /> eligible centroid area</span>
            </div>
            <div className="zone-fields">{ZONE_FIELDS.map(field => <label key={field.key}><span>{field.label}<b>{zonePercent(draft[field.key])}%</b></span><input type="range" min="0" max="100" step="0.1" value={draft[field.key] / 100} onChange={event => updateDraft(field.key, Number(event.target.value))} /><input type="number" min="0" max="100" step="0.1" value={draft[field.key] / 100} onChange={event => updateDraft(field.key, Number(event.target.value))} aria-label={`${field.label} percent`} /></label>)}</div>
            <div className="zone-proof"><ScanLine /><div><span>Canonical configuration hash</span><code>{selectedZone.configHash}</code></div></div>
            <div className="zone-actions"><button className="zone-save" disabled={!authenticatedAdmin || !dirty || !validDraft || saving} onClick={saveZone}><Save />{saving ? 'Saving…' : dirty ? 'Save detector zone' : 'Detector zone saved'}</button><button disabled={!authenticatedAdmin || !configuredContract || dirty || zoneTxState === 'PENDING' || zoneTxState === 'AWAITING_SIGNATURE'} onClick={publishZoneOnChain}><LockKeyhole /> Publish saved zone on-chain</button></div>
            {zoneTxState && <TransactionStatus state={zoneTxState} hash={zoneHash} confirmedText="Detection zone recorded on-chain." />}
          </>}
        </div>
      </section>

      <section className="deploy-console">
        <div className="deploy-copy"><span><Rocket /> Arbitrum Sepolia</span><h2>Deploy with your connected wallet</h2><p>The bytecode is compiled locally and the contract creation transaction is signed by Rabby, MetaMask, or Phantom. Crossflow never reads or asks for your private key.</p>{deployedAddress && <button onClick={() => navigator.clipboard.writeText(deployedAddress)}><Copy /> {deployedAddress}</button>}</div>
        <div className="role-fields"><label>Oracle address<input placeholder="0x…" value={roleAddresses.oracle} onChange={event => setRoleAddresses(current => ({ ...current, oracle: event.target.value }))} /></label><label>Market operator<input placeholder="0x…" value={roleAddresses.marketOperator} onChange={event => setRoleAddresses(current => ({ ...current, marketOperator: event.target.value }))} /></label><label>Dispute resolver<input placeholder="0x…" value={roleAddresses.disputeResolver} onChange={event => setRoleAddresses(current => ({ ...current, disputeResolver: event.target.value }))} /></label><small>All three public addresses must be valid and distinct from each other and the platform admin.</small><button disabled={!authenticatedAdmin || !roleValidation || chainId !== arbitrumSepolia.id || deployState === 'PENDING' || deployState === 'AWAITING_SIGNATURE'} onClick={deployContract}><Rocket /> Deploy contract</button>{deployState && <TransactionStatus state={deployState} hash={deployHash} confirmedText="Contract deployed on Arbitrum Sepolia." />}</div>
      </section>
      {notice && <p className="admin-notice" role="status">{notice}</p>}
    </section>
  </main>;
}
