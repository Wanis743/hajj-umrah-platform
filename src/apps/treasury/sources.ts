/**
 * Treasury — the three documents money arrives and leaves by.
 *
 * A supplier bill, a customer invoice, a payment. None of them live in
 * `shared/ledger`, and deliberately: no other app in the suite reads them. That file
 * is for vocabulary two windows have to agree about — a journal entry, an account —
 * and moving these into it would make eleven apps recompile for a change only this
 * one can see.
 *
 * Each mapper has one job beyond renaming columns, and it is the same job in three
 * different states of knowledge: decide what the row is worth *now*, which is never
 * simply the column called `amount`.
 *
 *   • A bill knows what has been paid against it, so its outstanding balance is a
 *     fact — `amount − paid_amount`, floored at zero, because an overpaid bill is a
 *     credit note's problem and not a negative obligation.
 *   • An invoice does not. `paid_dzd` exists on the table and is not projected, and
 *     `payment_allocations` is not a dataset an app may read, so a partly paid
 *     invoice is counted whole and every surface that shows one says so. Inferring
 *     the remainder by matching amounts against the payments page would be a guess
 *     wearing a receivable's clothes.
 *   • A payment is worth its amount and nothing more, and for the same reason it
 *     cannot be subtracted from anything here: nothing exposed says which invoice it
 *     settled. It is evidence of collection, which is why this window shows payments
 *     as a run-rate beside the receivables instead of inside them.
 *
 * Both money tables carry two amount columns and a currency, which is one column too
 * many to trust blindly — see {@link denominated}.
 */
import type { DatasetRow, Localized, Tone } from '@/platform/sdk';
import { asString, num, status, str } from '../shared/guards';
import { type Currency, EPSILON, toCurrency } from '../shared/ledger';

/**
 * Which of a row's two amount columns is the document, and in what currency.
 *
 * `payments` and `invoices` both carry `amount_dzd` and `amount_sar` with a
 * `currency` beside them. Usually the currency names the real one and the other is a
 * convenience restatement — but plenty of rows predate the currency column, and a
 * riyal invoice whose `total_sar` is zero would be read as costing nothing. So the
 * currency is believed only while its own column has something in it; when it does
 * not and the other does, the other one is the document and `restated` says so, so a
 * reader can go and fix the row rather than wonder at the figure.
 */
function denominated(
  row: DatasetRow,
  dzdKey: string,
  sarKey: string,
): { readonly currency: Currency; readonly amount: number; readonly restated: boolean } {
  const named = toCurrency(row.currency);
  const dzd = num(row[dzdKey]);
  const sar = num(row[sarKey]);
  const own = named === 'SAR' ? sar : dzd;
  const other = named === 'SAR' ? dzd : sar;
  if (own === 0 && other !== 0) {
    return { currency: named === 'SAR' ? 'DZD' : 'SAR', amount: other, restated: true };
  }
  return { currency: named, amount: own, restated: false };
}

/* ------------------------------------------------------------------ *
 * Supplier bills: money out
 * ------------------------------------------------------------------ */

/**
 * A bill's lifecycle, as the table checks it.
 *
 * `overdue` is a column value and not a computed one, which is worth knowing: a bill
 * can be past its due date and still say `OPEN`, because whatever sets the flag runs
 * on a schedule. This window therefore ages bills by their date rather than by their
 * status, and shows both.
 */
export type BillState = 'draft' | 'open' | 'partial' | 'paid' | 'overdue' | 'void';

export const BILL_STATE_LABEL: Readonly<Record<BillState, Localized>> = {
  draft: { ar: 'مسودة', fr: 'Brouillon', en: 'Draft' },
  open: { ar: 'مفتوحة', fr: 'Ouverte', en: 'Open' },
  partial: { ar: 'مدفوعة جزئيًا', fr: 'Partiellement payée', en: 'Partly paid' },
  paid: { ar: 'مدفوعة', fr: 'Payée', en: 'Paid' },
  overdue: { ar: 'متأخّرة', fr: 'En retard', en: 'Overdue' },
  void: { ar: 'ملغاة', fr: 'Annulée', en: 'Void' },
};

