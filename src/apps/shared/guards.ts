/**
 * Row guards.
 *
 * `data.query` hands back `Readonly<Record<string, unknown>>`: the broker will not
 * pretend to know the shape of a projection, because the schema lives on the
 * server and can change without this build. Apps narrow with these instead of
 * casting, so a renamed column shows up as a missing value rather than as
 * `undefined.toFixed` at render time.
 */

export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Text or the empty string — for labels, where `null` would render as "null". */
export const str = (value: unknown): string => asString(value) ?? '';

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A number or zero — for sums, where a missing amount really is nothing. */
export const num = (value: unknown): number => asNumber(value) ?? 0;

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 't') return true;
  if (value === 'false' || value === 'f') return false;
  return null;
}

/** Lower-cased status text, so `'POSTED'` and `'posted'` compare equal. */
export const status = (value: unknown): string => (asString(value) ?? '').toLowerCase();

/** Sums a numeric column across rows. */
export function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  let total = 0;
  for (const row of rows) total += pick(row);
  return total;
}

/** Groups rows by a key, preserving first-seen order. */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket === undefined) out.set(k, [row]);
    else bucket.push(row);
  }
  return out;
}
