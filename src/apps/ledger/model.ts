/**
 * Ledger — the reads, and everything derived from them.
 *
 * Four queries and one shape. This is a hook rather than a pile of `useMemo`s in
 * the shell because the derivation *is* the interesting part of this app: the chart
 * is a tree over one page of accounts, the roll-ups walk that tree against the
 * derived trial balance, and one account's general ledger is a third query joined
 * to a fourth for the dates and references its lines do not carry.
 *
 * The two per-selection queries are chained. `journalLines` comes back for the
 * account, then `journalEntries` is asked for exactly the entries those lines
 * belong to — an `in` over sorted ids, which the broker keys by content, so a
 * re-render with the same set of ids does not re-fetch.
 *
 * Nothing here is filtered on the server beyond the selection. The broker's `where`
 * speaks equality, `in` and `is null`, and a chart filter is a substring over two
 * columns plus a tree walk, so it is settled over the page instead. The status bar
 * is what tells a person the page is a window.
 */
import { useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type Account,
  type JournalEntry,
  toAccount,
  toEntry,
  toLine,
  type TrialRow,
  toTrialRow,
} from '../shared/ledger';
import {
  type ChartIndex,
  type ChartRow,
  type ChartTally,
  chartTally,
  entryIdsOf,
  filterTrial,
  flattenChart,
  indexAccounts,
  type LedgerFilter,
  PAGE_LIMIT,
  type Posting,
  POSTING_LIMIT,
  postingsOf,
  type Rollup,
  rollup,
  type RollupIndex,
  rollupOf,
  trialIndex,
  type TrialTotals,
  trialTotals,
  type TypeSlice,
  typeSlices,
} from './accounts';

export interface ChartModel {
  /** The page, in code order. */
  readonly accounts: readonly Account[];
  readonly index: ChartIndex;
  readonly rollups: RollupIndex;
  /** The derived trial balance, keyed by account, own figures only. */
  readonly trial: ReadonlyMap<string, TrialRow>;
  readonly rows: readonly ChartRow[];
  readonly tally: ChartTally;
  readonly trialRows: readonly TrialRow[];
  readonly totals: TrialTotals;
  readonly slices: readonly TypeSlice[];
  readonly selected: Account | null;
  readonly parent: Account | null;
  readonly childCount: number;
  readonly selectedTotals: Rollup;
  readonly postings: readonly Posting[];
  readonly loading: boolean;
  readonly postingsLoading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

export function useChartModel(
  filter: LedgerFilter,
  expanded: ReadonlySet<string>,
  selectedId: string | null,
): ChartModel {
  // The page is `useDataset` rather than `useMappedDataset` for one reason: the
  // status bar states when it last read the books, and only the raw hook carries
  // `fetchedAt`.
  const page = useDataset('accounts', {
    limit: PAGE_LIMIT,
    orderBy: { column: 'code', ascending: true },
  });
  const accounts = useMemo(() => {
    const out: Account[] = [];
    for (const row of page.rows) {
      const mapped = toAccount(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [page.rows]);

  const trialQuery = useMappedDataset('trialBalance', toTrialRow, { limit: PAGE_LIMIT });
  const lineQuery = useMappedDataset('journalLines', toLine, {
    where: { account_id: selectedId ?? '' },
    limit: POSTING_LIMIT,
    enabled: selectedId !== null,
  });
  const entryIds = useMemo(() => entryIdsOf(lineQuery.rows), [lineQuery.rows]);
  const entryQuery = useMappedDataset('journalEntries', toEntry, {
    where: { id: entryIds },
    limit: POSTING_LIMIT,
    enabled: entryIds.length > 0,
  });

  const trial = useMemo(() => trialIndex(trialQuery.rows), [trialQuery.rows]);
  const index = useMemo(() => indexAccounts(accounts), [accounts]);
  const rollups = useMemo(() => rollup(index, trial), [index, trial]);
  const rows = useMemo(() => flattenChart(accounts, filter, expanded, trial), [accounts, filter, expanded, trial]);
  const tally = useMemo(() => chartTally(accounts, filter, trial), [accounts, filter, trial]);
  const trialRows = useMemo(() => filterTrial(trialQuery.rows, filter, index.byId), [trialQuery.rows, filter, index.byId]);
  const totals = useMemo(() => trialTotals(trialRows), [trialRows]);
  // The overview describes the book, not the filter, so it reads the whole page.
  const slices = useMemo(() => typeSlices(trialQuery.rows), [trialQuery.rows]);

  const selected = selectedId === null ? null : index.byId.get(selectedId) ?? null;
  const parent =
    selected === null || selected.parentId === null ? null : index.byId.get(selected.parentId) ?? null;
  const childCount = selected === null ? 0 : (index.children.get(selected.id) ?? []).length;
  const selectedTotals = rollupOf(rollups, selected?.id ?? '');

  const entries = useMemo(() => {
    const out = new Map<string, JournalEntry>();
    for (const entry of entryQuery.rows) out.set(entry.id, entry);
    return out;
  }, [entryQuery.rows]);
  // Lines belong to whatever is selected. A set left over from the previous
  // selection would put one account's ledger under another's header.
  const postings = useMemo(() => {
    if (selected === null) return [];
    const mine = lineQuery.rows.filter((line) => line.accountId === selected.id);
    return postingsOf(mine, entries, selected.type);
  }, [entries, lineQuery.rows, selected]);

  const refresh = () => {
    page.refetch();
    trialQuery.refetch();
    lineQuery.refetch();
    entryQuery.refetch();
  };

  return {
    accounts,
    index,
    rollups,
    trial,
    rows,
    tally,
    trialRows,
    totals,
    slices,
    selected,
    parent,
    childCount,
    selectedTotals,
    postings,
    loading: page.loading || trialQuery.loading,
    postingsLoading: lineQuery.loading || entryQuery.loading,
    error: page.error ?? trialQuery.error,
    fetchedAt: page.fetchedAt,
    refresh,
  };
}
