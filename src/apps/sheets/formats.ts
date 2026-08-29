/**
 * Sheets — what a cell holds and how it reads.
 *
 * Typing `12,5` into a cell in an Algerian office means twelve and a half, typing
 * `28/08/2026` means a date, and typing `12%` means both a number and a *format*.
 * That last one is the reason this file exists: a format is not decoration, it is
 * the record of what the user meant, so `setInput` infers one and everything
 * downstream — the grid, the status bar, the CSV writer — reads it back.
 *
 * Dates are stored as Excel serials (see `finance.ts`), which is what makes
 * `=B2-B1` a number of days. Rendering them is `fmt`'s job, so a French session
 * sees `28/08/2026` and an Arabic one sees the same instant its own way, from one
 * stored number.
 */
import { type AppLang, type Localized, fmt } from '@/platform/sdk';
import { BLANK, type CellValue, bool, err, num, str, toText } from './values';

export type NumberFormat = 'general' | 'integer' | 'amount' | 'money' | 'percent' | 'date' | 'datetime' | 'text';

export const NUMBER_FORMATS: readonly NumberFormat[] = [
  'general',
  'integer',
  'amount',
  'money',
  'percent',
  'date',
  'datetime',
  'text',
];

export type CellAlign = 'auto' | 'start' | 'center' | 'end';

/** Excel's epoch again: serial 1 is 1900-01-01. Kept local so this file stays pure. */
const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export const serialToDate = (serial: number): Date => new Date(EPOCH + Math.round(serial * DAY_MS));

const dateToSerial = (utc: number): number => (utc - EPOCH) / DAY_MS;

const ISO_DATE = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/;
const LOCAL_DATE = /^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$/;

/** `2026-08-28` and `28/08/2026`; day-first, because that is how the region writes. */
export function parseDate(text: string): number | null {
  const iso = ISO_DATE.exec(text);
  const local = iso === null ? LOCAL_DATE.exec(text) : null;
  const parts = iso !== null ? [iso[1], iso[2], iso[3]] : local !== null ? [local[3], local[2], local[1]] : null;
  if (parts === null) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  // `31/02` rolls forward in `Date.UTC`, so a date that moved was never a date.
  return new Date(utc).getUTCMonth() === month - 1 ? dateToSerial(utc) : null;
}

/**
 * Thin and non-breaking spaces as well: `fmt.amount` groups thousands with them, so a
 * number copied out of a cell still parses when it is typed back in.
 */
const SPACES = /[\s\u00A0\u202F]/g;

/** `1 234,56` and `1234.56` are the same number; `12kg` is not a number at all. */
export function parseNumber(text: string): number | null {
  const bare = text.replace(SPACES, '');
  if (bare === '' || !/[0-9]/.test(bare)) return null;
  const normalized = bare.includes(',') && !bare.includes('.') ? bare.replace(/,/g, '.') : bare.replace(/,/g, '');
  if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * What a typed line means when it is not a formula.
 *
 * The order matters: an error name beats a number, a percentage beats a plain
 * number, and text is what is left. `format` is the format this input *implies* —
 * `null` when it implies nothing and the cell should keep the format it has.
 */
export function parseLiteral(input: string): { readonly value: CellValue; readonly format: NumberFormat | null } {
  const text = input.trim();
  if (text === '') return { value: BLANK, format: null };

  const upper = text.toUpperCase();
  if (upper === 'TRUE') return { value: bool(true), format: null };
  if (upper === 'FALSE') return { value: bool(false), format: null };
  if (text.startsWith('#')) {
    const found = (['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#CYCLE!', '#N/A', '#NUM!'] as const).find(
      (candidate) => candidate === upper,
    );
    if (found !== undefined) return { value: err(found), format: null };
  }

  const serial = parseDate(text);
  if (serial !== null) return { value: num(serial), format: 'date' };

  if (text.endsWith('%')) {
    const percentage = parseNumber(text.slice(0, -1));
    if (percentage !== null) return { value: num(percentage / 100), format: 'percent' };
  }

  const value = parseNumber(text);
  if (value !== null) return { value: num(value), format: null };

  return { value: str(text), format: null };
}

export const FORMAT_LABEL: Readonly<Record<NumberFormat, Localized>> = {
  general: { ar: 'عام', fr: 'Standard', en: 'General' },
  integer: { ar: 'عدد صحيح', fr: 'Nombre entier', en: 'Integer' },
  amount: { ar: 'رقم', fr: 'Nombre', en: 'Number' },
  money: { ar: 'عملة', fr: 'Monétaire', en: 'Currency' },
  percent: { ar: 'نسبة', fr: 'Pourcentage', en: 'Percent' },
  date: { ar: 'تاريخ', fr: 'Date', en: 'Date' },
  datetime: { ar: 'تاريخ ووقت', fr: 'Date et heure', en: 'Date and time' },
  text: { ar: 'نص', fr: 'Texte', en: 'Text' },
};

/**
 * `general` — as many digits as the number has, and no more.
 *
 * A spreadsheet's default format is the one that shows `0.5` as `0,5` and `1000000`
 * as `1 000 000` without ever inventing a trailing zero, because a cell that reads
 * `12,00` when you typed `12` looks like it rounded something.
 */
const general = (value: number, lang: AppLang): string =>
  new Intl.NumberFormat(fmt.intlLocaleFor(lang), { maximumFractionDigits: 10 }).format(value);

/** The string a cell shows. Not what it holds — that is `CellValue`. */
export function display(value: CellValue, format: NumberFormat, lang: AppLang): string {
  if (value.kind === 'error') return value.value;
  if (value.kind === 'blank') return '';
  if (format === 'text') return toText(value);
  if (value.kind !== 'number') return toText(value);

  switch (format) {
    case 'integer':
      return fmt.integer(Math.round(value.value), lang);
    case 'amount':
      return fmt.amount(value.value, lang);
    case 'money':
      return fmt.money(value.value, 'DZD', lang);
    case 'percent':
      return fmt.percent(value.value, lang, 2);
    case 'date':
      return value.value <= 0 ? general(value.value, lang) : fmt.date(serialToDate(value.value), lang);
    case 'datetime':
      return value.value <= 0 ? general(value.value, lang) : fmt.dateTime(serialToDate(value.value), lang);
    default:
      return general(value.value, lang);
  }
}

/**
 * Which edge a value sits against.
 *
 * Numbers right, text left, and the truth values centred — the alignment *is* the
 * type indicator in every spreadsheet ever shipped, which is why it is derived from
 * the value rather than left to the person who typed it.
 */
export function naturalAlign(value: CellValue, format: NumberFormat): CellAlign {
  if (format === 'text') return 'start';
  if (value.kind === 'number') return 'end';
  if (value.kind === 'boolean' || value.kind === 'error') return 'center';
  return 'start';
}

/** The text a formula bar shows for a cell that is not a formula. */
export const literalText = (value: CellValue, format: NumberFormat, lang: AppLang): string =>
  value.kind === 'number' && (format === 'date' || format === 'datetime')
    ? display(value, format, lang)
    : toText(value);
