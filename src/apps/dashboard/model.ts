/**
 * Dashboard — the reads.
 *
 * Six queries, all unconditional, because a dashboard with a lazy half is a dashboard
 * that lies for a second and a half every morning. They are the cheapest six that can
 * answer "how does the book look": the trial balance for position and performance,
 * the entries for activity, the periods and the checklist for the close, the bank
 * accounts for cash, and the audit trail for who did what.
 *
 * Every query is shaped to land on a cache key another app already uses, so opening
 * this window next to Ledger or Inbox costs nothing:
 *
 *   • `trialBalance` at `PAGE_LIMIT` with no `orderBy` — Ledger's exact query.
 *   • `fiscalPeriods` at `PERIOD_LIMIT` by `start_date` desc — Inbox's.
 *   • `closeTasks` at `PAGE_LIMIT` by `task_name` asc — Inbox's.
 *
 * The trial balance is the one read through the raw hook, because the status bar says
 * when the book was last read and only `useDataset` carries `fetchedAt`. It is also
 * the read whose provenance matters most: the broker aggregates *posted* lines over
 * the whole book, so what this app calls position and performance is book-to-date and
 * cannot be windowed. The range selector scopes activity, which is entry-dated.
 *
 * Nothing here filters on the server beyond a page ceiling. The broker's `where`
 * speaks equality, `in` and `is null` — no ranges — so the date window is applied
 * over the page, in `metrics.ts`, where it can be reasoned about.
 */
import { useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type BankAccount,
  type CloseTask,
  type Currency,
  type FiscalPeriod,
  type JournalEntry,
  toBankAccount,
  toCloseTask,
  toEntry,
  toPeriod,
  type TrialRow,
  toTrialRow,
} from '../shared/ledger';
import {
  BANK_LIMIT,
  FEED_LIMIT,
  type FeedRow,
  PAGE_LIMIT,
  PERIOD_LIMIT,
  type RangeId,
  type Snapshot,
  snapshot,
  toFeedRow,
} from './metrics';

export interface DashboardModel {
  readonly snap: Snapshot;
  /** The audit trail, newest first — the activity page's feed. */
  readonly feed: readonly FeedRow[];
  /** True when one of the reads came back at its ceiling. */
  readonly truncated: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

export function useDashboardModel(range: RangeId, book: Currency, today: string): DashboardModel {
  const trialQuery = useDataset('trialBalance', { limit: PAGE_LIMIT });
  const trial = useMemo(() => {
    const out: TrialRow[] = [];
    for (const row of trialQuery.rows) {
      const mapped = toTrialRow(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [trialQuery.rows]);

  const entryQuery = useMappedDataset('journalEntries', toEntry, {
    limit: PAGE_LIMIT,
    orderBy: { column: 'entry_date', ascending: false },
  });
  const periodQuery = useMappedDataset('fiscalPeriods', toPeriod, {
    limit: PERIOD_LIMIT,
    orderBy: { column: 'start_date', ascending: false },
  });
  const taskQuery = useMappedDataset('closeTasks', toCloseTask, {
    limit: PAGE_LIMIT,
    orderBy: { column: 'task_name', ascending: true },
  });
  const bankQuery = useMappedDataset('bankAccounts', toBankAccount, {
    limit: BANK_LIMIT,
    orderBy: { column: 'name', ascending: true },
  });
  const feedQuery = useMappedDataset('auditTrail', toFeedRow, {
    limit: FEED_LIMIT,
    orderBy: { column: 'created_at', ascending: false },
  });

  // One derivation, one memo. Every card on every page reads from this value, so a
  // render that changed nothing recomputes nothing.
  const entries: readonly JournalEntry[] = entryQuery.rows;
  const periods: readonly FiscalPeriod[] = periodQuery.rows;
  const tasks: readonly CloseTask[] = taskQuery.rows;
  const banks: readonly BankAccount[] = bankQuery.rows;
  const snap = useMemo(
    () => snapshot({ trial, entries, periods, tasks, banks, range, book, today }),
    [trial, entries, periods, tasks, banks, range, book, today],
  );

  const refresh = () => {
    trialQuery.refetch();
    entryQuery.refetch();
    periodQuery.refetch();
    taskQuery.refetch();
    bankQuery.refetch();
    feedQuery.refetch();
  };

  return {
    snap,
    feed: feedQuery.rows,
    // The feed is deliberately short, so it is not counted here: "truncated" has to
    // mean "a total on screen may be incomplete", or the status bar cries wolf.
    truncated:
      trialQuery.rows.length >= PAGE_LIMIT ||
      entryQuery.rows.length >= PAGE_LIMIT ||
      taskQuery.rows.length >= PAGE_LIMIT,
    loading: trialQuery.loading || entryQuery.loading || periodQuery.loading || taskQuery.loading,
    error:
      trialQuery.error ??
      entryQuery.error ??
      periodQuery.error ??
      taskQuery.error ??
      bankQuery.error ??
      feedQuery.error,
    fetchedAt: trialQuery.fetchedAt,
    refresh,
  };
}
