/**
 * Statements — what leaves the window.
 *
 * A statement is quoted in a meeting where this window is not open, so everything that
 * decides what its numbers mean travels with them: the basis, the period, the comparison,
 * and whether a page ran into its ceiling. A figure with none of that beside it is a figure
 * somebody will read as the whole book when it was one quarter, or as one quarter when it
 * was every posting ever made.
 *
 * The export is the statement, not the accounts behind it — headings, subtotals, the bottom
 * line and the balance check all go in the file, each named by its kind. A spreadsheet loses
 * the indentation that told a reader which rows add up to which, and a column where nothing
 * distinguishes an account from its section total is a column that gets summed twice.
 *
 * Amounts are decimals with a dot and no currency mark. A file that arrives pre-formatted
 * cannot be un-formatted, and `1.250` means two different numbers in the two languages this
 * OS runs in.
 */
import type { Localized } from '@/platform/sdk';
import { csvDocument } from '../shared/csv';
import { ACCOUNT_TYPE_LABEL, type FiscalPeriod } from '../shared/ledger';
import type { AccountFigure, Basis } from './balances';
import {
  ROW_KIND_LABEL,
  rowLabel,
  type StatementRow,
  type StatementView,
  type Summary,
  VIEW_LABEL,
} from './statement';

/** The translator the runtime already holds, narrowed to what a pure module needs. */
export type Label = (value: Localized) => string;
export type Translate = (ar: string, fr: string, en: string) => string;

/** `statement-balance-2026-08-29.csv` — the view first, because that is what differs. */
export const suggestedFileName = (view: StatementView, today: string): string =>
  `statement-${view}-${today}.csv`;

/** A period as a reader needs it: what it is called, and the dates that settles. */
const periodText = (period: FiscalPeriod | null, tr: Translate): string => {
  if (period === null) return tr('لا فترة', 'Aucune période', 'No period');
  const name = period.label === '' ? `${period.start} → ${period.end}` : period.label;
  return `${name} (${period.start} → ${period.end})`;
};

/** Everything that decides what the figures mean, gathered once. */
export interface Provenance {
  readonly basis: Basis;
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  /** A page came back full, so every total is a floor rather than a fact. */
  readonly bounded: boolean;
}

/** The basis in one word, for a column that repeats on every row. */
const basisCell = (basis: Basis, tr: Translate): string =>
  basis === 'book' ? tr('الدفتر بالكامل', 'Livre entier', 'Whole book') : tr('الفترة', 'Période', 'Period');

/** The window as raw dates, because a spreadsheet can filter those and not a label. */
const periodCell = (source: Provenance): string =>
  source.basis === 'book' || source.period === null ? '' : `${source.period.start} → ${source.period.end}`;

/**
 * The basis as one line, for the head of a paragraph.
 *
 * The comparison and the ceiling belong to the basis rather than being extras. A revenue
 * figure quoted with no note that the entry page was full is a number nobody can reproduce,
 * and the person who cannot reproduce it will assume the book is wrong.
 */
