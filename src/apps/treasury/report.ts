/**
 * Treasury — what leaves the window.
 *
 * A cash figure travels further than any other number this suite produces. "We have
 * 12 million" gets said in a meeting, repeated to a bank and written into a plan, and
 * every one of those repetitions drops whatever qualified it. So the qualification is
 * not a footnote here: the rate that priced it, the day it was read, the horizon it
 * was cut to and the invoices counted whole all head the paragraph and repeat on every
 * row of the file.
 *
 * The rate is the part people forget. A position stated in dinars out of a riyal
 * balance is only as true as a quote somebody typed, possibly last March, possibly
 * upside down — so the quote, its date and its source travel with the figure, and a
 * position that has no quote exports an empty cell rather than a plausible number.
 *
 * Amounts are decimals with a dot and their currency in a column of its own: a file
 * that arrives pre-formatted cannot be un-formatted, and `1.250` means two different
 * numbers in the three languages this OS runs in.
 */
import type { Localized } from '@/platform/sdk';
import { csvDocument } from '../shared/csv';
import type { Currency } from '../shared/ledger';
import {
  BUCKET_LABEL,
  type CashRow,
  type Forecast,
  type Horizon,
  type Lens,
  LENS_LABEL,
  LENS_UNIT,
  type Liquidity,
  NOTE_LABEL,
  NOTE_REASON,
} from './cash';
import { REPORTING, type RateBook, reported } from './rates';

/** The translator the runtime already holds, narrowed to what a pure module needs. */
export type Label = (value: Localized) => string;
export type Translate = (ar: string, fr: string, en: string) => string;

/** `treasury-payable-2026-08-29.csv` — the lens first, because that is what differs. */
export const suggestedFileName = (lens: Lens, today: string): string =>
  `treasury-${lens}-${today}.csv`;

/** An amount as a file and a paragraph want it: a dot, two places, and its currency named. */
const money = (value: number, currency: Currency = REPORTING): string =>
  `${value.toFixed(2)} ${currency}`;

/** A figure that may not exist, in a sentence. */
const orNothing = (value: number | null, tr: Translate, currency: Currency = REPORTING): string =>
  value === null ? tr('غير قابل للتحديد', 'Indéterminable', 'Not statable') : money(value, currency);

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

/**
 * Everything that decides what the figures mean, gathered once.
 *
 * Six facts, and the report is unquotable without any one of them: which question was
 * asked, how far ahead, as of when, at what rate, how much of the paper was counted at
 * more than it will collect, and whether the page it was read off ran out.
 */
export interface Provenance {
  readonly lens: Lens;
  readonly horizon: Horizon;
  /** The day every age and every bucket in the report is measured from. */
  readonly today: string;
  readonly rates: RateBook;
  /** Partly settled invoices counted at face value. Zero on the other two lenses. */
  readonly whole: number;
  /** Drafts, void bills and cancelled invoices that carry an amount and were excluded. */
  readonly setAside: number;
  readonly bounded: boolean;
}

/**
 * The rate in words, or the admission that there is none.
 *
 * Direction, date and source, because all three change the answer: a quote from a
 * bank's board and one somebody typed off a screen are not the same evidence, and a
 * quote read upside down is arithmetic performed on someone else's rounding.
 */
export function rateLine(book: RateBook, tr: Translate): string {
  if (book.perSar === null) {
    return tr(
      'لا يوجد سعر صرف مسجَّل للزوج، فكل مبلغ بالريال بقي بعملته',
      'Aucun taux enregistré pour la paire : les montants en riyals restent dans leur monnaie',
      'No rate on record for the pair, so riyal amounts stay in their own currency',
    );
  }
  const parts = [`1 SAR = ${book.perSar.toFixed(4)} DZD`];
  if (book.at !== null) parts.push(book.at);
  if (book.source !== '') parts.push(book.source);
  if (book.inverted) parts.push(tr('مقلوب', 'Inversé', 'Inverted'));
  return parts.join(' · ');
}

/**
 * The basis as one line, for the head of a paragraph and for the rail.
 *
 * The horizon is named on the flow lenses and left out on the cash one, where it means
 * nothing: a balance is not due on a date. The overstatement comes before the page
 * warning because it is the larger error of the two — a receivable counted whole is
 * wrong by however much has been collected, while a full page is only incomplete.
 */
