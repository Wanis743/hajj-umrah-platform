/**
 * Modeling — the reads.
 *
 * Five queries, and one judgement: where the history ends.
 *
 * It ends at the last month the book was written up for, not at today. Two empty months at
 * the end of the axis are a bookkeeping backlog rather than a collapse in trade, and a
 * straight line fitted through them projects the backlog forward. So the axis ends where
 * the postings end, the projection starts the month after, and the status bar names both —
 * a stale book is then visible as a stale date instead of as a bad forecast.
 *
 * Entries come newest-first with no filter, because that is the one page ordering that is
 * guaranteed to contain the months a forecast is built from. The broker's ceiling still
 * applies: when the page is full, the oldest month it reached is reported as the start of
 * proven history and everything before it is left blank rather than assumed to be zero.
 */
import { useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type Account,
  type Budget,
  type BudgetLine,
  type JournalEntry,
  toAccount,
  toBudget,
  toBudgetLine,
  toEntry,
  toLine,
} from '../shared/ledger';
import {
  build,
  EMPTY_PROJECTION,
  type ForecastRow,
  type Projection,
  type Scenario,
} from './forecast';
import {
  buildHistory,
  EMPTY_HISTORY,
  futureAxis,
  type History,
  monthAxis,
  type Month,
  monthOfEntry,
} from './history';

/** The chart of accounts: the broker's page ceiling, and every income row is a model row. */
export const ACCOUNT_LIMIT = 500;
/** Budgets in the book, for the comparison rail. */
export const BUDGET_LIMIT = 200;
/** At most one plan line per account. */
export const LINE_LIMIT = 500;
/** The newest page of entries, which is the history window. */
export const ENTRY_LIMIT = 500;
/** The postings beneath them. */
export const POSTING_LIMIT = 500;

/** How much history is fetched, independent of how much of it a driver reads. */
export const HISTORY_MONTHS = 18;

/**
 * The four views, of which the fourth is a different kind of thing.
 *
 * `forecast`, `timeline` and `compare` are three angles on one derived object: a
 * projection computed here, in this window, out of the posted book, holding
 * nothing. Close the window and the hypothesis is gone, which is the correct
 * lifetime for a hypothesis.
 *
 * `workbench` edits a *document*. It has rows and assumptions somebody wrote,
 * versions somebody published, and a certificate somebody else will quote. It
 * does not read the ledger at all and the other three do not read a model, so
 * the two halves share a window and almost nothing else — which is why nothing
 * below this line has a `workbench` branch, and why `useModelingModel` is not
 * asked to load anything for it.
 */
export type ModelingView = 'forecast' | 'timeline' | 'compare' | 'workbench';

/**
 * The three that project the book.
 *
 * Chrome that only the projection has — its status bar, its nouns, its per-view exports —
 * takes this rather than the full union, so a total `Record` over it stays total without
 * inventing a `workbench` arm nothing will ever read.
 */
export type ProjectionView = Exclude<ModelingView, 'workbench'>;

export interface ModelingSelection {
  readonly budgetId: string | null;
  readonly accountId: string | null;
}

