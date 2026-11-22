// Formatting and strict parsing helpers. Amounts are always bigint satoshis; never floats.

export const SATS_PER_BCH = 100_000_000n;

/** Format satoshis as a BCH string, trimming trailing zeros (e.g. 150000000n -> "1.5"). */
export function formatBch(sats: bigint): string {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / SATS_PER_BCH;
  const frac = (abs % SATS_PER_BCH).toString().padStart(8, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export function formatSats(sats: bigint): string {
  return sats.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Parse a user-typed BCH amount ("0.0005", "1", "1.23456789") into satoshis.
 * Rejects more than 8 decimals, signs, exponents and anything that is not a plain decimal.
 */
export function parseBch(input: string): bigint {
  const text = input.trim();
  if (!/^\d{1,10}(\.\d{1,8})?$/.test(text)) {
    throw new Error('Enter an amount like 0.001 (up to 8 decimals).');
  }
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * SATS_PER_BCH + BigInt(frac.padEnd(8, '0'));
}

export function shortHex(hex: string, chars = 6): string {
  return hex.length <= chars * 2 + 1 ? hex : `${hex.slice(0, chars)}…${hex.slice(-chars)}`;
}

export function shortAddress(address: string): string {
  const [prefix, body] = address.includes(':') ? address.split(':') : ['', address];
  const short = body.length > 16 ? `${body.slice(0, 8)}…${body.slice(-6)}` : body;
  return prefix ? `${prefix}:${short}` : short;
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Human "in 3 days" / "2 hours ago" relative to `nowSeconds`. */
export function relativeTime(unixSeconds: number, nowSeconds: number): string {
  const diff = unixSeconds - nowSeconds;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size);
      const label = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff >= 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return diff >= 0 ? 'in under a minute' : 'just now';
}

/** Turn raw SDK / VM failures into a sentence a backer can act on. */
export function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const rules: [RegExp, string][] = [
    [/bad backer signature/i, 'That wallet is not the backer for this pledge.'],
    [/not creator/i, 'Only the campaign creator can do that.'],
    [/goal not reached/i, 'The funding goal has not been reached yet.'],
    [/campaign failed/i, 'This campaign failed or was cancelled; it can no longer be claimed.'],
    [/deadline not reached|LOCKTIME|non-final|locktime/i, 'The deadline has not passed on chain yet. Block time lags wall-clock time by up to ~1 hour; try again later.'],
    [/insufficient|not enough|no (spendable )?utxo|fund/i, 'Your wallet does not have enough BCH for this amount plus the network fee.'],
    [/NULLFAIL/i, 'Signature rejected: this wallet is not authorised for that action.'],
    [/Require statement failed|preflight failed/i, 'The contract rejected this action in its current state (check the phase and your pledge).'],
  ];
  for (const [pattern, message] of rules) {
    if (pattern.test(text)) return message;
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
