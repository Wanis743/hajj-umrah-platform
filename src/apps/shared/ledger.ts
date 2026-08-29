/**
 * The ledger vocabulary the finance apps share.
 *
 * `data.query` returns `Readonly<Record<string, unknown>>`, and eleven apps read
 * the same eleven projections. Written once per app that would be eleven copies
 * of "what a journal entry is" drifting apart one renamed column at a time — so
 * the row shapes and their guards live here, and an app that wants a journal
 * entry asks for one.
 *
 * Two rules hold everything below together:
 *
 *   • A mapper returns `null` rather than a half-built row. A missing `id` is not
 *     a row with an empty id, it is a projection that changed shape, and a table
 *     that quietly shows a blank line for it is how a reconciliation goes wrong.
 *   • Nothing here formats. `fmt` owns locale policy and these are values, not
 *     text: the same `balance` is `1 250,00 DA` in one window and a CSV cell in
 *     another.
 */
import type { DatasetRow, Localized, Tone } from '@/platform/sdk';
import { asBoolean, asNumber, asString, num, status, str } from './guards';

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/**
 * The currencies the books are kept in.
 *
 * `fmt.money` takes exactly this pair, so the finance apps need one place to turn
 * a projected `currency_code` — which is a `string` from the database's point of
 * view — into something the formatter accepts.
 */
export type Currency = 'DZD' | 'SAR';

export const CURRENCIES: readonly Currency[] = ['DZD', 'SAR'];

/**
 * Defaulted rather than refused: an unrecognised code is a display question, and
 * a row shown in the wrong symbol is still readable, whereas a row dropped for
 * having an odd currency is a reconciliation that silently misses a line.
 */
export const toCurrency = (value: unknown): Currency => (status(value) === 'sar' ? 'SAR' : 'DZD');

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

/** Statement order, which is also the order a chart of accounts is numbered. */
export const ACCOUNT_TYPES: readonly AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export const ACCOUNT_TYPE_LABEL: Readonly<Record<AccountType, Localized>> = {
  ASSET: { ar: 'أصول', fr: 'Actif', en: 'Asset' },
  LIABILITY: { ar: 'خصوم', fr: 'Passif', en: 'Liability' },
  EQUITY: { ar: 'رأس المال', fr: 'Capitaux propres', en: 'Equity' },
  REVENUE: { ar: 'إيرادات', fr: 'Produits', en: 'Revenue' },
  EXPENSE: { ar: 'أعباء', fr: 'Charges', en: 'Expense' },
};

/**
 * Which side of the account increases it.
 *
 * Assets and expenses are debit-natured; everything else is the mirror image.
 * One function, because a sign convention repeated in five apps is a sign
 * convention that will disagree with itself in one of them.
 */
export const isDebitNatured = (type: AccountType): boolean => type === 'ASSET' || type === 'EXPENSE';

/** Which statement an account lands on. */
export const statementOf = (type: AccountType): 'balance' | 'income' =>
  type === 'REVENUE' || type === 'EXPENSE' ? 'income' : 'balance';

/** A projected account type, or `null` when the column holds something else. */
export function toAccountType(value: unknown): AccountType | null {
  const upper = (asString(value) ?? '').toUpperCase();
  return ACCOUNT_TYPES.find((candidate) => candidate === upper) ?? null;
}

export interface Account {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly parentId: string | null;
  readonly active: boolean;
}

export function toAccount(row: DatasetRow): Account | null {
  const id = asString(row.id);
  const type = toAccountType(row.account_type);
  if (id === null || type === null) return null;
  return {
    id,
    code: str(row.code),
    name: str(row.name),
    type,
    currency: asString(row.currency_code) ?? 'DZD',
    parentId: asString(row.parent_id),
    active: asBoolean(row.is_active) ?? true,
  };
}

/** `4011 · Suppliers` — the label a picker shows and a report prints. */
export const accountLabel = (account: Account): string => `${account.code} · ${account.name}`;

/* ------------------------------------------------------------------ *
 * Journal
 * ------------------------------------------------------------------ */

