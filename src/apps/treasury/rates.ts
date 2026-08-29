/**
 * Treasury — one currency, and the honest cost of getting there.
 *
 * The books are kept in two. A dinar account and a riyal account are both real, and
 * a treasurer wants one number for both — which means a rate, and a rate is the one
 * input in this app that is neither a balance nor a due date. It is an opinion with
 * a date on it, and stating a cash position without saying which opinion produced it
 * is how a figure becomes an argument.
 *
 * So conversion is a value here rather than a helper. A {@link RateBook} carries the
 * rate, the day it was quoted and who quoted it; the window prints all three; and a
 * purse that needs a rate the book does not have refuses to state a total instead of
 * silently dropping the riyals or adding them as though they were dinars.
 *
 * Two questions, two functions, and the difference matters. A row shows what it
 * actually holds — a riyal account reads in riyals — while anything that has to be
 * *compared* with another figure is stated in dinars or not at all. Netting a riyal
 * balance against a dinar bill would otherwise produce a number in no currency.
 *
 * `exchange_rates` is quoted in both directions by different sources, so a
 * `DZD → SAR` row is used upside down when it is the newest thing on record. The
 * inversion is remembered and shown, because a rate read backwards is a fact about
 * the data somebody may want to go and fix.
 */
import type { DatasetRow } from '@/platform/sdk';
import { asString, num, str } from '../shared/guards';
import type { Currency } from '../shared/ledger';

/** The currency every cross-currency figure in this window is stated in. */
export const REPORTING: Currency = 'DZD';

export interface Rate {
  readonly id: string;
  readonly base: string;
  readonly quote: string;
  readonly rate: number;
  readonly date: string;
  readonly source: string;
}

export function toRate(row: DatasetRow): Rate | null {
  const id = asString(row.id);
  const rate = num(row.rate);
  // Zero is not a quote, and inverting it is how a total becomes Infinity.
  if (id === null || rate <= 0) return null;
  return {
    id,
    base: str(row.base_currency).toUpperCase(),
    quote: str(row.quote_currency).toUpperCase(),
    rate,
    date: str(row.rate_date),
    source: str(row.source),
  };
}

/**
 * What a riyal is worth in dinars, as far as the book on record knows.
 *
 * One pair, because the agency keeps two currencies and this is the only crossing
 * between them. Everything the window says about a converted figure is said out of
 * this object, so there is exactly one rate in force at a time and no report can be
 * built out of two.
 */
export interface RateBook {
  /** Dinars per riyal, or `null` when nothing on record quotes the pair. */
  readonly perSar: number | null;
  readonly at: string | null;
  readonly source: string;
  /** True when the quote used was a `DZD → SAR` row read the other way round. */
  readonly inverted: boolean;
}

export const NO_RATE: RateBook = { perSar: null, at: null, source: '', inverted: false };

/**
 * The newest quote of the pair, in whichever direction it was written.
 *
 * Ties go to the direct quote: an inverted rate is arithmetic performed on somebody
 * else's answer, and when both are on record for the same day the one that needs no
 * arithmetic is the one to trust.
 */
export function rateBook(rows: readonly Rate[]): RateBook {
  let best: RateBook = NO_RATE;
  for (const row of rows) {
    const direct = row.base === 'SAR' && row.quote === 'DZD';
    const inverse = row.base === 'DZD' && row.quote === 'SAR';
    if (row.date === '' || (!direct && !inverse)) continue;
    if (best.at !== null) {
      if (row.date < best.at) continue;
      if (row.date === best.at && !(direct && best.inverted)) continue;
    }
    best = {
      perSar: direct ? row.rate : 1 / row.rate,
      at: row.date,
      source: row.source,
      inverted: inverse,
    };
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Purses: a sum that remembers what it was denominated in
 * ------------------------------------------------------------------ */

/**
 * A running total kept per currency.
 *
 * Adding as you go and converting at the end is the only order that produces the
 * same figure twice: converting each line would round a rate into every one of a
 * thousand rows, and the sum of those roundings is a discrepancy nobody can trace.
 */
export interface Purse {
  readonly dzd: number;
  readonly sar: number;
}

export const EMPTY_PURSE: Purse = { dzd: 0, sar: 0 };

export const plus = (purse: Purse, amount: number, currency: Currency): Purse =>
  currency === 'SAR'
    ? { dzd: purse.dzd, sar: purse.sar + amount }
    : { dzd: purse.dzd + amount, sar: purse.sar };

export const merge = (left: Purse, right: Purse): Purse => ({
  dzd: left.dzd + right.dzd,
  sar: left.sar + right.sar,
});

export const isEmptyPurse = (purse: Purse): boolean => purse.dzd === 0 && purse.sar === 0;

/** The single currency a purse holds, or `null` when it holds both. Empty reads as dinars. */
export function pure(purse: Purse): Currency | null {
  if (purse.sar === 0) return 'DZD';
  if (purse.dzd === 0) return 'SAR';
  return null;
}

export interface Amount {
  readonly value: number;
  readonly currency: Currency;
}

/**
 * A purse as one printable figure, in the currency it actually holds.
 *
 * What a row shows. A riyal account reads in riyals, which is what its statement
 * says and what the person looking at it expects; only a row that genuinely mixes
 * the two is converted, and then the flag says so beside it.
 */
export interface Stated {
  /** `null` when the purse mixes currencies and nothing on record prices the pair. */
  readonly amount: Amount | null;
  readonly converted: boolean;
  /** Riyals left out for want of a rate, so the window can name what is missing. */
  readonly unpriced: number;
}

export function stated(purse: Purse, book: RateBook): Stated {
  const single = pure(purse);
  if (single !== null) {
    return {
      amount: { value: single === 'SAR' ? purse.sar : purse.dzd, currency: single },
      converted: false,
      unpriced: 0,
    };
  }
  if (book.perSar === null) return { amount: null, converted: false, unpriced: purse.sar };
  return {
    amount: { value: purse.dzd + purse.sar * book.perSar, currency: REPORTING },
    converted: true,
    unpriced: 0,
  };
}

/**
 * A purse as a dinar figure, or nothing.
 *
 * Every total that has to be added to, subtracted from or ranked against another
 * one goes through here. A riyal balance netted against a dinar bill would produce
 * a number denominated in nothing at all, so the absence of a rate propagates: the
 * forecast is `null` and the window says which figure it could not price.
 */
export function reported(purse: Purse, book: RateBook): number | null {
  if (purse.sar === 0) return purse.dzd;
  if (book.perSar === null) return null;
  return purse.dzd + purse.sar * book.perSar;
}

/** One amount in dinars: the scalar case of {@link reported}. */
export const priced = (amount: number, currency: Currency, book: RateBook): number | null =>
  currency === 'SAR' ? (book.perSar === null ? null : amount * book.perSar) : amount;
