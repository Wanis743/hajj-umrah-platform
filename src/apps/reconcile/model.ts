/**
 * Reconciliation — the reads.
 *
 * Five queries, chained by what the person has selected rather than fetched all at
 * once: the banks, the chosen bank's statements, the chosen statement's lines, the
 * mirrored ledger account's postings, and the entries those postings belong to. A
 * bank with forty statements should cost one page of statement lines, not forty.
 *
 * Nothing here is filtered by an effect. The selection is *derived* — the id the
 * window is holding, or the first row if it matches nothing — so picking another
 * bank moves to its newest statement in the same render instead of flashing an
 * empty grid while an effect catches up.
 *
 * One join is done by hand and cannot be avoided: `journal_lines` carries no date
 * and no status, and the pairing rules need both. The entries are pulled by `in`
 * over the ids the lines named — the same shape Ledger uses for its postings — so
 * coverage is exact rather than "the last few hundred entries, hopefully".
 *
 * `useDataset` rather than `useMappedDataset` for the statement lines alone: the
 * status bar states when the bank was last read, and only the raw hook carries
 * `fetchedAt`.
 */
import { useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type Account,
  accountLabel,
  type BankAccount,
  type BankStatement,
  type BankTransaction,
  type JournalEntry,
  type JournalLine,
  toAccount,
  toBankAccount,
  toBankStatement,
  toBankTransaction,
  toEntry,
  toLine,
} from '../shared/ledger';
import {
  type AmountIndex,
  amountIndex,
  type AutoMatch,
  type CandidateSet,
  candidatesFor,
  type LedgerRow,
  planAutoMatch,
  reconcile,
  type Reconciliation,
} from './match';

/** A book with more bank accounts than this has an organisation problem. */
export const ACCOUNT_LIMIT = 200;
/** Statements listed in the rail. Ten years of monthly statements and room over. */
export const STATEMENT_LIMIT = 120;
/** Lines of one statement. The broker's own ceiling is 500. */
export const TX_LIMIT = 500;
/** Postings of the mirrored ledger account, and their entries. */
export const LINE_LIMIT = 300;

export type ReconcileView = 'open' | 'matched' | 'ledger';

export interface ReconcileSelection {
  readonly accountId: string | null;
  readonly statementId: string | null;
  readonly transactionId: string | null;
  readonly candidateId: string | null;
}

export interface ReconcileModel {
  readonly accounts: readonly BankAccount[];
  readonly account: BankAccount | null;
  /** The chart row the bank mirrors, when the bank names one. */
  readonly ledgerAccount: Account | null;
  readonly statements: readonly BankStatement[];
  readonly statement: BankStatement | null;
  /** Every line of the selected statement, oldest first — a statement is read forwards. */
  readonly transactions: readonly BankTransaction[];
  /** The current view, filtered by the search box. */
  readonly visible: readonly BankTransaction[];
  readonly ledgerRows: readonly LedgerRow[];
  readonly visibleLedger: readonly LedgerRow[];
  readonly summary: Reconciliation;
  readonly selected: BankTransaction | null;
  /** Candidates for the selected line: what the server would take, and what it would not. */
  readonly candidates: CandidateSet;
  /** The ledger row a matched line points at, when that row is on the page. */
  readonly counterpart: LedgerRow | null;
  /** Every pairing the sweep would make right now, unambiguous and certain. */
  readonly plan: readonly AutoMatch[];
  /** Eligible ledger amounts, counted once, so the grid can hint per row. */
  readonly amounts: AmountIndex;
  readonly ledgerById: ReadonlyMap<string, LedgerRow>;
  /** True when one of the pages came back at its ceiling; suggestions are partial. */
  readonly truncated: boolean;
  readonly loading: boolean;
  readonly ledgerLoading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

/** Deduplicated and sorted, so the `in` filter keys the broker's cache stably. */
function entryKeys(lines: readonly JournalLine[]): readonly string[] {
  const seen = new Set<string>();
  for (const line of lines) seen.add(line.entryId);
  return [...seen].sort();
}

/**
 * Which column carries the value, stated the way a statement states it.
 *
 * A line with both a debit and a credit is not a thing the chart of accounts
 * intends, but the column is `NUMERIC` and nothing stops it, so the larger side
 * wins and the amount is the net — which is exactly `ABS(debit - credit)`, the
 * expression `match_bank_transaction` compares against.
 */
function toLedgerRow(line: JournalLine, entry: JournalEntry | undefined, label: string): LedgerRow {
  return {
    line,
    reference: entry?.reference ?? '',
    date: entry?.date ?? '',
    posted: entry?.status === 'posted',
    accountLabel: label,
    kind: line.debit >= line.credit ? 'debit' : 'credit',
    amount: Math.abs(line.debit - line.credit),
  };
}

const matchesText = (needle: string, ...fields: readonly string[]): boolean =>
  fields.some((field) => field.toLowerCase().includes(needle));

function filterTransactions(
  rows: readonly BankTransaction[],
  view: ReconcileView,
  search: string,
): readonly BankTransaction[] {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    // The matched view carries the ignored lines too: both are decisions, and a
    // line somebody deliberately set aside does not belong in tomorrow's queue.
    const inView = view === 'open' ? row.state === 'unmatched' : row.state !== 'unmatched';
    if (!inView) return false;
    return needle === '' || matchesText(needle, row.description, row.reference, row.date, String(row.amount));
  });
}

