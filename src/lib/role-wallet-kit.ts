import { bytesToHex, concat, hexToBytes, keccak256, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export type TestnetRole = 'oracle' | 'marketOperator' | 'disputeResolver';

interface Web3KeystoreV3 {
  version: 3;
  id: string;
  address: string;
  crypto: {
    cipher: 'aes-128-ctr';
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: 'pbkdf2';
    kdfparams: { dklen: 32; c: number; prf: 'hmac-sha256'; salt: string };
    mac: string;
  };
}

export interface EncryptedRoleWallet {
  role: TestnetRole;
  address: `0x${string}`;
  filename: string;
  keystore: Web3KeystoreV3;
}

const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS }, passwordKey, 256);
  return new Uint8Array(bits);
}

async function encryptRoleWallet(role: TestnetRole, password: string): Promise<EncryptedRoleWallet> {
  const privateKey = generatePrivateKey();
  const privateKeyBytes = hexToBytes(privateKey);
  const account = privateKeyToAccount(privateKey);
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);
  const aesKey = await crypto.subtle.importKey('raw', derivedKey.slice(0, 16), { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter: iv as BufferSource, length: 128 }, aesKey, privateKeyBytes as BufferSource));
  const mac = keccak256(concat([bytesToHex(derivedKey.slice(16, 32)), bytesToHex(encrypted)]));

  // Fail closed if this runtime cannot recover the key it is about to export.
  const recovered = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter: iv as BufferSource, length: 128 }, aesKey, encrypted as BufferSource));
  if (recovered.length !== privateKeyBytes.length || recovered.some((byte, index) => byte !== privateKeyBytes[index])) {
    privateKeyBytes.fill(0); recovered.fill(0); derivedKey.fill(0);
    throw new Error('Encrypted wallet self-check failed');
  }

  const keystore: Web3KeystoreV3 = {
    version: 3,
    id: crypto.randomUUID(),
    address: account.address.slice(2).toLowerCase(),
    crypto: {
      cipher: 'aes-128-ctr', cipherparams: { iv: bytesToHex(iv).slice(2) }, ciphertext: bytesToHex(encrypted).slice(2),
      kdf: 'pbkdf2', kdfparams: { dklen: 32, c: PBKDF2_ITERATIONS, prf: 'hmac-sha256', salt: bytesToHex(salt).slice(2) },
      mac: (mac as Hex).slice(2),
    },
  };
  privateKeyBytes.fill(0); recovered.fill(0); derivedKey.fill(0); salt.fill(0); iv.fill(0); encrypted.fill(0);
  return { role, address: account.address, filename: `crossflow-arbitrum-sepolia-${role}-${account.address}.json`, keystore };
}

export async function generateEncryptedRoleWallets(password: string): Promise<EncryptedRoleWallet[]> {
  if (password.length < 16) throw new Error('Use at least 16 characters for the wallet-backup password');
  const wallets = await Promise.all((['oracle', 'marketOperator', 'disputeResolver'] as const).map(role => encryptRoleWallet(role, password)));
  if (new Set(wallets.map(wallet => wallet.address.toLowerCase())).size !== wallets.length) throw new Error('Role wallet collision; generate a new kit');
  return wallets;
}

export function downloadRoleKeystore(wallet: EncryptedRoleWallet): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(wallet.keystore, null, 2)}\n`], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = wallet.filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function inspectRoleKeystore(file: File): Promise<{ address: `0x${string}`; filename: string }> {
  if (file.size > 256_000) throw new Error(`${file.name} is too large to be a keystore`);
  let value: Partial<Web3KeystoreV3>;
  try { value = JSON.parse(await file.text()) as Partial<Web3KeystoreV3>; }
  catch { throw new Error(`${file.name} is not valid JSON`); }
  const cryptoSection = value.crypto;
  if (value.version !== 3 || !cryptoSection || cryptoSection.cipher !== 'aes-128-ctr' || cryptoSection.kdf !== 'pbkdf2' ||
      typeof value.address !== 'string' || !/^[0-9a-fA-F]{40}$/.test(value.address) || typeof cryptoSection.ciphertext !== 'string' ||
      typeof cryptoSection.mac !== 'string' || cryptoSection.kdfparams?.prf !== 'hmac-sha256' || cryptoSection.kdfparams.c < 100_000) {
    throw new Error(`${file.name} is not a supported encrypted Web3 V3 keystore`);
  }
  return { address: `0x${value.address}` as `0x${string}`, filename: file.name };
}
