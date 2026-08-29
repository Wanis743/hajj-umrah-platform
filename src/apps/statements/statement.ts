/**
 * Statements — the three statements themselves.
 *
 * A statement is a *list of rows with structure*, not a table of accounts: a heading, the
 * accounts under it, the subtotal they add to, and at the bottom the one line the whole
 * exercise exists to produce. Modelling that as rows with a `kind` rather than as a nested
 * tree is what lets all three print through one grid, and what lets a subtotal be copied
 * and exported with the same code path as an account.
 *
 * One rule holds the file together: **a subtotal is the truth about its section, whatever
 * is on screen.** The search box and the zero filter hide account lines; they never change
 * what "Total assets" means. A report whose totals move when somebody types is a report
 * that cannot be quoted, so the filter is a find, not a scope, and the window says how
 * many lines it is holding back.
 *
 * The balance sheet's last row is the only opinion in the file. Assets must equal
 * liabilities plus equity plus the result for the window, and when they do not, the
 * difference is printed as its own line instead of being spread across the sections. An
 * out-of-balance book is a fact about the book; hiding it inside "equity" would make this
 * window the place where it disappeared.
 */
import type { Localized } from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL, type AccountType, EPSILON } from '../shared/ledger';
import {
  type AccountFigure,
  creditTotal,
  debitTotal,
  ofType,
  priorTotal,
  total,
} from './balances';

export type StatementView = 'income' | 'balance' | 'trial';

/**
 * What a row *is*, which decides how it prints and whether it can be acted on.
 *
 * `account` rows are the only ones that lead anywhere — they have an account behind them,
 * so they can be opened in the ledger. Everything else is arithmetic over them.
 */
export type RowKind = 'section' | 'account' | 'subtotal' | 'total' | 'check';

export interface StatementRow {
  readonly id: string;
  readonly kind: RowKind;
  /** A heading's own words; `null` on an account row, which is named by its account. */
  readonly label: Localized | null;
  readonly figure: AccountFigure | null;
  readonly amount: number;
  /** The comparison column, or `null` when no comparison was asked for. */
  readonly prior: number | null;
  readonly debit: number;
  readonly credit: number;
  /** Indentation: headings and bottom lines sit flush, their contents sit in. */
  readonly depth: number;
}

/**
 * The words a statement uses that no account provides.
 *
 * Account types are named once, in `shared/ledger`, and this file does not restate them —
 * a section heading reads `ACCOUNT_TYPE_LABEL`. What lives here is everything a statement
 * says *about* those sections, which no chart of accounts contains.
 */
export const STATEMENT_LABEL: Readonly<Record<string, Localized>> = {
  income: { ar: 'حساب النتيجة', fr: 'Compte de résultat', en: 'Income statement' },
  balance: { ar: 'الميزانية', fr: 'Bilan', en: 'Balance sheet' },
  trial: { ar: 'ميزان المراجعة', fr: 'Balance générale', en: 'Trial balance' },
  totalRevenue: { ar: 'إجمالي الإيرادات', fr: 'Total des produits', en: 'Total revenue' },
  totalExpense: { ar: 'إجمالي التكاليف', fr: 'Total des charges', en: 'Total expenses' },
  result: { ar: 'النتيجة', fr: 'Résultat', en: 'Result' },
  totalAssets: { ar: 'إجمالي الأصول', fr: 'Total de l’actif', en: 'Total assets' },
  totalLiabilities: { ar: 'إجمالي الخصوم', fr: 'Total du passif', en: 'Total liabilities' },
  totalEquity: { ar: 'إجمالي رأس المال', fr: 'Total des capitaux propres', en: 'Total equity' },
  retained: { ar: 'نتيجة الفترة', fr: 'Résultat de la période', en: 'Result for the window' },
  claims: { ar: 'الخصوم ورأس المال', fr: 'Passif et capitaux propres', en: 'Liabilities and equity' },
  drift: { ar: 'فرق غير مفسَّر', fr: 'Écart inexpliqué', en: 'Out of balance' },
  grand: { ar: 'الإجمالي', fr: 'Total', en: 'Total' },
  difference: { ar: 'الفرق', fr: 'Différence', en: 'Difference' },
};

