/**
 * Journal — the view over the entry list.
 *
 * Everything in this file is a pure function of the page the broker returned. It
 * exists because of a boundary the broker draws: `where` can express equality,
 * `in` and `is null`, and nothing else. A period is an equality, so it is pushed
 * down and the server pages on it. A date *range*, a substring, "unbalanced" and
 * the four-state lifecycle are not, so they are settled here, over the page.
 *
 * Two consequences worth stating, because they are visible in the UI:
 *
 *   • The status chips can carry counts. A query already narrowed to `posted`
 *     could never report how many drafts it had left behind.
 *   • The page is capped at 500 rows by the broker, so the status bar says when
 *     the list it is describing is a window rather than the whole book.
 */
import { csvDocument } from '../shared/csv';
import type { JournalEntry, JournalLine } from '../shared/ledger';
import { EPSILON, type EntryStatus, isBalanced } from '../shared/ledger';

/** The broker's hard page ceiling. Mirrored here so the status bar can say so. */
export const PAGE_LIMIT = 500;

/** Left-rail views: the four lifecycle states, plus everything. */
export type ViewId = 'all' | EntryStatus;

export const VIEWS: readonly ViewId[] = ['all', 'draft', 'pending', 'posted', 'void'];

export interface JournalFilter {
  readonly view: ViewId;
  /** Matched against reference, description and source. */
  readonly search: string;
  /** ISO `yyyy-mm-dd`, inclusive. Empty means unbounded. */
  readonly from: string;
  readonly to: string;
  /** Pushed down to the broker as `fiscal_period_id`. */
  readonly periodId: string | null;
  readonly source: string | null;
  readonly unbalancedOnly: boolean;
}

export const DEFAULT_FILTER: JournalFilter = {
  view: 'all',
  search: '',
  from: '',
  to: '',
  periodId: null,
  source: null,
  unbalancedOnly: false,
};

/**
 * Whether anything beyond the chosen view is narrowing the list.
 *
 * The view itself is not a filter in this sense — it is where you are — so
 * switching to Drafts does not light up "clear filters".
 */
export const isFiltered = (filter: JournalFilter): boolean =>
  filter.search.trim() !== '' ||
  filter.from !== '' ||
  filter.to !== '' ||
  filter.source !== null ||
  filter.unbalancedOnly;

/** Filters other than the view and the period, which are settled elsewhere. */
function passesDetail(entry: JournalEntry, filter: JournalFilter, needle: string): boolean {
  if (filter.from !== '' && entry.date < filter.from) return false;
  if (filter.to !== '' && entry.date > filter.to) return false;
  if (filter.source !== null && entry.sourceType !== filter.source) return false;
  if (filter.unbalancedOnly && isBalanced(entry)) return false;
  if (needle === '') return true;
  return (
    entry.reference.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.sourceType.toLowerCase().includes(needle)
  );
}

export function matches(entry: JournalEntry, filter: JournalFilter): boolean {
  if (filter.view !== 'all' && entry.status !== filter.view) return false;
  return passesDetail(entry, filter, filter.search.trim().toLowerCase());
}

export function filterEntries(
  entries: readonly JournalEntry[],
  filter: JournalFilter,
): readonly JournalEntry[] {
  const needle = filter.search.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (filter.view === 'all' || entry.status === filter.view) && passesDetail(entry, filter, needle),
  );
}

/* ------------------------------------------------------------------ *
 * Counts and totals
 * ------------------------------------------------------------------ */

export interface Tally {
  /** Per-view counts, ignoring the view but honouring every other filter. */
  readonly counts: Readonly<Record<ViewId, number>>;
  readonly debit: number;
  readonly credit: number;
  /** Entries whose two sides disagree by more than half a centime. */
  readonly unbalanced: number;
}

const ZERO: Readonly<Record<ViewId, number>> = { all: 0, draft: 0, pending: 0, posted: 0, void: 0 };

/**
 * Counts every view at once.
 *
 * The totals deliberately follow the *visible* rows and not the tally: a footer
 * that sums drafts you are not looking at is a footer nobody trusts. So this is
 * called twice — once without the view for the chips, once with it for the
 * footer — which costs one pass over at most 500 rows.
 */
