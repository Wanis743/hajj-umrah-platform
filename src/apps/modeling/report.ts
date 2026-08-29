/**
 * Modeling — what leaves the window.
 *
 * A forecast is argued with in a room where this window is not open, so the export carries
 * its own assumptions: the driver, the lookback, the horizon and the growth rate go in the
 * file as a first block, and the months follow as columns. A projection whose method is not
 * written down beside it is a column of numbers somebody will read as a promise.
 *
 * Months are columns rather than rows because that is the shape a spreadsheet charts
 * without being rearranged first, and rearranging is where the numbers get edited.
 *
 * Amounts are decimals with a dot and no currency mark, and percentages are plain ratios:
 * a file that arrives pre-formatted cannot be reformatted back.
 */
import { csvDocument } from '../shared/csv';
import { ACCOUNT_TYPE_LABEL } from '../shared/ledger';
import type { Budget } from '../shared/ledger';
import type { Localized } from '@/platform/sdk';
import type { CompareRow, ForecastRow, Projection, Scenario, TimelineRow } from './forecast';
import { METHOD_LABEL } from './forecast';

/** The translator the runtime already holds, narrowed to what a pure module needs. */
export type Label = (value: Localized) => string;
export type Translate = (ar: string, fr: string, en: string) => string;

/** `model-forecast-2026-08-28.csv` — the view first, because that is what differs. */
export function suggestedFileName(view: string, today: string): string {
  return `model-${view}-${today}.csv`;
}

/** The scenario as one line, for the top of a file and the end of a paragraph. */
export function scenarioLine(scenario: Scenario, t: Label, tr: Translate): string {
  const parts = [
    `${tr('المحرّك', 'Moteur', 'Driver')}: ${t(METHOD_LABEL[scenario.method])}`,
    `${tr('الأفق', 'Horizon', 'Horizon')}: ${scenario.horizon}`,
    `${tr('أشهر النظر', 'Fenêtre', 'Lookback')}: ${scenario.lookback}`,
  ];
  if (scenario.method === 'growth') parts.push(`${tr('النمو', 'Croissance', 'Growth')}: ${scenario.growth}%`);
  if (scenario.uplift !== 0) parts.push(`${tr('زيادة التكاليف', 'Inflation des charges', 'Cost uplift')}: ${scenario.uplift}%`);
  if (scenario.overrides.size > 0) {
    parts.push(`${tr('تجاوزات', 'Dérogations', 'Overrides')}: ${scenario.overrides.size}`);
  }
  return parts.join(' · ');
}

/** Which driver produced a row, once the override has had its say. */
const rowDriver = (row: ForecastRow, scenario: Scenario, t: Label, tr: Translate): string =>
  row.overridden ? tr('تجاوز', 'Dérogation', 'Override') : t(METHOD_LABEL[scenario.method]);

/**
 * The forecast, one row per account and one column per projected month.
 *
 * The average and the total bracket the months: the first says what the account has been
 * doing, the last says what the model thinks it will do, and the columns between them are
 * how it got from one to the other.
 *
 * The driver, the lookback and the horizon are columns rather than a preamble. A preamble
 * would make row one something other than the header, and a row that gets filtered or
 * pasted into another sheet takes its assumptions with it this way.
 *
 * The rows come in as an argument rather than off the projection, because what leaves has to
 * be what was on screen: a search box that hid two thirds of the grid did so on purpose.
 */