/** The label a view wears in a title bar, a file and a pasted paragraph. */
export const VIEW_LABEL: Readonly<Record<StatementView, Localized>> = {
  income: STATEMENT_LABEL.income,
  balance: STATEMENT_LABEL.balance,
  trial: STATEMENT_LABEL.trial,
};

/**
 * What each kind of row is called.
 *
 * Read by the grid and by the export, because a statement pasted into a spreadsheet loses
 * its indentation and its type face — and a column of numbers where nothing distinguishes
 * an account from the total of its section is a column somebody will sum twice.
 */
export const ROW_KIND_LABEL: Readonly<Record<RowKind, Localized>> = {
  section: { ar: 'قسم', fr: 'Section', en: 'Section' },
  account: { ar: 'حساب', fr: 'Compte', en: 'Account' },
  subtotal: { ar: 'مجموع فرعي', fr: 'Sous-total', en: 'Subtotal' },
  total: { ar: 'مجموع', fr: 'Total', en: 'Total' },
  check: { ar: 'فحص', fr: 'Contrôle', en: 'Check' },
};

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

interface LineSpec {
  readonly id: string;
  readonly kind: RowKind;
  readonly label: Localized;
  readonly amount: number;
  readonly prior?: number | null;
  readonly depth?: number;
  readonly debit?: number;
  readonly credit?: number;
}

/** Any row that is arithmetic rather than an account: a heading, a subtotal, a check. */
const line = (spec: LineSpec): StatementRow => ({
  id: spec.id,
  kind: spec.kind,
  label: spec.label,
  figure: null,
  amount: spec.amount,
  prior: spec.prior ?? null,
  debit: spec.debit ?? 0,
  credit: spec.credit ?? 0,
  depth: spec.depth ?? 0,
});

/**
 * An account, indented under its heading.
 *
 * The figure travels with the row rather than being looked up again by id, because every
 * other thing this row can do — open the ledger, copy itself, show its own pane — needs
 * the type and the currency, and a grid that has to resolve a key before it can render a
 * cell is a grid that renders the wrong cell once.
 */
const accountRow = (figure: AccountFigure): StatementRow => ({
  id: `account:${figure.accountId}`,
  kind: 'account',
  label: null,
  figure,
  amount: figure.balance,
  prior: figure.prior,
  debit: figure.debit,
  credit: figure.credit,
  depth: 1,
});

/** Which account rows a view prints. Subtotals ignore it entirely. */
export type Keep = (figure: AccountFigure) => boolean;

interface SectionSpec {
  readonly type: AccountType;
  readonly figures: readonly AccountFigure[];
  readonly keep: Keep;
  readonly label: Localized;
  /** `total` for a line one side of an equation depends on; `subtotal` otherwise. */
  readonly kind?: RowKind;
}

/**
 * A heading, the accounts the filter kept, and the closing line for all of them.
 *
 * The heading carries no number and the closing line carries it, which is how a printed
 * statement reads and which leaves exactly one place per section for a figure to be wrong.
 */
function section(spec: SectionSpec): readonly StatementRow[] {
  const { type, figures, keep, label } = spec;
  const all = ofType(figures, type);
  return [
    line({ id: `section:${type}`, kind: 'section', label: ACCOUNT_TYPE_LABEL[type], amount: 0 }),
    ...all.filter(keep).map(accountRow),
    line({
      id: `subtotal:${type}`,
      kind: spec.kind ?? 'subtotal',
      label,
      amount: total(all),
      prior: priorTotal(all),
      depth: 1,
      debit: debitTotal(all),
      credit: creditTotal(all),
    }),
  ];
}

