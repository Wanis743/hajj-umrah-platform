/**
 * Dashboard — the arithmetic.
 *
 * Every number this app shows is computed here, from the pages the broker returned
 * and from `today`, which is passed in rather than read so the same book renders the
 * same dashboard in a test. Nothing below fetches, formats or renders.
 *
 * Two honesty rules run through the whole file, because a dashboard that rounds off
 * its own provenance is how people end up trusting a wrong number:
 *
 *   • The trial balance has no date dimension — the broker aggregates the posted
 *     lines of the whole book. So position and performance are *book-to-date*, and
 *     they are labelled that way. The range selector cannot touch them and does not
 *     pretend to; it scopes activity, which is entry-dated and can be windowed.
 *   • `journal_lines` carries no date either, so there is no month-by-month revenue
 *     series to be had without joining four thousand lines to five hundred entries
 *     in the browser. The trend on this dashboard is therefore posting *volume*,
 *     which the entries can answer exactly, and it says so.
 *
 * The accounting identity is checked rather than assumed. `balance` arrives already
 * sign-normalised by nature, so assets should equal liabilities plus equity plus the
 * result for the year, and the debit and credit columns should agree independently.
 * Both are reported, and when they disagree the dashboard says so instead of drawing
 * a tidy donut over a broken book.
 */
import type { DatasetRow, Localized, Tone } from '@/platform/sdk';
import { csvDocument } from '../shared/csv';
import { asString, str } from '../shared/guards';
import {
  type AccountType,
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPES,
  type BankAccount,
  type CloseTask,
  ENTRY_STATUS_LABEL,
  type EntryStatus,
  EPSILON,
  type FiscalPeriod,
  isBalanced,
  type JournalEntry,
  type TaskStatus,
  type TrialRow,
  withinPeriod,
} from '../shared/ledger';

/* ------------------------------------------------------------------ *
 * Ceilings
 * ------------------------------------------------------------------ */

/** The broker's page ceiling, mirrored so the status bar can say when it bit. */
export const PAGE_LIMIT = 500;
/** Fiscal periods and bank accounts are short lists. */
export const PERIOD_LIMIT = 200;
export const BANK_LIMIT = 200;
/** The activity feed is a glance, not an archive; Event Viewer holds the log. */
export const FEED_LIMIT = 60;

/** Months on the trend, and accounts in a "top" list. */
export const TREND_MONTHS = 12;
export const TOP_N = 6;

/* ------------------------------------------------------------------ *
 * Pages and range
 * ------------------------------------------------------------------ */

export type PageId = 'overview' | 'position' | 'performance' | 'activity' | 'close';

export const PAGES: readonly PageId[] = ['overview', 'position', 'performance', 'activity', 'close'];

export const PAGE_LABEL: Readonly<Record<PageId, Localized>> = {
  overview: { ar: 'نظرة عامة', fr: 'Vue d’ensemble', en: 'Overview' },
  position: { ar: 'المركز المالي', fr: 'Situation', en: 'Position' },
  performance: { ar: 'الأداء', fr: 'Performance', en: 'Performance' },
  activity: { ar: 'الحركة', fr: 'Activité', en: 'Activity' },
  close: { ar: 'الإقفال', fr: 'Clôture', en: 'Close' },
};

/** The pages whose numbers move when the range changes. Elsewhere it is hidden. */
export const RANGED_PAGES: readonly PageId[] = ['overview', 'activity'];

export type RangeId = 'period' | 'quarter' | 'year' | 'all';

export const RANGES: readonly RangeId[] = ['period', 'quarter', 'year', 'all'];

export const RANGE_LABEL: Readonly<Record<RangeId, Localized>> = {
  period: { ar: 'الفترة', fr: 'Période', en: 'Period' },
  quarter: { ar: 'الربع', fr: 'Trimestre', en: 'Quarter' },
  year: { ar: 'السنة', fr: 'Année', en: 'Year' },
  all: { ar: 'الكل', fr: 'Tout', en: 'All time' },
};

/** A closed interval over entry dates. `from === null` means "since the book began". */
export interface Window {
  readonly range: RangeId;
  readonly from: string | null;
  readonly to: string;
  /** The period this window came from, when the range was `period`. */
  readonly period: FiscalPeriod | null;
}

/**
 * What the range means in dates.
 *
 * `period` is the fiscal period covering today, and falls back to the most recent
 * one when today sits in a gap — a book whose periods stop in June should not show
 * an empty dashboard in August. Quarter and year are calendar, which is what the
 * words mean to everyone who has not read the fiscal calendar table.
 */
