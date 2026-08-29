/**
 * Reconciliation — the matcher.
 *
 * Pure arithmetic over rows already loaded, and deliberately so: the broker's
 * `where` speaks `eq`, `in` and `is null` and nothing else, so "an amount within a
 * centime, a date within three days" cannot be asked of the server. It is computed
 * here, over the page the app was handed, and the status bar says how big that page
 * was — a suggestion drawn from half the statement is worse than no suggestion.
 *
 * The rules split in two, and confusing them is how a reconciliation tool becomes
 * a liar:
 *
 *   • **Hard.** `match_bank_transaction` refuses unless the amounts agree within
 *     one centime, the entry is POSTED, the line is not already reconciled, and the
 *     statement line is not already matched. A pairing that fails any of these is
 *     never offered — the server would throw it back, and an offer the server
 *     refuses teaches somebody to stop trusting the list.
 *   • **Soft.** Direction, date proximity, reference and memo similarity only rank
 *     what is already legal. Note the server's own sweep additionally insists the
 *     directions agree; the manual RPC does not, so direction is scored, not
 *     enforced, and a deliberate cross-direction match stays possible.
 *
 * Amounts here are magnitudes. `BankTransaction.amount` is `Math.abs`, and a
 * ledger line's amount is `|debit − credit|`, which is exactly the expression the
 * RPC compares against.
 */
import type { Localized, Tone } from '@/platform/sdk';
import { EPSILON, type BankStatement, type BankTransaction, type JournalLine } from '../shared/ledger';

/** The centime of tolerance `match_bank_transaction` allows on the amounts. */
export const MATCH_TOLERANCE = 0.01;

/** Days either side of a statement date that still read as the same event. */
export const NEAR_DAYS = 3;

/** Days beyond which proximity says nothing at all. */
export const FAR_DAYS = 10;

/** Candidates offered for one statement line before the list stops being a list. */
export const CANDIDATE_LIMIT = 6;

/** Near misses shown for context. Three is enough to spot a bank fee. */
export const NEAR_MISS_LIMIT = 3;

/* ------------------------------------------------------------------ *
 * The ledger side
 * ------------------------------------------------------------------ */

/**
 * A journal line with the two things its own row does not carry: the entry's
 * business date and whether that entry is posted.
 *
 * `journal_lines` has a `created_at` and nothing else temporal — the server's own
 * sweep matches on it, which dates a line by when it was typed rather than by when
 * the money moved. This app dates it by `journal_entries.entry_date`, because that
 * is the date a person reconciling against a statement is thinking of, and the
 * manual RPC applies no date rule of its own to disagree with.
 */
export interface LedgerRow {
  readonly line: JournalLine;
  readonly reference: string;
  readonly date: string;
  readonly posted: boolean;
  readonly accountLabel: string;
  /** Which column carries the value, the way the statement would say it. */
  readonly kind: 'debit' | 'credit';
  /** `|debit − credit|` — the expression the server compares. */
  readonly amount: number;
}

/** Everything the server insists on, in one predicate. */
export const isEligible = (row: LedgerRow): boolean => row.posted && !row.line.reconciled;

/* ------------------------------------------------------------------ *
 * Signals
 * ------------------------------------------------------------------ */

export type MatchSignal =
  | 'amount'
  | 'rounding'
  | 'direction'
  | 'reference'
  | 'partial'
  | 'sameDay'
  | 'nearDay'
  | 'memo';

/** Why a candidate is where it is in the list, in words somebody can argue with. */
export const SIGNAL_LABEL: Readonly<Record<MatchSignal, Localized>> = {
  amount: { ar: 'المبلغ مطابق', fr: 'Montant identique', en: 'Same amount' },
  rounding: { ar: 'فرق تقريب', fr: 'Écart d’arrondi', en: 'Rounding' },
  direction: { ar: 'الاتجاه مطابق', fr: 'Sens identique', en: 'Same direction' },
  reference: { ar: 'المرجع مطابق', fr: 'Référence identique', en: 'Same reference' },
  partial: { ar: 'مرجع متقارب', fr: 'Référence proche', en: 'Similar reference' },
  sameDay: { ar: 'التاريخ نفسه', fr: 'Même date', en: 'Same day' },
  nearDay: { ar: 'تاريخ قريب', fr: 'Date proche', en: 'Nearby date' },
  memo: { ar: 'الوصف متقارب', fr: 'Libellé proche', en: 'Similar wording' },
};

