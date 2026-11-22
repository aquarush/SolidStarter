// Unit tests for the web app's pure logic: amount parsing and untrusted share-link decoding.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatBch, parseBch, relativeTime } from '../web/src/lib/format';
import { decodeRef, encodeRef, validateParams, type CampaignRef } from '../web/src/lib/campaign-ref';

const ref: CampaignRef = {
  network: 'mainnet',
  categoryId: 'ab'.repeat(32),
  creatorPubkey: `02${'11'.repeat(32)}`,
  beneficiaryPkh: '22'.repeat(20),
  goal: 5_000_000n,
  deadline: 1_800_000_000,
  minPledge: 10_000n,
};

describe('amount parsing', () => {
  it('parses BCH strings exactly, without floating point', () => {
    expect(parseBch('1')).toBe(100_000_000n);
    expect(parseBch('0.00000001')).toBe(1n);
    expect(parseBch('0.1')).toBe(10_000_000n);
    expect(parseBch(' 12.34567891 ')).toBe(1_234_567_891n);
  });

  it.each(['', '-1', '1e3', '0.123456789', '1,5', 'abc', '.5', '1.'])('rejects %j', (bad) => {
    expect(() => parseBch(bad)).toThrow();
  });

  it('formats satoshis back to BCH', () => {
    expect(formatBch(150_000_000n)).toBe('1.5');
    expect(formatBch(1n)).toBe('0.00000001');
    expect(formatBch(0n)).toBe('0');
    expect(formatBch(parseBch('0.0005'))).toBe('0.0005');
  });

  it('describes relative times', () => {
    expect(relativeTime(1_000 + 3 * 86_400, 1_000)).toBe('in 3 days');
    expect(relativeTime(1_000, 1_000 + 7_200)).toBe('2 hours ago');
  });
});

describe('campaign share links', () => {
  it('round-trips a campaign reference', () => {
    expect(decodeRef(encodeRef(ref))).toEqual(ref);
  });

  it('rejects tampered or malformed links', () => {
    const good = encodeRef(ref);
    expect(() => decodeRef(`${good}!`)).toThrow();
    expect(() => decodeRef('')).toThrow();
    expect(() => decodeRef(btoa('mainnet|xx'))).toThrow();
    const swap = (field: number, value: string) => {
      const parts = atob(good.replace(/-/g, '+').replace(/_/g, '/')).split('|');
      parts[field] = value;
      return btoa(parts.join('|')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    expect(() => decodeRef(swap(0, 'ethereum'))).toThrow(/network/i);
    expect(() => decodeRef(swap(2, `04${'11'.repeat(32)}`))).toThrow(/public key/i);
    expect(() => decodeRef(swap(3, '22'.repeat(19)))).toThrow(/beneficiary/i);
    expect(() => decodeRef(swap(4, '0'))).toThrow(/goal/i);
    expect(() => decodeRef(swap(4, '-5'))).toThrow();
    expect(() => decodeRef(swap(5, '12'))).toThrow(/deadline/i);
    expect(() => decodeRef(swap(6, '999'))).toThrow(/minimum/i);
  });

  it('enforces the same bounds the contract constructor checks', () => {
    expect(() => validateParams({ ...ref, minPledge: 999n })).toThrow();
    expect(() => validateParams({ ...ref, goal: 2n ** 64n })).toThrow();
  });
});

describe('bundled artifact', () => {
  it('matches the freshly compiled contract (run `npm run sync-artifact` if this fails)', () => {
    const compiled = JSON.parse(readFileSync('artifacts/solidcash/SolidStarter.json', 'utf8'));
    const bundled = JSON.parse(readFileSync('web/src/contract/SolidStarter.json', 'utf8'));
    expect(bundled.bytecode).toBe(compiled.bytecode);
    expect(bundled.fingerprint).toBe(compiled.fingerprint);
  });
});