/**
 * Entry lifecycle. `draft` is editable, `pending` is waiting on an approval,
 * `posted` is in the books and `void` is a reversal of one that was — the four
 * states the RPCs move an entry between, lower-cased because the table is.
 */
export type EntryStatus = 'draft' | 'pending' | 'posted' | 'void';

export const ENTRY_STATUS_LABEL: Readonly<Record<EntryStatus, Localized>> = {
  draft: { ar: 'مسودة', fr: 'Brouillon', en: 'Draft' },
  pending: { ar: 'قيد الموافقة', fr: 'En attente', en: 'Pending' },
  posted: { ar: 'مرحّل', fr: 'Comptabilisé', en: 'Posted' },
  void: { ar: 'ملغى', fr: 'Annulé', en: 'Void' },
};

export const ENTRY_STATUSES: readonly EntryStatus[] = ['draft', 'pending', 'posted', 'void'];

/** Unknown states read as drafts: the safe reading is "not in the books yet". */
export function toEntryStatus(value: unknown): EntryStatus {
  const text = status(value);
  if (text === 'posted' || text === 'approved') return 'posted';
  if (text === 'void' || text === 'voided' || text === 'reversed') return 'void';
  if (text === 'pending' || text === 'submitted' || text === 'awaiting_approval') return 'pending';
  return 'draft';
}

export interface JournalEntry {
  readonly id: string;
  readonly reference: string;
  readonly date: string;
  readonly description: string;
  readonly status: EntryStatus;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly periodId: string | null;
  readonly branchId: string | null;
  /**
   * The analytical tag: which package the entry was booked against, or `null`
   * for the general books. It is the only allocation dimension the projections
   * carry on money, which is what profitability reports on.
   */
  readonly packageId: string | null;
  readonly debit: number;
  readonly credit: number;
  readonly postedAt: string | null;
  readonly createdAt: string | null;
  readonly createdBy: string | null;
}

export function toEntry(row: DatasetRow): JournalEntry | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    reference: str(row.reference),
    date: str(row.entry_date),
    description: str(row.description),
    status: toEntryStatus(row.status),
    sourceType: str(row.source_type),
    sourceId: asString(row.source_id),
    periodId: asString(row.fiscal_period_id),
    branchId: asString(row.branch_id),
    packageId: asString(row.package_id),
    debit: num(row.total_debit),
    credit: num(row.total_credit),
    postedAt: asString(row.posted_at),
    createdAt: asString(row.created_at),
    createdBy: asString(row.created_by),
  };
}

/**
 * Half a centime of tolerance.
 *
 * Amounts arrive as JSON numbers, so a total that was exact on the server can
 * come back as `1249.9999999999998`. Comparing to zero exactly would paint a
 * perfectly good entry red.
 */
export const EPSILON = 0.005;

export const isBalanced = (entry: { readonly debit: number; readonly credit: number }): boolean =>
  Math.abs(entry.debit - entry.credit) < EPSILON;

export interface JournalLine {
  readonly id: string;
  readonly entryId: string;
  readonly accountId: string | null;
  readonly debit: number;
  readonly credit: number;
  readonly currency: string;
  readonly memo: string;
  readonly branchId: string | null;
  /**
   * The line's own analytical tag. A posting may be tagged where its entry is
   * not — a single entry can spread one payment across two packages — so a
   * reader of this field must fall back to the entry's rather than assume they
   * agree. See {@link tagOf}.
   */
  readonly packageId: string | null;
  readonly reconciled: boolean;
}

export function toLine(row: DatasetRow): JournalLine | null {
  const id = asString(row.id);
  const entryId = asString(row.journal_entry_id);
  if (id === null || entryId === null) return null;
  return {
    id,
    entryId,
    accountId: asString(row.account_id),
    debit: num(row.debit),
    credit: num(row.credit),
    currency: asString(row.currency_code) ?? 'DZD',
    memo: str(row.memo),
    branchId: asString(row.branch_id),
    packageId: asString(row.package_id),
    reconciled: asBoolean(row.is_reconciled) ?? false,
  };
}

