/**
 * Treasury — the reads.
 *
 * Eight pages, and the interesting decisions are about which rows are worth spending
 * one on. Two of them are worth stating plainly:
 *
 *   • Settled documents are not requested. A paid bill and a settled invoice are the
 *     bulk of both tables and neither is a cash question, so the broker is asked for
 *     every status except `PAID`. Drafts and void rows *are* fetched — the window
 *     reports how many it set aside, and a count it could not have obtained would be
 *     a zero pretending to be an answer.
 *   • Both flow pages are ordered by due date ascending, so what falls off a full page
 *     is the far end of the future rather than the overdue. Truncation has to happen
 *     somewhere; it should happen where it costs a reader least.
 *
 * Every source is read on every lens. The rail states the same opening balance, the
 * same outflow and the same forecast whichever of the three lists is in front of you,
 * and a figure that moved when somebody switched tabs would be a figure nobody could
 * quote. The cost is three pages that the list in view does not use, which is one
 * round trip on a window that opens once a morning.
 *
 * Nothing here decides anything. The ceilings are declared, the pages are mapped, the
 * pure functions in `cash.ts` are applied, and every limit that bit is reported as
 * `bounded` so the window can say a figure is a floor rather than a fact.
 */
import { useMemo } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import {
  type BankAccount,
  toBankAccount,
  toBankStatement,
  toBankTransaction,
  toTrialRow,
} from '../shared/ledger';
import {
  type Bucket,
  type CashRow,
  cashRows,
  type Forecast,
  forecast,
  type Liquidity,
  liquidity,
  matches,
  ordered,
  payableRows,
  type Position,
  positions,
  receivableRows,
  tally,
} from './cash';
import type { Question } from './question';
import { rateBook, type RateBook, toRate } from './rates';
import { toBill, toInvoice, toPayment } from './sources';

/* ------------------------------------------------------------------ *
 * Ceilings
 * ------------------------------------------------------------------ */

/** Bank accounts. An agency with more than this many has a different problem. */
export const ACCOUNT_LIMIT = 200;
/** The trial balance, which is the book side of every account. One row per account. */
export const TRIAL_LIMIT = 500;
/** Statements, newest first: the evidence that a balance was ever agreed. */
export const STATEMENT_LIMIT = 200;
/** Statement lines beneath them, read only to count what is still unmatched. */
export const LINE_LIMIT = 500;
/** Supplier bills, soonest due first. */
export const BILL_LIMIT = 500;
/** Customer invoices, soonest due first. */
export const INVOICE_LIMIT = 500;
/** Confirmed collections, newest first. Ninety days of them at most is what is read. */
export const PAYMENT_LIMIT = 300;
/** Quotes. One pair is used and the rest are ignored, cheaply. */
export const RATE_LIMIT = 100;

/**
 * Every bill status except `PAID`, as the table spells them.
 *
 * The broker turns an array into an `in` clause, so this is one filter and not five
 * round trips. `PAID` is the status a table accumulates and the one status that cannot
 * appear in a cash figure, which makes it the only one worth leaving out.
 */
const BILL_SCOPE: readonly string[] = ['DRAFT', 'OPEN', 'PARTIALLY_PAID', 'OVERDUE', 'VOID'];

/** The same, for invoices, whose settled and withdrawn states are named differently. */
const INVOICE_SCOPE: readonly string[] = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'OVERDUE',
  'CANCELLED',
];

/* ------------------------------------------------------------------ *
 * What prints
 * ------------------------------------------------------------------ */

/**
 * The rows the table shows, and how many it is holding back.
 *
 * Two filters, both of which leave the rail alone: the find box, and the horizon. A
 * total that moved while somebody typed would be a total that cannot be checked
 * against anything, so every figure on the rail is summed over the whole lens and only
 * the list narrows. The count of what is hidden goes on the toolbar for the same
 * reason — a list that ends early without saying so is a list somebody will quote.
 */