/** Two comparison columns added up, staying `null` when neither had one. */
function addPrior(left: number | null, right: number | null, sign: 1 | -1): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + sign * (right ?? 0);
}

/* ------------------------------------------------------------------ *
 * The three statements
 * ------------------------------------------------------------------ */

/** Revenue less costs, and the one line a trading month is judged by. */
function incomeRows(figures: readonly AccountFigure[], keep: Keep): readonly StatementRow[] {
  const revenue = ofType(figures, 'REVENUE');
  const expense = ofType(figures, 'EXPENSE');
  return [
    ...section({ type: 'REVENUE', figures, keep, label: STATEMENT_LABEL.totalRevenue }),
    ...section({ type: 'EXPENSE', figures, keep, label: STATEMENT_LABEL.totalExpense }),
    line({
      id: 'total:result',
      kind: 'total',
      label: STATEMENT_LABEL.result,
      amount: total(revenue) - total(expense),
      prior: addPrior(priorTotal(revenue), priorTotal(expense), -1),
    }),
  ];
}

/**
 * What is owned, against everything claimed on it.
 *
 * The result for the window is a claim like any other — it is next period's retained
 * earnings and has not been moved there yet — so it sits with liabilities and equity
 * rather than being netted into them. That keeps the equity section equal to what the
 * chart of accounts actually says, and makes the closing entry the only thing that ever
 * changes it.
 */
function balanceRows(figures: readonly AccountFigure[], keep: Keep): readonly StatementRow[] {
  const liabilities = ofType(figures, 'LIABILITY');
  const equity = ofType(figures, 'EQUITY');
  const revenue = ofType(figures, 'REVENUE');
  const expense = ofType(figures, 'EXPENSE');
  const result = total(revenue) - total(expense);
  const resultPrior = addPrior(priorTotal(revenue), priorTotal(expense), -1);
  const claims = total(liabilities) + total(equity) + result;
  return [
    ...section({ type: 'ASSET', figures, keep, label: STATEMENT_LABEL.totalAssets, kind: 'total' }),
    ...section({ type: 'LIABILITY', figures, keep, label: STATEMENT_LABEL.totalLiabilities }),
    ...section({ type: 'EQUITY', figures, keep, label: STATEMENT_LABEL.totalEquity }),
    line({ id: 'subtotal:retained', kind: 'subtotal', label: STATEMENT_LABEL.retained, amount: result, prior: resultPrior, depth: 1 }),
    line({
      id: 'total:claims',
      kind: 'total',
      label: STATEMENT_LABEL.claims,
      amount: claims,
      prior: addPrior(addPrior(priorTotal(liabilities), priorTotal(equity), 1), resultPrior, 1),
    }),
    line({ id: 'check:drift', kind: 'check', label: STATEMENT_LABEL.drift, amount: total(ofType(figures, 'ASSET')) - claims }),
  ];
}

/**
 * Every account, both sides, no structure.
 *
 * The one statement with no sections, because its whole purpose is the pair of grand
 * totals at the bottom: debits and credits agreeing is the evidence that everything above
 * it — both other statements included — is arithmetic rather than opinion.
 *
 * The grand-total row carries no balance. Adding a debit-natured balance to a
 * credit-natured one produces a number with no meaning, and printing it would invite
 * somebody to check it against something.
 */
function trialRows(figures: readonly AccountFigure[], keep: Keep): readonly StatementRow[] {
  const debit = debitTotal(figures);
  const credit = creditTotal(figures);
  return [
    ...figures.filter(keep).map(accountRow),
    line({ id: 'total:grand', kind: 'total', label: STATEMENT_LABEL.grand, amount: 0, debit, credit }),
    line({ id: 'check:difference', kind: 'check', label: STATEMENT_LABEL.difference, amount: debit - credit }),
  ];
}

/* ------------------------------------------------------------------ *
 * The set, and the numbers it is summarised by
 * ------------------------------------------------------------------ */

