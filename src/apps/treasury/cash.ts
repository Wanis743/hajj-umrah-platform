/**
 * Treasury — the figures, and what each one is allowed to claim.
 *
 * Three lenses over one row shape. A bank account, a supplier bill and an unsettled
 * invoice have nothing in common as records, but they are the same *kind* of thing to
 * a treasurer at nine in the morning: an amount, a date it matters on, and a reason
 * it might be wrong. So each is mapped to a {@link CashRow} and the grid, the search,
 * the ranking and the export are written once — the same trick the inbox plays on
 * three sources of work.
 *
 * Nothing here formats and nothing here fetches. Every figure is a function of the
 * pages the broker returned, of `today`, and of the horizon the rail is set to, which
 * is what makes the same page render the same numbers twice.
 *
 * The one piece of arithmetic worth reading twice is the bank-against-book gap. The
 * bank side is `bank_accounts.current_balance`, a stored column somebody or something
 * maintains; the book side is the trial balance of the account it says it mirrors.
 * They are two different claims about the same money, and this window's job is to put
 * them beside each other rather than to decide between them. An account with no
 * `ledger_account_id` has no book side at all, and its row says so instead of showing
 * a gap equal to its whole balance.
 */
import type { Localized, Tone } from '@/platform/sdk';
import {
  type BankAccount,
  type BankStatement,
  type BankTransaction,
  type Currency,
  EPSILON,
  toCurrency,
  type TrialRow,
} from '../shared/ledger';
import {
  arrived,
  BILL_STATE_LABEL,
  type Bill,
  billTone,
  expected,
  INVOICE_STATE_LABEL,
  type Invoice,
  invoiceTone,
  owed,
  type Payment,
} from './sources';
import { EMPTY_PURSE, plus, priced, type Purse, type RateBook, reported } from './rates';

/* ------------------------------------------------------------------ *
 * The question this window is set to
 * ------------------------------------------------------------------ */

/** Where the cash is, what leaves, what arrives. Three questions, three row sets. */
export type Lens = 'cash' | 'payable' | 'receivable';

export const LENSES: readonly Lens[] = ['cash', 'payable', 'receivable'];

export const LENS_LABEL: Readonly<Record<Lens, Localized>> = {
  cash: { ar: 'النقدية', fr: 'Trésorerie', en: 'Cash' },
  payable: { ar: 'المستحقّ للدفع', fr: 'À payer', en: 'Payable' },
  receivable: { ar: 'المستحقّ للتحصيل', fr: 'À encaisser', en: 'Receivable' },
};

export const LENS_UNIT: Readonly<Record<Lens, Localized>> = {
  cash: { ar: 'حساب', fr: 'comptes', en: 'accounts' },
  payable: { ar: 'فاتورة مورّد', fr: 'factures fournisseur', en: 'supplier bills' },
  receivable: { ar: 'فاتورة عميل', fr: 'factures client', en: 'customer invoices' },
};

/**
 * How far ahead the window is looking, in days.
 *
 * A week is the payment run; a month is the cash cycle; two and three are what a
 * departure season is planned in. Not a free number, because a horizon typed into a
 * box invites a reader to find the one that makes the forecast look survivable.
 */
export type Horizon = 7 | 30 | 60 | 90;

export const HORIZONS: readonly Horizon[] = [7, 30, 60, 90];

/** Which side of the horizon a date falls on. `undated` is a row with no due date. */
export type Bucket = 'overdue' | 'soon' | 'later' | 'undated';

export const BUCKET_LABEL: Readonly<Record<Bucket, Localized>> = {
  overdue: { ar: 'متأخّر', fr: 'En retard', en: 'Overdue' },
  soon: { ar: 'داخل الأفق', fr: "Dans l'horizon", en: 'Within the horizon' },
  later: { ar: 'بعد الأفق', fr: "Au-delà de l'horizon", en: 'Beyond the horizon' },
  undated: { ar: 'بلا تاريخ استحقاق', fr: "Sans échéance", en: 'No due date' },
};

export const bucketTone = (bucket: Bucket): Tone =>
  bucket === 'overdue' ? 'danger' : bucket === 'soon' ? 'warning' : bucket === 'later' ? 'neutral' : 'accent';

export type Sort = 'amount' | 'due' | 'name';