export function basisLine(source: Provenance, t: Label, tr: Translate): string {
  const parts = [t(LENS_LABEL[source.lens])];
  if (source.lens !== 'cash') {
    parts.push(
      tr(`أفق ${source.horizon} يومًا`, `Horizon ${source.horizon} j`, `${source.horizon}-day horizon`),
    );
  }
  parts.push(`${tr('بتاريخ', 'Au', 'As of')} ${source.today}`);
  parts.push(rateLine(source.rates, tr));
  if (source.whole > 0) {
    parts.push(
      tr(
        `${source.whole} فاتورة محسوبة بالكامل`,
        `${source.whole} facture(s) comptée(s) en entier`,
        `${source.whole} invoice(s) counted whole`,
      ),
    );
  }
  if (source.setAside > 0) {
    parts.push(
      tr(
        `${source.setAside} مستندًا مستثنى`,
        `${source.setAside} document(s) écarté(s)`,
        `${source.setAside} document(s) set aside`,
      ),
    );
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
 * The book side, for the two columns only a bank row fills.
 *
 * Both or neither: a gap without the balance it was taken from is a number nobody can
 * check, and an unlinked account has neither.
 */
const bookCells = (row: CashRow): readonly string[] => {
  const position = row.position;
  if (position === null || position.book === null || position.gap === null) return ['', ''];
  return [position.book.toFixed(2), position.gap.toFixed(2)];
};

/**
 * The table, one row per line of whichever lens is in force.
 *
 * One shape for the three lenses, and the columns a lens has no use for are left empty
 * rather than dropped: three files with three headers cannot be pasted under one
 * another, and a treasurer building a pack does exactly that. The book and gap columns
 * are the ones that only ever fill on the cash lens.
 *
 * Both amount columns are exported — the row's own currency and the dinar restatement —
 * because a sheet that sums the second one is summing the rate as well, and the reader
 * should be able to see which figures were converted and at what.
 */
export function rowsCsv(
  rows: readonly CashRow[],
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const lens = t(LENS_LABEL[source.lens]);
  const horizon = source.lens === 'cash' ? '' : String(source.horizon);
  const rate = source.rates.perSar === null ? '' : source.rates.perSar.toFixed(4);
  return csvDocument(
    [
      tr('العدسة', 'Vue', 'Lens'),
      tr('المرجع', 'Référence', 'Reference'),
      tr('التفصيل', 'Détail', 'Detail'),
      tr('العملة', 'Monnaie', 'Currency'),
      tr('المبلغ', 'Montant', 'Amount'),
      tr('المبلغ بالدينار', 'Montant en DZD', 'Amount in DZD'),
      tr('الدفتر', 'Livre', 'Book'),
      tr('الفرق', 'Écart', 'Gap'),
      tr('التاريخ', 'Date', 'Date'),
      tr('التوقيت', 'Échéancier', 'Timing'),
      tr('الأيام', 'Jours', 'Days'),
      tr('الحالة', 'Statut', 'Status'),
      tr('ملاحظة', 'Réserve', 'Note'),
      tr('الأفق', 'Horizon', 'Horizon'),
      tr('بتاريخ', 'Au', 'As of'),
      tr('سعر الريال', 'Taux du riyal', 'Rate per SAR'),
    ],
    rows.map((row) => [
      lens,
      row.title,
      row.detail,
      row.currency,
      row.amount.toFixed(2),
      row.reported === null ? '' : row.reported.toFixed(2),
      ...bookCells(row),
      row.date ?? '',
      row.bucket === null ? '' : t(BUCKET_LABEL[row.bucket]),
      row.days === null ? '' : String(row.days),
      t(row.badge),
      row.note === null ? '' : t(NOTE_LABEL[row.note]),
      horizon,
      source.today,
      rate,
    ]),
  );
}

/* ------------------------------------------------------------------ *
 * The clipboard — the same facts, as a paragraph
 * ------------------------------------------------------------------ */

/** What a pasted summary is assembled from. */
export interface Summary {
  readonly figures: Liquidity;
  readonly outlook: Forecast;
  readonly source: Provenance;
  /** The lens's rows, before the find box narrowed them. */
  readonly rows: readonly CashRow[];
  readonly biggest: CashRow | null;
  /** The most overdue row, which is the other thing a summary always mentions. */
  readonly worst: CashRow | null;
}

/**
 * The whole position as a paragraph.
 *
 * Ordered the way a treasurer says it out loud: what is in the bank, what the book
 * thinks, what leaves, what should arrive, what that leaves at the end of the horizon —
 * then the two rows worth naming. The projected balance comes last of the figures
 * because it is the only one that is not a fact, and putting it first is how a forecast
 * gets quoted as a balance.
 */
export function summaryClipboardText(summary: Summary, t: Label, tr: Translate): string {
  const { figures, outlook, source } = summary;
  const rates = source.rates;
  const lines = [
    `${tr('الخزينة', 'Trésorerie', 'Treasury')} — ${basisLine(source, t, tr)}`,
    `${tr('رصيد البنوك', 'Solde bancaire', 'Bank balance')}: ${orNothing(outlook.opening, tr)} ` +
      `(${figures.accounts} ${t({ ar: 'حسابًا', fr: 'comptes', en: 'accounts' })})`,
  ];
  if (figures.unlinked > 0) {
    lines.push(
      `${tr('بلا طرف دفتري', 'Sans contrepartie', 'No book side')}: ${figures.unlinked} · ` +
        `${tr('فروق', 'Écarts', 'Gaps')}: ${figures.gaps} · ` +
        `${tr('أسطر غير مطابقة', 'Lignes non rapprochées', 'Unmatched lines')}: ${figures.unmatched}`,
    );
  }
  lines.push(
    `${tr('الدفتر', 'Livre', 'Book')}: ${orNothing(reported(figures.book, rates), tr)} · ` +
      `${tr('الفرق', 'Écart', 'Gap')}: ${orNothing(outlook.gap, tr)}`,
    `${tr('يخرج خلال الأفق', "Sorties sur l'horizon", 'Out over the horizon')}: ${orNothing(outlook.outgoing, tr)} ` +
      `(${tr('منها متأخّر', 'dont en retard', 'of which overdue')} ${orNothing(reported(figures.outflow.overdue, rates), tr)})`,
    `${tr('يدخل خلال الأفق', "Entrées sur l'horizon", 'In over the horizon')}: ${orNothing(outlook.incoming, tr)} ` +
      `(${tr('منها متأخّر', 'dont en retard', 'of which overdue')} ${orNothing(reported(figures.inflow.overdue, rates), tr)})`,
    `${tr('محصَّل خلال الأفق المنصرم', "Encaissé sur l'horizon écoulé", 'Collected over the trailing horizon')}: ` +
      `${orNothing(reported(figures.collected, rates), tr)} (${figures.collections})`,
    `${tr('الرصيد المتوقَّع', 'Solde projeté', 'Projected balance')}: ${orNothing(outlook.closing, tr)}`,
  );
  if (summary.biggest !== null) {
    lines.push(
      `${tr('الأكبر', 'Le plus gros', 'Largest')}: ${summary.biggest.title} — ` +
        `${money(summary.biggest.amount, summary.biggest.currency)}`,
    );
  }
  if (summary.worst !== null && summary.worst.days !== null) {
    lines.push(
      `${tr('الأكثر تأخّرًا', 'Le plus en retard', 'Most overdue')}: ${summary.worst.title} — ` +
        `${money(summary.worst.amount, summary.worst.currency)} · ` +
        tr(
          `${Math.abs(summary.worst.days)} يومًا`,
          `${Math.abs(summary.worst.days)} j`,
          `${Math.abs(summary.worst.days)} days`,
        ),
    );
  }
  lines.push(
    `${t(LENS_LABEL[source.lens])}: ${summary.rows.length} ${t(LENS_UNIT[source.lens])}`,
  );
  return lines.join('\n');
}

/**
 * One row, with the reason it is not quite what it looks like.
 *
 * The note pastes as its whole sentence rather than its label. A row copied into a
 * message to a colleague loses every tooltip it had, and "counted whole" on its own
 * reads as reassurance when it means the opposite.
 */
export function rowClipboardText(
  row: CashRow,
  source: Provenance,
  t: Label,
  tr: Translate,
): string {
  const lines = [row.title];
  if (row.detail !== '') lines.push(row.detail);
  lines.push(`${tr('المبلغ', 'Montant', 'Amount')}: ${money(row.amount, row.currency)}`);
  if (row.currency !== REPORTING) {
    lines.push(
      `${tr('بالعملة المرجعية', 'En monnaie de référence', 'In the reporting currency')}: ` +
        orNothing(row.reported, tr),
    );
  }
  const position = row.position;
  if (position !== null) {
    lines.push(`${tr('الدفتر', 'Livre', 'Book')}: ${orNothing(position.book, tr, row.currency)}`);
    lines.push(`${tr('الفرق', 'Écart', 'Gap')}: ${orNothing(position.gap, tr, row.currency)}`);
    lines.push(
      `${tr('كشوف', 'Relevés', 'Statements')}: ${position.statements} · ` +
        `${tr('مطابقة', 'Rapprochées', 'Matched')}: ${position.matched} · ` +
        `${tr('غير مطابقة', 'Non rapprochées', 'Unmatched')}: ${position.unmatched}`,
    );
  }
  if (row.date !== null && row.date !== '') {
    const timing =
      row.bucket === null
        ? tr('آخر كشف', 'Dernier relevé', 'Latest statement')
        : t(BUCKET_LABEL[row.bucket]);
    const days =
      row.days === null
        ? ''
        : ` (${tr(`${Math.abs(row.days)} يومًا`, `${Math.abs(row.days)} j`, `${Math.abs(row.days)} days`)})`;
    lines.push(`${timing}: ${row.date}${days}`);
  }
  lines.push(`${tr('الحالة', 'Statut', 'Status')}: ${t(row.badge)}`);
  if (row.note !== null) lines.push(t(NOTE_REASON[row.note]));
  lines.push(basisLine(source, t, tr));
  return lines.join('\n');
}
