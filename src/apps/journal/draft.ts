/**
 * Journal — the draft entry.
 *
 * A draft is what you are typing; a journal entry is what the books hold. This
 * module is the first of those, and it is pure: no React, no syscalls, every
 * function taking a draft and returning a new one. The dialog that edits it is a
 * view over these values, and the `.fxjournal` file is one serialised.
 *
 * Amounts are held as *text*, deliberately. `1` on the way to `1.5` is not the
 * number 1, and a field that reformats itself while you type it is a field you
 * cannot type in. They become numbers once, at the boundary, in `draftPayload`.
 *
 * The balance check counts centimes, not floats. `post_journal_entry` compares
 * its two totals with `<>` on Postgres `NUMERIC` — exact decimal arithmetic — so
 * an entry that is off by the 0.00000000004 that `0.1 + 0.2` leaves behind would
 * be rejected by the server after passing a tolerance check here. Integers agree
 * with the server exactly.
 */
import { fmt, type Localized } from '@/platform/sdk';
import { asNumber, asString } from '../shared/guards';
import type { JournalEntry, JournalLine } from '../shared/ledger';

/** Double entry needs two sides; the ceiling keeps one entry reviewable. */
export const MIN_LINES = 2;
export const MAX_LINES = 40;

export interface DraftLine {
  /** Stable identity for React and for the "balance this line" action. */
  readonly key: string;
  /** Empty until an account is chosen; the server rejects a line without one. */
  readonly accountId: string;
  readonly memo: string;
  readonly debit: string;
  readonly credit: string;
}

export interface Draft {
  readonly reference: string;
  /** ISO `yyyy-mm-dd`, as a date input gives it. */
  readonly date: string;
  readonly description: string;
  /**
   * One currency for the whole entry, applied to every line. An entry that
   * balances in two currencies at once does not balance.
   */
  readonly currency: string;
  readonly lines: readonly DraftLine[];
  /** Where this draft was read from, or last saved to. */
  readonly path: string | null;
}

let counter = 0;
/** Session-unique line key. Not persisted: the file stores order, not identity. */
const nextKey = (): string => {
  counter += 1;
  return `L${counter}`;
};

export const blankLine = (): DraftLine => ({ key: nextKey(), accountId: '', memo: '', debit: '', credit: '' });

export function emptyDraft(today: string, currency = 'DZD'): Draft {
  return {
    reference: '',
    date: today,
    description: '',
    currency,
    lines: [blankLine(), blankLine()],
    path: null,
  };
}

/** True once the draft holds anything a person would mind losing. */
export function hasContent(draft: Draft): boolean {
  if (draft.reference !== '' || draft.description !== '') return true;
  return draft.lines.some(
    (line) => line.accountId !== '' || line.memo !== '' || line.debit !== '' || line.credit !== '',
  );
}

/* ------------------------------------------------------------------ *
 * Edits
 * ------------------------------------------------------------------ */

export type DraftField = 'reference' | 'date' | 'description' | 'currency';

export const withField = (draft: Draft, field: DraftField, value: string): Draft => ({ ...draft, [field]: value });

export function addLine(draft: Draft): Draft {
  if (draft.lines.length >= MAX_LINES) return draft;
  return { ...draft, lines: [...draft.lines, blankLine()] };
}

/** Removing below two lines is refused rather than silently allowed. */
export function removeLine(draft: Draft, key: string): Draft {
  if (draft.lines.length <= MIN_LINES) return draft;
  return { ...draft, lines: draft.lines.filter((line) => line.key !== key) };
}

/**
 * Patches one line.
 *
 * Typing in one amount column clears the other: a line is a debit or a credit,
 * and the pair that would otherwise result is the single most common way a
 * hand-keyed entry goes wrong.
 */
export function patchLine(draft: Draft, key: string, patch: Partial<Omit<DraftLine, 'key'>>): Draft {
  const lines = draft.lines.map((line) => {
    if (line.key !== key) return line;
    const next = { ...line, ...patch };
    if (patch.debit !== undefined && patch.debit !== '') return { ...next, credit: '' };
    if (patch.credit !== undefined && patch.credit !== '') return { ...next, debit: '' };
    return next;
  });
  return { ...draft, lines };
}

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