/**
 * The headline figures, over *every* account rather than the printed ones.
 *
 * This is what the tiles, the status bar and the pasted paragraph read, and it is the same
 * object whichever view is on screen — switching from the balance sheet to the trial
 * balance must not change what the window claims the result was.
 */
export interface Summary {
  readonly revenue: number;
  readonly expense: number;
  readonly result: number;
  readonly priorResult: number | null;
  /** Result over revenue, or `null` when there was no revenue to divide by. */
  readonly margin: number | null;
  readonly assets: number;
  readonly liabilities: number;
  readonly equity: number;
  /** Assets less everything claimed against them. Zero when the book balances. */
  readonly drift: number;
  readonly debit: number;
  readonly credit: number;
  /** Accounts carrying at least one posting: why a statement is as long as it is. */
  readonly accounts: number;
  readonly lines: number;
  readonly balanced: boolean;
}

export interface StatementSet {
  readonly income: readonly StatementRow[];
  readonly balance: readonly StatementRow[];
  readonly trial: readonly StatementRow[];
  readonly summary: Summary;
}

export const EMPTY_SUMMARY: Summary = {
  revenue: 0,
  expense: 0,
  result: 0,
  priorResult: null,
  margin: null,
  assets: 0,
  liabilities: 0,
  equity: 0,
  drift: 0,
  debit: 0,
  credit: 0,
  accounts: 0,
  lines: 0,
  balanced: true,
};

/** An empty book balances. There is nothing in it to disagree. */
export const EMPTY_SET: StatementSet = { income: [], balance: [], trial: [], summary: EMPTY_SUMMARY };

/** All three statements at once: they share every figure, so they cost one pass together. */
export function build(figures: readonly AccountFigure[], keep: Keep): StatementSet {
  const revenue = total(ofType(figures, 'REVENUE'));
  const expense = total(ofType(figures, 'EXPENSE'));
  const assets = total(ofType(figures, 'ASSET'));
  const liabilities = total(ofType(figures, 'LIABILITY'));
  const equity = total(ofType(figures, 'EQUITY'));
  const result = revenue - expense;
  const drift = assets - (liabilities + equity + result);
  return {
    income: incomeRows(figures, keep),
    balance: balanceRows(figures, keep),
    trial: trialRows(figures, keep),
    summary: {
      revenue,
      expense,
      result,
      priorResult: addPrior(priorTotal(ofType(figures, 'REVENUE')), priorTotal(ofType(figures, 'EXPENSE')), -1),
      margin: Math.abs(revenue) < EPSILON ? null : result / revenue,
      assets,
      liabilities,
      equity,
      drift,
      debit: debitTotal(figures),
      credit: creditTotal(figures),
      accounts: figures.filter((figure) => figure.lines > 0).length,
      lines: figures.reduce((sum, figure) => sum + figure.lines, 0),
      balanced: Math.abs(drift) < EPSILON,
    },
  };
}

/** The rows a view prints. */
export const rowsOf = (set: StatementSet, view: StatementView): readonly StatementRow[] =>
  view === 'income' ? set.income : view === 'balance' ? set.balance : set.trial;

/** Account rows only: what "12 of 40 lines hidden" is counted against. */
export const accountCount = (rows: readonly StatementRow[]): number =>
  rows.reduce((count, row) => (row.kind === 'account' ? count + 1 : count), 0);

/**
 * What a row is called: its account's code and name, or its own words.
 *
 * One function for both, because every consumer — the grid, the CSV, the clipboard, the
 * pane — needs the same string, and a row whose name is assembled differently in the export
 * than on screen is a row somebody cannot find again after pasting it.
 */
export const rowLabel = (row: StatementRow, t: (value: Localized) => string): string => {
  if (row.figure !== null) return `${row.figure.code} ${row.figure.name}`.trim();
  return row.label === null ? '' : t(row.label);
};