export function toBillState(value: unknown): BillState {
  const text = status(value);
  if (text === 'paid' || text === 'settled') return 'paid';
  if (text === 'partially_paid' || text === 'partial') return 'partial';
  if (text === 'overdue' || text === 'late') return 'overdue';
  if (text === 'void' || text === 'cancelled' || text === 'canceled') return 'void';
  if (text === 'draft') return 'draft';
  return 'open';
}

export const billTone = (state: BillState): Tone =>
  state === 'overdue'
    ? 'danger'
    : state === 'partial'
      ? 'warning'
      : state === 'paid'
        ? 'success'
        : state === 'open'
          ? 'accent'
          : 'neutral';

export interface Bill {
  readonly id: string;
  readonly number: string;
  /**
   * The supplier's id, and nothing else about it. `suppliers` is not a dataset an
   * app may read, so a bill prints by its own number — which is what an accounts
   * payable clerk searches by anyway.
   */
  readonly supplierId: string | null;
  readonly date: string;
  readonly due: string | null;
  readonly currency: Currency;
  readonly amount: number;
  readonly paid: number;
  /** What is still owed. Floored: an overpayment is a credit note, not a negative bill. */
  readonly outstanding: number;
  readonly state: BillState;
  readonly branchId: string | null;
  readonly notes: string;
}

export function toBill(row: DatasetRow): Bill | null {
  const id = asString(row.id);
  if (id === null) return null;
  const amount = num(row.amount);
  const paid = num(row.paid_amount);
  return {
    id,
    number: str(row.bill_number),
    supplierId: asString(row.supplier_id),
    date: str(row.bill_date),
    due: asString(row.due_date),
    // `supplier_bills` carries a real currency column, so no restatement question arises.
    currency: toCurrency(row.currency_code),
    amount,
    paid,
    outstanding: Math.max(0, amount - paid),
    state: toBillState(row.status),
    branchId: asString(row.branch_id),
    notes: str(row.notes),
  };
}

/**
 * Is this bill money that has to leave?
 *
 * A draft is not a commitment — somebody is still typing it — and a void one is not
 * a bill. Both are excluded from every money-out figure in this window, and the
 * window says how many it set aside rather than showing a total nobody can tie back
 * to the list underneath it.
 */
export const owed = (bill: Bill): boolean =>
  bill.outstanding > EPSILON && bill.state !== 'draft' && bill.state !== 'void';

/* ------------------------------------------------------------------ *
 * Invoices: money in
 * ------------------------------------------------------------------ */

export type InvoiceState = 'draft' | 'issued' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export const INVOICE_STATE_LABEL: Readonly<Record<InvoiceState, Localized>> = {
  draft: { ar: 'مسودة', fr: 'Brouillon', en: 'Draft' },
  issued: { ar: 'صادرة', fr: 'Émise', en: 'Issued' },
  partial: { ar: 'محصَّلة جزئيًا', fr: 'Partiellement réglée', en: 'Partly settled' },
  paid: { ar: 'محصَّلة', fr: 'Réglée', en: 'Settled' },
  overdue: { ar: 'متأخّرة', fr: 'En retard', en: 'Overdue' },
  cancelled: { ar: 'ملغاة', fr: 'Annulée', en: 'Cancelled' },
};

export function toInvoiceState(value: unknown): InvoiceState {
  const text = status(value);
  if (text === 'paid' || text === 'settled') return 'paid';
  if (text === 'partially_paid' || text === 'partial') return 'partial';
  if (text === 'overdue' || text === 'late') return 'overdue';
  if (text === 'cancelled' || text === 'canceled' || text === 'void') return 'cancelled';
  if (text === 'issued' || text === 'sent' || text === 'open') return 'issued';
  return 'draft';
}

export const invoiceTone = (state: InvoiceState): Tone =>
  state === 'overdue'
    ? 'danger'
    : state === 'partial'
      ? 'warning'
      : state === 'paid'
        ? 'success'
        : state === 'issued'
          ? 'accent'
          : 'neutral';

