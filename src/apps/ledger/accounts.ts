/**
 * Ledger — the view over the chart of accounts.
 *
 * Pure functions over the page the broker returned. Three things live here that
 * the components must not have to know:
 *
 *   • **The tree.** `chart_of_accounts.parent_id` is self-referencing, so the
 *     chart arrives flat and is rebuilt here. A parent may be missing from the
 *     page — the broker caps at 500 rows — so an account whose parent is not on
 *     the page is treated as a root rather than dropped. An account nobody can see
 *     is worse than one shown at the wrong depth, and the count is reported.
 *
 *   • **The roll-up.** A parent in a chart of accounts usually carries no postings
 *     of its own; `4000 Revenue` is worth reading because of what is under it. So
 *     every node gets its subtree's debits and credits, and the balance is signed
 *     by *its own* nature rather than by summing children's signed balances.
 *
 *   • **What the trial balance actually is.** The broker derives it from at most
 *     4000 journal lines and does not filter by entry status: a draft that has not
 *     been posted still moves these numbers. That is why the status bar states the
 *     difference instead of assuming zero, and why nothing here calls it a closing
 *     balance.
 */
import { csvDocument } from '../shared/csv';
import {
  type Account,
  type AccountType,
  ACCOUNT_TYPES,
  type EntryStatus,
  type JournalEntry,
  type JournalLine,
  type TrialRow,
  isDebitNatured,
} from '../shared/ledger';

/** The broker's hard page ceiling, mirrored so the status bar can say so. */
export const PAGE_LIMIT = 500;

/**
 * How many journal lines the broker folds into the trial balance. Stated here
 * because a chart of 500 accounts over 4000 lines is a page, not a year.
 */
export const DERIVE_LIMIT = 4000;

/** How many postings one account's ledger asks for. */
export const POSTING_LIMIT = 300;

/** Half a centime: enough to survive a JSON round trip, too little to hide an error. */
export const EPSILON = 0.005;

/* ------------------------------------------------------------------ *
 * Filter
 * ------------------------------------------------------------------ */

/** The two ways of reading the same accounts: as a tree, or as a balance. */
export type LedgerView = 'chart' | 'trial';

export const LEDGER_VIEWS: readonly LedgerView[] = ['chart', 'trial'];

export interface LedgerFilter {
  readonly view: LedgerView;
  /** Matched against code and name. */
  readonly search: string;
  readonly type: AccountType | null;
  /** Deactivated accounts are hidden until asked for; they are still in the books. */
  readonly showInactive: boolean;
  /** Only accounts something has actually been posted to. */
  readonly withActivityOnly: boolean;
}

export const DEFAULT_FILTER: LedgerFilter = {
  view: 'chart',
  search: '',
  type: null,
  showInactive: false,
  withActivityOnly: false,
};

/**
 * Whether anything other than the view is changing what is listed.
 *
 * `showInactive` counts even though it widens rather than narrows: "clear" means
 * back to the default reading of the chart, and hidden inactive accounts are part
 * of that default.
 */
export const isFiltered = (filter: LedgerFilter): boolean =>
  filter.search.trim() !== '' ||
  filter.type !== null ||
  filter.showInactive ||
  filter.withActivityOnly;

/**
 * Whether the filter, rather than the person, is deciding what is open.
 *
 * `showInactive` is absent on purpose: it adds rows without narrowing anything, so
 * it has no business re-opening a branch somebody collapsed by hand. The chart's
 * chevrons read this too, and stop offering a click they would lose.
 */
export const autoExpands = (filter: LedgerFilter): boolean =>
  filter.search.trim() !== '' || filter.type !== null || filter.withActivityOnly;

/* ------------------------------------------------------------------ *
 * Indexing
 * ------------------------------------------------------------------ */

/** Children of the top level, and of any account whose parent is off the page. */
const ROOT = '';

/**
 * Account codes sort as numbers where they can.
 *
 * A chart is numbered, so `9` belongs after `10` only to a plain string sort.
 * `numeric` collation puts `1000, 1200, 4000` in the order an accountant wrote
 * them, and still handles `4000-A` sensibly.
 */
export const byCode = (a: Account, b: Account): number =>
  a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name);

