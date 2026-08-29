/**
 * Statements — the reads, and the one switch that decides what they mean.
 *
 * Two bases, two sets of queries, and the app never blends them. The **book** basis reads
 * the kernel's trial-balance derive: one query, aggregated server-side across every posted
 * line, inception-to-date. That is what a balance sheet is actually asking for, and it is
 * the only basis whose figures are complete.
 *
 * The **period** basis cannot be a query at all, because the broker's `where` compares for
 * equality and has no range operator. So the newest page of entries is fetched, the window
 * is applied here, and the count of postings the page proved is reported next to the
 * figures. When a page comes back full the numbers are a lower bound and the window says so
 * — a quarterly P&L that quietly drops the oldest fortnight is worse than one that admits
 * its ceiling.
 *
 * The comparison column belongs to the period basis alone. An inception-to-date balance has
 * nothing to be compared against: the period before it is the empty book.
 *
 * What is fetched follows the basis, so the view this window opens on costs one query.
 * Accounts, entries and postings are asked for only once somebody chooses a period.
 */
import { useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  ACCOUNT_TYPES,
  type AccountType,
  byRecency,
  type FiscalPeriod,
  type JournalEntry,
  monthBefore,
  monthPeriod,
  toAccount,
  toEntry,
  toLine,
  toPeriod,
  type TrialRow,
  toTrialRow,
  windowOf,
} from '../shared/ledger';
import {
  type AccountFigure,
  bookFigures,
  isQuiet,
  periodFigures,
} from './balances';
import type { SavedReport } from './document';
import {
  build,
  EMPTY_SET,
  type Keep,
  rowsOf,
  type StatementRow,
  type StatementSet,
  type StatementView,
} from './statement';

/* ------------------------------------------------------------------ *
 * Ceilings
 * ------------------------------------------------------------------ */

/** The trial balance: one row per account that carries activity. */
export const TRIAL_LIMIT = 500;
/** The chart of accounts, read on the period basis so silent accounts still print as zero. */
export const ACCOUNT_LIMIT = 500;
/** Fiscal periods, for the window selector. */
export const PERIOD_LIMIT = 200;
/** The newest page of entries: the whole period basis is assembled out of this. */
export const ENTRY_LIMIT = 500;
/** The postings beneath them. */
export const POSTING_LIMIT = 500;

