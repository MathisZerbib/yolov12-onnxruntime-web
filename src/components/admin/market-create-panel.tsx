import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileKey2, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { concat, createWalletClient, http, keccak256, toBytes, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { usePublicClient } from 'wagmi';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';
import { ROOMS } from '@/lib/globe-markers';

interface MarketOperatorWallet {
  address: `0x${string}`;
  client: WalletClient;
  account: `0x${string}`;
}

const SAFE_FEE_BPS = 200; // 2% protocol fee
const MAX_KEYSTORE_BYTES = 256_000;
const HEX = /^[0-9a-fA-F]+$/;

function emptyState() {
  return {
    roomId: '',
    lowerBound: '0',
    upperBound: '50',
    exactTarget: '25',
    closeInMinutes: '60',
    resolveInMinutes: '120',
  };
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function MarketCreatePanel() {
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [keystoreFile, setKeystoreFile] = useState<File | null>(null);
  const [keystorePassword, setKeystorePassword] = useState('');
  const [operator, setOperator] = useState<MarketOperatorWallet | null>(null);
  const [form, setForm] = useState(emptyState);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [refreshingId, setRefreshingId] = useState(false);
  const [nextId, setNextId] = useState<bigint | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function decryptKeystore() {
    if (unlocking) return;
    if (!keystoreFile || keystorePassword.length < 1) {
      setNotice('Select the market-operator keystore and enter its backup password.');
      return;
    }
    setUnlocking(true);
    setNotice('Decrypting market-operator wallet locally…');
    try {
      if (keystoreFile.size > MAX_KEYSTORE_BYTES) throw new Error('Keystore file is too large. Select a Web3 V3 JSON file under 256 KB.');
      const text = await keystoreFile.text();
      const keystore = JSON.parse(text) as {
        version: number; address: string; crypto: {
          ciphertext: string; cipherparams: { iv: string }; kdf: string;
          kdfparams: { dklen: number; c: number; prf: string; salt: string }; mac: string;
        };
      };
      if (keystore.version !== 3 || keystore.crypto?.kdf !== 'pbkdf2' || keystore.crypto.kdfparams?.prf !== 'hmac-sha256') {
        throw new Error('Unsupported keystore. Select a PBKDF2 Web3 V3 JSON file.');
      }
      const fields = [keystore.crypto.ciphertext, keystore.crypto.cipherparams?.iv, keystore.crypto.kdfparams?.salt, keystore.crypto.mac];
      if (fields.some((value) => typeof value !== 'string' || value.length % 2 !== 0 || !HEX.test(value))) throw new Error('The keystore contains invalid encrypted data.');
      if (keystore.crypto.kdfparams.dklen !== 32 || keystore.crypto.kdfparams.c < 100_000 || keystore.crypto.kdfparams.c > 2_000_000) {
        throw new Error('The keystore uses unsupported key-derivation settings.');
      }
      const ciphertext = hexToBytes(keystore.crypto.ciphertext);
      const iv = hexToBytes(keystore.crypto.cipherparams.iv);
      const salt = hexToBytes(keystore.crypto.kdfparams.salt);
      const mac = keystore.crypto.mac.toLowerCase();

      const passwordKey = await crypto.subtle.importKey('raw', toBufferSource(new TextEncoder().encode(keystorePassword)), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: toBufferSource(salt), iterations: keystore.crypto.kdfparams.c }, passwordKey, 256);
      const derived = new Uint8Array(bits);
      const aesKey = await crypto.subtle.importKey('raw', derived.slice(0, 16), { name: 'AES-CTR' }, false, ['decrypt']);
      const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter: toBufferSource(iv), length: 128 }, aesKey, toBufferSource(ciphertext)));
      const computedMac = keccak256(concat([derived.slice(16, 32), ciphertext]));
      if (computedMac.toLowerCase() !== `0x${mac}`) throw new Error('Wrong backup password or damaged keystore');
      const privateKey = `0x${bytesToHex(decrypted)}` as Hex;
      const account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({
        account,
        chain: arbitrumSepolia,
        transport: http('https://sepolia-rollup.arbitrum.io/rpc'),
      });
      decrypted.fill(0);
      derived.fill(0);
      setOperator({ address: account.address, client: walletClient, account: account.address });
      setKeystorePassword('');
      setNotice('Market-operator wallet unlocked. Configure the market and create it.');
    } catch (error) {
      setOperator(null);
      setNotice(error instanceof Error ? error.message : 'Keystore decryption failed');
    } finally {
      setUnlocking(false);
    }
  }

  const formValid = useMemo(() => {
    if (!operator) return false;
    const roomOk = /^0x[0-9a-fA-F]{64}$/.test(form.roomId);
    const lower = Number(form.lowerBound), upper = Number(form.upperBound), exact = Number(form.exactTarget);
    const close = Number(form.closeInMinutes), resolve = Number(form.resolveInMinutes);
    return roomOk && lower >= 0 && upper >= lower && exact >= 0 && close > 0 && resolve > close;
  }, [operator, form]);

  async function refreshNextId() {
    if (!publicClient || refreshingId) return;
    setRefreshingId(true);
    try {
      const id = await publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'nextMarketId' });
      setNextId(id as bigint);
      setNotice('');
    } catch {
      setNotice('Could not read the next market ID. Check your connection and try again.');
    } finally {
      setRefreshingId(false);
    }
  }

  async function createMarket() {
    if (!operator || !publicClient || !formValid) return;
    setPending(true); setNotice('');
    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const closeTime = BigInt(nowSeconds + Number(form.closeInMinutes) * 60);
      const resolveDeadline = BigInt(nowSeconds + Number(form.resolveInMinutes) * 60);
      const lower = Number(form.lowerBound), upper = Number(form.upperBound), exact = Number(form.exactTarget);
      const txHash = await operator.client.writeContract({
        address: marketContractAddress,
        abi: trafficMarketAbi,
        account: operator.account,
        functionName: 'createMarket',
        args: [
          form.roomId as `0x${string}`,
          closeTime,
          resolveDeadline,
          lower,
          upper,
          exact,
          SAFE_FEE_BPS,
        ],
        chain: arbitrumSepolia,
      });
      setNotice(`Market creation submitted: ${txHash.slice(0, 12)}…`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Market creation reverted');
      const refreshedNextId = await publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'nextMarketId' }) as bigint;
      setNextId(refreshedNextId);
      const createdId = refreshedNextId - 1n;
      setNotice(`Market #${createdId.toString()} created and is now Open. Set VITE_ACTIVE_MARKET_ID=${createdId.toString()} to bet on it.`);
      setForm(emptyState());
    } catch (error) {
      setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Market creation failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="market-create" aria-labelledby="create-market-title">
      <header><div><span className="market-create-icon"><Plus /></span><span><b id="create-market-title">Create prediction market</b><small>Market operator · Arbitrum Sepolia</small></span></div><button type="button" disabled={refreshingId} onClick={() => void refreshNextId()} aria-label={nextId === null ? 'Check next market ID' : `Refresh next market ID, currently ${nextId}`}><RefreshCw className={refreshingId ? 'is-spinning' : ''} /> {refreshingId ? 'Checking…' : nextId === null ? 'Check next ID' : `Next ID · ${nextId}`}</button></header>
      <p className="market-create-intro">Unlock the dedicated operator wallet locally, then define the traffic-count range and market window. The keystore never leaves this device.</p>
      <div className="operator-unlock">
        <div className="keystore-picker"><span id="operator-keystore-label">Operator keystore</span><button type="button" className="file-control" onClick={() => fileInputRef.current?.click()} aria-labelledby="operator-keystore-label operator-keystore-name"><FileKey2 /><span><b id="operator-keystore-name" title={keystoreFile?.name}>{keystoreFile?.name ?? 'Choose encrypted JSON file'}</b><small>{keystoreFile ? `${Math.max(1, Math.ceil(keystoreFile.size / 1024))} KB · ready to unlock` : 'Web3 V3 · processed locally'}</small></span></button><input hidden ref={fileInputRef} type="file" accept="application/json,.json" onChange={(event) => { setKeystoreFile(event.target.files?.[0] ?? null); setOperator(null); setNotice(''); event.target.value = ''; }} /></div>
        <label htmlFor="operator-backup-password"><span>Backup password</span><input id="operator-backup-password" type="password" autoComplete="current-password" placeholder="Enter the offline backup password" value={keystorePassword} onChange={(event) => setKeystorePassword(event.target.value)} aria-describedby="operator-security-note" /></label>
        <button type="button" disabled={!keystoreFile || !keystorePassword || pending || unlocking} onClick={() => void decryptKeystore()}>{unlocking ? <Loader2 className="is-spinning" /> : <ShieldCheck />}{unlocking ? 'Decrypting…' : operator ? 'Operator unlocked' : 'Unlock operator'}</button>
        <small id="operator-security-note" className="operator-security-note">Your password and keystore stay in this browser tab.</small>
        {operator && <div className="operator-address"><CheckCircle2 /><span><b>Authorized signer ready</b><code>{operator.address}</code></span></div>}
      </div>
      {operator && (
        <div className="market-form">
          <label>Room
            <select value={form.roomId} onChange={(event) => setForm((f) => ({ ...f, roomId: event.target.value }))}>
              <option value="">Custom / manual bytes32…</option>
              {ROOMS.map((room) => (
                <option key={room.id} value={keccak256(toBytes(room.id))}>
                  {room.name} ({room.id})
                </option>
              ))}
            </select>
          </label>
          <label>Room ID (bytes32 hex)<input placeholder="0x… (64 hex chars)" value={form.roomId} onChange={(event) => setForm((f) => ({ ...f, roomId: event.target.value }))} /></label>
          <div className="market-grid">
            <label>Lower bound<input type="number" value={form.lowerBound} onChange={(event) => setForm((f) => ({ ...f, lowerBound: event.target.value }))} /></label>
            <label>Upper bound<input type="number" value={form.upperBound} onChange={(event) => setForm((f) => ({ ...f, upperBound: event.target.value }))} /></label>
            <label>Exact target<input type="number" value={form.exactTarget} onChange={(event) => setForm((f) => ({ ...f, exactTarget: event.target.value }))} /></label>
            <label>Close in (min)<input type="number" value={form.closeInMinutes} onChange={(event) => setForm((f) => ({ ...f, closeInMinutes: event.target.value }))} /></label>
            <label>Resolve in (min)<input type="number" value={form.resolveInMinutes} onChange={(event) => setForm((f) => ({ ...f, resolveInMinutes: event.target.value }))} /></label>
            <label>Fee (bps)<input type="number" value={SAFE_FEE_BPS} readOnly /></label>
          </div>
          <button disabled={!formValid || pending} onClick={createMarket}><Plus />Create market</button>
        </div>
      )}
      {!formValid && operator && <p className="admin-hint"><AlertTriangle /> Enter a valid 0x-prefixed 64-char room ID, numeric bounds, and resolve time after close time.</p>}
      {notice && <p className="admin-notice" role="status" aria-live="polite">{notice}</p>}
    </section>
  );
}
