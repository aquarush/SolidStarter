// Browser hot wallet for live networks.
//
// Security model:
//  * The private key is generated with the platform CSPRNG (crypto.getRandomValues via libauth).
//  * At rest it is stored ONLY encrypted: AES-256-GCM with a key derived from the user's password
//    by PBKDF2-SHA256 (600,000 iterations, random 16-byte salt, random 12-byte IV).
//  * The decrypted key lives in memory for the session and is never sent anywhere; the app talks
//    only to public Electrum servers, which receive signed transactions, never keys.
//  * Each network has its own key, so a chipnet key is never reused on mainnet.
import {
  decodePrivateKeyWif,
  encodePrivateKeyWif,
  generatePrivateKey,
  validateSecp256k1PrivateKey,
} from '@bitauth/libauth';
import type { NetworkName } from './campaign-ref';

const STORAGE_PREFIX = 'solidstarter.wallet.v1.';
const PBKDF2_ITERATIONS = 600_000;

interface StoredWallet {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function validatePassword(password: string): void {
  if (password.length < 10) throw new Error('Use a password of at least 10 characters.');
}

export function hasStoredWallet(network: NetworkName): boolean {
  return Boolean(storage()?.getItem(STORAGE_PREFIX + network));
}

export async function saveWallet(network: NetworkName, privateKey: Uint8Array, password: string): Promise<void> {
  validatePassword(password);
  if (!validateSecp256k1PrivateKey(privateKey)) throw new Error('Invalid private key.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, privateKey as BufferSource));
  const record: StoredWallet = { v: 1, salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) };
  const store = storage();
  if (!store) throw new Error('Browser storage is unavailable; the wallet cannot be saved.');
  store.setItem(STORAGE_PREFIX + network, JSON.stringify(record));
}

export async function unlockWallet(network: NetworkName, password: string): Promise<Uint8Array> {
  const raw = storage()?.getItem(STORAGE_PREFIX + network);
  if (!raw) throw new Error('No wallet saved for this network.');
  const record = JSON.parse(raw) as StoredWallet;
  if (record.v !== 1) throw new Error('Unsupported wallet format.');
  const key = await deriveKey(password, unb64(record.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.iv) }, key, unb64(record.ciphertext));
    return new Uint8Array(plain);
  } catch {
    throw new Error('Wrong password.');
  }
}

export function forgetWallet(network: NetworkName): void {
  storage()?.removeItem(STORAGE_PREFIX + network);
}

export function newPrivateKey(): Uint8Array {
  return generatePrivateKey();
}

export function importWif(network: NetworkName, wif: string): Uint8Array {
  const decoded = decodePrivateKeyWif(wif.trim());
  if (typeof decoded === 'string') throw new Error('That is not a valid WIF private key.');
  const isMainnetKey = decoded.type === 'mainnet' || decoded.type === 'mainnetUncompressed';
  if ((network === 'mainnet') !== isMainnetKey) {
    throw new Error(`That key is for ${isMainnetKey ? 'mainnet' : 'a test network'}, not ${network}.`);
  }
  return decoded.privateKey;
}

export function exportWif(network: NetworkName, privateKey: Uint8Array): string {
  return encodePrivateKeyWif(privateKey, network === 'mainnet' ? 'mainnet' : 'testnet');
}
