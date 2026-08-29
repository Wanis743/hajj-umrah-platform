/**
 * Inbox — the reads.
 *
 * Four queries for the queues and two more for whatever is selected. The four are
 * unconditional because the rail counts all three queues at once — a badge that
 * only fills in after you visit the queue is a badge nobody trusts — and because
 * the approvals queue cannot be assembled without the periods: an entry's block
 * depends on the period covering its date, which is a different row.
 *
 * Two filters are pushed to the server, both as `in` over module constants so the
 * broker's content-keyed cache sees one query rather than one per render: the entry
 * statuses that are still open, and the four audit actions that count as decisions.
 * Everything else — the search, "only mine", the ageing — is settled over the page,
 * because the broker's `where` speaks equality, `in` and `is null`, and none of
 * those three is any of them.
 *
 * The accounts query is deliberately shaped like Ledger's, down to the ordering:
 * same dataset, same limit, same `orderBy` means the same cache key, so opening a
 * journal entry in this window costs nothing if the chart is already loaded.
 */
import { useCallback, useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type Account,
  accountLabel,
  type CloseTask,
  type Currency,
  type FiscalPeriod,
  type JournalEntry,
  type JournalLine,
  toAccount,
  toCloseTask,
  toEntry,
  toLine,
  toPeriod,
} from '../shared/ledger';
import {
  buildItems,
  DECISION_ACTIONS,
  DECISION_LIMIT,
  type DependencyState,
  dependencyState,
  filterItems,
  type InboxFilter,
  type InboxTally,
  LINE_LIMIT,
  OPEN_ENTRY_STATUS,
  PAGE_LIMIT,
  periodFor,
  tally,
  taskIndex,
  toDecision,
  type Viewer,
  type WorkItem,
} from './queue';

/** Fiscal periods are a short list; a book with more than this has other problems. */
const PERIOD_LIMIT = 200;

export interface InboxModel {
  /** All three queues, unfiltered — what the rail badges count. */
  readonly items: readonly WorkItem[];
  /** The current queue, filtered — what the grid shows. */
  readonly visible: readonly WorkItem[];
  readonly tally: InboxTally;
  readonly selected: WorkItem | null;
  /** Lines of the selected entry, empty for anything else. */
  readonly lines: readonly JournalLine[];
  accountLabelOf: (accountId: string | null) => string;
  /** The period covering the selected entry's date, or null when none does. */
  readonly period: FiscalPeriod | null;
  /** Resolved dependencies of the selected close task. */
  readonly dependencies: DependencyState | null;
  /**
   * Close tasks by name, so the reading pane can put a status against every
   * dependency it lists. Keyed by name because `dependencies` holds names.
   */
  readonly tasks: ReadonlyMap<string, CloseTask>;
  /** True when one of the three sources came back at its ceiling. */
  readonly truncated: boolean;
  readonly loading: boolean;
  readonly linesLoading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

export function useInboxModel(
  filter: InboxFilter,
  selectedKey: string | null,
  viewer: Viewer,
  currency: Currency,
  today: string,
): InboxModel {
  // `useDataset` rather than `useMappedDataset` for the queue that matters most:
  // the status bar states when the books were last read, and only the raw hook
  // carries `fetchedAt`.
  const page = useDataset('journalEntries', {
    where: { status: OPEN_ENTRY_STATUS },
    limit: PAGE_LIMIT,
    orderBy: { column: 'entry_date', ascending: true },
  });
  const entries = useMemo(() => {
    const out: JournalEntry[] = [];
    for (const row of page.rows) {
      const mapped = toEntry(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [page.rows]);

  const taskQuery = useMappedDataset('closeTasks', toCloseTask, {
    limit: PAGE_LIMIT,
    orderBy: { column: 'task_name', ascending: true },
  });
  const periodQuery = useMappedDataset('fiscalPeriods', toPeriod, {
    limit: PERIOD_LIMIT,
    orderBy: { column: 'start_date', ascending: false },
  });
  const decisionQuery = useMappedDataset('auditTrail', toDecision, {
    where: { action: DECISION_ACTIONS },
    limit: DECISION_LIMIT,
    orderBy: { column: 'created_at', ascending: false },
  });

  const tasks = useMemo(() => taskIndex(taskQuery.rows), [taskQuery.rows]);
  const context = useMemo(
    () => ({ viewer, periods: periodQuery.rows, tasks, currency, today }),
    [viewer, periodQuery.rows, tasks, currency, today],
  );
  const items = useMemo(
    () => buildItems(entries, taskQuery.rows, decisionQuery.rows, context),
    [entries, taskQuery.rows, decisionQuery.rows, context],
  );
  const visible = useMemo(() => filterItems(items, filter), [items, filter]);
  const counts = useMemo(() => tally(items), [items]);

  const selected = useMemo(
    () => (selectedKey === null ? null : items.find((item) => item.key === selectedKey) ?? null),
    [items, selectedKey],
  );
  const entryId = selected?.entry?.id ?? null;

  const lineQuery = useMappedDataset('journalLines', toLine, {
    where: { journal_entry_id: entryId ?? '' },
    limit: LINE_LIMIT,
    enabled: entryId !== null,
  });
  // Only the chart's labels are wanted, and only once something is open — so this
  // stays disabled until then, and when it runs it runs on Ledger's cache key.
  const accountQuery = useMappedDataset('accounts', toAccount, {
    limit: PAGE_LIMIT,
    orderBy: { column: 'code', ascending: true },
    enabled: entryId !== null,
  });
  const accountsById = useMemo(() => {
    const out = new Map<string, Account>();
    for (const account of accountQuery.rows) out.set(account.id, account);
    return out;
  }, [accountQuery.rows]);
  const accountLabelOf = useCallback(
    (accountId: string | null): string => {
      if (accountId === null) return '—';
      const account = accountsById.get(accountId);
      return account === undefined ? accountId.slice(0, 8) : accountLabel(account);
    },
    [accountsById],
  );

  // Lines belong to whatever is selected. A set left over from the previous
  // selection would put one entry's detail under another's header.
  const lines = useMemo(
    () => (entryId === null ? [] : lineQuery.rows.filter((line) => line.entryId === entryId)),
    [entryId, lineQuery.rows],
  );

  const period = useMemo(
    () =>
      selected === null || selected.entry === null
        ? null
        : periodFor(periodQuery.rows, selected.entry.date),
    [periodQuery.rows, selected],
  );
  const dependencies = useMemo(
    () => (selected === null || selected.task === null ? null : dependencyState(selected.task, tasks)),
    [selected, tasks],
  );

  const refresh = () => {
    page.refetch();
    taskQuery.refetch();
    periodQuery.refetch();
    decisionQuery.refetch();
    lineQuery.refetch();
    accountQuery.refetch();
  };

  return {
    items,
    visible,
    tally: counts,
    selected,
    lines,
    accountLabelOf,
    period,
    dependencies,
    tasks,
    truncated:
      page.rows.length >= PAGE_LIMIT ||
      taskQuery.rows.length >= PAGE_LIMIT ||
      decisionQuery.rows.length >= DECISION_LIMIT,
    loading: page.loading || taskQuery.loading || decisionQuery.loading,
    linesLoading: lineQuery.loading || accountQuery.loading,
    error: page.error ?? taskQuery.error ?? periodQuery.error ?? decisionQuery.error,
    fetchedAt: page.fetchedAt,
    refresh,
  };
}


