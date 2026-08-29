/**
 * Budgets — what leaves the window.
 *
 * A variance report is read in a meeting and then argued with, so the export has to be
 * re-doable: every row carries the plan, the actual and the subtraction between them, and
 * anybody can check the third column against the first two. Percentages are written as
 * plain ratios for the same reason — a spreadsheet can format them, and a file that
 * arrives pre-formatted cannot be reformatted back.
 *
 * Amounts are decimals with a dot and no currency mark. `1 250,00 DA` reads as a number
 * in one locale and as text in the other, and the version that reads as text is the one
 * that ends up in the deck.
 */
import { csvDocument } from '../shared/csv';
import { ACCOUNT_TYPE_LABEL, type Budget } from '../shared/ledger';
import type { Localized } from '@/platform/sdk';
import { type BudgetAssessment, type RollupRow, VARIANCE_STATE_LABEL, type VarianceRow } from './variance';

/** The translator the runtime already holds, narrowed to what a pure module needs. */
export type Label = (value: Localized) => string;
export type Translate = (ar: string, fr: string, en: string) => string;

/** `budget-2026-plan-variance.csv` — the budget first, because that is how it is filed. */
export function suggestedFileName(budget: Budget | null, view: string, today: string): string {
  const stem = budget === null ? today : budget.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase();
  return `budget-${stem === '' ? today : stem}-${view}.csv`;
}

/**
 * The report itself, one row per account.
 *
 * Serves the plan view too: it is the same row with the idle accounts left in, and a
 * second exporter that formatted them differently would be a second thing to keep true.
 */
export function varianceCsv(rows: readonly VarianceRow[], t: Label, tr: Translate): string {
  return csvDocument(
    [
      tr('الحساب', 'Compte', 'Account'),
      tr('التسمية', 'Libellé', 'Name'),
      tr('النوع', 'Type', 'Type'),
      tr('الخطة', 'Budget', 'Planned'),
      tr('المنفَّذ', 'Réalisé', 'Actual'),
      tr('الفرق', 'Écart', 'Variance'),
      tr('النسبة', 'Consommé', 'Used'),
      tr('الحالة', 'État', 'State'),
      tr('عدد القيود', 'Écritures', 'Postings'),
    ],
    rows.map((row) => [
      row.account.code,
      row.account.name,
      t(ACCOUNT_TYPE_LABEL[row.account.type]),
      row.planned.toFixed(2),
      row.actual.toFixed(2),
      row.variance.toFixed(2),
      row.used === null ? '' : row.used.toFixed(4),
      t(VARIANCE_STATE_LABEL[row.state]),
      String(row.lines),
    ]),
  );
}

/** The version that goes into the meeting: five rows at most, and the count that matters. */
export function rollupCsv(groups: readonly RollupRow[], t: Label, tr: Translate): string {
  return csvDocument(
    [
      tr('النوع', 'Type', 'Type'),
      tr('الخطة', 'Budget', 'Planned'),
      tr('المنفَّذ', 'Réalisé', 'Actual'),
      tr('الفرق', 'Écart', 'Variance'),
      tr('حسابات', 'Comptes', 'Accounts'),
      tr('غير مواتٍ', 'Défavorables', 'Adverse'),
    ],
    groups.map((group) => [
      t(ACCOUNT_TYPE_LABEL[group.type]),
      group.planned.toFixed(2),
      group.actual.toFixed(2),
      group.variance.toFixed(2),
      String(group.accounts),
      String(group.adverse),
    ]),
  );
}

/**
 * The state of the plan as a paragraph, for the mail that follows the meeting.
 *
 * It names its own basis. "Actual" means one thing against a period and another against
 * the whole book, and a paragraph pasted into a thread loses the status bar that said so.
 */
export function summaryClipboardText(
  budget: Budget | null,
  assessment: BudgetAssessment,
  t: Label,
  tr: Translate,
): string {
  if (budget === null) return tr('لا موازنة محدّدة.', 'Aucun budget sélectionné.', 'No budget selected.');
  const basis =
    assessment.basis === 'period'
      ? tr('على أساس الفترة', 'sur la période', 'on the period')
      : tr('على أساس الدفتر كاملًا', 'sur tout le livre', 'over the whole book');
  const lines = [
    `${budget.name} — ${basis}${assessment.complete ? '' : ` (${tr('جزئي', 'partiel', 'partial')})`}`,
    `${tr('الخطة', 'Budget', 'Planned')}: ${assessment.planned.toFixed(2)} · ${tr('المنفَّذ', 'Réalisé', 'Actual')}: ${assessment.actual.toFixed(2)} · ${tr('الفرق', 'Écart', 'Variance')}: ${assessment.variance.toFixed(2)}`,
    `${tr('سطور الخطة', 'Lignes', 'Plan lines')}: ${assessment.lines}/${assessment.accounts} · ${tr('غير مواتٍ', 'Défavorables', 'Adverse')}: ${assessment.adverse} · ${tr('غير مخطَّط', 'Hors plan', 'Unplanned')}: ${assessment.unplanned}`,
  ];
  for (const group of assessment.groups) {
    lines.push(`— ${t(ACCOUNT_TYPE_LABEL[group.type])}: ${group.variance.toFixed(2)}`);
  }
  return lines.join('\n');
}

/** One rollup group, for the line somebody pastes under a chart. */
export function groupClipboardText(group: RollupRow, t: Label, tr: Translate): string {
  const head = `${t(ACCOUNT_TYPE_LABEL[group.type])} — ${tr('حسابات', 'Comptes', 'Accounts')}: ${group.accounts}`;
  const body = `${tr('الخطة', 'Budget', 'Planned')}: ${group.planned.toFixed(2)} · ${tr('المنفَّذ', 'Réalisé', 'Actual')}: ${group.actual.toFixed(2)} · ${tr('الفرق', 'Écart', 'Variance')}: ${group.variance.toFixed(2)}`;
  return group.adverse === 0
    ? `${head}\n${body}`
    : `${head}\n${body}\n${tr('غير مواتٍ', 'Défavorables', 'Adverse')}: ${group.adverse}`;
}

/** One account, for pasting into whatever thread is asking about it. */
export function rowClipboardText(row: VarianceRow, t: Label, tr: Translate): string {
  const parts = [
    `${row.account.code} · ${row.account.name} — ${t(VARIANCE_STATE_LABEL[row.state])}`,
    `${tr('الخطة', 'Budget', 'Planned')}: ${row.planned.toFixed(2)} · ${tr('المنفَّذ', 'Réalisé', 'Actual')}: ${row.actual.toFixed(2)} · ${tr('الفرق', 'Écart', 'Variance')}: ${row.variance.toFixed(2)}`,
  ];
  if (row.used !== null) parts.push(`${tr('النسبة', 'Consommé', 'Used')}: ${row.used.toFixed(4)}`);
  parts.push(`${tr('عدد القيود', 'Écritures', 'Postings')}: ${row.lines}`);
  return parts.join('\n');
}
