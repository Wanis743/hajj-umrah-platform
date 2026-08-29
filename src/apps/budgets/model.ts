/**
 * Budgets — the reads.
 *
 * Six queries, and one of them is a choice rather than a lookup: what "actual" means.
 *
 * A budget row in this schema may name a fiscal period, and when it does the comparison
 * is unambiguous — that period's posted entries, their lines, summed per account. When it
 * names none there is nothing to bound the window with, so the fallback is the whole
 * book's trial balance. Both are honest; only one is what a reader assumes, so the basis
 * travels with the numbers and the status bar says which one is on screen.
 *
 * The period path is two queries deep because `where` speaks equality, `in` and `is
 * null`, and never `between`: the period's entries are fetched first, the posted ones'
 * ids become an `in` filter on the lines, and both pages stop at the broker's ceiling. A
 * book with more than a page of either is reported as a partial answer rather than shown
 * as a total — a variance report that saw half the postings is worse than one that says
 * so.
 *
 * Lines are signed by their account's nature rather than by debit and credit, so an
 * expense and a revenue account can share a column and both read as "what this account
 * did".
 */
import { useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type Account,
  type Budget,
  type FiscalPeriod,
  signedAmount,
  toAccount,
  toBudget,
  toBudgetLine,
  toEntry,
  toLine,
  toPeriod,
  toTrialRow,
} from '../shared/ledger';
import {
  type ActualBasis,
  type ActualCell,
  assess,
  type BudgetAssessment,
  EMPTY_ACTUAL,
  type VarianceRow,
} from './variance';

/** The chart of accounts. The broker's own page ceiling, and every row is a plan row. */
export const ACCOUNT_LIMIT = 500;
/** Budgets in the book, newest first. */
export const BUDGET_LIMIT = 200;
/** Lines in one budget — at most one per account, so the chart bounds this too. */
export const LINE_LIMIT = 500;
/** Ten years of monthly periods and room over. */
export const PERIOD_LIMIT = 120;
/** Entries of the budget's period, and the lines beneath them. */
export const ENTRY_LIMIT = 500;
export const POSTING_LIMIT = 500;
/** Accounts in the whole-book fallback. */
export const TRIAL_LIMIT = 500;

export type BudgetView = 'variance' | 'plan' | 'rollup';

export interface BudgetSelection {
  readonly budgetId: string | null;
  readonly accountId: string | null;
}