export function forecastCsv(
  rows: readonly ForecastRow[],
  months: readonly string[],
  scenario: Scenario,
  t: Label,
  tr: Translate,
): string {
  const header = [
    tr('الحساب', 'Compte', 'Account'),
    tr('التسمية', 'Libellé', 'Name'),
    tr('النوع', 'Type', 'Type'),
    tr('متوسّط النظر', 'Moyenne fenêtre', 'Window average'),
    ...months,
    tr('الإجمالي المتوقّع', 'Total projeté', 'Projected total'),
    tr('الموازنة', 'Budget', 'Planned'),
    tr('الفرق', 'Écart', 'Gap'),
    tr('المحرّك', 'Moteur', 'Driver'),
    tr('أشهر النظر', 'Fenêtre', 'Lookback'),
    tr('الأفق', 'Horizon', 'Horizon'),
    tr('عدد القيود', 'Écritures', 'Postings'),
  ];
  return csvDocument(
    header,
    rows.map((row) => [
      row.account.code,
      row.account.name,
      t(ACCOUNT_TYPE_LABEL[row.account.type]),
      row.average.toFixed(2),
      ...row.values.map((value) => value.toFixed(2)),
      row.total.toFixed(2),
      row.planned === null ? '' : row.planned.toFixed(2),
      row.gap === null ? '' : row.gap.toFixed(2),
      rowDriver(row, scenario, t, tr),
      String(scenario.lookback),
      String(scenario.horizon),
      String(row.lines),
    ]),
  );
}

/** The months, actual and projected in one column so the join is visible. */
export function timelineCsv(rows: readonly TimelineRow[], tr: Translate): string {
  return csvDocument(
    [
      tr('الشهر', 'Mois', 'Month'),
      tr('النوع', 'Nature', 'Kind'),
      tr('الإيرادات', 'Produits', 'Revenue'),
      tr('التكاليف', 'Charges', 'Expense'),
      tr('النتيجة', 'Résultat', 'Result'),
      tr('التراكمي', 'Cumul', 'Cumulative'),
    ],
    rows.map((row) => [
      row.month,
      row.projected ? tr('متوقّع', 'Projeté', 'Projected') : tr('منفَّذ', 'Réalisé', 'Actual'),
      row.revenue.toFixed(2),
      row.expense.toFixed(2),
      row.result.toFixed(2),
      row.cumulative.toFixed(2),
    ]),
  );
}

/** The comparison against the plan, by account type. */
export function compareCsv(rows: readonly CompareRow[], t: Label, tr: Translate): string {
  return csvDocument(
    [
      tr('النوع', 'Type', 'Type'),
      tr('المتوقّع', 'Projeté', 'Projected'),
      tr('الموازنة', 'Budget', 'Planned'),
      tr('الفرق', 'Écart', 'Gap'),
      tr('حسابات', 'Comptes', 'Accounts'),
    ],
    rows.map((row) => [
      t(ACCOUNT_TYPE_LABEL[row.type]),
      row.projected.toFixed(2),
      row.planned.toFixed(2),
      row.gap.toFixed(2),
      String(row.accounts),
    ]),
  );
}

/* ------------------------------------------------------------------ *
 * The clipboard — the same facts, as a paragraph
 * ------------------------------------------------------------------ */

/** `2026-09 → 2027-02`, or the one month when the horizon is one month long. */
function span(months: readonly string[], tr: Translate): string {
  if (months.length === 0) return tr('لا شيء', 'Aucun', 'None');
  const first = months[0];
  const last = months[months.length - 1];
  return first === last ? first : `${first} → ${last}`;
}

/** Amounts in a pasted paragraph keep the dot and name the currency once each. */
const money = (value: number): string => `${value.toFixed(2)} DZD`;

/**
 * The whole model as a paragraph, for a message rather than a sheet.
 *
 * The worst gap is named rather than counted: "three accounts over plan" tells a reader to
 * go looking, "6100 Salaires — 240000.00 DZD over" tells them where.
 */