export interface ChartIndex {
  readonly byId: ReadonlyMap<string, Account>;
  /** Direct children by parent id, code-sorted; roots and orphans under `''`. */
  readonly children: ReadonlyMap<string, readonly Account[]>;
  readonly roots: readonly Account[];
  /** Accounts naming a parent that is not on this page. */
  readonly orphans: readonly Account[];
}

export function indexAccounts(accounts: readonly Account[]): ChartIndex {
  const byId = new Map<string, Account>();
  for (const account of accounts) byId.set(account.id, account);

  const buckets = new Map<string, Account[]>();
  const orphans: Account[] = [];
  for (const account of accounts) {
    const parent = account.parentId;
    // A parent off the page would otherwise take its whole subtree with it.
    const known = parent !== null && byId.has(parent);
    if (parent !== null && !known) orphans.push(account);
    const key = known ? parent : ROOT;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [account]);
    else bucket.push(account);
  }
  for (const bucket of buckets.values()) bucket.sort(byCode);

  return {
    byId,
    children: buckets,
    roots: buckets.get(ROOT) ?? [],
    orphans,
  };
}

/** Ids of every account something is filed under — what "expand all" opens. */
export function branchIds(accounts: readonly Account[]): readonly string[] {
  const index = indexAccounts(accounts);
  const out: string[] = [];
  for (const [key, bucket] of index.children) {
    if (key !== ROOT && bucket.length > 0) out.push(key);
  }
  return out;
}

/**
 * Would making `candidate` the parent of `account` close a loop?
 *
 * The RPC refuses an account that is its own parent and nothing more, so a chain
 * — A under B under A — has to be caught here. Walks up from the candidate with a
 * visit guard, because the data it is checking may already contain a cycle.
 */
export function wouldCycle(
  accounts: readonly Account[],
  accountId: string,
  candidateParentId: string | null,
): boolean {
  if (candidateParentId === null) return false;
  if (candidateParentId === accountId) return true;
  const byId = new Map(accounts.map((account) => [account.id, account] as const));
  const seen = new Set<string>();
  let cursor: string | null = candidateParentId;
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === accountId) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Roll-up
 * ------------------------------------------------------------------ */

export interface Rollup {
  /** Subtree debits and credits, this account included. */
  readonly debit: number;
  readonly credit: number;
  /** Signed by this account's own nature: positive means "more of itself". */
  readonly balance: number;
  readonly lines: number;
  /** This account's own balance, descendants excluded. */
  readonly own: number;
  /** True when descendants contributed, so the UI can say "including children". */
  readonly rolled: boolean;
}

export type RollupIndex = ReadonlyMap<string, Rollup>;

const EMPTY_ROLLUP: Rollup = { debit: 0, credit: 0, balance: 0, lines: 0, own: 0, rolled: false };

/** Trial-balance rows by account id, which is how every other read joins to them. */
export function trialIndex(rows: readonly TrialRow[]): ReadonlyMap<string, TrialRow> {
  const out = new Map<string, TrialRow>();
  for (const row of rows) out.set(row.accountId, row);
  return out;
}

/**
 * Every account's subtree totals.
 *
 * The balance is recomputed from the summed sides rather than by adding children's
 * signed balances: a debit-natured parent with a credit-natured child would
 * otherwise net two conventions against each other and report a number that is
 * neither. Post-order with a visit guard, because `parent_id` is a plain column
 * and nothing in the schema forbids a loop.
 */
export function rollup(index: ChartIndex, trial: ReadonlyMap<string, TrialRow>): RollupIndex {
  const out = new Map<string, Rollup>();
  const guard = new Set<string>();
  const visit = (id: string): Rollup => {
    const cached = out.get(id);
    if (cached !== undefined) return cached;
    if (guard.has(id)) return EMPTY_ROLLUP;
    guard.add(id);
    const own = trial.get(id);
    let debit = own?.debit ?? 0;
    let credit = own?.credit ?? 0;
    let lines = own?.lines ?? 0;
    let rolled = false;
    for (const child of index.children.get(id) ?? []) {
      const sub = visit(child.id);
      debit += sub.debit;
      credit += sub.credit;
      lines += sub.lines;
      rolled = true;
    }
    guard.delete(id);
    const type = index.byId.get(id)?.type ?? 'ASSET';
    const entry: Rollup = {
      debit,
      credit,
      balance: isDebitNatured(type) ? debit - credit : credit - debit,
      lines,
      own: own?.balance ?? 0,
      rolled,
    };
    out.set(id, entry);
    return entry;
  };
  for (const account of index.byId.values()) visit(account.id);
  return out;
}