export function rangeWindow(
  range: RangeId,
  periods: readonly FiscalPeriod[],
  today: string,
): Window {
  if (range === 'all') return { range, from: null, to: today, period: null };
  if (range === 'year') return { range, from: `${today.slice(0, 4)}-01-01`, to: today, period: null };
  if (range === 'quarter') {
    const month = Number(today.slice(5, 7));
    const first = Number.isFinite(month) ? Math.floor((month - 1) / 3) * 3 + 1 : 1;
    return { range, from: `${today.slice(0, 4)}-${String(first).padStart(2, '0')}-01`, to: today, period: null };
  }
  const covering =
    periods.find((period) => withinPeriod(period, today)) ?? (periods.length === 0 ? null : periods[0]);
  if (covering === null) return { range, from: null, to: today, period: null };
  return { range, from: covering.start, to: covering.end, period: covering };
}

/** ISO dates compare lexicographically, which is the whole reason they are used. */
export function inWindow(date: string, window: Window): boolean {
  if (date === '') return false;
  if (window.from !== null && date < window.from) return false;
  return date <= window.to;
}

/* ------------------------------------------------------------------ *
 * Position and performance — book to date
 * ------------------------------------------------------------------ */

export interface TypeTotal {
  readonly type: AccountType;
  readonly total: number;
  readonly accounts: number;
}

export interface Position {
  readonly assets: number;
  readonly liabilities: number;
  readonly equity: number;
  readonly revenue: number;
  readonly expense: number;
  /** Revenue less expense: the result of the year, not yet closed to equity. */
  readonly result: number;
  /** The result over revenue, or null when nothing has been earned yet. */
  readonly margin: number | null;
  /** The two columns of the trial balance, which must agree. */
  readonly debits: number;
  readonly credits: number;
  /** Assets − (liabilities + equity + result). Zero in a book that adds up. */
  readonly drift: number;
  readonly balanced: boolean;
  readonly accounts: number;
  readonly posting: number;
  readonly byType: readonly TypeTotal[];
  /**
   * Every currency code present on the page, in the order they first appear.
   *
   * The trial balance aggregates one row per account and each account carries its own
   * `currency_code`, so a book that keeps accounts in two currencies produces sums
   * above that added them together without a rate. When this holds more than one code
   * the pages say so — it is cheaper to admit than to invent an exchange rate.
   */
  readonly currencies: readonly string[];
}

/**
 * The book in eight numbers.
 *
 * `balance` arrives sign-normalised by nature, so every one of these sums is a
 * positive magnitude in a healthy book and the identity below is an addition rather
 * than a signed dance. `drift` is what is left over when it does not hold, and it is
 * reported instead of hidden: a dashboard whose donut always closes is a dashboard
 * that cannot tell you the ledger is broken.
 */
export function position(rows: readonly TrialRow[]): Position {
  const totals = new Map<AccountType, { total: number; accounts: number }>();
  const currencies = new Set<string>();
  let debits = 0;
  let credits = 0;
  let posting = 0;
  for (const row of rows) {
    const bucket = totals.get(row.type) ?? { total: 0, accounts: 0 };
    bucket.total += row.balance;
    bucket.accounts += 1;
    totals.set(row.type, bucket);
    currencies.add(row.currency);
    debits += row.debit;
    credits += row.credit;
    if (row.lines > 0) posting += 1;
  }
  const of = (type: AccountType): number => totals.get(type)?.total ?? 0;
  const assets = of('ASSET');
  const liabilities = of('LIABILITY');
  const equity = of('EQUITY');
  const revenue = of('REVENUE');
  const expense = of('EXPENSE');
  const result = revenue - expense;
  const drift = assets - (liabilities + equity + result);
  return {
    assets,
    liabilities,
    equity,
    revenue,
    expense,
    result,
    margin: Math.abs(revenue) < EPSILON ? null : result / revenue,
    debits,
    credits,
    drift,
    balanced: Math.abs(drift) < EPSILON && Math.abs(debits - credits) < EPSILON,
    accounts: rows.length,
    posting,
    byType: ACCOUNT_TYPES.map((type) => ({
      type,
      total: totals.get(type)?.total ?? 0,
      accounts: totals.get(type)?.accounts ?? 0,
    })),
    currencies: [...currencies],
  };
}