function shown(
  rows: readonly CashRow[],
  question: Question,
): { readonly rows: readonly CashRow[]; readonly hidden: number } {
  const needle = question.search.trim().toLowerCase();
  const out: CashRow[] = [];
  let hidden = 0;
  for (const row of rows) {
    const outside = row.bucket === 'later' || row.bucket === 'undated';
    if ((!question.beyond && outside) || !matches(row, needle)) {
      hidden += 1;
      continue;
    }
    out.push(row);
  }
  return { rows: ordered(out, question.sort), hidden };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

export interface TreasuryModel {
  /** The lens's rows, filtered and ordered: what the grid renders. */
  readonly rows: readonly CashRow[];
  /** Every row of the lens in force, filter or no filter. The rail is summed over this. */
  readonly all: readonly CashRow[];
  /** Rows the find box and the horizon are holding back. Every total still counts them. */
  readonly hidden: number;
  /** The row the pane describes, resolved over `all` so typing cannot empty it. */
  readonly selected: CashRow | null;
  readonly positions: readonly Position[];
  readonly figures: Liquidity;
  readonly outlook: Forecast;
  readonly rates: RateBook;
  readonly buckets: Readonly<Record<Bucket, number>>;
  /** A page came back full, so the figures above are floors rather than facts. */
  readonly bounded: boolean;
  /** Riyals are in play and nothing on record prices them, so totals refuse to state. */
  readonly unpriced: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  refresh: () => void;
}

/**
 * Everything the window renders, from the question it was asked and today's date.
 *
 * `today` is passed in rather than read here, because a figure that depends on the
 * clock and is computed inside a hook is a figure that changes on re-render for no
 * reason a reader can see. The shell fixes it once when the window opens.
 */
export function useTreasuryModel(
  question: Question,
  today: string,
  selectedKey: string | null,
): TreasuryModel {
  // Raw rather than mapped: this is the query the status bar dates the position by, and
  // only `useDataset` carries a `fetchedAt`.
  const accountPage = useDataset('bankAccounts', {
    limit: ACCOUNT_LIMIT,
    orderBy: { column: 'name', ascending: true },
  });
  const accounts = useMemo(() => {
    const out: BankAccount[] = [];
    for (const row of accountPage.rows) {
      const mapped = toBankAccount(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }, [accountPage.rows]);

  const trialQuery = useMappedDataset('trialBalance', toTrialRow, { limit: TRIAL_LIMIT });
  const statementQuery = useMappedDataset('bankStatements', toBankStatement, {
    limit: STATEMENT_LIMIT,
    orderBy: { column: 'statement_date', ascending: false },
  });

  // Scoped to the statements that came back, because a line belongs to an account only
  // through one of them: a line whose statement is off the page could not be attributed.
  const statementIds = useMemo(
    () => statementQuery.rows.map((statement) => statement.id),
    [statementQuery.rows],
  );
  const lineQuery = useMappedDataset('bankTransactions', toBankTransaction, {
    where: { statement_id: statementIds },
    limit: LINE_LIMIT,
    enabled: statementIds.length > 0,
  });

  const billQuery = useMappedDataset('supplierBills', toBill, {
    where: { status: BILL_SCOPE },
    limit: BILL_LIMIT,
    orderBy: { column: 'due_date', ascending: true },
  });
  const invoiceQuery = useMappedDataset('invoices', toInvoice, {
    where: { status: INVOICE_SCOPE },
    limit: INVOICE_LIMIT,
    orderBy: { column: 'due_date', ascending: true },
  });
  // Confirmed only, and at the broker rather than in the walk: a pending payment is not
  // evidence of collection, and there is no reason to spend a page carrying it here.
  const paymentQuery = useMappedDataset('payments', toPayment, {
    where: { status: 'CONFIRMED' },
    limit: PAYMENT_LIMIT,
    orderBy: { column: 'received_at', ascending: false },
  });
  const rateQuery = useMappedDataset('exchangeRates', toRate, {
    limit: RATE_LIMIT,
    orderBy: { column: 'rate_date', ascending: false },
  });

  const rates = useMemo(() => rateBook(rateQuery.rows), [rateQuery.rows]);

  const list = useMemo(
    () =>
      positions({
        accounts,
        trial: trialQuery.rows,
        statements: statementQuery.rows,
        transactions: lineQuery.rows,
        today,
      }),
    [accounts, lineQuery.rows, statementQuery.rows, today, trialQuery.rows],
  );

  const figures = useMemo(
    () =>
      liquidity({
        positions: list,
        bills: billQuery.rows,
        invoices: invoiceQuery.rows,
        payments: paymentQuery.rows,
        today,
        horizon: question.horizon,
      }),
    [billQuery.rows, invoiceQuery.rows, list, paymentQuery.rows, question.horizon, today],
  );

  const outlook = useMemo(() => forecast(figures, rates), [figures, rates]);

  const all = useMemo(() => {
    if (question.lens === 'payable') {
      return payableRows(billQuery.rows, rates, today, question.horizon);
    }
    if (question.lens === 'receivable') {
      return receivableRows(invoiceQuery.rows, rates, today, question.horizon);
    }
    return cashRows(list, rates, today);
  }, [billQuery.rows, invoiceQuery.rows, list, question.horizon, question.lens, rates, today]);

  const table = useMemo(() => shown(all, question), [all, question]);
  const buckets = useMemo(() => tally(all), [all]);

  const selected = useMemo(
    () => (selectedKey === null ? null : (all.find((row) => row.key === selectedKey) ?? null)),
    [all, selectedKey],
  );

  const refresh = () => {
    accountPage.refetch();
    trialQuery.refetch();
    statementQuery.refetch();
    lineQuery.refetch();
    billQuery.refetch();
    invoiceQuery.refetch();
    paymentQuery.refetch();
    rateQuery.refetch();
  };

  return {
    rows: table.rows,
    all,
    hidden: table.hidden,
    selected,
    positions: list,
    figures,
    outlook,
    rates,
    buckets,
    // Mapped pages under-report fullness, because a row the mapper dropped makes a full
    // page look like a short one. The test errs towards silence rather than towards a
    // warning nobody can act on.
    bounded:
      accountPage.rows.length >= ACCOUNT_LIMIT ||
      trialQuery.rows.length >= TRIAL_LIMIT ||
      statementQuery.rows.length >= STATEMENT_LIMIT ||
      lineQuery.rows.length >= LINE_LIMIT ||
      billQuery.rows.length >= BILL_LIMIT ||
      invoiceQuery.rows.length >= INVOICE_LIMIT ||
      paymentQuery.rows.length >= PAYMENT_LIMIT,
    unpriced:
      rates.perSar === null &&
      (figures.bank.sar !== 0 ||
        figures.outflow.within.sar !== 0 ||
        figures.inflow.within.sar !== 0),
    loading: accountPage.loading || trialQuery.loading || billQuery.loading || invoiceQuery.loading,
    error:
      accountPage.error ??
      trialQuery.error ??
      statementQuery.error ??
      lineQuery.error ??
      billQuery.error ??
      invoiceQuery.error ??
      paymentQuery.error ??
      rateQuery.error,
    fetchedAt: accountPage.fetchedAt,
    refresh,
  };
}