const WEIGHT: Readonly<Record<MatchSignal, number>> = {
  amount: 50,
  rounding: 42,
  direction: 18,
  reference: 22,
  partial: 12,
  sameDay: 10,
  nearDay: 6,
  memo: 8,
};

/** The best score a pairing can reach: exact amount, same side, same reference, same day, same words. */
export const PERFECT = WEIGHT.amount + WEIGHT.direction + WEIGHT.reference + WEIGHT.sameDay + WEIGHT.memo;

export type Confidence = 'certain' | 'likely' | 'possible';

export const CONFIDENCE_LABEL: Readonly<Record<Confidence, Localized>> = {
  certain: { ar: 'مؤكد', fr: 'Certain', en: 'Certain' },
  likely: { ar: 'مرجّح', fr: 'Probable', en: 'Likely' },
  possible: { ar: 'محتمل', fr: 'Possible', en: 'Possible' },
};

/** Green for the ones a machine may take, accent for the ones worth a glance. */
export const confidenceTone = (confidence: Confidence): Tone =>
  confidence === 'certain' ? 'success' : confidence === 'likely' ? 'accent' : 'neutral';

export interface Candidate {
  readonly row: LedgerRow;
  readonly score: number;
  readonly signals: readonly MatchSignal[];
  readonly confidence: Confidence;
  /** Ledger amount less statement amount. Zero for anything offered as a match. */
  readonly delta: number;
  readonly days: number | null;
}

export interface CandidateSet {
  /** Pairings the server would accept, best first. */
  readonly matches: readonly Candidate[];
  /**
   * Pairings whose amounts disagree.
   *
   * Shown and never offered. A statement line 150,00 heavier than the entry it
   * obviously belongs to is a bank fee nobody booked, and the answer is a journal
   * entry — not a match the server would refuse anyway.
   */
  readonly near: readonly Candidate[];
}

/* ------------------------------------------------------------------ *
 * Text and dates
 * ------------------------------------------------------------------ */

const PUNCTUATION = /[\s\p{P}\p{S}]+/gu;
const WORDS = /[^\p{L}\p{N}]+/u;
const MIN_WORD = 3;

/** Compares references the way a person does: ignoring spacing and punctuation. */
const key = (value: string): string => value.toLowerCase().replace(PUNCTUATION, '');

const words = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(WORDS)
    .filter((word) => word.length >= MIN_WORD);

/** Shared words over the shorter side, so a long memo cannot dilute a real hit. */
function overlap(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(b);
  const shared = a.filter((word) => set.has(word)).length;
  return shared / Math.min(a.length, b.length);
}

const DAY_MS = 86_400_000;