/** The largest balances of one nature, which is what a summary card lists. */
export function topBalances(rows: readonly TrialRow[], type: AccountType, limit: number = TOP_N): readonly TrialRow[] {
  return rows
    .filter((row) => row.type === type && Math.abs(row.balance) >= EPSILON)
    .slice()
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Activity — entry-dated, and therefore windowable
 * ------------------------------------------------------------------ */

export interface MonthPoint {
  /** `YYYY-MM`, which sorts. */
  readonly key: string;
  /** The two-digit month, because a chart axis has no room for a word. */
  readonly label: string;
  readonly count: number;
  readonly posted: number;
  /** Debit total of the month's posted entries. */
  readonly value: number;
}

export interface Activity {
  readonly total: number;
  readonly byStatus: Readonly<Record<EntryStatus, number>>;
  /** Debit total of posted entries in the window. */
  readonly value: number;
  readonly months: readonly MonthPoint[];
  /** Entries whose two sides disagree. The post trigger will refuse these. */
  readonly unbalanced: readonly JournalEntry[];
  /** Draft and pending, oldest first: the backlog. */
  readonly waiting: readonly JournalEntry[];
  readonly recent: readonly JournalEntry[];
  readonly firstDate: string | null;
  readonly lastDate: string | null;
}

const STATUS_ZERO: Readonly<Record<EntryStatus, number>> = { draft: 0, pending: 0, posted: 0, void: 0 };

/** `2026-12` → `2027-01`, on strings, so no timezone ever gets a vote. */
function nextMonth(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return key;
  return month >= 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Posting volume by month, with the empty months drawn.
 *
 * A month nobody posted in is information, so the series runs continuously from the
 * first month with an entry to the last rather than skipping to the next bar and
 * making a quiet August look like a busy one.
 */
function monthSeries(entries: readonly JournalEntry[], limit: number): readonly MonthPoint[] {
  const buckets = new Map<string, { count: number; posted: number; value: number }>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    if (key.length !== 7) continue;
    const bucket = buckets.get(key) ?? { count: 0, posted: 0, value: 0 };
    bucket.count += 1;
    if (entry.status === 'posted') {
      bucket.posted += 1;
      bucket.value += entry.debit;
    }
    buckets.set(key, bucket);
  }
  const keys = [...buckets.keys()].sort();
  if (keys.length === 0) return [];
  const filled: string[] = [];
  const last = keys[keys.length - 1];
  for (let key = keys[0]; key <= last && filled.length < 240; key = nextMonth(key)) filled.push(key);
  return filled.slice(Math.max(0, filled.length - limit)).map((key) => {
    const bucket = buckets.get(key) ?? { count: 0, posted: 0, value: 0 };
    return { key, label: key.slice(5, 7), count: bucket.count, posted: bucket.posted, value: bucket.value };
  });
}

export function activity(entries: readonly JournalEntry[], window: Window): Activity {
  const scoped = entries.filter((entry) => inWindow(entry.date, window));
  const byStatus: Record<EntryStatus, number> = { ...STATUS_ZERO };
  let value = 0;
  for (const entry of scoped) {
    byStatus[entry.status] += 1;
    if (entry.status === 'posted') value += entry.debit;
  }
  const dates = scoped.map((entry) => entry.date).filter((date) => date !== '');
  dates.sort();
  const waiting = scoped
    .filter((entry) => entry.status === 'draft' || entry.status === 'pending')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    total: scoped.length,
    byStatus,
    value,
    months: monthSeries(scoped, TREND_MONTHS),
    unbalanced: scoped.filter((entry) => entry.status !== 'void' && !isBalanced(entry)),
    waiting,
    recent: scoped.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    firstDate: dates.length === 0 ? null : dates[0],
    lastDate: dates.length === 0 ? null : dates[dates.length - 1],
  };
}

/* ------------------------------------------------------------------ *
 * Cash
 * ------------------------------------------------------------------ */

export interface CurrencyTotal {
  readonly currency: string;
  readonly total: number;
  readonly accounts: number;
}

export interface Cash {
  /** The book-currency total, which is the only figure that may be added up. */
  readonly total: number;
  readonly accounts: number;
  readonly byCurrency: readonly CurrencyTotal[];
  /** Active accounts, largest first. */
  readonly rows: readonly BankAccount[];
}

/**
 * Cash by bank account.
 *
 * Balances in different currencies are not summed — there is an exchange-rate table
 * in the schema and no rate on a bank row, so adding dinars to riyals here would
 * invent a number. The headline is the book currency; the rest are listed beside it.
 */
