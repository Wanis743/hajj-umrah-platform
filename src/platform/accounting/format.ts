/** Presentation formatting + parsing helpers for accounting surfaces. */

/** Format minor units as a major-unit decimal string. */
export function fmt(minor: bigint): string {
  return (Number(minor) / 100).toLocaleString('fr-DZ', { minimumFractionDigits: 2 });
}

/** Parse an editor decimal string into minor units; invalid input → 0n. */
export function parseOrZero(raw: string): bigint {
  try {
    const cleaned = raw.trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return 0n;
    const [whole, frac = ''] = cleaned.split('.');
    const negative = cleaned.startsWith('-');
    const abs = BigInt(negative ? whole.slice(1) : (whole ?? '0')) * 100n + BigInt((frac + '00').slice(0, 2));
    return negative ? -abs : abs;
  } catch {
    return 0n;
  }
}
