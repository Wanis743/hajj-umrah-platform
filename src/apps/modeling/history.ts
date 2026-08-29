/**
 * Modeling — the past, by month.
 *
 * Everything this window says about the future is a restatement of this file's output, so
 * it does one thing and does it in one place: turn posted postings into a dense monthly
 * series per account.
 *
 * Dense is the whole point. A month in which an account did nothing is a zero, not a
 * missing key, because a trend fitted over "the months that happened to have postings" is
 * a trend fitted over a different axis for every row, and the resulting numbers cannot be
 * compared with each other or added up.
 *
 * Months are `YYYY-MM` strings and stay that way through the grid and the export. A
 * localised month name is friendlier and sorts wrong in two of the three languages, and a
 * forecast whose axis is out of order is not a forecast.
 */
import { type Account, type AccountType, type JournalEntry, type JournalLine, signedAmount } from '../shared/ledger';

/** A calendar month, `YYYY-MM`. */
export type Month = string;

/** The month an ISO date falls in. Dates arrive as `YYYY-MM-DD`, so this is a slice. */
export const monthOf = (date: string): Month => date.slice(0, 7);

/** Month arithmetic on the string, which avoids `Date` and its timezone opinions. */
export function addMonths(month: Month, delta: number): Month {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const shifted = year + Math.floor(index / 12);
  const normalised = ((index % 12) + 12) % 12;
  return `${String(shifted).padStart(4, '0')}-${String(normalised + 1).padStart(2, '0')}`;
}

/** The month a date string lands in, or `null` when the book gave us nothing to read. */
export function monthOfEntry(entry: JournalEntry): Month | null {
  const date = entry.postedAt ?? entry.date;
  return date.length < 7 ? null : monthOf(date);
}

/** `count` months ending at `last`, ascending. Empty when `count` is not positive. */
export function monthAxis(last: Month, count: number): readonly Month[] {
  if (count <= 0) return [];
  const out: Month[] = [];
  for (let index = count - 1; index >= 0; index -= 1) out.push(addMonths(last, -index));
  return out;
}

/** `count` months after `first - 1`, ascending: the axis a projection is drawn on. */
export function futureAxis(lastHistory: Month, count: number): readonly Month[] {
  const out: Month[] = [];
  for (let index = 1; index <= count; index += 1) out.push(addMonths(lastHistory, index));
  return out;
}

/** What one account did over the axis, and how much evidence that is. */
export interface AccountHistory {
  readonly accountId: string;
  /** One signed total per month of the axis, in axis order. */
  readonly values: readonly number[];
  readonly lines: number;
  /** Months with at least one posting: the difference between quiet and unseen. */
  readonly active: number;
}

export interface History {
  readonly months: readonly Month[];
  readonly byAccount: ReadonlyMap<string, AccountHistory>;
  /** Every posting the window saw, for the status bar. */
  readonly lines: number;
  /** False when either page hit the broker's ceiling: the series is a lower bound. */
  readonly complete: boolean;
}

export const EMPTY_HISTORY: History = { months: [], byAccount: new Map(), lines: 0, complete: true };

export interface HistoryInput {
  readonly accounts: readonly Account[];
  readonly entries: readonly JournalEntry[];
  readonly lines: readonly JournalLine[];
  readonly months: readonly Month[];
  readonly complete: boolean;
}

/**
 * The series, built the only way the broker allows: entries first, lines by parent id.
 *
 * A line carries no date and no status — both live on its entry — so an entry that is not
 * posted, or whose month falls outside the axis, drops its lines on the floor here rather
 * than at the far end of a projection.
 */
export function buildHistory(input: HistoryInput): History {
  const { accounts, entries, lines, months, complete } = input;
  if (months.length === 0) return EMPTY_HISTORY;

  const slot = new Map<Month, number>(months.map((month, index) => [month, index] as const));
  const types = new Map<string, AccountType>(accounts.map((account) => [account.id, account.type] as const));

  // Posted entries only, and only those inside the window: `month` is the column a line
  // will land in, so an entry with no usable column is not worth walking its lines for.
  const column = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status !== 'posted') continue;
    const month = monthOfEntry(entry);
    if (month === null) continue;
    const index = slot.get(month);
    if (index !== undefined) column.set(entry.id, index);
  }

  const values = new Map<string, number[]>();
  const counts = new Map<string, number>();
  const active = new Map<string, Set<number>>();
  let seen = 0;

  for (const line of lines) {
    if (line.accountId === null) continue;
    const index = column.get(line.entryId);
    if (index === undefined) continue;
    const type = types.get(line.accountId);
    // A line against an account outside the loaded chart cannot be signed, and a guess at
    // its nature would put revenue in the expense column.
    if (type === undefined) continue;
    let series = values.get(line.accountId);
    if (series === undefined) {
      series = new Array<number>(months.length).fill(0);
      values.set(line.accountId, series);
    }
    series[index] += signedAmount(line, type);
    counts.set(line.accountId, (counts.get(line.accountId) ?? 0) + 1);
    const hit = active.get(line.accountId) ?? new Set<number>();
    hit.add(index);
    active.set(line.accountId, hit);
    seen += 1;
  }

  const byAccount = new Map<string, AccountHistory>();
  for (const [accountId, series] of values) {
    byAccount.set(accountId, {
      accountId,
      values: series,
      lines: counts.get(accountId) ?? 0,
      active: active.get(accountId)?.size ?? 0,
    });
  }
  return { months, byAccount, lines: seen, complete };
}

/** The series of an account with no postings in the window: a row of zeros, not a gap. */
export function seriesOf(history: History, accountId: string): readonly number[] {
  return history.byAccount.get(accountId)?.values ?? new Array<number>(history.months.length).fill(0);
}

/* ------------------------------------------------------------------ *
 * The statistics a driver reads
 * ------------------------------------------------------------------ */

export const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** The last `count` months of a series, which is what every driver is fitted over. */
export const tail = (values: readonly number[], count: number): readonly number[] =>
  count >= values.length ? values : values.slice(values.length - count);

/** A straight line through the series: `value(index) = intercept + slope * index`. */
export interface Fit {
  readonly slope: number;
  readonly intercept: number;
}

export function fitLine(values: readonly number[]): Fit {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0] };
  const meanX = (n - 1) / 2;
  const meanY = mean(values);
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = index - meanX;
    covariance += dx * (values[index] - meanY);
    variance += dx * dx;
  }
  const slope = variance === 0 ? 0 : covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * Month-over-month growth the series implies, as a ratio, or `null` when it cannot say.
 *
 * The geometric mean of the steps rather than first-to-last, so one freak month at either
 * end does not become the whole rate. Steps across a zero or a sign change are skipped:
 * there is no growth rate from nothing to something.
 */
export function impliedGrowth(values: readonly number[]): number | null {
  let product = 1;
  let steps = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous <= 0 || current <= 0) continue;
    product *= current / previous;
    steps += 1;
  }
  return steps === 0 ? null : product ** (1 / steps) - 1;
}

