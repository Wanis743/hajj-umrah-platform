/**
 * Statements — the figures, before anything is a statement.
 *
 * Two bases, and the difference between them is the whole reason this file has two
 * functions instead of one.
 *
 * The **book** basis comes off the trial-balance projection, which the kernel derives
 * from every posted line it can see. It is inception-to-date, it is what a balance
 * sheet is actually asking for, and it is complete: the broker pulls its inputs an
 * order of magnitude above the page an app may request.
 *
 * The **period** basis has to be assembled here, because the broker has no range
 * operator — `where` compares for equality and nothing else. So a page of entries is
 * fetched newest-first and the range is applied in this module. That page has a
 * ceiling, which makes period figures a lower bound rather than a fact, and the window
 * says so out loud rather than quietly showing a smaller number.
 *
 * Nothing here formats and nothing here rounds. `EPSILON` exists because a total that
 * was exact on the server comes back as `1249.9999999999998`, and a report that paints
 * a balanced book red is worse than one that says nothing.
 */
import {
  type Account,
  type AccountType,
  belongs,
  EPSILON,
  isDebitNatured,
  type JournalEntry,
  type JournalLine,
  type PeriodWindow,
  signedAmount,
  type TrialRow,
} from '../shared/ledger';

/**
 * The window vocabulary, re-exported rather than redefined.
 *
 * It moved to `shared/ledger` when a second report started asking the same
 * question of the same page of entries. Both had to agree about which entries
 * are inside a quarter, or a margin per package could not be tied back to the
 * income statement it came out of. This file keeps the names because everything
 * downstream of it reads a statement, not a ledger.
 *
 * `PeriodWindow` also appears in the import above, because a re-export forwards a name
 * without binding it here, and the walk below names the type in its own signatures.
 */
export type { Basis, DateRange, PeriodWindow } from '../shared/ledger';
export { belongs, inRange } from '../shared/ledger';

/** One account's numbers on the chosen basis, signed the way the account reads them. */
export interface AccountFigure {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly debit: number;
  readonly credit: number;
  /** Positive means "more of what this account is": a bigger asset, a bigger cost. */
  readonly balance: number;
  readonly lines: number;
  /** The same balance over the comparison window, or `null` when nothing to compare. */
  readonly prior: number | null;
}

/** Nothing moved: the shape a chart-of-accounts row takes before any posting lands. */
const empty = (account: Account): AccountFigure => ({
  accountId: account.id,
  code: account.code,
  name: account.name,
  type: account.type,
  currency: account.currency,
  debit: 0,
  credit: 0,
  balance: 0,
  lines: 0,
  prior: null,
});

/**
 * The book basis: the trial balance, restated.
 *
 * A near-copy, and deliberately so. Everything downstream reads `AccountFigure`, which
 * means the statement builders never learn which basis they are on — a section total is
 * the same arithmetic whether the numbers came from the kernel's aggregate or from a
 * page of entries this module walked itself.
 */
export function bookFigures(rows: readonly TrialRow[]): readonly AccountFigure[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    type: row.type,
    currency: row.currency,
    debit: row.debit,
    credit: row.credit,
    balance: row.balance,
    lines: row.lines,
    prior: null,
  }));
}

export interface PeriodInput {
  readonly accounts: readonly Account[];
  readonly entries: readonly JournalEntry[];
  readonly lines: readonly JournalLine[];
  readonly period: PeriodWindow;
  /** The window the comparison column reads, or `null` when there is no column. */
  readonly compare: PeriodWindow | null;
}

/** What a walk of the page produced, and how much of the page it actually used. */
export interface PeriodFigures {
  readonly figures: readonly AccountFigure[];
  /** Postings counted inside the window: the evidence behind every number above. */
  readonly lines: number;
  /** The oldest posted entry date the page reached, whatever the window asked for. */
  readonly reachedFrom: string | null;
}

/** One account's two sides, while the walk is still going. */
interface Bucket {
  debit: number;
  credit: number;
  lines: number;
}