export function basisLine(source: Provenance, tr: Translate): string {
  const parts = [
    source.basis === 'book'
      ? `${tr('الأساس', 'Base', 'Basis')}: ${tr('الدفتر بالكامل', 'Livre entier', 'Whole book')}`
      : `${tr('الفترة', 'Période', 'Period')}: ${periodText(source.period, tr)}`,
  ];
  if (source.comparison !== null) {
    parts.push(`${tr('مقارنة', 'Comparaison', 'Compared with')}: ${periodText(source.comparison, tr)}`);
  }
  if (source.bounded) {
    parts.push(tr('حدّ أدنى: الصفحة مكتملة', 'Minorant : page saturée', 'Lower bound: the page was full'));
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

/**
 * How a row moved against its comparison.
 *
 * Computed off the row rather than off the account, so a subtotal exports the same variance
 * the grid shows it. A row with no comparison has no variance — not a zero one.
 */
const moved = (row: StatementRow): number | null => (row.prior === null ? null : row.amount - row.prior);

/**
 * The income statement and the balance sheet: one row per line, structure included.
 *
 * Code and name are separate columns while the on-screen row is one string, because a sheet
 * sorts and looks up by code and a person reads the name. Section headings carry no amount
 * here for the same reason they carry none on screen — the number belongs to the line that
 * closes the section, and printing it twice invites a reader to add it in.
 */
export function statementCsv(
  rows: readonly StatementRow[],
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const basis = basisCell(source.basis, tr);
  const period = periodCell(source);
  return csvDocument(
    [
      tr('النوع', 'Nature', 'Kind'),
      tr('الحساب', 'Compte', 'Account'),
      tr('التسمية', 'Libellé', 'Label'),
      tr('التصنيف', 'Classe', 'Class'),
      tr('العملة', 'Devise', 'Currency'),
      tr('المبلغ', 'Montant', 'Amount'),
      tr('المقارنة', 'Comparaison', 'Prior'),
      tr('الفرق', 'Écart', 'Variance'),
      tr('الأساس', 'Base', 'Basis'),
      tr('الفترة', 'Période', 'Period'),
    ],
    rows.map((row) => {
      const figure = row.figure;
      const gap = moved(row);
      return [
        t(ROW_KIND_LABEL[row.kind]),
        figure?.code ?? '',
        figure === null ? rowLabel(row, t) : figure.name,
        figure === null ? '' : t(ACCOUNT_TYPE_LABEL[figure.type]),
        figure?.currency ?? '',
        row.kind === 'section' ? '' : row.amount.toFixed(2),
        row.prior === null ? '' : row.prior.toFixed(2),
        gap === null ? '' : gap.toFixed(2),
        basis,
        period,
      ];
    }),
  );
}

/**
 * The trial balance: both sides, no structure.
 *
 * The grand total exports its two sides and no balance, exactly as it prints. Adding a
 * debit-natured balance to a credit-natured one produces a number with no meaning, and a
 * cell with a number in it is a cell somebody will check something against.
 *
 * The posting count travels too. Two accounts can hold the same balance off one entry and
 * off four hundred, and which of those it is decides whether a wrong figure is worth
 * hunting by eye.
 */
export function trialCsv(
  rows: readonly StatementRow[],
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const basis = basisCell(source.basis, tr);
  const period = periodCell(source);
  return csvDocument(
    [
      tr('النوع', 'Nature', 'Kind'),
      tr('الحساب', 'Compte', 'Account'),
      tr('التسمية', 'Libellé', 'Label'),
      tr('التصنيف', 'Classe', 'Class'),
      tr('العملة', 'Devise', 'Currency'),
      tr('مدين', 'Débit', 'Debit'),
      tr('دائن', 'Crédit', 'Credit'),
      tr('الرصيد', 'Solde', 'Balance'),
      tr('عدد القيود', 'Écritures', 'Postings'),
      tr('الأساس', 'Base', 'Basis'),
      tr('الفترة', 'Période', 'Period'),
    ],
    rows.map((row) => {
      const figure = row.figure;
      return [
        t(ROW_KIND_LABEL[row.kind]),
        figure?.code ?? '',
        figure === null ? rowLabel(row, t) : figure.name,
        figure === null ? '' : t(ACCOUNT_TYPE_LABEL[figure.type]),
        figure?.currency ?? '',
        row.debit.toFixed(2),
        row.credit.toFixed(2),
        row.kind === 'total' ? '' : row.amount.toFixed(2),
        figure === null ? '' : String(figure.lines),
        basis,
        period,
      ];
    }),
  );
}

/* ------------------------------------------------------------------ *
 * The clipboard — the same facts, as a paragraph
 * ------------------------------------------------------------------ */

/** Amounts in a pasted paragraph keep the dot and name their currency once each. */
const money = (value: number, currency = 'DZD'): string => `${value.toFixed(2)} ${currency}`;

/** The headline figures of whichever statement is on screen. */
function headline(view: StatementView, summary: Summary, tr: Translate): readonly string[] {
  if (view === 'trial') {
    return [
      `${tr('مدين', 'Débit', 'Debit')}: ${money(summary.debit)}`,
      `${tr('دائن', 'Crédit', 'Credit')}: ${money(summary.credit)}`,
      `${tr('الفرق', 'Différence', 'Difference')}: ${money(summary.debit - summary.credit)}`,
    ];
  }
  if (view === 'balance') {
    return [
      `${tr('الأصول', 'Actif', 'Assets')}: ${money(summary.assets)}`,
      `${tr('الخصوم', 'Passif', 'Liabilities')}: ${money(summary.liabilities)}`,
      `${tr('رأس المال', 'Capitaux propres', 'Equity')}: ${money(summary.equity)}`,
      `${tr('نتيجة الفترة', 'Résultat de la période', 'Result')}: ${money(summary.result)}`,
      `${tr('فرق غير مفسَّر', 'Écart inexpliqué', 'Out of balance')}: ${money(summary.drift)}`,
    ];
  }
  const margin =
    summary.margin === null ? tr('لا ينطبق', 'S. O.', 'n/a') : `${(summary.margin * 100).toFixed(1)}%`;
  return [
    `${tr('الإيرادات', 'Produits', 'Revenue')}: ${money(summary.revenue)}`,
    `${tr('التكاليف', 'Charges', 'Expenses')}: ${money(summary.expense)}`,
    `${tr('النتيجة', 'Résultat', 'Result')}: ${money(summary.result)}`,
    `${tr('الهامش', 'Marge', 'Margin')}: ${margin}`,
  ];
}

/**
 * The statement as a paragraph, for a message rather than a sheet.
 *
 * The statement is named first and the basis second, before any figure, because those two
 * lines are what make the rest quotable. The evidence — how many accounts carry a posting
 * and how many postings there are — closes it, and an unbalanced book says so in words: a
 * reader who has to notice that assets and claims differ by hand will not notice.
 */
export function summaryClipboardText(
  view: StatementView,
  summary: Summary,
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const lines = [t(VIEW_LABEL[view]), basisLine(source, tr), ...headline(view, summary, tr)];
  if (summary.priorResult !== null) {
    lines.push(`${tr('نتيجة المقارنة', 'Résultat comparé', 'Prior result')}: ${money(summary.priorResult)}`);
  }
  lines.push(
    `${tr('حسابات', 'Comptes', 'Accounts')}: ${summary.accounts} · ` +
      `${tr('قيود', 'Écritures', 'Postings')}: ${summary.lines}`,
  );
  if (!summary.balanced) {
    lines.push(tr('الدفتر غير متوازن.', 'Le livre n’est pas équilibré.', 'The book does not balance.'));
  }
  return lines.join('\n');
}

/**
 * One line of a statement, whichever kind it is.
 *
 * A subtotal is worth pasting as much as an account — "Total expenses" against last quarter
 * is the sentence most of these copies are for — so this takes a row rather than an account
 * and names what kind of row it was.
 */
export function rowClipboardText(row: StatementRow, source: Provenance, t: Label, tr: Translate): string {
  const figure = row.figure;
  const currency = figure?.currency ?? 'DZD';
  const lines = [rowLabel(row, t), `${t(ROW_KIND_LABEL[row.kind])}${figure === null ? '' : ` · ${t(ACCOUNT_TYPE_LABEL[figure.type])}`}`];
  if (row.kind !== 'section') lines.push(`${tr('المبلغ', 'Montant', 'Amount')}: ${money(row.amount, currency)}`);
  if (row.debit !== 0 || row.credit !== 0) {
    lines.push(
      `${tr('مدين', 'Débit', 'Debit')}: ${money(row.debit, currency)} · ` +
        `${tr('دائن', 'Crédit', 'Credit')}: ${money(row.credit, currency)}`,
    );
  }
  const gap = moved(row);
  if (row.prior !== null) lines.push(`${tr('المقارنة', 'Comparaison', 'Prior')}: ${money(row.prior, currency)}`);
  if (gap !== null) lines.push(`${tr('الفرق', 'Écart', 'Variance')}: ${money(gap, currency)}`);
  if (figure !== null) {
    lines.push(`${tr('عدد القيود', 'Écritures', 'Postings')}: ${figure.lines}`);
  }
  lines.push(basisLine(source, tr));
  return lines.join('\n');
}

/**
 * One account, from the pane rather than from the grid.
 *
 * The pane holds the figure and not the row it happened to be printed on, and the figure is
 * the more useful of the two: an account's own numbers do not depend on which statement was
 * open when somebody clicked it.
 */
export function accountClipboardText(
  figure: AccountFigure,
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const currency = figure.currency;
  const lines = [
    `${figure.code} ${figure.name}`.trim(),
    `${t(ACCOUNT_TYPE_LABEL[figure.type])} · ${currency}`,
    `${tr('الرصيد', 'Solde', 'Balance')}: ${money(figure.balance, currency)}`,
    `${tr('مدين', 'Débit', 'Debit')}: ${money(figure.debit, currency)} · ` +
      `${tr('دائن', 'Crédit', 'Credit')}: ${money(figure.credit, currency)}`,
  ];
  if (figure.prior !== null) {
    lines.push(`${tr('المقارنة', 'Comparaison', 'Prior')}: ${money(figure.prior, currency)}`);
    lines.push(`${tr('الفرق', 'Écart', 'Variance')}: ${money(figure.balance - figure.prior, currency)}`);
  }
  lines.push(`${tr('عدد القيود', 'Écritures', 'Postings')}: ${figure.lines}`);
  lines.push(basisLine(source, tr));
  return lines.join('\n');
}