/**
 * The analytical tag a posting is filed under, line first and entry second.
 *
 * A line that names a dimension is a decision somebody made about that line; an
 * entry that names one is a decision about the whole document. The narrower wins
 * — otherwise a split entry would report both halves against the header's tag —
 * and `null` means untagged, which is a real answer and not a missing one.
 */
export const tagOf = (
  line: JournalLine,
  entry: JournalEntry,
  dimension: 'package' | 'branch',
): string | null =>
  dimension === 'package'
    ? (line.packageId ?? entry.packageId)
    : (line.branchId ?? entry.branchId);

/** What a line moves, signed the way its account reads it. */
export const signedAmount = (line: JournalLine, type: AccountType): number =>
  isDebitNatured(type) ? line.debit - line.credit : line.credit - line.debit;

/* ------------------------------------------------------------------ *
 * Fiscal periods
 * ------------------------------------------------------------------ */

export type PeriodStatus = 'open' | 'closing' | 'closed';

export const PERIOD_STATUS_LABEL: Readonly<Record<PeriodStatus, Localized>> = {
  open: { ar: 'مفتوحة', fr: 'Ouverte', en: 'Open' },
  closing: { ar: 'قيد الإقفال', fr: 'En clôture', en: 'Closing' },
  closed: { ar: 'مقفلة', fr: 'Clôturée', en: 'Closed' },
};

export function toPeriodStatus(value: unknown): PeriodStatus {
  const text = status(value);
  if (text === 'closed' || text === 'locked') return 'closed';
  if (text === 'closing' || text === 'in_progress' || text === 'pending_close') return 'closing';
  return 'open';
}

export interface FiscalPeriod {
  readonly id: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly status: PeriodStatus;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
}

export function toPeriod(row: DatasetRow): FiscalPeriod | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    label: str(row.label),
    start: str(row.start_date),
    end: str(row.end_date),
    status: toPeriodStatus(row.status),
    closedAt: asString(row.closed_at),
    closedBy: asString(row.closed_by),
  };
}

/** Does a date fall inside a period? Dates are ISO, so string order is date order. */
export const withinPeriod = (period: FiscalPeriod, date: string): boolean =>
  date >= period.start && date <= period.end;

/* ------------------------------------------------------------------ *
 * Windows: what "over this period" means to a report
 * ------------------------------------------------------------------ */

/**
 * Which postings a report is built from.
 *
 * `book` is every posting the app can see, with no date filter at all; `period`
 * is one window. The distinction is not cosmetic — a balance sheet is only ever
 * asking for the first, and a margin is only ever asking for the second.
 */
export type Basis = 'book' | 'period';

/** A closed, inclusive range of ISO dates. Dates sort as strings, so `>=`/`<=` hold. */
export interface DateRange {
  readonly start: string;
  readonly end: string;
}

export const inRange = (range: DateRange, date: string): boolean =>
  date !== '' && date >= range.start && date <= range.end;

/**
 * The window a period basis reads.
 *
 * Both halves are carried because either can be the authority. A fiscal period is
 * a row in the book with an id, and an entry that names that id belongs to it
 * however its date reads — that is what the close was run against. An entry with
 * no period stamp falls back to its own date, which is the only other thing it
 * can be judged by.
 */
export interface PeriodWindow {
  readonly periodId: string | null;
  readonly range: DateRange;
}

/**
 * Does an entry fall in the window?
 *
 * The stamp wins when both sides have one, because a period is a decision
 * somebody made and a date is only evidence of one. When either side is silent
 * the date decides — a book that never used fiscal periods still has to produce
 * a P&L. Shared rather than written per report: two windows that disagree about
 * which entries are in Q1 would produce a margin that cannot be tied back to the
 * income statement it came from.
 */
export function belongs(entry: JournalEntry, period: PeriodWindow): boolean {
  if (period.periodId !== null && entry.periodId !== null) return entry.periodId === period.periodId;
  return inRange(period.range, entry.date);
}