export interface ModelingModel {
  readonly accounts: readonly Account[];
  readonly budgets: readonly Budget[];
  /** The plan the projection is compared against, when one is chosen. */
  readonly budget: Budget | null;
  readonly history: History;
  readonly projection: Projection;
  /** What the forecast grid shows, after the search box and the quiet filter. */
  readonly rows: readonly ForecastRow[];
  readonly selected: ForecastRow | null;
  /** The oldest month the fetched page proved. `null` when nothing is posted. */
  readonly coveredFrom: Month | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

/** The search box reads the chart of accounts, which is a code and a name. */
function filterRows(rows: readonly ForecastRow[], search: string): readonly ForecastRow[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(
    (row) => row.account.code.toLowerCase().includes(needle) || row.account.name.toLowerCase().includes(needle),
  );
}

/** The budget on screen: the chosen one, else none — a comparison nobody asked for is noise. */
function pickBudget(budgets: readonly Budget[], id: string | null): Budget | null {
  return budgets.find((row) => row.id === id) ?? null;
}

export function useModelingModel(
  view: ModelingView,
  search: string,
  selection: ModelingSelection,
  scenario: Scenario,
  showQuiet: boolean,
): ModelingModel {
  /**
   * Whether the book is being read at all.
   *
   * The workbench edits a document and touches no ledger, and the jump list can
   * open the window straight into it — so without this the app would fetch five
   * hundred entries, five hundred postings and the whole chart of accounts to
   * render a screen that shows none of them.
   *
   * Disabling a query keeps the rows it already had (`useDataset` sets `loading`
   * false and leaves `rows` alone), so the trip to the workbench and back costs
   * one re-issued query that the broker's cache usually answers, not a spinner.
   */
  const book = view !== 'workbench';

  const accountQuery = useMappedDataset('accounts', toAccount, { limit: ACCOUNT_LIMIT, enabled: book });
  const budgetQuery = useMappedDataset('budgets', toBudget, { limit: BUDGET_LIMIT, enabled: book });

  // Raw, not mapped: this is the query whose `fetchedAt` the status bar reports, and only
  // `useDataset` carries one.
  const entryPage = useDataset('journalEntries', {
    limit: ENTRY_LIMIT,
    orderBy: { column: 'entry_date', ascending: false },
    enabled: book,
  });

  const entries = useMemo(() => {
    const out: JournalEntry[] = [];
    for (const row of entryPage.rows) {
      const entry = toEntry(row);
      if (entry !== null && entry.status === 'posted') out.push(entry);
    }
    return out;
  }, [entryPage.rows]);

  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const linePage = useMappedDataset('journalLines', toLine, {
    where: { journal_entry_id: ids },
    limit: POSTING_LIMIT,
    enabled: book && ids.length > 0,
  });

  /**
   * The axis, and what the page could prove about it.
   *
   * `last` is the newest posted month; `coveredFrom` is the oldest one the page reached.
   * When the page came back full, months before that are unproven rather than empty — the
   * difference matters, because a zero is evidence and a blank is not.
   */
  const axis = useMemo(() => {
    let last: Month | null = null;
    let first: Month | null = null;
    for (const entry of entries) {
      const month = monthOfEntry(entry);
      if (month === null) continue;
      if (last === null || month > last) last = month;
      if (first === null || month < first) first = month;
    }
    if (last === null) return { months: [] as readonly Month[], last: null, coveredFrom: null };
    const full = entryPage.rows.length >= ENTRY_LIMIT;
    return { months: monthAxis(last, HISTORY_MONTHS), last, coveredFrom: full ? first : null };
  }, [entries, entryPage.rows.length]);

  const history = useMemo(
    () =>
      axis.months.length === 0
        ? EMPTY_HISTORY
        : buildHistory({
            accounts: accountQuery.rows,
            entries,
            lines: linePage.rows,
            months: axis.months,
            complete: entryPage.rows.length < ENTRY_LIMIT && linePage.rows.length < POSTING_LIMIT,
          }),
    [accountQuery.rows, axis.months, entries, entryPage.rows.length, linePage.rows],
  );

  const budgets = budgetQuery.rows;
  const budget = useMemo(() => pickBudget(budgets, selection.budgetId), [budgets, selection.budgetId]);
  const lineQuery = useMappedDataset('budgetLines', toBudgetLine, {
    where: { budget_id: budget?.id ?? '' },
    limit: LINE_LIMIT,
    enabled: book && budget !== null,
  });
  const plan = useMemo(() => {
    if (budget === null) return null;
    const out = new Map<string, BudgetLine>();
    for (const line of lineQuery.rows) out.set(line.accountId, line);
    return out as ReadonlyMap<string, BudgetLine>;
  }, [budget, lineQuery.rows]);

  const projection = useMemo(() => {
    if (axis.last === null) return EMPTY_PROJECTION;
    return build({
      accounts: accountQuery.rows,
      history,
      futureMonths: futureAxis(axis.last, scenario.horizon),
      scenario,
      plan,
    });
  }, [accountQuery.rows, axis.last, history, plan, scenario]);

  const rows = useMemo(
    () => filterRows(showQuiet ? projection.rows : projection.moving, search),
    [projection.moving, projection.rows, search, showQuiet],
  );
  // Resolved against every row, not the filtered ones: typing in the search box should not
  // empty the pane on the right.
  const selected = useMemo(
    () => projection.rows.find((row) => row.account.id === selection.accountId) ?? null,
    [projection.rows, selection.accountId],
  );

  const refresh = () => {
    accountQuery.refetch();
    budgetQuery.refetch();
    entryPage.refetch();
    linePage.refetch();
    lineQuery.refetch();
  };

  // Which queries a view waits on. The three projection views read the same object, so they
  // differ only in whether the budget matters; the workbench reads none of it and must not
  // report a spinner for a fetch it did not ask for and will not display.
  const loading =
    book &&
    (accountQuery.loading || entryPage.loading || linePage.loading || (view === 'compare' && lineQuery.loading));

  return {
    accounts: accountQuery.rows,
    budgets,
    budget,
    history,
    projection,
    rows,
    selected,
    coveredFrom: axis.coveredFrom,
    loading,
    error: accountQuery.error ?? budgetQuery.error ?? entryPage.error ?? linePage.error ?? lineQuery.error,
    fetchedAt: entryPage.fetchedAt,
    refresh,
  };
}