/** Posted activity per account, and how much of the book it saw. */
interface Actuals {
  readonly cells: ReadonlyMap<string, ActualCell>;
  readonly basis: ActualBasis;
  readonly complete: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

export interface BudgetModel {
  readonly budgets: readonly Budget[];
  readonly budget: Budget | null;
  /** The period the budget names, when it names one that still exists. */
  readonly period: FiscalPeriod | null;
  readonly accounts: readonly Account[];
  readonly assessment: BudgetAssessment;
  /** What the active view shows, after the search box has had its say. */
  readonly rows: readonly VarianceRow[];
  readonly selected: VarianceRow | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

/**
 * What the book did, on whichever basis the budget allows.
 *
 * Both paths are declared every render — hooks cannot be conditional — and the one that
 * does not apply is `enabled: false`, which costs nothing and keeps the query identities
 * stable when the selected budget changes.
 */
function useActuals(period: FiscalPeriod | null, accounts: readonly Account[]): Actuals {
  const scoped = period !== null;

  const entryPage = useDataset('journalEntries', {
    where: { fiscal_period_id: period?.id ?? '' },
    limit: ENTRY_LIMIT,
    enabled: scoped,
  });
  // Lines carry no status of their own; the entry owns it. So the posted entries are
  // resolved first and the lines are asked for by parent id.
  const posted = useMemo(() => {
    const out: string[] = [];
    for (const row of entryPage.rows) {
      const entry = toEntry(row);
      if (entry !== null && entry.status === 'posted') out.push(entry.id);
    }
    return out;
  }, [entryPage.rows]);

  const linePage = useDataset('journalLines', {
    where: { journal_entry_id: posted },
    limit: POSTING_LIMIT,
    enabled: scoped && posted.length > 0,
  });
  const trialPage = useDataset('trialBalance', { limit: TRIAL_LIMIT, enabled: !scoped });

  const types = useMemo(() => new Map(accounts.map((account) => [account.id, account.type] as const)), [accounts]);

  const fromLines = useMemo(() => {
    const out = new Map<string, ActualCell>();
    for (const row of linePage.rows) {
      const line = toLine(row);
      if (line === null || line.accountId === null) continue;
      const type = types.get(line.accountId);
      // A line against an account outside the loaded chart cannot be signed, and a
      // guess at its nature would land in the wrong column.
      if (type === undefined) continue;
      const cell = out.get(line.accountId) ?? EMPTY_ACTUAL;
      out.set(line.accountId, { amount: cell.amount + signedAmount(line, type), lines: cell.lines + 1 });
    }
    return out;
  }, [linePage.rows, types]);

  const fromTrial = useMemo(() => {
    const out = new Map<string, ActualCell>();
    for (const row of trialPage.rows) {
      const mapped = toTrialRow(row);
      if (mapped !== null) out.set(mapped.accountId, { amount: mapped.balance, lines: mapped.lines });
    }
    return out;
  }, [trialPage.rows]);

  const refresh = () => {
    entryPage.refetch();
    linePage.refetch();
    trialPage.refetch();
  };

  if (!scoped) {
    return {
      cells: fromTrial,
      basis: 'book',
      complete: trialPage.rows.length < TRIAL_LIMIT,
      loading: trialPage.loading,
      error: trialPage.error,
      fetchedAt: trialPage.fetchedAt,
      refresh,
    };
  }
  return {
    cells: fromLines,
    basis: 'period',
    complete: entryPage.rows.length < ENTRY_LIMIT && linePage.rows.length < POSTING_LIMIT,
    loading: entryPage.loading || linePage.loading,
    error: entryPage.error ?? linePage.error,
    fetchedAt: entryPage.fetchedAt,
    refresh,
  };
}

/** The search box reads the chart of accounts, which is a code and a name. */
function filterRows(rows: readonly VarianceRow[], search: string): readonly VarianceRow[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(
    (row) => row.account.code.toLowerCase().includes(needle) || row.account.name.toLowerCase().includes(needle),
  );
}

/** The budget on screen: the chosen one, else one still open to editing, else the newest. */
function pickBudget(budgets: readonly Budget[], id: string | null): Budget | null {
  const chosen = budgets.find((row) => row.id === id);
  if (chosen !== undefined) return chosen;
  return budgets.find((row) => row.lockedAt === null) ?? budgets[0] ?? null;
}

/** A locked budget is a signed one: the report still reads, the amounts no longer move. */
const isLocked = (budget: Budget | null): boolean =>
  budget !== null && (budget.lockedAt !== null || budget.status === 'locked');

export function useBudgetModel(view: BudgetView, search: string, selection: BudgetSelection): BudgetModel {
  const accountQuery = useMappedDataset('accounts', toAccount, { limit: ACCOUNT_LIMIT });
  const budgetQuery = useMappedDataset('budgets', toBudget, { limit: BUDGET_LIMIT });
  const periodQuery = useMappedDataset('fiscalPeriods', toPeriod, {
    limit: PERIOD_LIMIT,
    orderBy: { column: 'start_date', ascending: false },
  });

  const budgets = budgetQuery.rows;
  const budget = useMemo(() => pickBudget(budgets, selection.budgetId), [budgets, selection.budgetId]);
  const period = useMemo(
    () => periodQuery.rows.find((row) => row.id === budget?.periodId) ?? null,
    [periodQuery.rows, budget],
  );

  const lineQuery = useMappedDataset('budgetLines', toBudgetLine, {
    where: { budget_id: budget?.id ?? '' },
    limit: LINE_LIMIT,
    enabled: budget !== null,
  });
  const actuals = useActuals(period, accountQuery.rows);

  const assessment = useMemo(
    () =>
      assess({
        accounts: accountQuery.rows,
        lines: lineQuery.rows,
        actuals: actuals.cells,
        locked: isLocked(budget),
        basis: actuals.basis,
        // A chart cut off at the page ceiling is as partial as a short page of postings.
        complete: actuals.complete && accountQuery.rows.length < ACCOUNT_LIMIT,
      }),
    [accountQuery.rows, lineQuery.rows, actuals.cells, actuals.basis, actuals.complete, budget],
  );

  const rows = useMemo(
    () => filterRows(view === 'plan' ? assessment.plan : assessment.rows, search),
    [assessment.plan, assessment.rows, search, view],
  );
  // Selection is resolved against the plan, not the filtered rows: typing in the search
  // box should not clear the pane on the right.
  const selected = useMemo(
    () => assessment.plan.find((row) => row.account.id === selection.accountId) ?? null,
    [assessment.plan, selection.accountId],
  );

  const refresh = () => {
    accountQuery.refetch();
    budgetQuery.refetch();
    periodQuery.refetch();
    lineQuery.refetch();
    actuals.refresh();
  };

  return {
    budgets,
    budget,
    period,
    accounts: accountQuery.rows,
    assessment,
    rows,
    selected,
    loading: accountQuery.loading || budgetQuery.loading || lineQuery.loading || actuals.loading,
    error: accountQuery.error ?? budgetQuery.error ?? periodQuery.error ?? lineQuery.error ?? actuals.error,
    fetchedAt: actuals.fetchedAt,
    refresh,
  };
}