export interface Invoice {
  readonly id: string;
  readonly number: string;
  readonly bookingId: string | null;
  readonly issued: string;
  readonly due: string | null;
  readonly currency: Currency;
  /** The invoice's face value. Never net of what has been collected — see the header. */
  readonly total: number;
  /** True when the currency column and the populated amount column disagreed. */
  readonly restated: boolean;
  readonly state: InvoiceState;
  /** The rate the invoice was raised at, which is not the rate this window reports in. */
  readonly rate: number | null;
}

export function toInvoice(row: DatasetRow): Invoice | null {
  const id = asString(row.id);
  if (id === null) return null;
  const money = denominated(row, 'total_dzd', 'total_sar');
  const rate = num(row.exchange_rate);
  return {
    id,
    number: str(row.invoice_number),
    bookingId: asString(row.booking_id),
    issued: str(row.issued_at).slice(0, 10),
    due: asString(row.due_date),
    currency: money.currency,
    total: money.amount,
    restated: money.restated,
    state: toInvoiceState(row.status),
    rate: rate > 0 ? rate : null,
  };
}

/**
 * Is this invoice money that should arrive?
 *
 * A draft was never sent and a cancelled one was withdrawn, so neither is a
 * receivable. A partly settled one is — at its full face value, which overstates it
 * by however much has already been collected. That is the sharpest limit in this
 * app, so it is stated on the row, in the totals and in the export rather than
 * mentioned once in a tooltip.
 */
export const expected = (invoice: Invoice): boolean =>
  invoice.total > EPSILON &&
  (invoice.state === 'issued' || invoice.state === 'partial' || invoice.state === 'overdue');

/* ------------------------------------------------------------------ *
 * Payments: money that actually arrived
 * ------------------------------------------------------------------ */

export type PaymentState = 'pending' | 'confirmed' | 'failed' | 'refunded';

export const PAYMENT_STATE_LABEL: Readonly<Record<PaymentState, Localized>> = {
  pending: { ar: 'قيد التأكيد', fr: 'En attente', en: 'Pending' },
  confirmed: { ar: 'مؤكَّد', fr: 'Confirmé', en: 'Confirmed' },
  failed: { ar: 'فاشل', fr: 'Échoué', en: 'Failed' },
  refunded: { ar: 'مُعاد', fr: 'Remboursé', en: 'Refunded' },
};

export function toPaymentState(value: unknown): PaymentState {
  const text = status(value);
  if (text === 'confirmed' || text === 'paid' || text === 'received') return 'confirmed';
  if (text === 'failed' || text === 'rejected') return 'failed';
  if (text === 'refunded' || text === 'reversed') return 'refunded';
  return 'pending';
}

export interface Payment {
  readonly id: string;
  readonly bookingId: string | null;
  readonly reference: string;
  readonly receipt: string;
  /** `Cash`, `Bank Transfer`, `CCP`, `BaridiMob` — the table's own words, unchanged. */
  readonly method: string;
  readonly state: PaymentState;
  readonly currency: Currency;
  readonly amount: number;
  readonly restated: boolean;
  readonly at: string;
}

export function toPayment(row: DatasetRow): Payment | null {
  const id = asString(row.id);
  if (id === null) return null;
  const money = denominated(row, 'amount_dzd', 'amount_sar');
  return {
    id,
    bookingId: asString(row.booking_id),
    reference: str(row.reference),
    receipt: str(row.receipt_number),
    method: str(row.method),
    state: toPaymentState(row.status),
    currency: money.currency,
    amount: money.amount,
    restated: money.restated,
    at: str(row.received_at).slice(0, 10),
  };
}

/**
 * Did this money arrive?
 *
 * Confirmed only. A pending payment is a promise with a reference number, and a
 * failed or refunded one is cash that went back out — counting any of them as
 * collection would flatter the run-rate this window is reporting.
 */
export const arrived = (payment: Payment): boolean => payment.state === 'confirmed';

export const paymentTone = (state: PaymentState): Tone =>
  state === 'confirmed'
    ? 'success'
    : state === 'pending'
      ? 'warning'
      : state === 'refunded'
        ? 'accent'
        : 'danger';