export function tally(entries: readonly JournalEntry[], filter: JournalFilter): Tally {
  const counts = { ...ZERO };
  let debit = 0;
  let credit = 0;
  let broken = 0;
  const needle = filter.search.trim().toLowerCase();
  for (const entry of entries) {
    if (!passesDetail(entry, filter, needle)) continue;
    counts.all += 1;
    counts[entry.status] += 1;
    debit += entry.debit;
    credit += entry.credit;
    if (!isBalanced(entry)) broken += 1;
  }
  return { counts, debit, credit, unbalanced: broken };
}

/** Sums the two sides of whatever is on screen. */
export function totalsOf(entries: readonly JournalEntry[]): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    debit += entry.debit;
    credit += entry.credit;
  }
  return { debit, credit };
}

/** Distinct `source_type` values in the page, for the source filter. */
export function sourcesOf(entries: readonly JournalEntry[]): readonly string[] {
  const seen = new Set<string>();
  for (const entry of entries) if (entry.sourceType !== '') seen.add(entry.sourceType);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Entry counts per day, oldest first, for the volume sparkline.
 *
 * `today` is passed in rather than read from the clock so the series is a
 * function of its inputs — the same page renders the same chart in a test.
 */
export function volumeByDay(entries: readonly JournalEntry[], today: string, days: number): readonly number[] {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const index = new Map<string, number>();
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    index.set(day.toISOString().slice(0, 10), offset);
  }
  const series = new Array<number>(days).fill(0);
  for (const entry of entries) {
    const at = index.get(entry.date.slice(0, 10));
    if (at !== undefined) series[at] += 1;
  }
  return series;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

const CSV_HEADER = [
  'date',
  'reference',
  'description',
  'status',
  'source',
  'debit',
  'credit',
  'period',
  'posted_at',
];

/**
 * The entry list as CSV.
 *
 * Values are raw: ISO dates and unformatted decimals, not `1 250,00 DA`. A CSV
 * is read by a spreadsheet, and a spreadsheet that has to guess whether `1.250`
 * is one thousand or one and a quarter will guess wrong in one of the two
 * languages this OS runs in.
 */
export function entriesCsv(entries: readonly JournalEntry[]): string {
  return csvDocument(
    CSV_HEADER,
    entries.map((entry) => [
      entry.date,
      entry.reference,
      entry.description,
      entry.status,
      entry.sourceType,
      entry.debit.toFixed(2),
      entry.credit.toFixed(2),
      entry.periodId ?? '',
      entry.postedAt ?? '',
    ]),
  );
}

/**
 * One entry and its lines as tab-separated text, for pasting into Sheets.
 *
 * Tabs rather than commas because that is what a paste into a grid splits on,
 * and because an account label legitimately contains a comma.
 */
export function entryClipboardText(
  entry: JournalEntry,
  lines: readonly JournalLine[],
  labelOf: (accountId: string | null) => string,
): string {
  const head = [entry.date, entry.reference, entry.description, entry.status].join('\t');
  const body = lines.map((line) =>
    ['', labelOf(line.accountId), line.memo, line.debit.toFixed(2), line.credit.toFixed(2)].join('\t'),
  );
  const foot = ['', '', '', entry.debit.toFixed(2), entry.credit.toFixed(2)].join('\t');
  return [head, ...body, foot].join('\n');
}

/* ------------------------------------------------------------------ *
 * Line-level helpers
 * ------------------------------------------------------------------ */

/** Sums the lines of one entry — used to check the header against its detail. */
export function lineTotals(lines: readonly JournalLine[]): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += line.debit;
    credit += line.credit;
  }
  return { debit, credit };
}

/**
 * Whether the header totals agree with the lines that were loaded.
 *
 * A disagreement is not a rounding question, it is a projection that is out of
 * step with itself, so it is reported rather than smoothed over. Only meaningful
 * once the lines have actually arrived, hence the empty-list guard.
 */
export function headerMatchesLines(entry: JournalEntry, lines: readonly JournalLine[]): boolean {
  if (lines.length === 0) return true;
  const sum = lineTotals(lines);
  return Math.abs(sum.debit - entry.debit) < EPSILON && Math.abs(sum.credit - entry.credit) < EPSILON;
}