function filterLedger(rows: readonly LedgerRow[], search: string): readonly LedgerRow[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) => matchesText(needle, row.line.memo, row.reference, row.date, String(row.amount)));
}

export function useReconcileModel(view: ReconcileView, search: string, selection: ReconcileSelection): ReconcileModel {
  const accountQuery = useMappedDataset('bankAccounts', toBankAccount, {
    limit: ACCOUNT_LIMIT,
    orderBy: { column: 'name', ascending: true },
  });
  const accounts = accountQuery.rows;
  const account = useMemo(
    () => accounts.find((row) => row.id === selection.accountId) ?? accounts[0] ?? null,
    [accounts, selection.accountId],
  );

  const statementQuery = useMappedDataset('bankStatements', toBankStatement, {
    where: { bank_account_id: account?.id ?? '' },
    limit: STATEMENT_LIMIT,
    orderBy: { column: 'statement_date', ascending: false },
    enabled: account !== null,
  });
  const statements = statementQuery.rows;
  const statement = useMemo(
    () => statements.find((row) => row.id === selection.statementId) ?? statements[0] ?? null,
    [statements, selection.statementId],
  );

  const page = useDataset('bankTransactions', {
    where: { statement_id: statement?.id ?? '' },
    limit: TX_LIMIT,
    orderBy: { column: 'transaction_date', ascending: true },
    enabled: statement !== null,
  });
  const transactions = useMemo(() => {
    const out: BankTransaction[] = [];
    for (const row of page.rows) {
      const mapped = toBankTransaction(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [page.rows]);

  const ledgerAccountId = account?.ledgerAccountId ?? null;
  const lineQuery = useMappedDataset('journalLines', toLine, {
    where: { account_id: ledgerAccountId ?? '' },
    limit: LINE_LIMIT,
    enabled: ledgerAccountId !== null,
  });
  const entryIds = useMemo(() => entryKeys(lineQuery.rows), [lineQuery.rows]);
  const entryQuery = useMappedDataset('journalEntries', toEntry, {
    where: { id: entryIds },
    limit: LINE_LIMIT,
    enabled: entryIds.length > 0,
  });
  const chartQuery = useMappedDataset('accounts', toAccount, {
    where: { id: ledgerAccountId ?? '' },
    limit: 1,
    enabled: ledgerAccountId !== null,
  });
  const ledgerAccount = chartQuery.rows[0] ?? null;

  const ledgerRows = useMemo(() => {
    const entries = new Map<string, JournalEntry>();
    for (const entry of entryQuery.rows) entries.set(entry.id, entry);
    const label = ledgerAccount === null ? '' : accountLabel(ledgerAccount);
    return lineQuery.rows
      .map((line) => toLedgerRow(line, entries.get(line.entryId), label))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [lineQuery.rows, entryQuery.rows, ledgerAccount]);

  const ledgerById = useMemo(() => {
    const out = new Map<string, LedgerRow>();
    for (const row of ledgerRows) out.set(row.line.id, row);
    return out;
  }, [ledgerRows]);

  const visible = useMemo(() => filterTransactions(transactions, view, search), [transactions, view, search]);
  const visibleLedger = useMemo(() => filterLedger(ledgerRows, search), [ledgerRows, search]);
  const summary = useMemo(() => reconcile(statement, transactions, ledgerRows), [statement, transactions, ledgerRows]);

  const selected = useMemo(
    () => transactions.find((row) => row.id === selection.transactionId) ?? null,
    [transactions, selection.transactionId],
  );
  const candidates = useMemo(
    () => (selected === null ? { matches: [], near: [] } : candidatesFor(selected, ledgerRows)),
    [selected, ledgerRows],
  );
  const counterpartId = selected === null ? null : selected.matchedLineId;
  const counterpart = counterpartId === null ? null : ledgerById.get(counterpartId) ?? null;
  const plan = useMemo(() => planAutoMatch(transactions, ledgerRows), [transactions, ledgerRows]);
  const amounts = useMemo(() => amountIndex(ledgerRows), [ledgerRows]);

  const refresh = () => {
    accountQuery.refetch();
    statementQuery.refetch();
    page.refetch();
    lineQuery.refetch();
    entryQuery.refetch();
    chartQuery.refetch();
  };

  return {
    accounts,
    account,
    ledgerAccount,
    statements,
    statement,
    transactions,
    visible,
    ledgerRows,
    visibleLedger,
    summary,
    selected,
    candidates,
    counterpart,
    plan,
    amounts,
    ledgerById,
    truncated: page.rows.length >= TX_LIMIT || lineQuery.rows.length >= LINE_LIMIT,
    loading: accountQuery.loading || statementQuery.loading || page.loading,
    ledgerLoading: lineQuery.loading || entryQuery.loading,
    error: accountQuery.error ?? statementQuery.error ?? page.error ?? lineQuery.error,
    fetchedAt: page.fetchedAt,
    refresh,
  };
}
