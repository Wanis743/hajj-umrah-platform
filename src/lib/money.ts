export type CurrencyCode = 'DZD' | 'SAR';

/** Decimal-safe money helpers. Amounts are represented as integer minor units. */
export const MINOR_UNITS = 2;
export function toMinorUnits(value: number | string): bigint {
  if (value == null || value === '') return 0n;
  let text = String(value).trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    text = value.toFixed(2);
  }
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Invalid monetary amount: ' + text);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const parts = unsigned.split('.');
  const whole = parts[0] ?? '0';
  const fraction = parts[1] ?? '';
  const minor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -minor : minor;
}
export function fromMinorUnits(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const fraction = String(abs % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
export function addMoney(a: number | string, b: number | string): string { return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b)); }
export function subtractMoney(a: number | string, b: number | string): string { return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b)); }
export function compareMoney(a: number | string, b: number | string): -1 | 0 | 1 { const x=toMinorUnits(a), y=toMinorUnits(b); return x<y?-1:x>y?1:0; }
export function formatMoney(value: number | string, currency: CurrencyCode, locale = 'fr-DZ'): string {
  const numeric = Number(toMinorUnits(value)) / 100;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
}
