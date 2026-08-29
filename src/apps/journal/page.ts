/**
 * Journal — the read layer.
 *
 * Four queries and everything derived from them, in one hook, so the app shell is
 * left holding state and markup rather than plumbing.
 *
 * Only the period is pushed down to the server. The broker's `where` speaks
 * equality, `in` and `is null` — a date range is none of those — so the view, the
 * dates, the source, the text and "unbalanced only" are settled here, over the
 * page already in hand. That boundary is why the status bar has to say whether the
 * rows it is describing are a window or the whole book.
 */
import { useCallback, useMemo } from 'react';
import { type AppLocale, useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type Account,
  type Currency,
  type FiscalPeriod,
  type JournalEntry,
  type JournalLine,
  accountLabel,
  toAccount,
  toCurrency,
  toEntry,
  toLine,
  toPeriod,
} from '../shared/ledger';
import { PAGE_LIMIT, type JournalFilter, type Tally, filterEntries, sourcesOf, tally } from './entries';

/**
 * The currency the page totals are shown in.
 *
 * `journal_entries` projects no currency — the amounts are the book's own, and the
 * per-line currency lives on `journal_lines`. So the footer states the book's
 * currency, and the detail pane, which does have the lines, states theirs.
 */
export const BOOK_CURRENCY: Currency = 'DZD';

const ACCOUNT_LIMIT = 500;
const PERIOD_LIMIT = 60;

export interface JournalPage {
  readonly entries: readonly JournalEntry[];
  readonly visible: readonly JournalEntry[];
  /** Over the whole page, ignoring the view, so the rail can count what is hidden. */
  readonly counts: Tally;
  /** Over the visible rows only, which is what the footer is describing. */
  readonly footer: Tally;
  readonly sources: readonly string[];
  readonly selected: JournalEntry | null;
  readonly lines: readonly JournalLine[];
  readonly linesLoading: boolean;
  readonly accounts: readonly Account[];
  readonly periods: readonly FiscalPeriod[];
  readonly labelOf: (accountId: string | null) => string;
  readonly detailCurrency: Currency;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  readonly refetch: () => void;
}

export function useJournalPage(filter: JournalFilter, selectedId: string | null, tr: AppLocale['tr']): JournalPage {
  // The period is the one filter the broker can answer, so it is the only one sent.
  const page = useDataset('journalEntries', {
    limit: PAGE_LIMIT,
    orderBy: { column: 'entry_date', ascending: false },
    where: filter.periodId === null ? undefined : { fiscal_period_id: filter.periodId },
  });
  const entries = useMemo(() => {
    const out: JournalEntry[] = [];
    for (const row of page.rows) {
      const mapped = toEntry(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [page.rows]);

  const lineQuery = useMappedDataset('journalLines', toLine, {
    where: { journal_entry_id: selectedId ?? '' },
    enabled: selectedId !== null,
  });
  const accountQuery = useMappedDataset('accounts', toAccount, { limit: ACCOUNT_LIMIT });
  const periodQuery = useMappedDataset('fiscalPeriods', toPeriod, { limit: PERIOD_LIMIT });

  const visible = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  // Twice over the page: once ignoring the view, so the rail can say how many
  // drafts you are not looking at, and once over the visible rows for the footer.
  const counts = useMemo(() => tally(entries, filter), [entries, filter]);
  const footer = useMemo(() => tally(visible, filter), [visible, filter]);
  const sources = useMemo(() => sourcesOf(entries), [entries]);
  const selected = useMemo(() => visible.find((entry) => entry.id === selectedId) ?? null, [visible, selectedId]);
  // Lines belong to whatever is selected; a stale set from the previous selection
  // would put one entry's detail under another's header.
  const lines = useMemo(
    () => (selectedId === null ? [] : lineQuery.rows.filter((line) => line.entryId === selectedId)),
    [lineQuery.rows, selectedId],
  );

  const labels = useMemo(() => {
    const index = new Map<string, string>();
    for (const account of accountQuery.rows) index.set(account.id, accountLabel(account));
    return index;
  }, [accountQuery.rows]);
  const labelOf = useCallback(
    (accountId: string | null): string =>
      accountId === null ? tr('بدون حساب', 'Sans compte', 'No account') : (labels.get(accountId) ?? accountId),
    [labels, tr],
  );

  return {
    entries,
    visible,
    counts,
    footer,
    sources,
    selected,
    lines,
    linesLoading: lineQuery.loading,
    accounts: accountQuery.rows,
    periods: periodQuery.rows,
    labelOf,
    detailCurrency: lines.length === 0 ? BOOK_CURRENCY : toCurrency(lines[0].currency),
    loading: page.loading,
    error: page.error,
    fetchedAt: page.fetchedAt,
    refetch: page.refetch,
  };
}