/**
 * The period basis: a page of entries, walked.
 *
 * Entries first and lines second, because that is the only order the broker allows — a
 * line carries no date and no status, both of which live on its entry. An entry outside
 * the window therefore drops its lines here rather than at the far end of a subtotal.
 *
 * Every account in the chart comes back, including the ones that did nothing. A revenue
 * account that was silent this quarter is a zero on the statement, not an absence, and
 * whether to print it is a question for the reader rather than for this function.
 */
export function periodFigures(input: PeriodInput): PeriodFigures {
  const { accounts, entries, lines, period, compare } = input;
  const types = new Map<string, AccountType>(accounts.map((account) => [account.id, account.type] as const));

  const slot = new Map<string, 'current' | 'compare'>();
  let reachedFrom: string | null = null;
  for (const entry of entries) {
    if (entry.status !== 'posted') continue;
    if (entry.date !== '' && (reachedFrom === null || entry.date < reachedFrom)) reachedFrom = entry.date;
    if (belongs(entry, period)) slot.set(entry.id, 'current');
    else if (compare !== null && belongs(entry, compare)) slot.set(entry.id, 'compare');
  }

  const current = new Map<string, Bucket>();
  const prior = new Map<string, number>();
  let counted = 0;
  for (const line of lines) {
    if (line.accountId === null) continue;
    const where = slot.get(line.entryId);
    if (where === undefined) continue;
    // A line against an account outside the loaded chart cannot be signed, and guessing
    // its nature would put a cost in the revenue subtotal.
    const type = types.get(line.accountId);
    if (type === undefined) continue;
    if (where === 'compare') {
      prior.set(line.accountId, (prior.get(line.accountId) ?? 0) + signedAmount(line, type));
      continue;
    }
    const bucket = current.get(line.accountId) ?? { debit: 0, credit: 0, lines: 0 };
    bucket.debit += line.debit;
    bucket.credit += line.credit;
    bucket.lines += 1;
    current.set(line.accountId, bucket);
    counted += 1;
  }

  const figures = accounts.map((account) => {
    const compared = compare === null ? null : (prior.get(account.id) ?? 0);
    const bucket = current.get(account.id);
    if (bucket === undefined) return { ...empty(account), prior: compared };
    const balance = isDebitNatured(account.type)
      ? bucket.debit - bucket.credit
      : bucket.credit - bucket.debit;
    return {
      ...empty(account),
      debit: bucket.debit,
      credit: bucket.credit,
      balance,
      lines: bucket.lines,
      prior: compared,
    };
  });
  return { figures, lines: counted, reachedFrom };
}

/* ------------------------------------------------------------------ *
 * The four sums every statement is made of
 * ------------------------------------------------------------------ */

export const ofType = (figures: readonly AccountFigure[], type: AccountType): readonly AccountFigure[] =>
  figures.filter((figure) => figure.type === type);

export const total = (figures: readonly AccountFigure[]): number =>
  figures.reduce((sum, figure) => sum + figure.balance, 0);

export const debitTotal = (figures: readonly AccountFigure[]): number =>
  figures.reduce((sum, figure) => sum + figure.debit, 0);

export const creditTotal = (figures: readonly AccountFigure[]): number =>
  figures.reduce((sum, figure) => sum + figure.credit, 0);

/**
 * The comparison total, or `null` when there is no comparison column.
 *
 * `null` rather than zero, because a blank column and a column of zeros say different
 * things: one means nobody asked, the other means nothing happened.
 */
export function priorTotal(figures: readonly AccountFigure[]): number | null {
  let out: number | null = null;
  for (const figure of figures) {
    if (figure.prior === null) continue;
    out = (out ?? 0) + figure.prior;
  }
  return out;
}

/** Nothing to print: no balance this window, and nothing to compare it against. */
export const isQuiet = (figure: AccountFigure): boolean =>
  Math.abs(figure.balance) < EPSILON && (figure.prior === null || Math.abs(figure.prior) < EPSILON);

/** How a figure moved against its comparison, or `null` when there is nothing to move from. */
export const variance = (figure: AccountFigure): number | null =>
  figure.prior === null ? null : figure.balance - figure.prior;