/** Whole days between two ISO dates, or `null` when either is unreadable. */
export function daysApart(left: string, right: string): number | null {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round(Math.abs(a - b) / DAY_MS);
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

function referenceSignal(transaction: BankTransaction, row: LedgerRow): MatchSignal | null {
  const left = key(transaction.reference);
  const right = key(row.reference);
  if (left.length < MIN_WORD || right.length < MIN_WORD) return null;
  if (left === right) return 'reference';
  return left.includes(right) || right.includes(left) ? 'partial' : null;
}

function daySignal(days: number | null): MatchSignal | null {
  if (days === null) return null;
  if (days === 0) return 'sameDay';
  return days <= NEAR_DAYS ? 'nearDay' : null;
}

/** How the pairing scores, and every reason it does. Order is display order. */
export function score(transaction: BankTransaction, row: LedgerRow): Candidate {
  const delta = row.amount - transaction.amount;
  const gap = Math.abs(delta);
  const days = daysApart(transaction.date, row.date);
  const signals: MatchSignal[] = [];
  if (gap < EPSILON) signals.push('amount');
  else if (gap <= MATCH_TOLERANCE) signals.push('rounding');
  if (transaction.kind === row.kind) signals.push('direction');
  const reference = referenceSignal(transaction, row);
  if (reference !== null) signals.push(reference);
  const day = daySignal(days);
  if (day !== null) signals.push(day);
  const memo = overlap(transaction.description, `${row.line.memo} ${row.reference}`);
  if (memo >= 0.5) signals.push('memo');
  const total = signals.reduce((sum, signal) => sum + WEIGHT[signal], 0);
  return { row, score: total, signals, confidence: confidenceOf(signals, total), delta, days };
}

/**
 * Certainty is not a high score; it is the absence of a question.
 *
 * The amount has to be exact rather than merely tolerable, the sides have to
 * agree, and something has to tie the two rows to the same event — a reference or
 * a date. Everything else is a suggestion for a person, and `planAutoMatch` will
 * not act on it.
 */
function confidenceOf(signals: readonly MatchSignal[], total: number): Confidence {
  const has = (signal: MatchSignal): boolean => signals.includes(signal);
  if (has('amount') && has('direction') && (has('reference') || has('sameDay'))) return 'certain';
  return total >= WEIGHT.amount + WEIGHT.direction ? 'likely' : 'possible';
}

/** Best first; equal scores broken by the nearer date, then the smaller amount gap. */
function rank(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;
  const days = (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER);
  if (days !== 0) return days;
  return Math.abs(a.delta) - Math.abs(b.delta);
}

/**
 * What could pair with one statement line.
 *
 * `claimed` holds line ids already spoken for by an earlier decision in the same
 * sweep — the loaded page still shows them as unreconciled, because the refetch
 * has not landed yet, and offering the same entry to two statement lines is how a
 * batch double-books.
 */
export function candidatesFor(
  transaction: BankTransaction,
  rows: readonly LedgerRow[],
  claimed: ReadonlySet<string> = new Set<string>(),
): CandidateSet {
  const matches: Candidate[] = [];
  const near: Candidate[] = [];
  for (const row of rows) {
    if (!isEligible(row) || claimed.has(row.line.id)) continue;
    const candidate = score(transaction, row);
    if (Math.abs(candidate.delta) <= MATCH_TOLERANCE) matches.push(candidate);
    else if (isNearMiss(transaction, candidate)) near.push(candidate);
  }
  matches.sort(rank);
  near.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  return { matches: matches.slice(0, CANDIDATE_LIMIT), near: near.slice(0, NEAR_MISS_LIMIT) };
}

/**
 * A near miss is a line that clearly belongs to the same event and disagrees about
 * the money: within a tenth of the amount, or within a day of the date and sharing
 * a reference. Anything looser is noise, and a pane full of noise gets ignored.
 */
function isNearMiss(transaction: BankTransaction, candidate: Candidate): boolean {
  const gap = Math.abs(candidate.delta);
  if (transaction.amount > 0 && gap / transaction.amount <= 0.1) return true;
  const tied = candidate.signals.includes('reference') || candidate.signals.includes('partial');
  return tied && candidate.days !== null && candidate.days <= NEAR_DAYS;
}

/* ------------------------------------------------------------------ *
 * The cheap index
 * ------------------------------------------------------------------ */

/**
 * How many eligible ledger lines carry each amount.
 *
 * The ranked list is worth its cost for one row at a time; paying it for every row
 * of a five-hundred-line statement is a hundred and fifty thousand scorings, and the
 * grid only needs to answer a much smaller question — *is there anything on the
 * other side this line could legally pair with?* One pass over the ledger answers it
 * for every statement line at once.
 *
 * Keyed in whole centimes, because a float is a poor map key and the server's own
 * comparison is a centime wide anyway.
 */
export type AmountIndex = ReadonlyMap<number, number>;

const centimes = (value: number): number => Math.round(value * 100);

export function amountIndex(rows: readonly LedgerRow[]): AmountIndex {
  const out = new Map<number, number>();
  for (const row of rows) {
    if (!isEligible(row)) continue;
    const key = centimes(row.amount);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * Eligible lines whose amount the server would accept against this one.
 *
 * Three buckets, because the tolerance is one centime either side. This counts what
 * is *legal*, not what is likely — a count of four means somebody has to choose, and
 * that is the whole message.
 */
export function candidateCount(index: AmountIndex, amount: number): number {
  const key = centimes(amount);
  return (index.get(key - 1) ?? 0) + (index.get(key) ?? 0) + (index.get(key + 1) ?? 0);
}

/* ------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------ */

export interface AutoMatch {
  readonly transaction: BankTransaction;
  readonly candidate: Candidate;
}

/**
 * The pairings a machine may make on its own.
 *
 * Two rules, and the second is the one that matters. A pairing must be `certain`,
 * and it must be *unambiguous*: if a second candidate scores the same, the sweep
 * skips the line and leaves it for a person. Two identical 1 200,00 payments on the
 * same day are precisely the case where an auto-matcher does damage, and the cost
 * of skipping is one manual decision.
 *
 * Oldest line first, because a statement is worked forwards, and each accepted
 * pairing claims its ledger line so the next line cannot take it too.
 */
export function planAutoMatch(
  transactions: readonly BankTransaction[],
  rows: readonly LedgerRow[],
): readonly AutoMatch[] {
  const queue = transactions.filter((transaction) => transaction.state === 'unmatched');
  const ordered = [...queue].sort((a, b) => a.date.localeCompare(b.date));
  const claimed = new Set<string>();
  const plan: AutoMatch[] = [];
  for (const transaction of ordered) {
    const { matches } = candidatesFor(transaction, rows, claimed);
    const best = matches[0];
    if (best === undefined || best.confidence !== 'certain') continue;
    const runnerUp = matches[1];
    if (runnerUp !== undefined && runnerUp.score === best.score) continue;
    claimed.add(best.row.line.id);
    plan.push({ transaction, candidate: best });
  }
  return plan;
}

/* ------------------------------------------------------------------ *
 * The arithmetic of the exercise
 * ------------------------------------------------------------------ */

/** Money in less money out, from the account holder's side. */
export const movementOf = (transactions: readonly BankTransaction[]): number =>
  transactions.reduce((sum, item) => sum + (item.kind === 'debit' ? item.amount : -item.amount), 0);

const bookMovementOf = (rows: readonly LedgerRow[]): number =>
  rows.reduce((sum, row) => (row.posted ? sum + row.line.debit - row.line.credit : sum), 0);

/**
 * The four numbers a reconciliation is judged by.
 *
 * `difference` is the point of the exercise: what the statement moved less what the
 * book moved. It is explained by the unmatched lines on either side, and it is zero
 * when there are none. `drift` is a different animal — the statement failing its
 * own arithmetic, opening plus movement not landing on closing — which is a data
 * problem no amount of matching will fix, so it is named separately rather than
 * folded into the difference and blamed on the ledger.
 */
export interface Reconciliation {
  readonly statement: BankStatement | null;
  readonly total: number;
  readonly matched: number;
  readonly ignored: number;
  readonly open: number;
  readonly ratio: number;
  readonly movement: number;
  readonly matchedValue: number;
  readonly openValue: number;
  readonly bookMovement: number;
  readonly difference: number;
  readonly drift: number | null;
}

export function reconcile(
  statement: BankStatement | null,
  transactions: readonly BankTransaction[],
  rows: readonly LedgerRow[],
): Reconciliation {
  const matched = transactions.filter((item) => item.state === 'matched');
  const ignored = transactions.filter((item) => item.state === 'ignored');
  const open = transactions.filter((item) => item.state === 'unmatched');
  const decided = matched.length + ignored.length;
  const movement = movementOf(transactions);
  const bookMovement = bookMovementOf(rows);
  return {
    statement,
    total: transactions.length,
    matched: matched.length,
    ignored: ignored.length,
    open: open.length,
    ratio: transactions.length === 0 ? 1 : decided / transactions.length,
    movement,
    matchedValue: movementOf(matched),
    openValue: movementOf(open),
    bookMovement,
    difference: movement - bookMovement,
    drift: statement === null ? null : statement.opening + movement - statement.closing,
  };
}

/** Below half a centime, a difference is floating-point noise, not a discrepancy. */
export const isAgreed = (value: number): boolean => Math.abs(value) < EPSILON;