/** Newest first: a report is nearly always about the period that has just ended. */
export const byRecency = (periods: readonly FiscalPeriod[]): readonly FiscalPeriod[] =>
  [...periods].sort((left, right) => right.end.localeCompare(left.end));

/**
 * The calendar month a date falls in, as a closed range.
 *
 * The fallback for a book that keeps no fiscal periods, and plenty do not.
 * Refusing to produce a period report without a period row would make the whole
 * basis a privilege of books that have already been closed once. Day zero of the
 * next month is the last of this one.
 */
export function monthWindow(date: string): DateRange {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const stem = date.slice(0, 7);
  return { start: `${stem}-01`, end: `${stem}-${String(last).padStart(2, '0')}` };
}

/** A month wearing a period row's shape, so one type describes both authorities. */
export function monthPeriod(date: string): FiscalPeriod {
  const range = monthWindow(date);
  return {
    id: '',
    label: date.slice(0, 7),
    start: range.start,
    end: range.end,
    status: 'open',
    closedAt: null,
    closedBy: null,
  };
}

/** The month before a synthetic month: its comparison column, when it has one. */
export function monthBefore(period: FiscalPeriod): FiscalPeriod {
  const year = Number(period.start.slice(0, 4));
  const month = Number(period.start.slice(5, 7));
  return monthPeriod(new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10));
}

/**
 * A period as the window a walk reads.
 *
 * A synthetic month carries no id, and a window with no id lets each entry's own
 * date decide — the only thing a book without fiscal periods can be judged by.
 */
export const windowOf = (period: FiscalPeriod): PeriodWindow => ({
  periodId: period.id === '' ? null : period.id,
  range: { start: period.start, end: period.end },
});

/* ------------------------------------------------------------------ *
 * Banks and reconciliation
 * ------------------------------------------------------------------ */

export interface BankAccount {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly reference: string;
  readonly currency: string;
  readonly opening: number;
  readonly current: number;
  readonly ledgerAccountId: string | null;
  readonly active: boolean;
}

export function toBankAccount(row: DatasetRow): BankAccount | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    name: str(row.name),
    institution: str(row.institution),
    reference: str(row.account_reference),
    currency: asString(row.currency_code) ?? 'DZD',
    opening: num(row.opening_balance),
    current: num(row.current_balance),
    ledgerAccountId: asString(row.ledger_account_id),
    active: asBoolean(row.is_active) ?? true,
  };
}

export interface BankTransaction {
  readonly id: string;
  readonly statementId: string | null;
  readonly date: string;
  readonly kind: 'debit' | 'credit';
  readonly amount: number;
  readonly description: string;
  readonly reference: string;
  readonly state: MatchState;
  readonly matchedLineId: string | null;
  readonly matchedAt: string | null;
}

/**
 * What the line's own status column says, independent of what it points at.
 *
 * `ignored` is a decision rather than an omission: somebody looked at the line and
 * said it needs no ledger counterpart — a fee already accrued, a transfer booked
 * from the other side. Folding it back into "unmatched" would put it in front of
 * them again every morning.
 */
export type MatchState = 'unmatched' | 'matched' | 'ignored';

export const MATCH_STATE_LABEL: Readonly<Record<MatchState, Localized>> = {
  unmatched: { ar: 'غير مطابقة', fr: 'Non rapprochée', en: 'Unmatched' },
  matched: { ar: 'مطابقة', fr: 'Rapprochée', en: 'Matched' },
  ignored: { ar: 'مستثناة', fr: 'Ignorée', en: 'Ignored' },
};

export function toMatchState(value: unknown): MatchState {
  const text = status(value);
  if (text === 'matched' || text === 'reconciled' || text === 'cleared') return 'matched';
  if (text === 'ignored' || text === 'excluded') return 'ignored';
  return 'unmatched';
}

/**
 * A statement line's direction.
 *
 * Statements disagree about whether a withdrawal is `type: 'debit'`, a negative
 * amount, or both, so the direction is read from the type when it says something
 * and from the sign when it does not. `amount` is kept as its magnitude, because
 * a matcher comparing amounts should not also have to guess a convention.
 */
