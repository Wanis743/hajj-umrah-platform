/**
 * Profitability — the reads, and the naming problem.
 *
 * Every figure in this app is walked here rather than aggregated by the kernel,
 * because there is no derive that carries an analytical tag: the trial balance is
 * summed per account and knows nothing about packages. So one page of entries and
 * one page of postings are fetched newest-first and the window is applied in
 * memory. Those pages have a ceiling, which makes every figure a lower bound when
 * one comes back full — and the window says so out loud instead of quietly
 * reporting a smaller margin.
 *
 * That also means the whole-book basis costs exactly what the period basis costs.
 * It is offered anyway, because "which package has ever made money" is a fair
 * question, and it is honest about being bounded in the same words.
 *
 * The naming problem is the interesting part. Postings carry a `package_id` and a
 * `branch_id`, and nothing exposed to an app resolves either into a name — there
 * is no packages dataset and no branches dataset. What there is, is `groups`: the
 * departures, each of which names the package it belongs to. So a package is
 * labelled by the departures booked against it, which is what an operator
 * recognises anyway, and a branch is labelled by the stem of its id with the
 * window admitting as much. A report that invented a name would be worse than one
 * that shows an id.
 */
import { useMemo } from 'react';
import { type DatasetRow, useDataset, useLocale, useMappedDataset } from '@/platform/sdk';
import { asNumber, asString, num, status, str } from '../shared/guards';
import {
  byRecency,
  type FiscalPeriod,
  type JournalEntry,
  monthBefore,
  monthPeriod,
  toAccount,
  toEntry,
  toLine,
  toPeriod,
  windowOf,
} from '../shared/ledger';
import {
  EMPTY_SLICE,
  isSilent,
  matches,
  type MemberFigure,
  type MemberName,
  type Slice,
  sliceFigures,
} from './figures';
import type { Question } from './question';
import type { Translate } from './report';

/* ------------------------------------------------------------------ *
 * Ceilings
 * ------------------------------------------------------------------ */

/** The chart of accounts: a posting whose account is not here cannot be classified. */
export const ACCOUNT_LIMIT = 500;
/** Fiscal periods, for the window selector. */
export const PERIOD_LIMIT = 200;
/** The newest page of entries. Every figure in the app is assembled out of this. */
export const ENTRY_LIMIT = 500;
/** The postings beneath them. */
export const POSTING_LIMIT = 500;
/** Departures, read only to put names on package ids. */
export const DEPARTURE_LIMIT = 200;

/* ------------------------------------------------------------------ *
 * Departures, which is where package names come from
 * ------------------------------------------------------------------ */

/**
 * A departure, as much of one as naming a package needs.
 *
 * The projection is the whole `groups` row, so this reads the four fields that
 * identify a departure to somebody who runs them and ignores the rest.
 */
export interface Departure {
  readonly id: string;
  readonly packageId: string | null;
  readonly code: string;
  readonly name: string;
  readonly departure: string | null;
  readonly status: string;
  readonly capacity: number;
  readonly booked: number;
}

export function toDeparture(row: DatasetRow): Departure | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    packageId: asString(row.package_id),
    code: str(row.code),
    name: str(row.name),
    departure: asString(row.departure_date),
    status: status(row.status),
    capacity: asNumber(row.max_capacity) ?? 0,
    booked: num(row.current_capacity),
  };
}

/** How many departure codes fit in a label before it stops being one. */
const LABEL_CAP = 3;

/**
 * Package ids, named by the departures booked against them.
 *
 * Codes rather than the package's own name, which is not exposed to an app: a
 * departure code is what an operator recognises, and three of them is as many as
 * fits on a row before the label stops being readable. The detail line carries the
 * count and the earliest departure, so a label that had to be truncated still says
 * how much it is hiding.
 */
