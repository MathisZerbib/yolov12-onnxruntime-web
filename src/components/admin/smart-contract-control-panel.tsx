import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatEther, isAddress, keccak256, parseEther, toBytes } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { isPlatformAdmin } from '@/config/detection-zone';
import { marketContractAddress, trafficMarketAbi } from '@/lib/market-contract';

const roles = [
  { label: 'Oracle', key: keccak256(toBytes('ORACLE_ROLE')) },
  { label: 'Market operator', key: keccak256(toBytes('MARKET_ROLE')) },
  { label: 'Dispute resolver', key: keccak256(toBytes('DISPUTE_ROLE')) },
] as const;

export function SmartContractControlPanel() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: arbitrumSepolia.id });
  const { writeContractAsync } = useWriteContract();
  const [paused, setPaused] = useState<boolean | null>(null);
  const [nextMarketId, setNextMarketId] = useState<bigint>(0n);
  const [fees, setFees] = useState<bigint>(0n);
  const [liquidity, setLiquidity] = useState<bigint>(0n);
  const [lockedPayouts, setLockedPayouts] = useState<bigint>(0n);
  const [fundAmount, setFundAmount] = useState('0.1');
  const [roleAccounts, setRoleAccounts] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState(0);
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [preparedRoles, setPreparedRoles] = useState<{ oracle: `0x${string}`; marketOperator: `0x${string}`; disputeResolver: `0x${string}` } | null>(null);

  const refresh = useCallback(async () => {
    if (!publicClient) return;
    try {
      const [pauseState, marketId, protocolFees, available, locked] = await Promise.all([
        publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'paused' }),
        publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'nextMarketId' }),
        publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'protocolFees' }),
        publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'availableLiquidity' }),
        publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'lockedPayouts' }),
      ]);
      setPaused(pauseState); setNextMarketId(marketId); setFees(protocolFees); setLiquidity(available); setLockedPayouts(locked);
      const accounts = await Promise.all(roles.map(role => publicClient.readContract({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'roleAccount', args: [role.key] }).catch(() => null)));
      setRoleAccounts(accounts.filter((item): item is `0x${string}` => Boolean(item)));
    } catch { setNotice('The configured contract could not be read from Arbitrum Sepolia.'); }
  }, [publicClient]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const load = () => {
      try {
        const value = JSON.parse(sessionStorage.getItem('crossflow:prepared-roles') ?? 'null') as typeof preparedRoles;
        setPreparedRoles(value && isAddress(value.oracle) && isAddress(value.marketOperator) && isAddress(value.disputeResolver) ? value : null);
      } catch { setPreparedRoles(null); }
    };
    load(); window.addEventListener('crossflow:prepared-roles', load); return () => window.removeEventListener('crossflow:prepared-roles', load);
  }, []);

  async function submit(functionName: 'pause' | 'unpause' | 'rotateOperationalRole', args?: readonly [`0x${string}`, `0x${string}`]) {
    if (!isPlatformAdmin(address) || chainId !== arbitrumSepolia.id || !publicClient) return;
    setPending(true); setNotice('');
    try {
      const hash = functionName === 'rotateOperationalRole'
        ? await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName, args: args!, chainId: arbitrumSepolia.id })
        : await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName, chainId: arbitrumSepolia.id });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      setConfirmation(''); setNotice(`Confirmed: ${hash.slice(0, 12)}…`); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Admin transaction failed'); }
    finally { setPending(false); }
  }

  const pauseWord = paused ? 'UNPAUSE' : 'PAUSE';
  const preparedRoleAddresses = preparedRoles ? [preparedRoles.oracle, preparedRoles.marketOperator, preparedRoles.disputeResolver] as const : null;
  const selectedPreparedAddress = preparedRoleAddresses?.[selectedRole];
  async function rotatePreparedRoles() {
    if (!preparedRoles || !isPlatformAdmin(address) || !publicClient) return;
    setPending(true); setNotice('');
    try {
      const hash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'rotateAllOperationalRoles', args: [preparedRoles.oracle, preparedRoles.marketOperator, preparedRoles.disputeResolver], chainId: arbitrumSepolia.id });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      setNotice(`All three roles rotated: ${hash.slice(0, 12)}…`); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Batch rotation failed'); }
    finally { setPending(false); }
  }
  async function fundLiquidity() {
    if (!publicClient || chainId !== arbitrumSepolia.id || !/^\d+(?:\.\d{1,18})?$/.test(fundAmount)) return;
    setPending(true); setNotice('');
    try {
      const hash = await writeContractAsync({ address: marketContractAddress, abi: trafficMarketAbi, functionName: 'fundLiquidity', value: parseEther(fundAmount), chainId: arbitrumSepolia.id });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Liquidity transaction reverted');
      setNotice(`Liquidity funded: ${fundAmount} ETH`); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message.split('\n')[0] : 'Liquidity funding failed'); }
    finally { setPending(false); }
  }
  return <section className="contract-control"><header><div><ShieldCheck /><span><b>Live contract controls</b><small>{marketContractAddress}</small></span></div><button onClick={() => void refresh()}><RefreshCw /> Refresh</button></header><div className="contract-metrics"><div><span>State</span><b>{paused === null ? 'UNKNOWN' : paused ? 'PAUSED' : 'ACTIVE'}</b></div><div><span>Next market</span><b>#{nextMarketId.toString()}</b></div><div><span>Available bankroll</span><b>{Number(formatEther(liquidity)).toFixed(4)} ETH</b></div><div><span>Guaranteed payouts</span><b>{Number(formatEther(lockedPayouts)).toFixed(4)} ETH</b></div><div><span>Protocol fees</span><b>{Number(formatEther(fees)).toFixed(5)} ETH</b></div></div><div className="liquidity-funder"><div><b>Fixed-return bankroll</b><small>Funds guarantee 1.5× / 1.75× / 2× / 3× player returns. Bets exceeding available coverage revert on-chain.</small></div><input aria-label="Liquidity amount in ETH" inputMode="decimal" value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} /><button disabled={pending || chainId !== arbitrumSepolia.id} onClick={() => void fundLiquidity()}>Fund bankroll</button></div><div className="role-status">{roles.map((role, index) => <div key={role.label}><span>{role.label}</span><code>{roleAccounts[index] ?? 'Unavailable on legacy deployment'}</code></div>)}</div>{preparedRoles && <div className="prepared-rotation"><div><b>Prepared three-wallet kit</b><small>One transaction rotates oracle, market operator, and dispute resolver atomically.</small></div><button disabled={pending || roleAccounts.length !== 3} onClick={() => void rotatePreparedRoles()}><RefreshCw /> One-click rotate all roles</button></div>}<div className="danger-controls"><article><AlertTriangle /><div><h3>Emergency circuit breaker</h3><p>Pausing blocks new markets and positions. Existing claims and dispute recovery remain available.</p><input placeholder={`Type ${pauseWord}`} value={confirmation} onChange={event => setConfirmation(event.target.value)} /><button disabled={pending || confirmation !== pauseWord || paused === null} onClick={() => void submit(paused ? 'unpause' : 'pause')}><LockKeyhole /> {pauseWord} contract</button></div></article><article><RefreshCw /><div><h3>One-click single-role rotation</h3><p>The replacement address is taken automatically from the prepared encrypted wallet kit.</p><select value={selectedRole} onChange={event => setSelectedRole(Number(event.target.value))}>{roles.map((role, index) => <option value={index} key={role.label}>{role.label}</option>)}</select><div className="automatic-target"><span>Automatic replacement</span><code>{selectedPreparedAddress ?? 'Generate or import a role-wallet kit below'}</code></div><button disabled={pending || roleAccounts.length !== 3 || !selectedPreparedAddress || roleAccounts[selectedRole]?.toLowerCase() === selectedPreparedAddress.toLowerCase()} onClick={() => selectedPreparedAddress && void submit('rotateOperationalRole', [roles[selectedRole].key, selectedPreparedAddress])}><ShieldCheck /> Rotate {roles[selectedRole].label} automatically</button></div></article></div>{notice && <p className="admin-notice">{notice}</p>}</section>;
}
