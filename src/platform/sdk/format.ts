/**
 * SDK formatting helpers.
 *
 * Apps must not hand-roll currency or date rendering: the OS owns locale
 * policy so every window agrees. Money arithmetic goes through
 * `@/lib/money` (integer minor units, never binary floats).
 */
import { formatMoney, toMinorUnits, type CurrencyCode } from '@/lib/money';
import type { AppLang } from './types';

export const intlLocaleFor = (lang: AppLang): string =>
  lang === 'ar' || lang === 'dz' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';

/** Currency with symbol, e.g. `1 250,00 DA`. Accepts numbers or decimal text. */
export function money(value: number | string, currency: CurrencyCode = 'DZD', lang: AppLang = 'fr'): string {
  try {
    return formatMoney(value, currency, intlLocaleFor(lang));
  } catch {
    return `${value} ${currency}`;
  }
}

/** Bare grouped amount with two decimals, for table columns. */
export function amount(value: number | string, lang: AppLang = 'fr'): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat(intlLocaleFor(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

/** Compact amount for tiles: `1,2 M`, `840 k`. */
export function compact(value: number, lang: AppLang = 'fr'): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocaleFor(lang), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function percent(value: number, lang: AppLang = 'fr', digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocaleFor(lang), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function integer(value: number, lang: AppLang = 'fr'): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocaleFor(lang), { maximumFractionDigits: 0 }).format(value);
}

export function date(value: string | number | Date | null | undefined, lang: AppLang = 'fr'): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(intlLocaleFor(lang), { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(value: string | number | Date | null | undefined, lang: AppLang = 'fr'): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(intlLocaleFor(lang), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function time(value: string | number | Date, lang: AppLang = 'fr'): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(intlLocaleFor(lang), { hour: '2-digit', minute: '2-digit' });
}

/** `2 min ago` / `il y a 2 min` / `قبل 2 دقيقة`. */
export function relativeTime(value: string | number | Date, lang: AppLang = 'fr'): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const deltaSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(intlLocaleFor(lang), { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(deltaSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), 'hour');
  return rtf.format(Math.round(deltaSec / 86400), 'day');
}

/** Byte sizes for the Settings storage page and the tray widgets. */
export function bytes(value: number, lang: AppLang = 'fr'): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : scaled < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(intlLocaleFor(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(scaled)} ${units[unit]}`;
}

/** `2 h 14 min` uptime rendering. */
export function duration(ms: number, lang: AppLang = 'fr'): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const unit = (n: number, ar: string, fr: string, en: string) =>
    `${n}${lang === 'ar' || lang === 'dz' ? ar : lang === 'fr' ? fr : en}`;
  if (days > 0) return `${unit(days, 'ي', 'j', 'd')} ${unit(hours, 'س', 'h', 'h')}`;
  if (hours > 0) return `${unit(hours, 'س', 'h', 'h')} ${unit(minutes, 'د', 'min', 'm')}`;
  if (minutes > 0) return `${unit(minutes, 'د', 'min', 'm')} ${unit(seconds, 'ث', 's', 's')}`;
  return unit(seconds, 'ث', 's', 's');
}

/** Parses user-entered money text into a number, tolerating spaces and commas. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(/,/g, '.');
  if (cleaned === '' || cleaned === '-') return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Rounds to two decimals through integer minor units (no float drift). */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(toMinorUnits(value.toFixed(2))) / 100;
}

export type { CurrencyCode };
