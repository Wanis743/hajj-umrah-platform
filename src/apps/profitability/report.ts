/**
 * Profitability — what leaves the window.
 *
 * A margin quoted without its coverage is the most misleading number this suite
 * can produce. "The Ramadan package made 400 000" is a sentence somebody will
 * repeat in a meeting, and if two thirds of the ledger's cost carried no package
 * tag then the sentence is false and nothing on its face says so. So coverage
 * travels with every export and heads every paragraph, next to the basis and the
 * window — the same courtesy the statements window pays its page ceiling.
 *
 * The remainder exports as a row like any other, named rather than blank. A sheet
 * whose members sum to less than the ledger and does not say why is a sheet that
 * gets reconciled by hand, badly.
 *
 * Amounts are decimals with a dot and no currency mark: a file that arrives
 * pre-formatted cannot be un-formatted, and `1.250` means two different numbers in
 * the two languages this OS runs in.
 */
import type { Localized } from '@/platform/sdk';
import { csvDocument } from '../shared/csv';
import { type Basis, type FiscalPeriod } from '../shared/ledger';
import { type Contribution, type Dimension, isUntagged, type MemberFigure, type Slice, variance } from './figures';
import { DIMENSION_LABEL } from './question';

/** The translator the runtime already holds, narrowed to what a pure module needs. */
export type Label = (value: Localized) => string;
export type Translate = (ar: string, fr: string, en: string) => string;

/** `profitability-package-2026-08-29.csv` — the dimension first, because that is what differs. */
export const suggestedFileName = (dimension: Dimension, today: string): string =>
  `profitability-${dimension}-${today}.csv`;

/** A period as a reader needs it: what it is called, and the dates that settles. */
const periodText = (period: FiscalPeriod | null, tr: Translate): string => {
  if (period === null) return tr('كل التواريخ', 'Toutes dates', 'All dates');
  const name = period.label === '' ? `${period.start} → ${period.end}` : period.label;
  return `${name} (${period.start} → ${period.end})`;
};

/** A share as text, for a file and a paragraph rather than for a tile. */
const pct = (value: number | null, tr: Translate): string =>
  value === null ? tr('لا ينطبق', 'S. O.', 'n/a') : `${(value * 100).toFixed(1)}%`;

/**
 * Everything that decides what the figures mean, gathered once.
 *
 * Five facts, and the report is unquotable without any one of them: what it was
 * sliced by, over what, against what, how much of the book it covers, and whether
 * the page it was read off ran out.
 */
export interface Provenance {
  readonly dimension: Dimension;
  readonly basis: Basis;
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  /** Tagged activity over all activity, or `null` when there was none. */
  readonly coverage: number | null;
  /** A page came back full, so every figure is a floor rather than a fact. */
  readonly bounded: boolean;
  /** Members nothing could put a name to, shown by the stem of their id. */
  readonly unnamed: number;
}

/** The basis in one word, for a column that repeats on every row. */
const basisCell = (basis: Basis, tr: Translate): string =>
  basis === 'book' ? tr('الدفتر بالكامل', 'Livre entier', 'Whole book') : tr('الفترة', 'Période', 'Period');

/** The window as raw dates, because a spreadsheet can filter those and not a label. */
const periodCell = (source: Provenance): string =>
  source.basis === 'book' || source.period === null ? '' : `${source.period.start} → ${source.period.end}`;

/**
 * The basis as one line, for the head of a paragraph and the rail.
 *
 * Coverage sits in it rather than after it. A reader who reaches the figures
 * without having been told what fraction of the ledger they rest on has already
 * formed an opinion, and the note underneath will not undo it.
 */