export function summaryClipboardText(
  projection: Projection,
  scenario: Scenario,
  budget: Budget | null,
  t: Label,
  tr: Translate,
): string {
  const lines = [
    `${tr('التوقّع', 'Projection', 'Forecast')}: ${span(projection.futureMonths, tr)}`,
    scenarioLine(scenario, t, tr),
    `${tr('الإيرادات', 'Produits', 'Revenue')}: ${money(projection.revenue)}`,
    `${tr('التكاليف', 'Charges', 'Expense')}: ${money(projection.expense)}`,
    `${tr('النتيجة', 'Résultat', 'Result')}: ${money(projection.result)}`,
    `${tr('حسابات', 'Comptes', 'Accounts')}: ${projection.accounts}`,
  ];
  if (budget !== null && projection.planned !== null) {
    const name = budget.name === '' ? tr('بلا اسم', 'Sans nom', 'Untitled') : budget.name;
    lines.push(`${tr('الموازنة', 'Budget', 'Plan')}: ${name} — ${money(projection.planned)}`);
  }
  const worst = projection.worst;
  if (worst !== null && worst.gap !== null) {
    const who = `${worst.account.code} ${worst.account.name}`.trim();
    lines.push(`${tr('أسوأ فرق', 'Écart le plus défavorable', 'Worst gap')}: ${who} — ${money(worst.gap)}`);
  }
  if (!projection.complete) {
    lines.push(tr('التاريخ غير مكتمل.', 'Historique incomplet.', 'History is incomplete.'));
  }
  return lines.join('\n');
}

/**
 * One account, with the evidence beside the projection.
 *
 * The window average and the count of months the account actually moved in go in the same
 * paragraph as the total, because a projection drawn from one active month out of six is a
 * different claim from the same number drawn from six.
 */
export function rowClipboardText(row: ForecastRow, scenario: Scenario, t: Label, tr: Translate): string {
  const lines = [
    `${row.account.code} ${row.account.name}`.trim(),
    `${tr('النوع', 'Type', 'Type')}: ${t(ACCOUNT_TYPE_LABEL[row.account.type])}`,
    `${tr('المحرّك', 'Moteur', 'Driver')}: ${rowDriver(row, scenario, t, tr)}`,
    `${tr('متوسّط النظر', 'Moyenne fenêtre', 'Window average')}: ${money(row.average)}`,
    `${tr('الإجمالي المتوقّع', 'Total projeté', 'Projected total')}: ${money(row.total)}`,
  ];
  if (scenario.method === 'trend' && !row.overridden) {
    lines.push(`${tr('الانحدار الشهري', 'Dérive mensuelle', 'Monthly drift')}: ${money(row.slope)}`);
  }
  if (row.planned !== null && row.gap !== null) {
    lines.push(`${tr('الموازنة', 'Budget', 'Planned')}: ${money(row.planned)}`);
    lines.push(`${tr('الفرق', 'Écart', 'Gap')}: ${money(row.gap)}`);
  }
  lines.push(
    `${tr('الشهود', 'Observations', 'Evidence')}: ${row.lines} ${tr('قيد', 'écritures', 'postings')}, ` +
      `${row.activeMonths}/${scenario.lookback} ${tr('شهر بحركة', 'mois actifs', 'active months')}`,
  );
  return lines.join('\n');
}

/** One month of the timeline: the income statement that month implies. */
export function monthClipboardText(row: TimelineRow, tr: Translate): string {
  const kind = row.projected ? tr('متوقّع', 'Projeté', 'Projected') : tr('منفَّذ', 'Réalisé', 'Actual');
  return [
    `${row.month} — ${kind}`,
    `${tr('الإيرادات', 'Produits', 'Revenue')}: ${money(row.revenue)}`,
    `${tr('التكاليف', 'Charges', 'Expense')}: ${money(row.expense)}`,
    `${tr('النتيجة', 'Résultat', 'Result')}: ${money(row.result)}`,
    `${tr('التراكمي', 'Cumul', 'Cumulative')}: ${money(row.cumulative)}`,
  ].join('\n');
}

/** One line of the comparison against the plan, by account type. */
export function groupClipboardText(row: CompareRow, t: Label, tr: Translate): string {
  return [
    t(ACCOUNT_TYPE_LABEL[row.type]),
    `${tr('المتوقّع', 'Projeté', 'Projected')}: ${money(row.projected)}`,
    `${tr('الموازنة', 'Budget', 'Planned')}: ${money(row.planned)}`,
    `${tr('الفرق', 'Écart', 'Gap')}: ${money(row.gap)}`,
    `${tr('حسابات', 'Comptes', 'Accounts')}: ${row.accounts}`,
  ].join('\n');
}
