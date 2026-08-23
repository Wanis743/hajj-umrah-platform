/**
 * Currency utilities — conversion, rounding, formatting.
 * Rounding policy: HALF_EVEN (banker's rounding) for financial values.
 */

export type Currency = 'DZD' | 'SAR' | 'EUR' | 'USD';

export interface ExchangeRate {
  from: Currency;
  to: Currency;
  rate: number;
  date: string; // ISO date of the rate
}

/**
 * Convert amount from one currency to another using a provided rate.
 * NOTE: This does NOT fetch live rates. Rates must be provided externally.
 */
export function convertCurrency(
  amount: number | null,
  rate: number | null,
): number | null {
  if (amount == null || rate == null || rate <= 0) return null;
  return roundFinancial(amount * rate);
}

/**
 * Banker's rounding (HALF_EVEN): rounds 0.5 to the nearest even number.
 * More accurate for financial aggregations than HALF_UP.
 */
export function roundFinancial(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  const shifted = value * factor;
  const floor = Math.floor(shifted);
  const diff = shifted - floor;
  if (Math.abs(diff - 0.5) < Number.EPSILON) {
    // Exactly 0.5 — round to even
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round(shifted) / factor;
}

/** Format a number as DZD currency string */
export function formatDZD(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('fr-DZ', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' دج';
}

/** Format a number as SAR currency string */
export function formatSAR(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('ar-SA', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' ﷼';
}

/** Format a number as EUR currency string */
export function formatEUR(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

/** Format currency based on currency code */
export function formatCurrency(value: number | null, currency: Currency): string {
  switch (currency) {
    case 'DZD': return formatDZD(value);
    case 'SAR': return formatSAR(value);
    case 'EUR': return formatEUR(value);
    case 'USD': return value != null ? `$${roundFinancial(value).toLocaleString()}` : '—';
    default: return value != null ? String(roundFinancial(value)) : '—';
  }
}

/** Split a mixed-currency total into component currencies */
export function allocateByWeight(
  total: number | null,
  weights: number[],
): number[] {
  if (total == null || weights.length === 0) return weights.map(() => 0);
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW === 0) return weights.map(() => 0);
  const allocated = weights.map(w => roundFinancial((w / sumW) * total));
  // Distribute rounding remainder to last element
  const remainder = roundFinancial(total - allocated.reduce((a, b) => a + b, 0));
  allocated[allocated.length - 1] = roundFinancial(allocated[allocated.length - 1] + remainder);
  return allocated;
}