export function toBankTransaction(row: DatasetRow): BankTransaction | null {
  const id = asString(row.id);
  if (id === null) return null;
  const raw = num(row.amount);
  const text = status(row.type);
  const kind: 'debit' | 'credit' =
    text === 'debit' || text === 'withdrawal' || text === 'payment'
      ? 'debit'
      : text === 'credit' || text === 'deposit' || text === 'receipt'
        ? 'credit'
        : raw < 0
          ? 'debit'
          : 'credit';
  return {
    id,
    statementId: asString(row.statement_id),
    date: str(row.transaction_date),
    kind,
    amount: Math.abs(raw),
    description: str(row.description),
    reference: str(row.reference),
    state: toMatchState(row.status),
    matchedLineId: asString(row.matched_journal_line_id) ?? asString(row.matched_ledger_line_id),
    matchedAt: asString(row.matched_at),
  };
}

export const isMatched = (transaction: BankTransaction): boolean => transaction.matchedLineId !== null;

/**
 * A statement, which is the unit of reconciliation.
 *
 * `closing` is the number the exercise exists to agree with: when every line is
 * matched, the ledger balance of the mirrored account must equal it. `locked`
 * means somebody signed that off, and the server refuses to unmatch afterwards.
 */
export type StatementStatus = 'draft' | 'reconciled' | 'locked';

export const STATEMENT_STATUS_LABEL: Readonly<Record<StatementStatus, Localized>> = {
  draft: { ar: 'قيد العمل', fr: 'En cours', en: 'Draft' },
  reconciled: { ar: 'مطابق', fr: 'Rapproché', en: 'Reconciled' },
  locked: { ar: 'مقفل', fr: 'Verrouillé', en: 'Locked' },
};

export function toStatementStatus(value: unknown): StatementStatus {
  const text = status(value);
  if (text === 'locked' || text === 'closed') return 'locked';
  if (text === 'reconciled' || text === 'complete' || text === 'completed') return 'reconciled';
  return 'draft';
}

export interface BankStatement {
  readonly id: string;
  readonly accountId: string | null;
  readonly date: string;
  readonly opening: number;
  readonly closing: number;
  readonly status: StatementStatus;
  readonly createdAt: string | null;
}

export function toBankStatement(row: DatasetRow): BankStatement | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    accountId: asString(row.bank_account_id),
    date: str(row.statement_date),
    opening: num(row.start_balance),
    closing: num(row.end_balance),
    status: toStatementStatus(row.status),
    createdAt: asString(row.created_at),
  };
}

/* ------------------------------------------------------------------ *
 * Trial balance
 * ------------------------------------------------------------------ */

export interface TrialRow {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly debit: number;
  readonly credit: number;
  readonly balance: number;
  readonly lines: number;
}

export function toTrialRow(row: DatasetRow): TrialRow | null {
  const accountId = asString(row.account_id);
  const type = toAccountType(row.account_type);
  if (accountId === null || type === null) return null;
  return {
    accountId,
    code: str(row.code),
    name: str(row.name),
    type,
    currency: asString(row.currency_code) ?? 'DZD',
    debit: num(row.debit),
    credit: num(row.credit),
    balance: num(row.balance),
    lines: asNumber(row.line_count) ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * Budgets, cost centres, close tasks
 * ------------------------------------------------------------------ */

export interface Budget {
  readonly id: string;
  readonly periodId: string | null;
  readonly name: string;
  readonly status: string;
  readonly lockedAt: string | null;
}

export function toBudget(row: DatasetRow): Budget | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    periodId: asString(row.period_id),
    name: str(row.name),
    status: status(row.status),
    lockedAt: asString(row.locked_at),
  };
}

export interface BudgetLine {
  readonly id: string;
  readonly budgetId: string;
  readonly accountId: string;
  readonly dzd: number;
  readonly sar: number;
}

