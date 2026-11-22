// A CampaignRef is everything needed to find and verify a deployed campaign:
// the five contract parameters (they are baked into the covenant address) plus its CashToken category.
// It is encoded into share links. Every field is validated strictly when decoded,
// because a link is untrusted input.

export type NetworkName = 'demo' | 'chipnet' | 'mainnet';
export const LIVE_NETWORKS: NetworkName[] = ['mainnet', 'chipnet'];

export interface CampaignParams {
  creatorPubkey: string; // 33-byte compressed public key, hex
  beneficiaryPkh: string; // 20-byte P2PKH hash, hex
  goal: bigint; // satoshis
  deadline: number; // Unix seconds
  minPledge: bigint; // satoshis
}

export interface CampaignRef extends CampaignParams {
  network: NetworkName;
  categoryId: string; // 32-byte category, display order hex
}

const HEX = (bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
const UINT64_MAX = 2n ** 64n - 1n;
const UINT32_MAX = 2 ** 32 - 1;

export function validateParams(p: CampaignParams): void {
  if (!HEX(33).test(p.creatorPubkey) || !/^0[23]/.test(p.creatorPubkey)) throw new Error('Invalid creator public key.');
  if (!HEX(20).test(p.beneficiaryPkh)) throw new Error('Invalid beneficiary.');
  if (p.goal <= 0n || p.goal > UINT64_MAX) throw new Error('Goal must be a positive amount.');
  if (p.minPledge < 1_000n || p.minPledge > p.goal) throw new Error('Minimum pledge must be at least 1,000 sats and at most the goal.');
  if (!Number.isInteger(p.deadline) || p.deadline < 500_000_000 || p.deadline > UINT32_MAX) {
    throw new Error('Deadline must be a Unix timestamp.');
  }
}

export function validateRef(ref: CampaignRef): void {
  if (!['demo', 'chipnet', 'mainnet'].includes(ref.network)) throw new Error('Unknown network.');
  if (!HEX(32).test(ref.categoryId)) throw new Error('Invalid campaign id.');
  validateParams(ref);
}

/** Constructor arguments in the exact order of the contract's parameter list. */
export function constructorArgs(p: CampaignParams): [string, string, bigint, bigint, bigint] {
  return [p.creatorPubkey, p.beneficiaryPkh, p.goal, BigInt(p.deadline), p.minPledge];
}

// Compact positional encoding: n|category|creator|beneficiary|goal|deadline|minPledge (base64url).
export function encodeRef(ref: CampaignRef): string {
  validateRef(ref);
  const raw = [
    ref.network,
    ref.categoryId,
    ref.creatorPubkey,
    ref.beneficiaryPkh,
    ref.goal.toString(),
    ref.deadline.toString(),
    ref.minPledge.toString(),
  ].join('|');
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRef(encoded: string): CampaignRef {
  if (!/^[A-Za-z0-9_-]{1,1000}$/.test(encoded)) throw new Error('Malformed campaign link.');
  let raw: string;
  try {
    raw = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw new Error('Malformed campaign link.');
  }
  const parts = raw.split('|');
  if (parts.length !== 7 || !parts.slice(4).every((n) => /^\d{1,20}$/.test(n))) {
    throw new Error('Malformed campaign link.');
  }
  const [network, categoryId, creatorPubkey, beneficiaryPkh, goal, deadline, minPledge] = parts;
  const ref: CampaignRef = {
    network: network as NetworkName,
    categoryId: categoryId.toLowerCase(),
    creatorPubkey: creatorPubkey.toLowerCase(),
    beneficiaryPkh: beneficiaryPkh.toLowerCase(),
    goal: BigInt(goal),
    deadline: Number(deadline),
    minPledge: BigInt(minPledge),
  };
  validateRef(ref);
  return ref;
}

export function refKey(ref: Pick<CampaignRef, 'network' | 'categoryId'>): string {
  return `${ref.network}:${ref.categoryId}`;
}
