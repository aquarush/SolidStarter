// Network sessions: an in-browser mock chain for the demo, or Electrum for chipnet / mainnet.
import { Signer } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { binToHex, decodeCashAddress, encodeCashAddress, hexToBin } from '@bitauth/libauth';
import type { NetworkName } from './campaign-ref';

export interface Account {
  label: string;
  signer: Signer;
}

export interface Session {
  network: NetworkName;
  provider: any;
  /** Accounts the user can act as. Demo: five funded personas. Live: the unlocked wallet (if any). */
  accounts: Account[];
  /** Current chain time in Unix seconds (mock clock in the demo, wall clock on live networks). */
  now(): number;
  /** Demo only: move the mock chain clock forward and mine a block. */
  advanceTime?(seconds: number): Promise<void>;
  explorerTx?(txid: string): string;
}

export const DEMO_PERSONAS = ['Creator', 'Beneficiary', 'Alice', 'Bob', 'Carol'] as const;

export async function createDemoSession(): Promise<Session> {
  const provider: any = new MockNetworkProvider();
  // Each persona gets 2 play-BCH in four coins (each usable as a campaign genesis input).
  const signers = await provider.getSigners(DEMO_PERSONAS.length, {
    satoshis: 50_000_000n,
    fundingUtxos: 4,
    genesisFundingUtxos: 4,
  });
  return {
    network: 'demo',
    provider,
    accounts: signers.map((signer: Signer, i: number) => ({ label: DEMO_PERSONAS[i], signer })),
    now: () => Number(provider.getBlockTime()),
    async advanceTime(seconds: number) {
      provider.increaseTime(seconds);
      await provider.mine(1);
    },
  };
}

export function createLiveSession(network: 'mainnet' | 'chipnet'): Session {
  const provider: any = new ElectrumNetworkProvider(network);
  return {
    network,
    provider,
    accounts: [],
    now: () => Math.floor(Date.now() / 1000),
    explorerTx: (txid) =>
      network === 'mainnet'
        ? `https://blockchair.com/bitcoin-cash/transaction/${txid}`
        : `https://chipnet.chaingraph.cash/tx/${txid}`,
  };
}

export function signerFromKey(session: Session, privateKey: Uint8Array): Signer {
  return new Signer(privateKey, session.provider);
}

const prefixFor = (network: NetworkName) => (network === 'mainnet' ? 'bitcoincash' : 'bchtest');

export function addressOf(signer: Signer, network: NetworkName): string {
  return pkhToAddress(binToHex(signer.pkh), network);
}

export function pkhToAddress(pkhHex: string, network: NetworkName): string {
  return encodeCashAddress({ prefix: prefixFor(network), type: 'p2pkh', payload: hexToBin(pkhHex) }).address;
}

/** Accepts a P2PKH CashAddress for the session's network (prefix optional) and returns its hash. */
export function addressToPkh(address: string, network: NetworkName): string {
  const prefix = prefixFor(network);
  const text = address.trim().toLowerCase();
  const full = text.includes(':') ? text : `${prefix}:${text}`;
  const decoded = decodeCashAddress(full);
  if (typeof decoded === 'string') throw new Error('Not a valid CashAddress.');
  if (decoded.prefix !== prefix) throw new Error(`Use a ${prefix}: address on ${network}.`);
  if (decoded.type !== 'p2pkh' && decoded.type !== 'p2pkhWithTokens') {
    throw new Error('The beneficiary must be a regular (P2PKH) wallet address.');
  }
  return binToHex(decoded.payload);
}

/** Spendable BCH of a wallet: plain coins without CashTokens. */
export async function balanceOf(signer: Signer): Promise<bigint> {
  const utxos = await signer.getUtxos();
  return utxos.filter((u: any) => !u.token).reduce((sum: bigint, u: any) => sum + BigInt(u.satoshis), 0n);
}