export function cash(accounts: readonly BankAccount[], book: string): Cash {
  const active = accounts.filter((account) => account.active);
  const totals = new Map<string, { total: number; accounts: number }>();
  for (const account of active) {
    const bucket = totals.get(account.currency) ?? { total: 0, accounts: 0 };
    bucket.total += account.current;
    bucket.accounts += 1;
    totals.set(account.currency, bucket);
  }
  const byCurrency = [...totals.entries()]
    .map(([currency, bucket]) => ({ currency, total: bucket.total, accounts: bucket.accounts }))
    .sort((a, b) => (a.currency === book ? -1 : b.currency === book ? 1 : b.total - a.total));
  return {
    total: totals.get(book)?.total ?? 0,
    accounts: active.length,
    byCurrency,
    rows: active.slice().sort((a, b) => Math.abs(b.current) - Math.abs(a.current)),
  };
}

/* ------------------------------------------------------------------ *
 * The close
 * ------------------------------------------------------------------ */

export interface PeriodState {
  readonly period: FiscalPeriod;
  readonly entries: number;
  /** Entries dated inside the period that are still draft or pending. */
  readonly unposted: number;
  readonly value: number;
}

/**
 * Each period with what is sitting in it.
 *
 * Counted by entry *date* rather than by `fiscal_period_id`, because the server
 * stamps that column when an entry is approved — so a draft has none, and drafts are
 * exactly what a person wants to see before closing a month.
 */
export function periodStates(
  periods: readonly FiscalPeriod[],
  entries: readonly JournalEntry[],
  limit: number,
): readonly PeriodState[] {
  return periods.slice(0, limit).map((period) => {
    let count = 0;
    let unposted = 0;
    let value = 0;
    for (const entry of entries) {
      if (!withinPeriod(period, entry.date)) continue;
      count += 1;
      if (entry.status === 'draft' || entry.status === 'pending') unposted += 1;
      if (entry.status === 'posted') value += entry.debit;
    }
    return { period, entries: count, unposted, value };
  });
}

export interface CloseStep {
  readonly task: CloseTask;
  /** Dependency names that are not certified yet, in the order the task lists them. */
  readonly blockedBy: readonly string[];
  readonly ready: boolean;
}

export interface CloseProgress {
  readonly total: number;
  readonly certified: number;
  /** Certified over total, or 0 for an empty checklist. */
  readonly ratio: number;
  readonly byStatus: Readonly<Record<TaskStatus, number>>;
  readonly steps: readonly CloseStep[];
  /** The first step that could be certified right now. */
  readonly next: CloseStep | null;
  readonly blocked: readonly CloseStep[];
}

const TASK_ZERO: Readonly<Record<TaskStatus, number>> = { pending: 0, inProgress: 0, certified: 0, blocked: 0 };

/**
 * The checklist, resolved.
 *
 * `close_tasks.dependencies` holds task *names*, and `complete_close_task` refuses to
 * certify out of order — so a step is ready only when every name it lists is already
 * certified, and `next` is the one the server would accept.
 */
export function closeProgress(tasks: readonly CloseTask[]): CloseProgress {
  const certifiedNames = new Set<string>();
  for (const task of tasks) if (task.status === 'certified') certifiedNames.add(task.name);
  const byStatus: Record<TaskStatus, number> = { ...TASK_ZERO };
  const steps = tasks
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((task) => {
      byStatus[task.status] += 1;
      const blockedBy = task.dependencies.filter((name) => !certifiedNames.has(name));
      return { task, blockedBy, ready: task.status !== 'certified' && blockedBy.length === 0 };
    });
  const certified = byStatus.certified;
  return {
    total: steps.length,
    certified,
    ratio: steps.length === 0 ? 0 : certified / steps.length,
    byStatus,
    steps,
    next: steps.find((step) => step.ready) ?? null,
    blocked: steps.filter((step) => step.task.status !== 'certified' && step.blockedBy.length > 0),
  };
}

/* ------------------------------------------------------------------ *
 * The activity feed
 * ------------------------------------------------------------------ */

export interface FeedRow {
  readonly id: string;
  /** The audit action code, kept verbatim — this app does not invent a vocabulary. */
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
  readonly who: string;
  readonly at: string;
  /** `details.reason`, which is where an approval note or a void reason lands. */
  readonly reason: string | null;
}

