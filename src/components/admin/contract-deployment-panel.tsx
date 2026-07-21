import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, KeyRound, Rocket, Upload } from 'lucide-react';
import { getAddress, isAddress, keccak256, parseAbi, parseEther, toBytes, type Abi, encodeFunctionData } from 'viem';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { TransactionStatus, type TransactionState } from '@/components/transaction-status';
import { PLATFORM_ADMIN_ADDRESS, isPlatformAdmin } from '@/config/detection-zone';
import { downloadRoleKeystore, generateEncryptedRoleWallets, inspectRoleKeystore, type EncryptedRoleWallet } from '@/lib/role-wallet-kit';
import { AUTH_API_URL } from '@/lib/wagmi';
import { ROOMS } from '@/lib/globe-markers';
import type { DetectionZone } from '@/config/detection-zone';

interface ContractArtifact { abi: Abi; bytecode: `0x${string}` }

const ROLE_FUND_TARGET = parseEther('0.05');
const ROLE_LABELS = { oracle: 'oracle', marketOperator: 'market operator', disputeResolver: 'dispute resolver' } as const;

export function ContractDeploymentPanel() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: arbitrumSepolia.id });
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const [sessionAddress, setSessionAddress] = useState('');
  const [roleAddresses, setRoleAddresses] = useState({ oracle: '', marketOperator: '', disputeResolver: '' });
  const [kitPassword, setKitPassword] = useState('');
  const [kitPasswordConfirm, setKitPasswordConfirm] = useState('');
  const [roleWalletKit, setRoleWalletKit] = useState<EncryptedRoleWallet[]>([]);
  const [generatingKit, setGeneratingKit] = useState(false);
  const [backupsDownloaded, setBackupsDownloaded] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [deployHash, setDeployHash] = useState<`0x${string}`>();
  const [deployState, setDeployState] = useState<TransactionState>();
  const [deployedAddress, setDeployedAddress] = useState<`0x${string}`>();
  const [notice, setNotice] = useState('');
  const [importedFiles, setImportedFiles] = useState<string[]>([]);
  const [autoFund, setAutoFund] = useState(true);
  const [fundingState, setFundingState] = useState<TransactionState>();
  const [fundingDetail, setFundingDetail] = useState('');
  const [bankrollAmount, setBankrollAmount] = useState('1');
  const [upgradeHash, setUpgradeHash] = useState<`0x${string}`>();
  const [upgradeState, setUpgradeState] = useState<TransactionState>();
  const [implArtifact, setImplArtifact] = useState<ContractArtifact | null>(null);
  const [proxyArtifact, setProxyArtifact] = useState<ContractArtifact | null>(null);
  const authenticatedAdmin = isPlatformAdmin(address) && sessionAddress.toLowerCase() === address?.toLowerCase();

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}contracts/TrafficPredictionMarket.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() as Promise<ContractArtifact> : Promise.reject('impl missing')),
      fetch(`${import.meta.env.BASE_URL}contracts/ERC1967Proxy.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() as Promise<ContractArtifact> : Promise.reject('proxy missing')),
    ]).then(([impl, proxy]) => { setImplArtifact(impl); setProxyArtifact(proxy); }).catch(() => setNotice('Deployment artifacts are unavailable'));
  }, []);

  function prepareRoleAddresses(value: typeof roleAddresses) {
    setRoleAddresses(value);
    sessionStorage.setItem('crossflow:prepared-roles', JSON.stringify(value));
    window.dispatchEvent(new Event('crossflow:prepared-roles'));
  }

  const roleValidation = useMemo(() => {
    const raw = [roleAddresses.oracle, roleAddresses.marketOperator, roleAddresses.disputeResolver];
    if (!raw.every(value => isAddress(value))) return null;
    const normalized = raw.map(value => getAddress(value));
    return new Set([PLATFORM_ADMIN_ADDRESS.toLowerCase(), ...normalized.map(value => value.toLowerCase())]).size === 4 ? normalized as [`0x${string}`, `0x${string}`, `0x${string}`] : null;
  }, [roleAddresses]);

  async function refreshSession() {
    const response = await fetch(`${AUTH_API_URL}/auth/session`, { credentials: 'include' }).catch(() => null);
    const session = response?.ok ? await response.json() as { address?: string } : null;
    setSessionAddress(session?.address ?? '');
  }
  useEffect(() => {
    fetch(`${AUTH_API_URL}/auth/session`, { credentials: 'include' })
      .then(async response => response.ok ? response.json() as Promise<{ address?: string }> : null)
      .then(session => setSessionAddress(session?.address ?? ''))
      .catch(() => setSessionAddress(''));
  }, [address]);

  async function generateKit() {
    if (kitPassword !== kitPasswordConfirm) { setNotice('Wallet-backup passwords do not match.'); return; }
    setGeneratingKit(true); setNotice('');
    try {
      const wallets = await generateEncryptedRoleWallets(kitPassword);
      const byRole = Object.fromEntries(wallets.map(wallet => [wallet.role, wallet.address])) as Record<EncryptedRoleWallet['role'], string>;
      setRoleWalletKit(wallets); prepareRoleAddresses({ oracle: byRole.oracle, marketOperator: byRole.marketOperator, disputeResolver: byRole.disputeResolver });
      setKitPassword(''); setKitPasswordConfirm(''); setBackupsDownloaded(false); setBackupConfirmed(false);
      setNotice('Three encrypted testnet role wallets are ready. Download every backup before deployment.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Wallet generation failed'); }
    finally { setGeneratingKit(false); }
  }

  function downloadAll() {
    roleWalletKit.forEach(downloadRoleKeystore); setBackupsDownloaded(true); setBackupConfirmed(false);
  }

  async function importKeystores(files: FileList | null) {
    if (!files || files.length !== 3) { setNotice('Select exactly three encrypted keystore JSON files.'); return; }
    try {
      const inspected = await Promise.all(Array.from(files).map(inspectRoleKeystore));
      if (new Set(inspected.map(item => item.address.toLowerCase())).size !== 3) throw new Error('Every role must use a different wallet');
      const remaining = [...inspected];
      const take = (pattern: RegExp) => {
        const index = remaining.findIndex(item => pattern.test(item.filename));
        return remaining.splice(index >= 0 ? index : 0, 1)[0];
      };
      const oracle = take(/oracle/i); const marketOperator = take(/market|operator/i); const disputeResolver = take(/dispute|resolver/i);
      prepareRoleAddresses({ oracle: oracle.address, marketOperator: marketOperator.address, disputeResolver: disputeResolver.address });
      setImportedFiles(inspected.map(item => item.filename)); setRoleWalletKit([]); setBackupsDownloaded(true); setBackupConfirmed(false);
      setNotice('Three encrypted keystores were validated locally. Confirm your offline backups before deployment.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Keystore import failed'); }
  }

  async function fundRole(role: keyof typeof ROLE_LABELS, target: `0x${string}`) {
    if (!walletClient || !publicClient || !address) return false;
    const balance = await publicClient.getBalance({ address: target });
    if (balance >= ROLE_FUND_TARGET) return false;
    const hash = await walletClient.sendTransaction({ account: address, chain: arbitrumSepolia, to: target, value: ROLE_FUND_TARGET - balance });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== 'success') throw new Error(`Funding ${ROLE_LABELS[role]} (${target}) reverted`);
    return true;
  }

  async function fundRoles() {
    if (!walletClient || !publicClient || !address || !roleValidation) return;
    setFundingState('AWAITING_SIGNATURE'); setFundingDetail('');
    const entries = Object.entries(ROLE_LABELS) as [keyof typeof ROLE_LABELS, string][];
    const funded: string[] = [];
    const skipped: string[] = [];
    try {
      for (const [role, label] of entries) {
        setFundingDetail(`Funding ${label}…`);
        const sent = await fundRole(role, getAddress(roleAddresses[role]));
        (sent ? funded : skipped).push(label);
      }
      setFundingState('CONFIRMED');
      setFundingDetail(`Funded ${funded.length} role wallet${funded.length === 1 ? '' : 's'}${skipped.length ? `, ${skipped.length} already had enough` : ''}.`);
    } catch (error) {
      setFundingState('FAILED');
      setFundingDetail(error instanceof Error ? error.message : 'Funding failed');
      throw error;
    }
  }

  async function deploy() {
    if (!walletClient || !publicClient || !address || !authenticatedAdmin || !roleValidation || !backupConfirmed || !implArtifact || !proxyArtifact) return;
    setDeployState('AWAITING_SIGNATURE'); setNotice('');
    try {
      if (!/^\d+(?:\.\d{1,18})?$/.test(bankrollAmount) || parseEther(bankrollAmount) <= 0n) throw new Error('Enter a positive launch bankroll');
      const operatorResponse = await fetch(`${AUTH_API_URL}/admin/market-scheduler/operator`, { credentials: 'include' });
      const automationOperator = operatorResponse.ok ? await operatorResponse.json() as { address?: string } : null;
      if (!automationOperator?.address || automationOperator.address.toLowerCase() !== roleValidation[1].toLowerCase()) {
        throw new Error(`Market operator must match the Worker automation signer ${automationOperator?.address ?? '(unavailable)'}. Import that operator keystore before deploying.`);
      }
      setNotice('Validating every saved room zone…');
      const zones = await Promise.all(ROOMS.map(async (room) => {
        const zoneResponse = await fetch(`${AUTH_API_URL}/rooms/${room.id}/zone`, { credentials: 'include' });
        if (!zoneResponse.ok) throw new Error(`${room.name} has no saved detection zone`);
        return zoneResponse.json() as Promise<DetectionZone>;
      }));
      setNotice('Deploying implementation contract…');
      const implHash = await walletClient.deployContract({ account: address, abi: implArtifact.abi, bytecode: implArtifact.bytecode, args: [] });
      const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash, confirmations: 1 });
      if (implReceipt.status !== 'success' || !implReceipt.contractAddress) throw new Error('Implementation deployment reverted');
      const implementationAddress = implReceipt.contractAddress;
      setNotice(`Implementation deployed at ${implementationAddress}. Deploying upgradeable proxy…`);
      const initAbi = parseAbi(['function initialize(address admin, address oracle, address marketOperator, address disputeResolver)']);
      const initData = encodeFunctionData({ abi: initAbi, functionName: 'initialize', args: [PLATFORM_ADMIN_ADDRESS, ...roleValidation] });
      const proxyHash = await walletClient.deployContract({ account: address, abi: proxyArtifact.abi, bytecode: proxyArtifact.bytecode, args: [implementationAddress, initData] });
      setDeployHash(proxyHash); setDeployState('PENDING');
      const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash, confirmations: 1 });
      if (proxyReceipt.status !== 'success' || !proxyReceipt.contractAddress) throw new Error('Proxy deployment reverted');
      const proxyAddress = proxyReceipt.contractAddress;
      setDeployedAddress(proxyAddress); setDeployState('CONFIRMED');
      setNotice(`Proxy deployed at ${proxyAddress}. Funding ${bankrollAmount} ETH guaranteed-return bankroll…`);
      const liquidityHash = await walletClient.writeContract({ account: address, address: proxyAddress, abi: implArtifact.abi, functionName: 'fundLiquidity', value: parseEther(bankrollAmount), chain: arbitrumSepolia });
      const liquidityReceipt = await publicClient.waitForTransactionReceipt({ hash: liquidityHash, confirmations: 1 });
      if (liquidityReceipt.status !== 'success') throw new Error('Initial bankroll funding reverted');

      setNotice(`Bankroll funded. Publishing ${zones.length} room zones atomically…`);
      const roomIds = zones.map((zone) => keccak256(toBytes(zone.roomId)));
      const geometries = zones.map((zone) => [zone.topLeftXBps, zone.topLeftYBps, zone.topRightXBps, zone.topRightYBps,
        zone.bottomRightXBps, zone.bottomRightYBps, zone.bottomLeftXBps, zone.bottomLeftYBps] as const);
      const zonesHash = await walletClient.writeContract({ account: address, address: proxyAddress, abi: implArtifact.abi, functionName: 'setRoomZones', args: [roomIds, geometries], chain: arbitrumSepolia });
      const zonesReceipt = await publicClient.waitForTransactionReceipt({ hash: zonesHash, confirmations: 1 });
      if (zonesReceipt.status !== 'success') throw new Error('Batch zone publication reverted');

      if (autoFund) {
        setNotice(`Contract deployed at ${proxyAddress}. Funding low-balance role wallets from your admin balance…`);
        try {
          await fundRoles();
        } catch {
          setNotice(`Contract deployed at ${proxyAddress}, but role-wallet funding failed: ${fundingDetail || 'unknown error'}. Fund them manually from a faucet.`);
        }
      }
      try {
        const res = await fetch('/__crossflow_update_env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            VITE_MARKET_CONTRACT_ADDRESS: proxyAddress,
          }),
        });
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          setNotice('Environment updated. Starting automated rounds…');
          let schedulerStarted = false;
          for (let attempt = 0; attempt < 6 && !schedulerStarted; attempt++) {
            if (attempt > 0) await new Promise(resolve => window.setTimeout(resolve, 750));
            const schedulerResponse = await fetch(`${AUTH_API_URL}/admin/market-scheduler/reconcile`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' } }).catch(() => null);
            schedulerStarted = schedulerResponse?.ok === true;
          }
          if (!schedulerStarted) throw new Error('Contract is ready, but the scheduler could not start. Verify that the deployed market-operator wallet matches MARKET_OPERATOR_PRIVATE_KEY.');
          setNotice(`Game launched at ${proxyAddress}. Bankroll funded, ${zones.length} zones published, and automated rounds started. Reloading…`);
          setTimeout(() => window.location.reload(), 1800);
        } else {
          setNotice(`Contract deployed at ${proxyAddress}. Local env update failed: ${data?.error ?? 'unknown error'}. Set VITE_MARKET_CONTRACT_ADDRESS and Worker MARKET_CONTRACT_ADDRESS manually.`);
        }
      } catch {
        setNotice(`Contract deployed at ${proxyAddress}. Set VITE_MARKET_CONTRACT_ADDRESS and Worker MARKET_CONTRACT_ADDRESS manually.`);
      }
    } catch (error) { setDeployState('FAILED'); setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Deployment failed'); }
  }

  async function upgrade() {
    if (!walletClient || !publicClient || !address || !authenticatedAdmin || !roleValidation || !implArtifact || !deployedAddress) return;
    setUpgradeState('AWAITING_SIGNATURE'); setNotice('');
    try {
      const operatorResponse = await fetch(`${AUTH_API_URL}/admin/market-scheduler/operator`, { credentials: 'include' });
      const automationOperator = operatorResponse.ok ? await operatorResponse.json() as { address?: string } : null;
      if (!automationOperator?.address || automationOperator.address.toLowerCase() !== roleValidation[1].toLowerCase()) {
        throw new Error(`Market operator must match the Worker automation signer ${automationOperator?.address ?? '(unavailable)'}. Import that operator keystore before upgrading.`);
      }
      setNotice('Deploying new implementation contract for upgrade…');
      const implHash = await walletClient.deployContract({ account: address, abi: implArtifact.abi, bytecode: implArtifact.bytecode, args: [] });
      const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash, confirmations: 1 });
      if (implReceipt.status !== 'success' || !implReceipt.contractAddress) throw new Error('New implementation deployment reverted');
      const newImplAddress = implReceipt.contractAddress;
      setNotice(`New implementation deployed at ${newImplAddress}. Upgrading proxy at ${deployedAddress}…`);
      const upgradeHash = await walletClient.writeContract({ account: address, address: deployedAddress, abi: implArtifact.abi, functionName: 'upgradeToAndCall', args: [newImplAddress, '0x'], chain: arbitrumSepolia });
      setUpgradeHash(upgradeHash); setUpgradeState('PENDING');
      const upgradeReceipt = await publicClient.waitForTransactionReceipt({ hash: upgradeHash, confirmations: 1 });
      if (upgradeReceipt.status !== 'success') throw new Error('Proxy upgrade reverted');
      setUpgradeState('CONFIRMED');
      setNotice(`Proxy upgraded to ${newImplAddress}. Funds and state are preserved. Reloading…`);
      setTimeout(() => window.location.reload(), 1800);
    } catch (error) { setUpgradeState('FAILED'); setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Upgrade failed'); }
  }

  return <>
    <div className={`admin-access ${authenticatedAdmin ? 'granted' : 'restricted'}`}>
      <KeyRound />
      <div>
        <b>{authenticatedAdmin ? 'Admin session verified' : 'Admin authentication required'}</b>
        <span>Connect the fixed admin wallet and verify its SIWE session before deployment.</span>
      </div>
      {!authenticatedAdmin && <button onClick={refreshSession}>Recheck session</button>}
    </div>
    <section className="deploy-console" id="redeploy" tabIndex={-1}>
      <div className="deploy-copy">
        <span><Rocket /> Arbitrum Sepolia only</span>
        <h2>Role-wallet kit</h2>
        <p>Generate three independent wallets locally or import three existing encrypted Web3 V3 keystores. Files are inspected locally and never uploaded.</p>
        <div className="role-import">
          <label><Upload /> Import three encrypted wallets<input type="file" accept="application/json,.json" multiple onChange={event => void importKeystores(event.target.files)} /></label>
          {importedFiles.length > 0 && <small>{importedFiles.join(' · ')}</small>}
        </div>
        <div className="role-kit">
          {roleWalletKit.length === 0 && importedFiles.length === 0 ? <>
            <label>Backup password<input type="password" minLength={16} value={kitPassword} onChange={event => setKitPassword(event.target.value)} /></label>
            <label>Confirm password<input type="password" minLength={16} value={kitPasswordConfirm} onChange={event => setKitPasswordConfirm(event.target.value)} /></label>
            <button disabled={generatingKit || kitPassword.length < 16 || kitPasswordConfirm.length < 16} onClick={generateKit}><KeyRound />{generatingKit ? 'Encrypting wallets…' : 'Generate encrypted wallet kit'}</button>
          </> : roleWalletKit.length > 0 ? <button onClick={downloadAll}><Download />Download all three keystores</button> : null}
          <label className="backup-confirm">
            <input type="checkbox" disabled={!backupsDownloaded} checked={backupConfirmed} onChange={event => setBackupConfirmed(event.target.checked)} />
            <span>I stored all files and passwords offline.</span>
          </label>
        </div>
        {deployedAddress && <button onClick={() => navigator.clipboard.writeText(deployedAddress)}><Copy />{deployedAddress}</button>}
        <div className="role-fields">
          <label>Oracle address<input readOnly={roleWalletKit.length > 0 || importedFiles.length > 0} value={roleAddresses.oracle} onChange={event => setRoleAddresses(current => ({ ...current, oracle: event.target.value }))} /></label>
          <label>Market operator<input readOnly={roleWalletKit.length > 0 || importedFiles.length > 0} value={roleAddresses.marketOperator} onChange={event => setRoleAddresses(current => ({ ...current, marketOperator: event.target.value }))} /></label>
          <label>Dispute resolver<input readOnly={roleWalletKit.length > 0 || importedFiles.length > 0} value={roleAddresses.disputeResolver} onChange={event => setRoleAddresses(current => ({ ...current, disputeResolver: event.target.value }))} /></label>
          <label>Launch bankroll (ETH)<input inputMode="decimal" value={bankrollAmount} onChange={event => setBankrollAmount(event.target.value)} /><small>Deposited into the contract before bets open to guarantee fixed returns.</small></label>
          <label className="backup-confirm"><input type="checkbox" checked={autoFund} onChange={event => setAutoFund(event.target.checked)} /><span>Auto-fund role wallets from my admin balance if they are low on testnet ETH</span></label>
          {!deployedAddress ? <button disabled={!authenticatedAdmin || !roleValidation || !backupConfirmed || chainId !== arbitrumSepolia.id || deployState === 'PENDING' || fundingState === 'AWAITING_SIGNATURE' || !implArtifact || !proxyArtifact} onClick={deploy}><Rocket />Deploy & launch game automatically</button> : <button disabled={!authenticatedAdmin || !roleValidation || chainId !== arbitrumSepolia.id || deployState === 'PENDING' || fundingState === 'AWAITING_SIGNATURE' || upgradeState === 'PENDING' || !implArtifact} onClick={upgrade}><Rocket />Upgrade contract logic</button>}
          {deployState && <TransactionStatus state={deployState} hash={deployHash} />}
          {fundingState && <TransactionStatus state={fundingState} detail={fundingDetail} />}
          {upgradeState && <TransactionStatus state={upgradeState} hash={upgradeHash} />}
        </div>
      </div>
    </section>
    {notice && <p className="admin-notice">{notice}</p>}
  </>;
}