export const rollupOf = (rollups: RollupIndex, id: string): Rollup => rollups.get(id) ?? EMPTY_ROLLUP;

/* ------------------------------------------------------------------ *
 * Chart rows
 * ------------------------------------------------------------------ */

/** Filters other than the type, which the rail owns and the counts must ignore. */
function passesDetail(
  account: Account,
  filter: LedgerFilter,
  needle: string,
  trial: ReadonlyMap<string, TrialRow>,
): boolean {
  if (!filter.showInactive && !account.active) return false;
  if (filter.withActivityOnly && (trial.get(account.id)?.lines ?? 0) === 0) return false;
  if (needle === '') return true;
  return (
    account.code.toLowerCase().includes(needle) || account.name.toLowerCase().includes(needle)
  );
}

export function accountMatches(
  account: Account,
  filter: LedgerFilter,
  trial: ReadonlyMap<string, TrialRow>,
): boolean {
  if (filter.type !== null && account.type !== filter.type) return false;
  return passesDetail(account, filter, filter.search.trim().toLowerCase(), trial);
}

export interface ChartRow {
  readonly account: Account;
  readonly depth: number;
  /** Children that survived the filter, so a chevron means something to open. */
  readonly childCount: number;
  readonly expanded: boolean;
}

/**
 * The tree, flattened to the rows a grid can draw.
 *
 * An account that matches brings its ancestors with it: a search hit shown at the
 * top level has lost the one thing the chart was for, which is where the account
 * sits. And a filtered tree opens itself — having to expand five levels by hand to
 * find the row you just searched for is the behaviour that makes people give up on
 * tree views. Expansion is only honoured when nothing is narrowing the list.
 */
export function flattenChart(
  accounts: readonly Account[],
  filter: LedgerFilter,
  expanded: ReadonlySet<string>,
  trial: ReadonlyMap<string, TrialRow>,
): readonly ChartRow[] {
  const index = indexAccounts(accounts);
  const keep = new Set<string>();
  for (const account of accounts) {
    if (!accountMatches(account, filter, trial)) continue;
    keep.add(account.id);
    const seen = new Set<string>([account.id]);
    let cursor = account.parentId;
    while (cursor !== null && !seen.has(cursor) && index.byId.has(cursor)) {
      keep.add(cursor);
      seen.add(cursor);
      cursor = index.byId.get(cursor)?.parentId ?? null;
    }
  }

  const auto = autoExpands(filter);
  const out: ChartRow[] = [];
  const walk = (bucket: readonly Account[], depth: number): void => {
    for (const account of bucket) {
      if (!keep.has(account.id)) continue;
      const children = (index.children.get(account.id) ?? []).filter((child) => keep.has(child.id));
      const open = (auto || expanded.has(account.id)) && children.length > 0;
      out.push({ account, depth, childCount: children.length, expanded: open });
      if (open) walk(children, depth + 1);
    }
  };
  walk(index.roots, 0);
  return out;
}

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

export interface ChartTally {
  /** Rows the current filter leaves, the type included. */
  readonly shown: number;
  /** Rows the filter leaves ignoring the type — the rail's "all types" count. */
  readonly all: number;
  readonly byType: Readonly<Record<AccountType, number>>;
  /** Facts about the whole page, which no filter should change. */
  readonly loaded: number;
  readonly active: number;
  readonly inactive: number;
  /** Accounts nothing has ever been posted to. */
  readonly unused: number;
  readonly orphans: number;
}

const ZERO_BY_TYPE: Readonly<Record<AccountType, number>> = {
  ASSET: 0,
  LIABILITY: 0,
  EQUITY: 0,
  REVENUE: 0,
  EXPENSE: 0,
};

/**
 * Counts every type at once.
 *
 * The per-type counts honour the search and the two toggles but not the type
 * itself: a rail already narrowed to Assets could never say how many expense
 * accounts the search also matched, and that number is the reason the rail has
 * badges at all.
 */