export const SORT_LABEL: Readonly<Record<Sort, Localized>> = {
  amount: { ar: 'المبلغ', fr: 'Montant', en: 'Amount' },
  due: { ar: 'الاستحقاق', fr: 'Échéance', en: 'Due date' },
  name: { ar: 'الاسم', fr: 'Nom', en: 'Name' },
};

const DAY_MS = 86_400_000;

/**
 * Whole days from one ISO date to another, signed.
 *
 * Negative means the second date has passed. Both sides are truncated to a day
 * because a due date is a day and not an instant, and a bill due today should not
 * read as overdue because the page loaded at two in the afternoon.
 */
export function daysUntil(today: string, date: string): number | null {
  if (date === '') return null;
  const from = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

export function bucketOf(due: string | null, today: string, horizon: Horizon): Bucket {
  const days = due === null ? null : daysUntil(today, due);
  if (days === null) return 'undated';
  if (days < 0) return 'overdue';
  return days <= horizon ? 'soon' : 'later';
}

/* ------------------------------------------------------------------ *
 * Notes: the reason a row is not quite what it looks like
 * ------------------------------------------------------------------ */

/**
 * Eight ways a figure in this window is qualified.
 *
 * A row carries at most one, the most consequential, because a line of small print
 * per row is small print nobody reads. The short label goes in the grid and the
 * sentence goes in the pane, and both come from here so a reader who asks "why" twice
 * gets the same answer with more of it.
 */
export type NoteId =
  | 'unlinked'
  | 'dormant'
  | 'stale'
  | 'unreconciled'
  | 'wholeInvoice'
  | 'restated'
  | 'undated'
  | 'mistimed';

export const NOTE_LABEL: Readonly<Record<NoteId, Localized>> = {
  unlinked: { ar: 'غير مرتبط بالدفتر', fr: 'Non rattaché', en: 'Not linked' },
  dormant: { ar: 'حساب موقوف', fr: 'Compte inactif', en: 'Inactive account' },
  stale: { ar: 'كشف قديم', fr: 'Relevé ancien', en: 'Old statement' },
  unreconciled: { ar: 'أسطر غير مطابقة', fr: 'Lignes non rapprochées', en: 'Unmatched lines' },
  wholeInvoice: { ar: 'محسوبة بالكامل', fr: 'Comptée en entier', en: 'Counted whole' },
  restated: { ar: 'عملة مُعاد قراءتها', fr: 'Monnaie relue', en: 'Currency re-read' },
  undated: { ar: 'خارج الأفق', fr: "Hors horizon", en: 'Outside the horizon' },
  mistimed: { ar: 'حالة لم تُحدَّث', fr: 'Statut non à jour', en: 'Status not updated' },
};

export const NOTE_REASON: Readonly<Record<NoteId, Localized>> = {
  unlinked: {
    ar: 'هذا الحساب البنكي لا يشير إلى حساب في الدفتر، فلا وجود لطرف دفتري يقابله. الرصيد صحيح، لكنه غير قابل للمقارنة.',
    fr: "Ce compte bancaire ne désigne aucun compte du grand livre : il n'a pas de contrepartie comptable. Le solde est exact, simplement incomparable.",
    en: 'This bank account names no ledger account, so it has no book side at all. The balance is accurate; it is simply not comparable to anything.',
  },
  dormant: {
    ar: 'الحساب موسوم بأنه غير نشط ومع ذلك يحمل رصيدًا. إمّا أن الرصيد يجب أن يُحوَّل، أو أن الوسم خطأ.',
    fr: "Le compte est marqué inactif et porte pourtant un solde. Soit il faut le virer, soit le marqueur est faux.",
    en: 'The account is marked inactive and still holds a balance. Either the money should be moved, or the flag is wrong.',
  },
  stale: {
    ar: 'لم يُحمَّل كشف لهذا الحساب منذ فترة طويلة، فالمقارنة بين البنك والدفتر تقارن رقمًا حديثًا بآخر قديم.',
    fr: "Aucun relevé récent pour ce compte : la comparaison banque / livre oppose un chiffre frais à un chiffre ancien.",
    en: 'No statement has been loaded for this account in a long while, so the bank-against-book comparison is holding a fresh figure against an old one.',
  },
  unreconciled: {
    ar: 'يوجد أسطر كشف لم تُطابَق بعد. الفرق بين البنك والدفتر يُقرأ من خلالها أولًا.',
    fr: "Des lignes de relevé ne sont pas encore rapprochées. L'écart banque / livre se lit d'abord à travers elles.",
    en: 'Statement lines are still unmatched. The gap between bank and book is read through those first.',
  },
  wholeInvoice: {
    ar: 'الفاتورة محصَّلة جزئيًا وتُحسب بقيمتها الكاملة: ما تم تحصيله مقابلها غير متاح للتطبيقات.',
    fr: "Facture partiellement réglée, comptée à sa valeur totale : ce qui a été encaissé dessus n'est pas exposé aux applications.",
    en: 'A partly settled invoice, counted at its full value: what has been collected against it is not exposed to an app.',
  },
  restated: {
    ar: 'عمود العملة يخالف عمود المبلغ المملوء، فقُرئ المبلغ بعملته الفعلية. يستحقّ السطر تصحيحًا في المصدر.',
    fr: "La colonne monnaie contredit la colonne montant renseignée ; le montant a été lu dans sa monnaie réelle. La ligne mérite une correction à la source.",
    en: 'The currency column contradicts the amount column that is filled in, so the amount was read in the currency it is actually in. The row deserves fixing at the source.',
  },
  undated: {
    ar: 'لا تاريخ استحقاق، فلا يمكن إدراج السطر في أفق. المبلغ حقيقي والتوقيت مجهول.',
    fr: "Sans échéance, la ligne ne peut entrer dans aucun horizon. Le montant est réel, le moment est inconnu.",
    en: 'With no due date the row cannot be placed in a horizon. The amount is real; the timing is unknown.',
  },
  mistimed: {
    ar: 'تاريخ الاستحقاق مضى والحالة لم تُحدَّث إلى «متأخّرة». التقادم في هذه النافذة محسوب من التاريخ لا من الحالة.',
    fr: "L'échéance est passée sans que le statut soit passé à « en retard ». Cette fenêtre vieillit par la date, pas par le statut.",
    en: 'The due date has passed and the status was never moved to overdue. This window ages rows by the date, not by the status.',
  },
};

/* ------------------------------------------------------------------ *
 * Positions: one bank account, twice
 * ------------------------------------------------------------------ */

/** Days after which a loaded statement stops being evidence about today. */
export const STALE_DAYS = 45;

/** Relative gap past which "the two disagree" becomes "something is wrong". */
const GAP_ALARM = 0.02;

export interface Position {
  readonly account: BankAccount;
  readonly currency: Currency;
  /** The bank's own figure: a stored column, maintained by whoever imports statements. */
  readonly bank: number;
  /** True when the account names a ledger account, whether or not one came back. */
  readonly linked: boolean;
  readonly trial: TrialRow | null;
  /** The book's figure, or `null` when there is nothing to compare against. */
  readonly book: number | null;
  readonly gap: number | null;
  readonly statement: BankStatement | null;
  readonly statements: number;
  readonly unmatched: number;
  readonly matched: number;
  readonly note: NoteId | null;
}

/**
 * A gap is a question, not an error.
 *
 * Two per mille of a balance is timing — a cheque in the post, a fee posted a day
 * late. Two percent of it is a morning's work. The threshold is relative because an
 * absolute one would call a rounding difference on a large account an emergency and
 * a genuine hole in a small one a rounding difference.
 */
export function gapTone(gap: number | null, bank: number): Tone {
  if (gap === null) return 'neutral';
  if (Math.abs(gap) < EPSILON) return 'success';
  return Math.abs(gap) / Math.max(Math.abs(bank), 1) > GAP_ALARM ? 'danger' : 'warning';
}

export interface PositionInput {
  readonly accounts: readonly BankAccount[];
  readonly trial: readonly TrialRow[];
  readonly statements: readonly BankStatement[];
  readonly transactions: readonly BankTransaction[];
  readonly today: string;
}

/** Which account a statement line belongs to. Lines carry a statement, not an account. */
function lineOwners(statements: readonly BankStatement[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const statement of statements) {
    if (statement.accountId !== null) owners.set(statement.id, statement.accountId);
  }
  return owners;
}

/** The one note a position wears, worst first. */
function positionNote(
  account: BankAccount,
  book: number | null,
  unmatched: number,
  newest: string | null,
  today: string,
): NoteId | null {
  if (book === null) return 'unlinked';
  if (!account.active) return 'dormant';
  if (unmatched > 0) return 'unreconciled';
  const age = newest === null ? null : daysUntil(newest, today);
  if (newest === null || (age !== null && age > STALE_DAYS)) return 'stale';
  return null;
}

/**
 * Every bank account, with the book beside it.
 *
 * A retired account with nothing in it is dropped, which is the same rule the trial
 * balance derive applies to a retired ledger account: it is noise on a cash report
 * and it is not noise when it still holds money.
 */
export function positions(input: PositionInput): readonly Position[] {
  const owners = lineOwners(input.statements);
  const trialById = new Map(input.trial.map((row) => [row.accountId, row] as const));
  const unmatched = new Map<string, number>();
  const matched = new Map<string, number>();
  for (const line of input.transactions) {
    const accountId = line.statementId === null ? undefined : owners.get(line.statementId);
    if (accountId === undefined) continue;
    const tally = line.state === 'unmatched' ? unmatched : line.state === 'matched' ? matched : null;
    if (tally !== null) tally.set(accountId, (tally.get(accountId) ?? 0) + 1);
  }
  const out: Position[] = [];
  for (const account of input.accounts) {
    if (!account.active && account.current === 0) continue;
    const mine = input.statements.filter((statement) => statement.accountId === account.id);
    const newest = mine.reduce<string | null>(
      (best, statement) => (statement.date !== '' && (best === null || statement.date > best) ? statement.date : best),
      null,
    );
    const trial = account.ledgerAccountId === null ? null : (trialById.get(account.ledgerAccountId) ?? null);
    const book = trial === null ? null : trial.balance;
    const open = unmatched.get(account.id) ?? 0;
    out.push({
      account,
      currency: toCurrency(account.currency),
      bank: account.current,
      linked: account.ledgerAccountId !== null,
      trial,
      book,
      gap: book === null ? null : account.current - book,
      statement: mine.find((statement) => statement.date === newest) ?? null,
      statements: mine.length,
      unmatched: open,
      matched: matched.get(account.id) ?? 0,
      note: positionNote(account, book, open, newest, input.today),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Rows: three sources, one shape
 * ------------------------------------------------------------------ */

export interface CashRow {
  /** Unique across the three lenses, because one grid renders whichever is in force. */
  readonly key: string;
  readonly lens: Lens;
  readonly id: string;
  readonly title: string;
  /** The second line under the title: whatever the row has that identifies it further. */
  readonly detail: string;
  readonly currency: Currency;
  /** What the row contributes to its lens, in its own currency. */
  readonly amount: number;
  /** The same figure in dinars, or `null` when no rate prices it. */
  readonly reported: number | null;
  /** Due date for a flow row; the newest loaded statement for a bank account. */
  readonly date: string | null;
  readonly bucket: Bucket | null;
  /** Days until `date`, negative once it has passed. */
  readonly days: number | null;
  readonly badge: Localized;
  readonly tone: Tone;
  readonly note: NoteId | null;
  /** The ledger account this row can be drilled into, when it has one. */
  readonly accountId: string | null;
  readonly position: Position | null;
  readonly bill: Bill | null;
  readonly invoice: Invoice | null;
}

/** Enough of a uuid to recognise it again, for the rows nothing exposed can name. */
const stem = (id: string): string => id.slice(0, 8);

const CASH_BADGE: Readonly<Record<'agrees' | 'differs' | 'unlinked', Localized>> = {
  agrees: { ar: 'مطابق للدفتر', fr: 'Conforme au livre', en: 'Agrees with the book' },
  differs: { ar: 'يخالف الدفتر', fr: 'Écart avec le livre', en: 'Differs from the book' },
  unlinked: { ar: 'بلا طرف دفتري', fr: 'Sans contrepartie', en: 'No book side' },
};

export function cashRows(
  list: readonly Position[],
  rates: RateBook,
  today: string,
): readonly CashRow[] {
  return list.map((position) => {
    const date = position.statement?.date ?? null;
    const agrees = position.gap !== null && Math.abs(position.gap) < EPSILON;
    return {
      key: `cash:${position.account.id}`,
      lens: 'cash' as const,
      id: position.account.id,
      title: position.account.name !== '' ? position.account.name : stem(position.account.id),
      detail: [position.account.institution, position.account.reference].filter((part) => part !== '').join(' · '),
      currency: position.currency,
      amount: position.bank,
      reported: priced(position.bank, position.currency, rates),
      date,
      bucket: null,
      days: date === null ? null : daysUntil(today, date),
      badge: position.gap === null ? CASH_BADGE.unlinked : agrees ? CASH_BADGE.agrees : CASH_BADGE.differs,
      tone: gapTone(position.gap, position.bank),
      note: position.note,
      accountId: position.account.ledgerAccountId,
      position,
      bill: null,
      invoice: null,
    };
  });
}

/** A due date that has passed while the status stayed put is worth pointing at. */
function timingNote(bucket: Bucket, overdue: boolean): NoteId | null {
  if (bucket === 'undated') return 'undated';
  if (bucket === 'overdue' && !overdue) return 'mistimed';
  return null;
}

export function payableRows(
  bills: readonly Bill[],
  rates: RateBook,
  today: string,
  horizon: Horizon,
): readonly CashRow[] {
  return bills.filter(owed).map((bill) => {
    const bucket = bucketOf(bill.due, today, horizon);
    return {
      key: `payable:${bill.id}`,
      lens: 'payable' as const,
      id: bill.id,
      title: bill.number !== '' ? bill.number : stem(bill.id),
      // Nothing exposed to an app names a supplier, so the note the clerk typed is
      // the best second line there is, and the supplier's id stem the fallback.
      detail: bill.notes !== '' ? bill.notes : bill.supplierId === null ? '' : stem(bill.supplierId),
      currency: bill.currency,
      amount: bill.outstanding,
      reported: priced(bill.outstanding, bill.currency, rates),
      date: bill.due,
      bucket,
      days: bill.due === null ? null : daysUntil(today, bill.due),
      badge: BILL_STATE_LABEL[bill.state],
      tone: billTone(bill.state),
      note: timingNote(bucket, bill.state === 'overdue'),
      accountId: null,
      position: null,
      bill,
      invoice: null,
    };
  });
}

/** Wrong currency beats overstated amount beats unknown timing. */
function invoiceNote(invoice: Invoice, bucket: Bucket): NoteId | null {
  if (invoice.restated) return 'restated';
  if (invoice.state === 'partial') return 'wholeInvoice';
  return timingNote(bucket, invoice.state === 'overdue');
}

export function receivableRows(
  invoices: readonly Invoice[],
  rates: RateBook,
  today: string,
  horizon: Horizon,
): readonly CashRow[] {
  return invoices.filter(expected).map((invoice) => {
    const bucket = bucketOf(invoice.due, today, horizon);
    return {
      key: `receivable:${invoice.id}`,
      lens: 'receivable' as const,
      id: invoice.id,
      title: invoice.number !== '' ? invoice.number : stem(invoice.id),
      detail: invoice.bookingId === null ? '' : stem(invoice.bookingId),
      currency: invoice.currency,
      amount: invoice.total,
      reported: priced(invoice.total, invoice.currency, rates),
      date: invoice.due,
      bucket,
      days: invoice.due === null ? null : daysUntil(today, invoice.due),
      badge: INVOICE_STATE_LABEL[invoice.state],
      tone: invoiceTone(invoice.state),
      note: invoiceNote(invoice, bucket),
      accountId: null,
      position: null,
      bill: null,
      invoice,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Liquidity: the four figures the rail is really about
 * ------------------------------------------------------------------ */

/** Anything with an amount and a date it matters on. Both flow lenses reduce to this. */
interface Flow {
  readonly amount: number;
  readonly currency: Currency;
  readonly due: string | null;
}

/**
 * One side of the flow, cut by the horizon.
 *
 * `within` deliberately includes the overdue: money that should already have moved is
 * money the horizon has to survive, and a forecast that quietly dropped it would be
 * the most flattering number in the app. `overdue` is carried separately so the rail
 * can say how much of the total is late rather than merely due.
 */
export interface Split {
  readonly within: Purse;
  readonly overdue: Purse;
  readonly later: Purse;
  readonly undated: Purse;
}

const EMPTY_SPLIT: Split = {
  within: EMPTY_PURSE,
  overdue: EMPTY_PURSE,
  later: EMPTY_PURSE,
  undated: EMPTY_PURSE,
};

function split(items: readonly Flow[], today: string, horizon: Horizon): Split {
  let within = EMPTY_PURSE;
  let overdue = EMPTY_PURSE;
  let later = EMPTY_PURSE;
  let undated = EMPTY_PURSE;
  for (const item of items) {
    const bucket = bucketOf(item.due, today, horizon);
    if (bucket === 'undated') {
      undated = plus(undated, item.amount, item.currency);
      continue;
    }
    if (bucket === 'later') {
      later = plus(later, item.amount, item.currency);
      continue;
    }
    within = plus(within, item.amount, item.currency);
    if (bucket === 'overdue') overdue = plus(overdue, item.amount, item.currency);
  }
  return { within, overdue, later, undated };
}

export interface Liquidity {
  /** What the banks say they hold. */
  readonly bank: Purse;
  /** What the book says about the accounts the banks are mirrored onto. */
  readonly book: Purse;
  readonly accounts: number;
  /** Bank accounts with no book side, whose balances the comparison cannot include. */
  readonly unlinked: number;
  /** Accounts whose two sides disagree by more than a centime. */
  readonly gaps: number;
  readonly unmatched: number;
  readonly outflow: Split;
  readonly inflow: Split;
  /** Confirmed payments in the trailing horizon: collection, as evidence rather than plan. */
  readonly collected: Purse;
  readonly collections: number;
  /** Partly settled invoices counted at face value. The app's sharpest overstatement. */
  readonly whole: number;
  /** Drafts, void bills and cancelled invoices that carry an amount and are excluded. */
  readonly setAside: number;
}

export const EMPTY_LIQUIDITY: Liquidity = {
  bank: EMPTY_PURSE,
  book: EMPTY_PURSE,
  accounts: 0,
  unlinked: 0,
  gaps: 0,
  unmatched: 0,
  outflow: EMPTY_SPLIT,
  inflow: EMPTY_SPLIT,
  collected: EMPTY_PURSE,
  collections: 0,
  whole: 0,
  setAside: 0,
};

export interface LiquidityInput {
  readonly positions: readonly Position[];
  readonly bills: readonly Bill[];
  readonly invoices: readonly Invoice[];
  readonly payments: readonly Payment[];
  readonly today: string;
  readonly horizon: Horizon;
}

/** The banks' side and the book's, in one pass so the count of gaps agrees with the totals. */
function banks(list: readonly Position[]): Pick<Liquidity, 'bank' | 'book' | 'accounts' | 'unlinked' | 'gaps' | 'unmatched'> {
  let bank = EMPTY_PURSE;
  let book = EMPTY_PURSE;
  let unlinked = 0;
  let gaps = 0;
  let unmatched = 0;
  for (const position of list) {
    bank = plus(bank, position.bank, position.currency);
    unmatched += position.unmatched;
    if (position.book === null) {
      unlinked += 1;
      continue;
    }
    book = plus(book, position.book, position.currency);
    if (Math.abs(position.gap ?? 0) >= EPSILON) gaps += 1;
  }
  return { bank, book, accounts: list.length, unlinked, gaps, unmatched };
}

/**
 * Everything the rail states, from one page of each source.
 *
 * The two flow sides are filtered by the same predicates the lists are, so a total on
 * the rail is always the sum of rows a reader can go and look at. Nothing is counted
 * that is not printable somewhere, which is the only version of this window worth
 * trusting.
 */
export function liquidity(input: LiquidityInput): Liquidity {
  const bills = input.bills.filter(owed);
  const invoices = input.invoices.filter(expected);
  const trailing = input.payments.filter((payment) => {
    if (!arrived(payment)) return false;
    const age = daysUntil(payment.at, input.today);
    return age !== null && age >= 0 && age <= input.horizon;
  });
  let collected = EMPTY_PURSE;
  for (const payment of trailing) collected = plus(collected, payment.amount, payment.currency);
  return {
    ...banks(input.positions),
    // Mapped rather than passed straight in: a bill's `amount` is its face value and
    // what leaves the bank is what is still owed on it.
    outflow: split(
      bills.map((bill) => ({ amount: bill.outstanding, currency: bill.currency, due: bill.due })),
      input.today,
      input.horizon,
    ),
    inflow: split(
      invoices.map((invoice) => ({ amount: invoice.total, currency: invoice.currency, due: invoice.due })),
      input.today,
      input.horizon,
    ),
    collected,
    collections: trailing.length,
    whole: invoices.filter((invoice) => invoice.state === 'partial').length,
    setAside:
      input.bills.filter(
        (bill) => bill.outstanding > EPSILON && (bill.state === 'draft' || bill.state === 'void'),
      ).length +
      input.invoices.filter(
        (invoice) => invoice.total > EPSILON && (invoice.state === 'draft' || invoice.state === 'cancelled'),
      ).length,
  };
}

/* ------------------------------------------------------------------ *
 * The forecast, and the ranking
 * ------------------------------------------------------------------ */

/**
 * Cash now, minus what leaves, plus what should arrive.
 *
 * Three inputs and a subtraction, which is all a cash forecast is and all this one
 * claims to be. It is not a projection: nothing here models a departure, a payroll or
 * a season, and the modeling window is where that argument belongs. What it does say
 * is whether the money on hand covers the paper already written, which is the question
 * a treasurer is actually asked on a Tuesday.
 *
 * `null` propagates on purpose. One riyal figure with no rate on record makes the
 * closing balance unstatable, and printing the dinar part alone would be a smaller
 * number wearing the same label.
 */
export interface Forecast {
  readonly opening: number | null;
  readonly outgoing: number | null;
  readonly incoming: number | null;
  readonly closing: number | null;
  /** What the banks say less what the book says, in the reporting currency. */
  readonly gap: number | null;
}

export function forecast(figures: Liquidity, rates: RateBook): Forecast {
  const opening = reported(figures.bank, rates);
  const outgoing = reported(figures.outflow.within, rates);
  const incoming = reported(figures.inflow.within, rates);
  const book = reported(figures.book, rates);
  return {
    opening,
    outgoing,
    incoming,
    closing:
      opening === null || outgoing === null || incoming === null ? null : opening - outgoing + incoming,
    gap: opening === null || book === null ? null : opening - book,
  };
}

/** Negative is an emergency; merely smaller than today is the thing to watch. */
export const runwayTone = (closing: number | null, opening: number | null): Tone => {
  if (closing === null) return 'neutral';
  if (closing < 0) return 'danger';
  if (opening !== null && closing < opening) return 'warning';
  return 'success';
};

/** What a row is worth for ranking: dinars where they can be had, its own face value otherwise. */
const size = (row: CashRow): number => Math.abs(row.reported ?? row.amount);

/**
 * The order the table prints in.
 *
 * By amount is the default and the reason is not aesthetic: on every one of the three
 * lenses the largest row is the one worth an argument, and a list sorted by name buries
 * it wherever the alphabet happens to put it. Undated rows sort last on the date order
 * rather than first, because a missing date is not the earliest one.
 */
export function ordered(rows: readonly CashRow[], sort: Sort): readonly CashRow[] {
  const list = [...rows];
  if (sort === 'name') return list.sort((left, right) => left.title.localeCompare(right.title));
  if (sort === 'due') {
    return list.sort((left, right) => {
      if (left.date === null || left.date === '') return right.date === null || right.date === '' ? 0 : 1;
      if (right.date === null || right.date === '') return -1;
      const byDate = left.date.localeCompare(right.date);
      return byDate !== 0 ? byDate : size(right) - size(left);
    });
  }
  return list.sort((left, right) => size(right) - size(left));
}

/** The find box: what a row is called, what is written on it, and what it is priced in. */
export function matches(row: CashRow, needle: string): boolean {
  if (needle === '') return true;
  return (
    row.title.toLowerCase().includes(needle) ||
    row.detail.toLowerCase().includes(needle) ||
    row.id.toLowerCase().startsWith(needle) ||
    row.currency.toLowerCase() === needle
  );
}

export function tally(rows: readonly CashRow[]): Readonly<Record<Bucket, number>> {
  const counts: Record<Bucket, number> = { overdue: 0, soon: 0, later: 0, undated: 0 };
  for (const row of rows) {
    if (row.bucket !== null) counts[row.bucket] += 1;
  }
  return counts;
}

/** The biggest row on the list, which is the one a summary names first. */
export function largest(rows: readonly CashRow[]): CashRow | null {
  let best: CashRow | null = null;
  for (const row of rows) {
    if (best === null || size(row) > size(best)) best = row;
  }
  return best;
}

/** The latest row, which is the other thing a summary always mentions. */
export function latest(rows: readonly CashRow[]): CashRow | null {
  let best: CashRow | null = null;
  for (const row of rows) {
    if (row.bucket !== 'overdue' || row.days === null) continue;
    if (best === null || row.days < (best.days ?? 0)) best = row;
  }
  return best;
}