/** `details` is jsonb: it can be a string, an array, or null. Read it defensively. */
function detail(details: unknown, key: string): string | null {
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return null;
  const value = (details as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

export function toFeedRow(row: DatasetRow): FeedRow | null {
  const id = asString(row.id);
  const action = asString(row.action);
  if (id === null || action === null) return null;
  return {
    id,
    action,
    resource: str(row.resource),
    resourceId: asString(row.resource_id),
    who: str(row.user_email),
    at: asString(row.timestamp) ?? str(row.created_at),
    reason: detail(row.details, 'reason'),
  };
}

/**
 * How an action reads at a glance.
 *
 * Matched on substrings rather than an enumeration, because `audit_logs.action` is a
 * free text column written by every RPC in the schema: a fixed list would silently
 * grey out the next one somebody adds. Anything unrecognised stays neutral, which is
 * the honest colour for "something happened".
 */
export function feedTone(action: string): Tone {
  const code = action.toUpperCase();
  if (code.includes('VOID') || code.includes('REVERSE') || code.includes('DELETE') || code.includes('DENIED')) {
    return 'danger';
  }
  if (code.includes('POST') || code.includes('APPROVE') || code.includes('CERTIF') || code.includes('CLOSE')) {
    return 'success';
  }
  if (code.includes('REOPEN') || code.includes('UNMATCH')) return 'warning';
  if (code.includes('CREATE') || code.includes('UPSERT') || code.includes('UPDATE') || code.includes('MATCH')) {
    return 'info';
  }
  return 'neutral';
}

/* ------------------------------------------------------------------ *
 * Where a row sends you
 * ------------------------------------------------------------------ */

/**
 * The three apps this one hands work to.
 *
 * Named rather than carried as an `AppId` so this module stays pure; `actions.ts`
 * resolves a name to the manifest id it launches. The list is short because it is
 * honest: only these three are installed, and a tile that offered to open something
 * absent would be a dead button.
 */
export type TargetApp = 'inbox' | 'journal' | 'ledger';

export interface Destination {
  readonly app: TargetApp;
  /** A command the target understands as a cold-start verb, so it opens on that view. */
  readonly command?: string;
  /** Ledger focuses one account when it is launched with an id. */
  readonly accountId?: string;
  readonly label: Localized;
}

export const TO_APPROVALS: Destination = {
  app: 'inbox',
  command: 'queue:approvals',
  label: { ar: 'فتح صندوق الموافقات', fr: 'Ouvrir les approbations', en: 'Open approvals' },
};

export const TO_CHECKLIST: Destination = {
  app: 'inbox',
  command: 'queue:checklist',
  label: { ar: 'فتح قائمة الإقفال', fr: 'Ouvrir la clôture', en: 'Open the checklist' },
};

export const TO_DECIDED: Destination = {
  app: 'inbox',
  command: 'queue:decided',
  label: { ar: 'فتح القرارات', fr: 'Ouvrir les décisions', en: 'Open decisions' },
};

export const TO_DRAFTS: Destination = {
  app: 'journal',
  command: 'view:draft',
  label: { ar: 'فتح المسوّدات', fr: 'Ouvrir les brouillons', en: 'Open drafts' },
};

export const TO_POSTED: Destination = {
  app: 'journal',
  command: 'view:posted',
  label: { ar: 'فتح القيود المعتمدة', fr: 'Ouvrir les écritures approuvées', en: 'Open posted entries' },
};

export const TO_TRIAL: Destination = {
  app: 'ledger',
  command: 'view:trial',
  label: { ar: 'فتح ميزان المراجعة', fr: 'Ouvrir la balance', en: 'Open the trial balance' },
};

export const TO_CHART: Destination = {
  app: 'ledger',
  command: 'view:chart',
  label: { ar: 'فتح دليل الحسابات', fr: 'Ouvrir le plan comptable', en: 'Open the chart of accounts' },
};

/** One account, in Ledger. */
export function accountDestination(accountId: string): Destination {
  return {
    app: 'ledger',
    accountId,
    label: { ar: 'فتح الحساب', fr: 'Ouvrir le compte', en: 'Open the account' },
  };
}

/* ------------------------------------------------------------------ *
 * What needs a person
 * ------------------------------------------------------------------ */

/** Days before a waiting entry is worth colouring. Inbox uses the same threshold. */
export const AGE_WARNING = 3;

export type AttentionKind = 'drift' | 'unbalanced' | 'closedPeriod' | 'approval' | 'blocked' | 'ready';

export interface AttentionItem {
  readonly key: string;
  readonly kind: AttentionKind;
  readonly label: Localized;
  readonly count: number;
  /** Up to three references or names, so the row says *which*. */
  readonly sample: readonly string[];
  readonly tone: Tone;
  readonly destination: Destination;
}

/** Whole days between two ISO dates, floored at zero. */
export function ageInDays(date: string, today: string): number {
  const from = Date.parse(`${date}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export interface AttentionInput {
  readonly position: Position;
  readonly activity: Activity;
  readonly entries: readonly JournalEntry[];
  readonly periods: readonly FiscalPeriod[];
  readonly close: CloseProgress;
  readonly today: string;
}

/**
 * The standing list, in the order a person should deal with it.
 *
 * Aggregated rather than itemised: eleven rows saying "entry waiting" are one fact,
 * and the app that can act on them is one launch away. Each row therefore carries a
 * count, a few references so it is not abstract, and the destination that owns the
 * work — this app never acts, it hands over.
 */
export function attention(input: AttentionInput): readonly AttentionItem[] {
  const { position: book, activity: act, entries, periods, close, today } = input;
  const out: AttentionItem[] = [];

  if (book.accounts > 0 && !book.balanced) {
    out.push({
      key: 'drift',
      kind: 'drift',
      label: { ar: 'الميزان لا يتوازن', fr: 'La balance ne s’équilibre pas', en: 'The trial balance does not balance' },
      count: 1,
      sample: [],
      tone: 'danger',
      destination: TO_TRIAL,
    });
  }

  if (act.unbalanced.length > 0) {
    out.push({
      key: 'unbalanced',
      kind: 'unbalanced',
      label: { ar: 'قيود غير متوازنة', fr: 'Écritures déséquilibrées', en: 'Entries that do not balance' },
      count: act.unbalanced.length,
      sample: act.unbalanced.slice(0, 3).map((entry) => entry.reference),
      tone: 'danger',
      destination: TO_DRAFTS,
    });
  }

  const closedNames = new Set<string>();
  const inClosed = entries.filter((entry) => {
    if (entry.status !== 'draft' && entry.status !== 'pending') return false;
    const period = periods.find((candidate) => withinPeriod(candidate, entry.date));
    if (period === undefined || period.status === 'open') return false;
    closedNames.add(period.label);
    return true;
  });
  if (inClosed.length > 0) {
    out.push({
      key: 'closed-period',
      kind: 'closedPeriod',
      label: {
        ar: 'قيود بتاريخ داخل فترة مقفلة',
        fr: 'Écritures datées dans une période clôturée',
        en: 'Entries dated inside a closed period',
      },
      count: inClosed.length,
      sample: [...closedNames].slice(0, 3),
      tone: 'warning',
      destination: TO_DRAFTS,
    });
  }

  if (act.waiting.length > 0) {
    const oldest = act.waiting[0];
    const age = ageInDays(oldest.date, today);
    out.push({
      key: 'approval',
      kind: 'approval',
      label: { ar: 'في انتظار الاعتماد', fr: 'En attente d’approbation', en: 'Waiting on approval' },
      count: act.waiting.length,
      sample: act.waiting.slice(0, 3).map((entry) => entry.reference),
      tone: age >= AGE_WARNING ? 'warning' : 'info',
      destination: TO_APPROVALS,
    });
  }

  if (close.blocked.length > 0) {
    out.push({
      key: 'blocked',
      kind: 'blocked',
      label: { ar: 'خطوات إقفال متعطّلة', fr: 'Étapes de clôture bloquées', en: 'Close steps waiting on another' },
      count: close.blocked.length,
      sample: close.blocked.slice(0, 3).map((step) => step.task.name),
      tone: 'warning',
      destination: TO_CHECKLIST,
    });
  }

  if (close.next !== null) {
    out.push({
      key: 'ready',
      kind: 'ready',
      label: { ar: 'الخطوة التالية جاهزة للتصديق', fr: 'Étape suivante prête à certifier', en: 'Next close step is ready' },
      count: 1,
      sample: [close.next.task.name],
      tone: 'info',
      destination: TO_CHECKLIST,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * The whole dashboard, in one value
 * ------------------------------------------------------------------ */

export interface SnapshotInput {
  readonly trial: readonly TrialRow[];
  readonly entries: readonly JournalEntry[];
  readonly periods: readonly FiscalPeriod[];
  readonly tasks: readonly CloseTask[];
  readonly banks: readonly BankAccount[];
  readonly range: RangeId;
  /** The currency the trial balance is added up in. */
  readonly book: string;
  readonly today: string;
}

export interface Snapshot {
  readonly window: Window;
  readonly position: Position;
  readonly cash: Cash;
  readonly activity: Activity;
  readonly close: CloseProgress;
  readonly periods: readonly PeriodState[];
  readonly attention: readonly AttentionItem[];
  /** Carried through, because the account cards and the CSV both list them. */
  readonly trial: readonly TrialRow[];
  readonly book: string;
  readonly today: string;
}

/**
 * One pass over the pages, one value for the whole window.
 *
 * The attention list is built from *all* entries rather than the windowed ones: a
 * draft dated into a closed March is somebody's problem in August too, and hiding it
 * behind the range selector would be the one thing this list must never do.
 */
export function snapshot(input: SnapshotInput): Snapshot {
  const window = rangeWindow(input.range, input.periods, input.today);
  const book = position(input.trial);
  const act = activity(input.entries, window);
  const close = closeProgress(input.tasks);
  return {
    window,
    position: book,
    cash: cash(input.banks, input.book),
    activity: act,
    close,
    periods: periodStates(input.periods, input.entries, 12),
    attention: attention({
      position: book,
      activity: act,
      entries: input.entries,
      periods: input.periods,
      close,
      today: input.today,
    }),
    trial: input.trial,
    book: input.book,
    today: input.today,
  };
}

/* ------------------------------------------------------------------ *
 * Export and clipboard
 * ------------------------------------------------------------------ */

/**
 * Formatting, passed in.
 *
 * This module knows what the numbers are, not how the language they are read in
 * writes them — so the four formatters it needs arrive as arguments and it stays a
 * function of its inputs.
 */
export interface Formatters {
  readonly t: (text: Localized) => string;
  readonly money: (value: number) => string;
  readonly percent: (fraction: number) => string;
  readonly integer: (value: number) => string;
}

/** Raw decimals for the spreadsheet, per the rule in `shared/csv.ts`. */
const dec = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '');
const int = (value: number): string => (Number.isFinite(value) ? String(Math.round(value)) : '');

const BASIS_BOOK: Localized = { ar: 'حتى تاريخه', fr: 'à ce jour', en: 'book to date' };

/** What the current window is called, for a subtitle or a CSV column. */
export function windowLabel(window: Window, t: (text: Localized) => string): string {
  if (window.period !== null) return window.period.label;
  if (window.from === null) return t(RANGE_LABEL.all);
  return `${window.from} → ${window.to}`;
}

/**
 * The dashboard as a paragraph.
 *
 * What somebody pastes into a message at nine in the morning when they are asked how
 * the book looks: the position, the result, the cash, what moved, and what is in the
 * way. Six lines, because a seventh would not be read.
 */
export function summaryText(snap: Snapshot, f: Formatters): string {
  const { t, money, percent, integer } = f;
  const basis = t(BASIS_BOOK);
  const out: string[] = [
    `${t(PAGE_LABEL.overview)} — ${snap.today}`,
    `${t(ACCOUNT_TYPE_LABEL.ASSET)} ${money(snap.position.assets)} · ${t(ACCOUNT_TYPE_LABEL.LIABILITY)} ${money(
      snap.position.liabilities,
    )} · ${t(ACCOUNT_TYPE_LABEL.EQUITY)} ${money(snap.position.equity)} (${basis})`,
  ];
  const margin = snap.position.margin === null ? '' : ` · ${percent(snap.position.margin)}`;
  out.push(
    `${t(ACCOUNT_TYPE_LABEL.REVENUE)} ${money(snap.position.revenue)} · ${t(ACCOUNT_TYPE_LABEL.EXPENSE)} ${money(
      snap.position.expense,
    )} · ${t({ ar: 'النتيجة', fr: 'Résultat', en: 'Result' })} ${money(snap.position.result)}${margin}`,
  );
  if (snap.cash.accounts > 0) {
    out.push(
      `${t({ ar: 'النقد', fr: 'Trésorerie', en: 'Cash' })} ${money(snap.cash.total)} · ${integer(
        snap.cash.accounts,
      )} ${t({ ar: 'حساب', fr: 'comptes', en: 'accounts' })}`,
    );
  }
  out.push(
    `${t(PAGE_LABEL.activity)} (${windowLabel(snap.window, t)}) — ${integer(snap.activity.total)} ${t({
      ar: 'قيد',
      fr: 'écritures',
      en: 'entries',
    })}, ${integer(snap.activity.byStatus.posted)} ${t(ENTRY_STATUS_LABEL.posted)}, ${integer(
      snap.activity.waiting.length,
    )} ${t({ ar: 'في الانتظار', fr: 'en attente', en: 'waiting' })}`,
  );
  if (snap.close.total > 0) {
    const next = snap.close.next === null ? '' : ` · ${snap.close.next.task.name}`;
    out.push(
      `${t(PAGE_LABEL.close)} ${integer(snap.close.certified)}/${integer(snap.close.total)} ${t({
        ar: 'مصدّقة',
        fr: 'certifiées',
        en: 'certified',
      })}${next}`,
    );
  }
  for (const item of snap.attention.slice(0, 3)) {
    out.push(`• ${t(item.label)} — ${integer(item.count)}${item.sample.length === 0 ? '' : ` (${item.sample.join(', ')})`}`);
  }
  return out.join('\n');
}

const BALANCE_TYPES: readonly AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY'];
const INCOME_TYPES: readonly AccountType[] = ['REVENUE', 'EXPENSE'];

const ACCOUNT_HEADER: readonly string[] = [
  'type',
  'code',
  'name',
  'currency',
  'debit',
  'credit',
  'balance',
  'lines',
];

function accountRows(rows: readonly TrialRow[], types: readonly AccountType[]): readonly (readonly string[])[] {
  return rows
    .filter((row) => types.includes(row.type))
    .map((row) => [
      row.type,
      row.code,
      row.name,
      row.currency,
      dec(row.debit),
      dec(row.credit),
      dec(row.balance),
      int(row.lines),
    ]);
}

/** The book-to-date figures, then the windowed ones, each saying which it is. */
function overviewRows(snap: Snapshot, window: string): readonly (readonly string[])[] {
  const book = 'BOOK_TO_DATE';
  const p = snap.position;
  return [
    ['ASSETS', dec(p.assets), snap.book, book],
    ['LIABILITIES', dec(p.liabilities), snap.book, book],
    ['EQUITY', dec(p.equity), snap.book, book],
    ['REVENUE', dec(p.revenue), snap.book, book],
    ['EXPENSES', dec(p.expense), snap.book, book],
    ['RESULT', dec(p.result), snap.book, book],
    ['MARGIN', p.margin === null ? '' : p.margin.toFixed(4), '', book],
    ['TRIAL_DEBITS', dec(p.debits), snap.book, book],
    ['TRIAL_CREDITS', dec(p.credits), snap.book, book],
    ['TRIAL_DRIFT', dec(p.drift), snap.book, book],
    ['TRIAL_CURRENCIES', int(p.currencies.length), p.currencies.join(' '), book],
    ['CASH', dec(snap.cash.total), snap.book, book],
    ['CASH_ACCOUNTS', int(snap.cash.accounts), '', book],
    ['ENTRIES', int(snap.activity.total), '', window],
    ['ENTRIES_POSTED', int(snap.activity.byStatus.posted), '', window],
    ['ENTRIES_WAITING', int(snap.activity.waiting.length), '', window],
    ['ENTRIES_VOID', int(snap.activity.byStatus.void), '', window],
    ['POSTED_VALUE', dec(snap.activity.value), snap.book, window],
    ['CLOSE_CERTIFIED', int(snap.close.certified), '', ''],
    ['CLOSE_TOTAL', int(snap.close.total), '', ''],
  ];
}

function closeRows(snap: Snapshot): readonly (readonly string[])[] {
  const periods = snap.periods.map((state) => [
    'PERIOD',
    state.period.label,
    state.period.status.toUpperCase(),
    `${state.period.start}..${state.period.end}`,
    int(state.entries),
    int(state.unposted),
    dec(state.value),
  ]);
  const tasks = snap.close.steps.map((step) => [
    'TASK',
    step.task.name,
    step.task.status.toUpperCase(),
    step.blockedBy.join(' | '),
    '',
    '',
    '',
  ]);
  return [...periods, ...tasks];
}

/**
 * The page you are looking at, as a table.
 *
 * Codes rather than labels in the machine columns — a CSV outlives the language it
 * was exported in — and one table per page, because a spreadsheet given two headers
 * in one file is a spreadsheet nobody can pivot.
 */
export function pageCsv(snap: Snapshot, page: PageId, t: (text: Localized) => string): string {
  const window = windowLabel(snap.window, t);
  if (page === 'position') return csvDocument(ACCOUNT_HEADER, accountRows(snap.trial, BALANCE_TYPES));
  if (page === 'performance') return csvDocument(ACCOUNT_HEADER, accountRows(snap.trial, INCOME_TYPES));
  if (page === 'activity') {
    return csvDocument(
      ['month', 'entries', 'posted', 'posted_value', 'currency'],
      snap.activity.months.map((point) => [point.key, int(point.count), int(point.posted), dec(point.value), snap.book]),
    );
  }
  if (page === 'close') {
    return csvDocument(['kind', 'name', 'status', 'detail', 'entries', 'unposted', 'value'], closeRows(snap));
  }
  return csvDocument(['metric', 'value', 'currency', 'basis'], overviewRows(snap, window));
}

export function suggestedFileName(page: PageId, today: string): string {
  return `dashboard-${page}-${today}.csv`;
}