/** Centimes, or `null` when the text is not a number. Empty reads as zero. */
export function minorOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const parsed = fmt.parseAmount(trimmed);
  if (parsed === null || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export interface DraftTotals {
  readonly debitMinor: number;
  readonly creditMinor: number;
  readonly debit: number;
  readonly credit: number;
  /** Debit less credit, in units. Zero exactly when the entry balances. */
  readonly difference: number;
  /** A line whose amount could not be read at all. */
  readonly malformed: boolean;
}

export function draftTotals(draft: Draft): DraftTotals {
  let debitMinor = 0;
  let creditMinor = 0;
  let malformed = false;
  for (const line of draft.lines) {
    const debit = minorOf(line.debit);
    const credit = minorOf(line.credit);
    if (debit === null || credit === null) {
      malformed = true;
      continue;
    }
    debitMinor += debit;
    creditMinor += credit;
  }
  return {
    debitMinor,
    creditMinor,
    debit: debitMinor / 100,
    credit: creditMinor / 100,
    difference: (debitMinor - creditMinor) / 100,
    malformed,
  };
}

/** The server's own two conditions: the sides agree, and the entry is not empty. */
export const isPostable = (totals: DraftTotals): boolean =>
  !totals.malformed && totals.debitMinor === totals.creditMinor && totals.debitMinor > 0;

/**
 * Writes the outstanding difference into one line.
 *
 * The side is chosen by which one closes the gap, not by which column happens to
 * be empty — an entry that is 500 short on credit gets 500 in credit, and the
 * line's other column is cleared so the result stays one-sided.
 */
export function autoBalance(draft: Draft, key: string): Draft {
  const totals = draftTotals(draft);
  if (totals.malformed || totals.difference === 0) return draft;
  const line = draft.lines.find((candidate) => candidate.key === key);
  if (line === undefined) return draft;
  const own = minorOf(line.debit) ?? 0;
  const owed = minorOf(line.credit) ?? 0;
  // The line's own contribution is excluded, so balancing twice is idempotent.
  const rest = totals.debitMinor - own - (totals.creditMinor - owed);
  if (rest === 0) return draft;
  const value = (Math.abs(rest) / 100).toFixed(2);
  return rest > 0 ? patchLine(draft, key, { credit: value }) : patchLine(draft, key, { debit: value });
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type ProblemField = 'reference' | 'date' | 'lines' | 'accounts' | 'amounts' | 'balance';

export interface Problem {
  readonly field: ProblemField;
  readonly text: Localized;
}

const PROBLEM_TEXT: Readonly<Record<ProblemField, Localized>> = {
  reference: { ar: 'المرجع مطلوب.', fr: 'La référence est obligatoire.', en: 'A reference is required.' },
  date: { ar: 'التاريخ غير صالح.', fr: 'La date est invalide.', en: 'The date is not valid.' },
  lines: {
    ar: 'يحتاج القيد إلى سطرين على الأقل.',
    fr: 'Une écriture exige au moins deux lignes.',
    en: 'An entry needs at least two lines.',
  },
  accounts: {
    ar: 'كل سطر يحتاج إلى حساب.',
    fr: 'Chaque ligne doit porter un compte.',
    en: 'Every line needs an account.',
  },
  amounts: {
    ar: 'مبلغ غير مقروء أو سطر بدون مبلغ.',
    fr: 'Montant illisible ou ligne sans montant.',
    en: 'An amount is unreadable, or a line carries none.',
  },
  balance: {
    ar: 'المدين والدائن غير متساويين.',
    fr: 'Le débit et le crédit ne s’équilibrent pas.',
    en: 'Debit and credit do not balance.',
  },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A line carrying an account but no amount at all — filled in, but not finished. */
const isSilent = (line: DraftLine): boolean =>
  line.accountId !== '' && (minorOf(line.debit) ?? 0) === 0 && (minorOf(line.credit) ?? 0) === 0;

/**
 * Everything wrong with the draft, in the order a person would fix it.
 *
 * The list is what the dialog shows and what disables its primary button, so it
 * has to be exhaustive rather than first-failure: fixing one problem and being
 * shown the next one is how a form wastes an afternoon.
 */
export function validateDraft(draft: Draft): readonly Problem[] {
  const problems: Problem[] = [];
  const totals = draftTotals(draft);
  const add = (field: ProblemField) => problems.push({ field, text: PROBLEM_TEXT[field] });

  if (draft.reference.trim() === '') add('reference');
  if (!ISO_DATE.test(draft.date) || Number.isNaN(Date.parse(draft.date))) add('date');
  if (draft.lines.length < MIN_LINES) add('lines');
  if (draft.lines.some((line) => line.accountId === '')) add('accounts');
  if (totals.malformed || draft.lines.some(isSilent)) add('amounts');
  if (totals.debitMinor !== totals.creditMinor || totals.debitMinor === 0) add('balance');
  return problems;
}

/* ------------------------------------------------------------------ *
 * Duplication
 * ------------------------------------------------------------------ */

/** An amount from the books, as the field would hold it. Zero stays empty. */
const draftAmount = (value: number): string => (value === 0 ? '' : value.toFixed(2));

/**
 * An existing entry, reopened as a new draft.
 *
 * Two fields are deliberately not copied. The date becomes today, because a
 * duplicate is a new entry and not a re-dating of an old one; and the reference is
 * cleared, because references identify entries — reusing one is how two months'
 * postings end up looking like the same document. `validateDraft` will ask for the
 * new one before anything can be created.
 *
 * The lines are copied as they were booked, so the duplicate balances if the
 * original did.
 */
export function draftFromEntry(
  entry: JournalEntry,
  lines: readonly JournalLine[],
  today: string,
): Draft {
  const copied = lines.map((line) => ({
    key: nextKey(),
    accountId: line.accountId ?? '',
    memo: line.memo,
    debit: draftAmount(line.debit),
    credit: draftAmount(line.credit),
  }));
  while (copied.length < MIN_LINES) copied.push(blankLine());
  return {
    reference: '',
    date: today,
    description: entry.description,
    currency: lines.length === 0 ? 'DZD' : lines[0].currency,
    lines: copied,
    path: null,
  };
}

/* ------------------------------------------------------------------ *
 * The wire payload
 * ------------------------------------------------------------------ */

/**
 * `journal.create`, as the broker's binding names its fields.
 *
 * The line keys are snake_case because they are not the broker's — it forwards
 * the array to `post_journal_entry` verbatim, and the RPC reads
 * `account_id`/`debit`/`credit`/`currency_code`/`memo` out of the JSON itself.
 * `currency_code` is always sent: the RPC's own default is SAR, and an entry
 * silently booked in the wrong currency is worse than one that was refused.
 *
 * Amounts go out through centimes so the two totals the server compares are the
 * two totals shown here.
 */
export function draftPayload(draft: Draft): Readonly<Record<string, unknown>> {
  const lines = draft.lines
    .filter((line) => line.accountId !== '')
    .map((line) => ({
      account_id: line.accountId,
      debit: (minorOf(line.debit) ?? 0) / 100,
      credit: (minorOf(line.credit) ?? 0) / 100,
      currency_code: draft.currency,
      memo: line.memo.trim(),
    }));
  return {
    reference: draft.reference.trim(),
    entryDate: draft.date,
    description: draft.description.trim(),
    lines,
  };
}

/* ------------------------------------------------------------------ *
 * The `.fxjournal` file
 * ------------------------------------------------------------------ */

const FILE_KIND = 'financeos.journal.draft';
const FILE_VERSION = 1;

/** Pretty-printed: a draft is a document, and documents get diffed by people. */
export function serialiseDraft(draft: Draft): string {
  return `${JSON.stringify(
    {
      kind: FILE_KIND,
      version: FILE_VERSION,
      reference: draft.reference,
      date: draft.date,
      description: draft.description,
      currency: draft.currency,
      lines: draft.lines.map((line) => ({
        account_id: line.accountId,
        memo: line.memo,
        debit: minorOf(line.debit) === null ? line.debit : (minorOf(line.debit) ?? 0) / 100,
        credit: minorOf(line.credit) === null ? line.credit : (minorOf(line.credit) ?? 0) / 100,
      })),
    },
    null,
    2,
  )}\n`;
}

/** An amount from a file: a number, or text that was already text. */
const amountText = (value: unknown): string => {
  const numeric = asNumber(value);
  if (numeric !== null) return numeric === 0 ? '' : numeric.toFixed(2);
  return asString(value) ?? '';
};

function fileLine(value: unknown): DraftLine {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Readonly<Record<string, unknown>>;
  return {
    key: nextKey(),
    accountId: asString(row.account_id) ?? '',
    memo: asString(row.memo) ?? '',
    debit: amountText(row.debit),
    credit: amountText(row.credit),
  };
}

/**
 * Reads a `.fxjournal`.
 *
 * Returns `null` for anything that is not one — a JSON file that happens to
 * parse is not a draft, so the `kind` marker is checked rather than assumed. A
 * file with fewer than two lines is padded rather than rejected: it is a draft,
 * being incomplete is its normal state.
 */
export function parseDraftFile(text: string, today: string): Draft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const root = parsed as Readonly<Record<string, unknown>>;
  if (asString(root.kind) !== FILE_KIND) return null;
  const raw = Array.isArray(root.lines) ? root.lines : [];
  const lines = raw.map(fileLine);
  while (lines.length < MIN_LINES) lines.push(blankLine());
  return {
    reference: asString(root.reference) ?? '',
    date: asString(root.date) ?? today,
    description: asString(root.description) ?? '',
    currency: asString(root.currency) ?? 'DZD',
    lines,
    path: null,
  };
}

/** `2026-02-14.fxjournal`, or the reference when there is one. */
export function suggestedFileName(draft: Draft): string {
  const stem = draft.reference.trim() === '' ? draft.date : draft.reference.trim();
  return `${stem.replace(/[\\/:*?"<>|]/g, '-')}.fxjournal`;
}