export function basisLine(source: Provenance, t: Label, tr: Translate): string {
  const parts = [
    `${tr('حسب', 'Par', 'By')} ${t(DIMENSION_LABEL[source.dimension])}`,
    source.basis === 'book'
      ? tr('الدفتر بالكامل', 'Livre entier', 'Whole book')
      : `${tr('الفترة', 'Période', 'Period')}: ${periodText(source.period, tr)}`,
  ];
  if (source.comparison !== null) {
    parts.push(`${tr('مقارنة', 'Comparaison', 'Compared with')}: ${periodText(source.comparison, tr)}`);
  }
  parts.push(`${tr('التغطية', 'Couverture', 'Coverage')}: ${pct(source.coverage, tr)}`);
  if (source.bounded) {
    parts.push(tr('حدّ أدنى: الصفحة مكتملة', 'Minorant : page saturée', 'Lower bound: the page was full'));
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

/**
 * The table, one row per member, remainder included.
 *
 * The kind column tells a member from the remainder, because a sheet that sorts by
 * margin will put them next to each other and nothing else on the row distinguishes
 * "the Cairo branch" from "no branch at all". Rates and shares export as decimals
 * rather than as percent strings: a spreadsheet formats those, and a `%` in a cell
 * is a cell that will not multiply.
 */
export function sliceCsv(
  rows: readonly MemberFigure[],
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const dimension = t(DIMENSION_LABEL[source.dimension]);
  const basis = basisCell(source.basis, tr);
  const period = periodCell(source);
  return csvDocument(
    [
      tr('النوع', 'Nature', 'Kind'),
      dimension,
      tr('التفصيل', 'Détail', 'Detail'),
      tr('الإيرادات', 'Produits', 'Revenue'),
      tr('التكاليف', 'Charges', 'Cost'),
      tr('الهامش', 'Marge', 'Margin'),
      tr('نسبة الهامش', 'Taux de marge', 'Margin rate'),
      tr('الحصة', 'Part', 'Share'),
      tr('المقارنة', 'Comparaison', 'Prior margin'),
      tr('الفرق', 'Écart', 'Variance'),
      tr('عدد القيود', 'Écritures', 'Postings'),
      tr('البُعد', 'Dimension', 'Dimension'),
      tr('الأساس', 'Base', 'Basis'),
      tr('الفترة', 'Période', 'Period'),
    ],
    rows.map((row) => {
      const gap = variance(row);
      return [
        isUntagged(row)
          ? tr('غير مخصَّص', 'Non affecté', 'Unallocated')
          : tr('عضو', 'Membre', 'Member'),
        row.label,
        row.detail,
        row.revenue.toFixed(2),
        row.cost.toFixed(2),
        row.margin.toFixed(2),
        row.rate === null ? '' : row.rate.toFixed(4),
        row.share === null ? '' : row.share.toFixed(4),
        row.prior === null ? '' : row.prior.toFixed(2),
        gap === null ? '' : gap.toFixed(2),
        String(row.postings),
        dimension,
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
const money = (value: number): string => `${value.toFixed(2)} DZD`;

/** How many account lines a pasted member carries before it stops being a paragraph. */
const TOP_ACCOUNTS = 4;

const accountLine = (row: Contribution): string =>
  `  ${row.code} ${row.name}`.trimEnd() + ` — ${money(row.amount)} (${row.postings})`;

/**
 * The whole slice as a paragraph.
 *
 * Ordered the way a person would say it: what was sliced, over what, how much of
 * the book that covers, then the totals, then who is at each end of the ranking.
 * The remainder is stated in money rather than only as a percentage, because
 * "38% unallocated" and "1 240 000 DZD unallocated" land very differently on the
 * person who has to go and tag it.
 */
export function sliceClipboardText(
  slice: Slice,
  source: Provenance,
  t: Label,
  tr: Translate,
  best: MemberFigure | null,
  worst: MemberFigure | null,
): string {
  const lines = [
    `${tr('الربحية', 'Rentabilité', 'Profitability')} — ${t(DIMENSION_LABEL[source.dimension])}`,
    basisLine(source, t, tr),
    `${tr('الإيرادات', 'Produits', 'Revenue')}: ${money(slice.totals.revenue)}`,
    `${tr('التكاليف', 'Charges', 'Cost')}: ${money(slice.totals.cost)}`,
    `${tr('الهامش', 'Marge', 'Margin')}: ${money(slice.totals.margin)} (${pct(slice.totals.rate, tr)})`,
  ];
  if (slice.untagged !== null) {
    lines.push(
      `${tr('غير مخصَّص', 'Non affecté', 'Unallocated')}: ` +
        `${money(slice.untagged.revenue)} / ${money(slice.untagged.cost)}`,
    );
  }
  if (best !== null) {
    lines.push(`${tr('الأعلى', 'Meilleur', 'Best')}: ${best.label} — ${money(best.margin)}`);
  }
  if (worst !== null) {
    lines.push(`${tr('الأدنى', 'Pire', 'Worst')}: ${worst.label} — ${money(worst.margin)}`);
  }
  lines.push(
    `${t(DIMENSION_LABEL[source.dimension])}: ${slice.members.length} · ` +
      `${tr('قيود', 'Écritures', 'Postings')}: ${slice.lines}`,
  );
  return lines.join('\n');
}

/**
 * One member, with the accounts that made it.
 *
 * The four biggest accounts go in the paste. A margin on its own invites the reply
 * "why", and the answer is nearly always one of the first three line items — so it
 * travels with the figure rather than waiting for somebody to open the window
 * again. The remainder pastes the same way, and reads as an instruction.
 */
export function memberClipboardText(
  member: MemberFigure,
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const lines = [
    member.label,
    member.detail === ''
      ? `${t(DIMENSION_LABEL[source.dimension])}`
      : `${t(DIMENSION_LABEL[source.dimension])} · ${member.detail}`,
    `${tr('الإيرادات', 'Produits', 'Revenue')}: ${money(member.revenue)}`,
    `${tr('التكاليف', 'Charges', 'Cost')}: ${money(member.cost)}`,
    `${tr('الهامش', 'Marge', 'Margin')}: ${money(member.margin)} (${pct(member.rate, tr)})`,
  ];
  if (member.share !== null) {
    lines.push(`${tr('الحصة من الإيرادات', 'Part des produits', 'Share of revenue')}: ${pct(member.share, tr)}`);
  }
  const gap = variance(member);
  if (member.prior !== null) {
    lines.push(`${tr('هامش المقارنة', 'Marge comparée', 'Prior margin')}: ${money(member.prior)}`);
  }
  if (gap !== null) lines.push(`${tr('الفرق', 'Écart', 'Variance')}: ${money(gap)}`);
  lines.push(`${tr('عدد القيود', 'Écritures', 'Postings')}: ${member.postings}`);
  if (member.accounts.length > 0) {
    lines.push(`${tr('أكبر الحسابات', 'Principaux comptes', 'Largest accounts')}:`);
    for (const row of member.accounts.slice(0, TOP_ACCOUNTS)) lines.push(accountLine(row));
  }
  if (isUntagged(member)) {
    lines.push(
      tr(
        'هذه القيود لا تحمل أي تخصيص، فلا يمكن نسبتها إلى أحد.',
        'Ces écritures ne portent aucune affectation : elles ne peuvent être attribuées.',
        'These postings carry no allocation, so nothing here can be attributed.',
      ),
    );
  }
  lines.push(basisLine(source, t, tr));
  return lines.join('\n');
}