export function chartTally(
  accounts: readonly Account[],
  filter: LedgerFilter,
  trial: ReadonlyMap<string, TrialRow>,
): ChartTally {
  const byType = { ...ZERO_BY_TYPE };
  const needle = filter.search.trim().toLowerCase();
  let all = 0;
  let shown = 0;
  let active = 0;
  let unused = 0;
  for (const account of accounts) {
    if (account.active) active += 1;
    if ((trial.get(account.id)?.lines ?? 0) === 0) unused += 1;
    if (!passesDetail(account, filter, needle, trial)) continue;
    all += 1;
    byType[account.type] += 1;
    if (filter.type === null || account.type === filter.type) shown += 1;
  }
  return {
    shown,
    all,
    byType,
    loaded: accounts.length,
    active,
    inactive: accounts.length - active,
    unused,
    orphans: indexAccounts(accounts).orphans.length,
  };
}

/* ------------------------------------------------------------------ *
 * Trial balance
 * ------------------------------------------------------------------ */

/**
 * The same filter, applied to the derived rows.
 *
 * "Show inactive" is answered by joining back to the accounts on the page rather than
 * from the derived row's own `is_active`, because the two can disagree: the chart is
 * paged, the aggregate is not. A row whose account is not on the page is kept — it
 * has postings, and a balance line dropped because its account paged out is the one
 * omission a trial balance must never make.
 */
export function filterTrial(
  rows: readonly TrialRow[],
  filter: LedgerFilter,
  byId: ReadonlyMap<string, Account>,
): readonly TrialRow[] {
  const needle = filter.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.type !== null && row.type !== filter.type) return false;
    if (filter.withActivityOnly && row.lines === 0) return false;
    const account = byId.get(row.accountId);
    if (!filter.showInactive && account !== undefined && !account.active) return false;
    if (needle === '') return true;
    return row.code.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle);
  });
}

export interface TrialTotals {
  readonly debit: number;
  readonly credit: number;
  readonly difference: number;
  readonly accounts: number;
  readonly withActivity: number;
  readonly lines: number;
}

export function trialTotals(rows: readonly TrialRow[]): TrialTotals {
  let debit = 0;
  let credit = 0;
  let withActivity = 0;
  let lines = 0;
  for (const row of rows) {
    debit += row.debit;
    credit += row.credit;
    lines += row.lines;
    if (row.lines > 0) withActivity += 1;
  }
  return { debit, credit, difference: debit - credit, accounts: rows.length, withActivity, lines };
}

export const trialBalances = (totals: TrialTotals): boolean => Math.abs(totals.difference) < EPSILON;

export interface TypeSlice {
  readonly type: AccountType;
  readonly accounts: number;
  readonly debit: number;
  readonly credit: number;
  /** Signed by the type's own nature, so every slice reads positive when normal. */
  readonly balance: number;
}

/** All five types in statement order, whether or not the page has any of them. */
export function typeSlices(rows: readonly TrialRow[]): readonly TypeSlice[] {
  return ACCOUNT_TYPES.map((type) => {
    let debit = 0;
    let credit = 0;
    let accounts = 0;
    for (const row of rows) {
      if (row.type !== type) continue;
      accounts += 1;
      debit += row.debit;
      credit += row.credit;
    }
    return {
      type,
      accounts,
      debit,
      credit,
      balance: isDebitNatured(type) ? debit - credit : credit - debit,
    };
  });
}

/* ------------------------------------------------------------------ *
 * The account ledger
 * ------------------------------------------------------------------ */

export interface Posting {
  readonly id: string;
  readonly entryId: string;
  readonly date: string;
  readonly reference: string;
  readonly description: string;
  readonly status: EntryStatus;
  readonly memo: string;
  readonly debit: number;
  readonly credit: number;
  /** What this line did to the account, signed by the account's nature. */
  readonly movement: number;
  /** Running balance, oldest line first. */
  readonly balance: number;
  readonly reconciled: boolean;
}

/** Unknown dates sort last: an off-page entry is not the start of the ledger. */
const sortKey = (date: string): string => (date === '' ? '9999-99-99' : date);

/**
 * One account's lines as a general ledger, oldest first with a running balance.
 *
 * The order is the reason this is a function and not a `map`: a running balance
 * printed against a list sorted newest-first reads bottom-up, and the two orders
 * disagree about which number is the closing one. Ordering is by date, then by
 * reference, then by id, so the same page produces the same ledger twice.
 *
 * Every line counts, drafts included, because the trial balance this is checked
 * against counts them too. `status` is carried on each row so an unposted line is
 * visible as one rather than silently inflating the total.
 */