export function toBudgetLine(row: DatasetRow): BudgetLine | null {
  const id = asString(row.id);
  const budgetId = asString(row.budget_id);
  const accountId = asString(row.account_id);
  if (id === null || budgetId === null || accountId === null) return null;
  return { id, budgetId, accountId, dzd: num(row.amount_dzd), sar: num(row.amount_sar) };
}

/**
 * A cost centre. `id` is nullable on purpose: the broker projects an explicit
 * "General / unallocated" dimension so profitability can show what nothing was
 * allocated to, and that row genuinely has no group behind it.
 */
export interface CostCenter {
  readonly id: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly departureDate: string | null;
  readonly capacity: number | null;
}

export function toCostCenter(row: DatasetRow): CostCenter | null {
  const code = asString(row.code);
  if (code === null) return null;
  return {
    id: asString(row.id),
    code,
    name: str(row.name),
    kind: str(row.kind),
    status: status(row.status),
    departureDate: asString(row.departure_date),
    capacity: asNumber(row.capacity),
  };
}

export type TaskStatus = 'pending' | 'inProgress' | 'certified' | 'blocked';

export const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, Localized>> = {
  pending: { ar: 'قيد الانتظار', fr: 'À faire', en: 'Pending' },
  inProgress: { ar: 'جارية', fr: 'En cours', en: 'In progress' },
  certified: { ar: 'مصدّقة', fr: 'Certifiée', en: 'Certified' },
  blocked: { ar: 'معلّقة', fr: 'Bloquée', en: 'Blocked' },
};

export function toTaskStatus(value: unknown): TaskStatus {
  const text = status(value);
  if (text === 'certified' || text === 'complete' || text === 'completed' || text === 'done') return 'certified';
  if (text === 'in_progress' || text === 'started') return 'inProgress';
  if (text === 'blocked' || text === 'failed') return 'blocked';
  return 'pending';
}

export interface CloseTask {
  readonly id: string;
  readonly name: string;
  /**
   * Names — not ids — of tasks that must be certified first. `complete_close_task`
   * compares this array against `close_tasks.task_name`, so anything reading it as
   * a foreign key finds nothing.
   */
  readonly dependencies: readonly string[];
  readonly status: TaskStatus;
  readonly ownerId: string | null;
  readonly updatedAt: string | null;
}

export function toCloseTask(row: DatasetRow): CloseTask | null {
  const id = asString(row.id);
  if (id === null) return null;
  const raw = row.dependencies;
  const dependencies = Array.isArray(raw)
    ? raw.map((value) => asString(value)).filter((value): value is string => value !== null)
    : [];
  return {
    id,
    name: str(row.task_name),
    dependencies,
    status: toTaskStatus(row.certification_status),
    ownerId: asString(row.owner_id),
    updatedAt: asString(row.updated_at) ?? asString(row.created_at),
  };
}

/* ------------------------------------------------------------------ *
 * Tones
 * ------------------------------------------------------------------ */

/**
 * The colour a state wears, in one place.
 *
 * Every app in the suite shows one of these badges, and "posted" being green in
 * the journal and blue in the ledger is the kind of detail that makes a person
 * wonder whether they mean the same thing. They do.
 */
export const entryTone = (state: EntryStatus): Tone =>
  state === 'posted' ? 'success' : state === 'void' ? 'danger' : state === 'pending' ? 'warning' : 'neutral';

export const periodTone = (state: PeriodStatus): Tone =>
  state === 'closed' ? 'neutral' : state === 'closing' ? 'warning' : 'success';

export const taskTone = (state: TaskStatus): Tone =>
  state === 'certified' ? 'success' : state === 'blocked' ? 'danger' : state === 'inProgress' ? 'accent' : 'neutral';

/** A matched line is done; an unmatched one is work, not an error. */
export const matchTone = (state: MatchState): Tone =>
  state === 'matched' ? 'success' : state === 'ignored' ? 'neutral' : 'warning';

export const statementTone = (state: StatementStatus): Tone =>
  state === 'locked' ? 'neutral' : state === 'reconciled' ? 'success' : 'accent';