export interface StatementsModel {
  /** Every account's figures on the chosen basis, before any filter. */
  readonly figures: readonly AccountFigure[];
  readonly set: StatementSet;
  /** The rows the current view prints, after the search box and the zero filter. */
  readonly rows: readonly StatementRow[];
  /** Account rows the filter is holding back. Every subtotal still counts them. */
  readonly hidden: number;
  /** The account the pane describes, resolved over every figure so typing cannot clear it. */
  readonly selected: AccountFigure | null;
  readonly periods: readonly FiscalPeriod[];
  /** The window in force: a period row, or the month the book was last written up in. */
  readonly period: FiscalPeriod | null;
  /** What the comparison column reads, or `null` when there is nothing to read. */
  readonly comparison: FiscalPeriod | null;
  /** True when a page came back full: every figure above is then a lower bound. */
  readonly bounded: boolean;
  /** The oldest posted date the page reached, whatever the window asked for. */
  readonly coveredFrom: string | null;
  /** Postings counted inside the window: the evidence behind the figures. */
  readonly postings: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

/* ------------------------------------------------------------------ *
 * The filter, and what it holds back
 * ------------------------------------------------------------------ */

/**
 * Which account rows print.
 *
 * Both controls are finds rather than scopes. `build` applies this to account rows and to
 * nothing else, so a subtotal means the same thing while somebody is typing as it did
 * before — a total that moved with the search box could not be quoted to anybody.
 */
function keeper(search: string, showZero: boolean): Keep {
  const needle = search.trim().toLowerCase();
  return (figure) => {
    if (!showZero && isQuiet(figure)) return false;
    if (needle === '') return true;
    return figure.code.toLowerCase().includes(needle) || figure.name.toLowerCase().includes(needle);
  };
}

/** Which account types each view prints at all. */
const VIEW_TYPES: Readonly<Record<StatementView, readonly AccountType[]>> = {
  income: ['REVENUE', 'EXPENSE'],
  balance: ['ASSET', 'LIABILITY', 'EQUITY'],
  trial: ACCOUNT_TYPES,
};

/**
 * How many account rows the filter dropped from this view.
 *
 * Counted off the figures rather than by building the statement a second time, and counted
 * per view, because an income statement never prints an asset in the first place — a hidden
 * count that included them would be reporting rows nobody was looking for.
 */
const hiddenCount = (figures: readonly AccountFigure[], view: StatementView, keep: Keep): number =>
  figures.filter((figure) => VIEW_TYPES[view].includes(figure.type) && !keep(figure)).length;

/* ------------------------------------------------------------------ *
 * Which window
 * ------------------------------------------------------------------ */

/**
 * The period vocabulary lives in `shared/ledger`, because a second report reads
 * the same page of entries and both have to agree about what "last month" is.
 * `byRecency`, `monthPeriod`, `monthBefore` and `windowOf` are imported above.
 */

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

/**
 * Everything the window renders, from the question it was asked.
 *
 * The report is the input, which is what makes `.fxreport` more than a convenience: opening
 * a saved file and setting the controls by hand arrive at the same state, because there is
 * only one state and it is this object's argument.
 */
export function useStatementsModel(report: SavedReport, selectedId: string | null): StatementsModel {
  const { view, basis, periodId, compare, showZero, search } = report;
  const walking = basis === 'period';

  // Raw rather than mapped: this is the query the status bar dates the book by on the book
  // basis, and only `useDataset` carries a `fetchedAt`.
  const trialPage = useDataset('trialBalance', { limit: TRIAL_LIMIT, enabled: !walking });
  const trial = useMemo(() => {
    const out: TrialRow[] = [];
    for (const row of trialPage.rows) {
      const mapped = toTrialRow(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [trialPage.rows]);

  const periodQuery = useMappedDataset('fiscalPeriods', toPeriod, { limit: PERIOD_LIMIT });
  const accountQuery = useMappedDataset('accounts', toAccount, {
    limit: ACCOUNT_LIMIT,
    enabled: walking,
  });

  const entryPage = useDataset('journalEntries', {
    limit: ENTRY_LIMIT,
    orderBy: { column: 'entry_date', ascending: false },
    enabled: walking,
  });
  // Drafts come back with the page and are dropped by `periodFigures`, not here: the oldest
  // date the page reached is a fact about the page, whatever the status of the entry.
  const entries = useMemo(() => {
    const out: JournalEntry[] = [];
    for (const row of entryPage.rows) {
      const entry = toEntry(row);
      if (entry !== null) out.push(entry);
    }
    return out;
  }, [entryPage.rows]);

  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const linePage = useMappedDataset('journalLines', toLine, {
    where: { journal_entry_id: ids },
    limit: POSTING_LIMIT,
    enabled: walking && ids.length > 0,
  });

  const periods = useMemo(() => byRecency(periodQuery.rows), [periodQuery.rows]);

  /**
   * The window, and what it is measured against.
   *
   * A named period wins; failing that the newest one on record; failing that the month the
   * newest posting landed in. The comparison is whatever sits immediately before it — the
   * next row down in date order. When the chosen period is the oldest one the book has,
   * there is no comparison, and an empty column is the honest answer rather than a quarter
   * held up against a month.
   */
  const frame = useMemo(() => {
    const index = periods.findIndex((row) => row.id === periodId);
    const chosen = index >= 0 ? periods[index] : (periods[0] ?? null);
    if (chosen !== null) {
      return { period: chosen, comparison: periods[(index >= 0 ? index : 0) + 1] ?? null };
    }
    let newest: string | null = null;
    for (const entry of entries) {
      if (entry.date !== '' && (newest === null || entry.date > newest)) newest = entry.date;
    }
    const month = newest === null ? null : monthPeriod(newest);
    return { period: month, comparison: month === null ? null : monthBefore(month) };
  }, [entries, periodId, periods]);

  const comparison = walking && compare ? frame.comparison : null;

  const walked = useMemo(() => {
    if (!walking || frame.period === null) return null;
    return periodFigures({
      accounts: accountQuery.rows,
      entries,
      lines: linePage.rows,
      period: windowOf(frame.period),
      compare: comparison === null ? null : windowOf(comparison),
    });
  }, [accountQuery.rows, comparison, entries, frame.period, linePage.rows, walking]);

  const figures = useMemo(
    () => (walked === null ? bookFigures(trial) : walked.figures),
    [trial, walked],
  );

  const keep = useMemo(() => keeper(search, showZero), [search, showZero]);
  const set = useMemo(() => (figures.length === 0 ? EMPTY_SET : build(figures, keep)), [figures, keep]);
  const rows = useMemo(() => rowsOf(set, view), [set, view]);
  const hidden = useMemo(() => hiddenCount(figures, view, keep), [figures, keep, view]);
  const selected = useMemo(
    () => figures.find((figure) => figure.accountId === selectedId) ?? null,
    [figures, selectedId],
  );

  /**
   * Did a page hit its ceiling?
   *
   * Asked of whichever queries the basis actually read. On the book basis a full trial
   * balance means accounts are missing from the bottom of the statement; on the period basis
   * a full entry or posting page means the window was only partly walked. Either way the
   * figures are a floor, and the status bar prints that instead of a total that looks whole.
   */
  const bounded = walking
    ? entryPage.rows.length >= ENTRY_LIMIT || linePage.rows.length >= POSTING_LIMIT
    : trialPage.rows.length >= TRIAL_LIMIT;

  const refresh = () => {
    trialPage.refetch();
    periodQuery.refetch();
    accountQuery.refetch();
    entryPage.refetch();
    linePage.refetch();
  };

  return {
    figures,
    set,
    rows,
    hidden,
    selected,
    periods,
    period: frame.period,
    comparison,
    bounded,
    coveredFrom: walked?.reachedFrom ?? null,
    // On the book basis the kernel counted the postings for us, one aggregate per account.
    postings: walked === null ? set.summary.lines : walked.lines,
    loading: walking
      ? accountQuery.loading || entryPage.loading || linePage.loading
      : trialPage.loading,
    error:
      trialPage.error ?? periodQuery.error ?? accountQuery.error ?? entryPage.error ?? linePage.error,
    fetchedAt: walking ? entryPage.fetchedAt : trialPage.fetchedAt,
    refresh,
  };
}