export function postingsOf(
  lines: readonly JournalLine[],
  entries: ReadonlyMap<string, JournalEntry>,
  type: AccountType,
): readonly Posting[] {
  const debitNatured = isDebitNatured(type);
  const sorted = [...lines].sort((a, b) => {
    const left = entries.get(a.entryId);
    const right = entries.get(b.entryId);
    return (
      sortKey(left?.date ?? '').localeCompare(sortKey(right?.date ?? '')) ||
      (left?.reference ?? '').localeCompare(right?.reference ?? '') ||
      a.id.localeCompare(b.id)
    );
  });
  let running = 0;
  return sorted.map((line) => {
    const entry = entries.get(line.entryId);
    const movement = debitNatured ? line.debit - line.credit : line.credit - line.debit;
    running += movement;
    return {
      id: line.id,
      entryId: line.entryId,
      date: entry?.date ?? '',
      reference: entry?.reference ?? '',
      description: entry?.description ?? '',
      status: entry?.status ?? 'draft',
      memo: line.memo,
      debit: line.debit,
      credit: line.credit,
      movement,
      balance: running,
      reconciled: line.reconciled,
    };
  });
}

/** Distinct entry ids in a set of lines, sorted so the `in` query has one key. */
export function entryIdsOf(lines: readonly JournalLine[]): readonly string[] {
  const seen = new Set<string>();
  for (const line of lines) seen.add(line.entryId);
  return [...seen].sort();
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

const CHART_HEADER = [
  'code',
  'name',
  'account_type',
  'currency',
  'parent_code',
  'depth',
  'is_active',
  'debit',
  'credit',
  'balance',
  'lines',
];

/**
 * The chart as CSV, in the order the tree is drawn.
 *
 * Depth is a column rather than indentation in the code cell: a spreadsheet can
 * group, filter and pivot on a number, and cannot do anything at all with three
 * leading spaces. The amounts are the roll-up, which is what the row shows.
 */
export function chartCsv(
  rows: readonly ChartRow[],
  rollups: RollupIndex,
  byId: ReadonlyMap<string, Account>,
): string {
  return csvDocument(
    CHART_HEADER,
    rows.map(({ account, depth }) => {
      const totals = rollupOf(rollups, account.id);
      const parent = account.parentId === null ? undefined : byId.get(account.parentId);
      return [
        account.code,
        account.name,
        account.type,
        account.currency,
        parent?.code ?? '',
        String(depth),
        account.active ? 'true' : 'false',
        totals.debit.toFixed(2),
        totals.credit.toFixed(2),
        totals.balance.toFixed(2),
        String(totals.lines),
      ];
    }),
  );
}

const TRIAL_HEADER = ['code', 'name', 'account_type', 'currency', 'debit', 'credit', 'balance', 'lines'];

export function trialCsv(rows: readonly TrialRow[]): string {
  return csvDocument(
    TRIAL_HEADER,
    rows.map((row) => [
      row.code,
      row.name,
      row.type,
      row.currency,
      row.debit.toFixed(2),
      row.credit.toFixed(2),
      row.balance.toFixed(2),
      String(row.lines),
    ]),
  );
}

/** `trial-balance-2026-08-28.csv` — the view, then the day it was taken. */
export const suggestedFileName = (view: LedgerView, today: string): string =>
  `${view === 'trial' ? 'trial-balance' : 'chart-of-accounts'}-${today}.csv`;

/**
 * One account and its ledger as tab-separated text, for pasting into Sheets.
 *
 * Tabs rather than commas because that is what a paste into a grid splits on, and
 * because an account name legitimately contains a comma.
 */
export function accountClipboardText(
  account: Account,
  totals: Rollup,
  postings: readonly Posting[],
): string {
  const head = [account.code, account.name, account.type, account.currency].join('\t');
  const body = postings.map((posting) =>
    [
      posting.date,
      posting.reference,
      posting.memo,
      posting.debit === 0 ? '' : posting.debit.toFixed(2),
      posting.credit === 0 ? '' : posting.credit.toFixed(2),
      posting.balance.toFixed(2),
    ].join('\t'),
  );
  const foot = ['', '', '', totals.debit.toFixed(2), totals.credit.toFixed(2), totals.balance.toFixed(2)].join('\t');
  return [head, ...body, foot].join('\n');
}