function packageNames(departures: readonly Departure[], tr: Translate): Map<string, MemberName> {
  const grouped = new Map<string, Departure[]>();
  for (const departure of departures) {
    if (departure.packageId === null) continue;
    const list = grouped.get(departure.packageId) ?? [];
    list.push(departure);
    grouped.set(departure.packageId, list);
  }

  const out = new Map<string, MemberName>();
  for (const [packageId, list] of grouped) {
    const sorted = [...list].sort((left, right) => left.code.localeCompare(right.code));
    const codes = sorted.map((one) => one.code).filter((code) => code !== '');
    const head = codes.slice(0, LABEL_CAP).join(', ');
    const rest = codes.length - LABEL_CAP;
    let first: string | null = null;
    for (const one of sorted) {
      if (one.departure !== null && (first === null || one.departure < first)) first = one.departure;
    }
    const count = tr(
      `${sorted.length} رحلة`,
      `${sorted.length} départ(s)`,
      `${sorted.length} departure(s)`,
    );
    out.set(packageId, {
      label: head === '' ? packageId : rest > 0 ? `${head} +${rest}` : head,
      detail: first === null ? count : `${count} · ${first.slice(0, 10)}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The filter, and what it holds back
 * ------------------------------------------------------------------ */

/**
 * Which rows print.
 *
 * Both controls are finds rather than scopes: the totals on the rail are summed
 * over every member, so a percentage does not move while somebody is typing. The
 * remainder is appended rather than ranked, because it is not competing with the
 * members above it — it is the part of the book they fail to cover.
 */
function shown(slice: Slice, question: Question): {
  readonly rows: readonly MemberFigure[];
  readonly hidden: number;
} {
  const needle = question.search.trim().toLowerCase();
  const rows: MemberFigure[] = [];
  let hidden = 0;
  for (const member of slice.members) {
    if ((!question.showSilent && isSilent(member)) || !matches(member, needle)) {
      hidden += 1;
      continue;
    }
    rows.push(member);
  }
  if (slice.untagged !== null && matches(slice.untagged, needle)) rows.push(slice.untagged);
  return { rows, hidden };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

export interface ProfitabilityModel {
  readonly slice: Slice;
  /** The rows the table prints, after the search box and the silence filter. */
  readonly rows: readonly MemberFigure[];
  /** Members the filter is holding back. Every total still counts them. */
  readonly hidden: number;
  /** The member the pane describes, resolved over the whole slice so typing cannot clear it. */
  readonly selected: MemberFigure | null;
  /** Departures, for the pane to list the ones behind a package. */
  readonly departures: readonly Departure[];
  readonly periods: readonly FiscalPeriod[];
  /** The window in force: a period row, or the month the book was last written up in. */
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  /** True when a page came back full: every figure is then a lower bound. */
  readonly bounded: boolean;
  readonly coveredFrom: string | null;
  /** Members nothing could name, shown by the stem of their id. */
  readonly unnamed: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

/**
 * Everything the window renders, from the question it was asked.
 *
 * The question is the only argument, which is what keeps the toolbar and the
 * figures from ever describing different reports. Departures are fetched only on
 * the package dimension, because they exist here to put names on ids and a branch
 * report has no use for them.
 */
export function useProfitabilityModel(
  question: Question,
  selectedKey: string | null,
): ProfitabilityModel {
  const { tr } = useLocale();
  const { basis, compare, dimension, sort, periodId } = question;

  const periodQuery = useMappedDataset('fiscalPeriods', toPeriod, { limit: PERIOD_LIMIT });
  const accountQuery = useMappedDataset('accounts', toAccount, { limit: ACCOUNT_LIMIT });
  const departureQuery = useMappedDataset('groups', toDeparture, {
    limit: DEPARTURE_LIMIT,
    enabled: dimension === 'package',
  });

  // Raw rather than mapped: this is the query the status bar dates the book by, and
  // only `useDataset` carries a `fetchedAt`.
  const entryPage = useDataset('journalEntries', {
    limit: ENTRY_LIMIT,
    orderBy: { column: 'entry_date', ascending: false },
  });
  // Drafts come back with the page and are dropped by the walk, not here: the oldest
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
    enabled: ids.length > 0,
  });

  const periods = useMemo(() => byRecency(periodQuery.rows), [periodQuery.rows]);

  /**
   * The window, and what it is measured against.
   *
   * A named period wins; failing that the newest one on record; failing that the
   * month the newest posting landed in. The comparison is the next row down in date
   * order, and when the chosen period is the oldest the book has there is none — an
   * empty column being the honest answer rather than a quarter held up against a
   * month.
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

  const comparison = basis === 'period' && compare ? frame.comparison : null;

  const names = useMemo(
    () =>
      dimension === 'package'
        ? packageNames(departureQuery.rows, tr)
        : new Map<string, MemberName>(),
    [departureQuery.rows, dimension, tr],
  );

  const untagged = useMemo<MemberName>(
    () => ({
      label: tr('غير مخصَّص', 'Non affecté', 'Unallocated'),
      detail:
        dimension === 'package'
          ? tr('قيود بلا باقة', 'Écritures sans forfait', 'Postings with no package')
          : tr('قيود بلا فرع', 'Écritures sans succursale', 'Postings with no branch'),
    }),
    [dimension, tr],
  );

  const slice = useMemo(() => {
    if (accountQuery.rows.length === 0) return EMPTY_SLICE;
    return sliceFigures({
      accounts: accountQuery.rows,
      entries,
      lines: linePage.rows,
      dimension,
      names,
      untagged,
      period: basis === 'book' || frame.period === null ? null : windowOf(frame.period),
      compare: comparison === null ? null : windowOf(comparison),
      sort,
    });
  }, [
    accountQuery.rows,
    basis,
    comparison,
    dimension,
    entries,
    frame.period,
    linePage.rows,
    names,
    sort,
    untagged,
  ]);

  const table = useMemo(() => shown(slice, question), [question, slice]);

  // Resolved over the whole slice rather than over the printed rows, so filtering a
  // member out of the table does not empty the pane describing it.
  const selected = useMemo(() => {
    if (selectedKey === null) return null;
    if (slice.untagged !== null && slice.untagged.key === selectedKey) return slice.untagged;
    return slice.members.find((member) => member.key === selectedKey) ?? null;
  }, [selectedKey, slice]);

  const unnamed = useMemo(
    () => slice.members.filter((member) => !names.has(member.key)).length,
    [names, slice.members],
  );

  const refresh = () => {
    periodQuery.refetch();
    accountQuery.refetch();
    departureQuery.refetch();
    entryPage.refetch();
    linePage.refetch();
  };

  return {
    slice,
    rows: table.rows,
    hidden: table.hidden,
    selected,
    departures: departureQuery.rows,
    periods,
    period: basis === 'book' ? null : frame.period,
    comparison,
    // Asked of both bases, because both are walked. A full page means the oldest
    // postings never arrived, so every figure above is a floor.
    bounded: entryPage.rows.length >= ENTRY_LIMIT || linePage.rows.length >= POSTING_LIMIT,
    coveredFrom: slice.reachedFrom,
    unnamed,
    loading:
      accountQuery.loading ||
      entryPage.loading ||
      linePage.loading ||
      (dimension === 'package' && departureQuery.loading),
    error:
      periodQuery.error ??
      accountQuery.error ??
      departureQuery.error ??
      entryPage.error ??
      linePage.error,
    fetchedAt: entryPage.fetchedAt,
    refresh,
  };
}
