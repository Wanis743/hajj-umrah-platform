/**
 * What every export in the suite is, before it is a file.
 *
 * Fourteen apps produce a table and then immediately flatten it to CSV, which is
 * why for years the suite could only produce CSV: the shape was thrown away at
 * the first opportunity. A `TableDocument` is that shape kept — a title, a header
 * row, the body, and the provenance lines that a spreadsheet has nowhere to put
 * but a printed page badly needs.
 *
 * Rows stay raw. An ISO date and an unformatted decimal survive every reader; a
 * pre-formatted `1 250,00 DA` survives none of them, and a spreadsheet asked to
 * guess whether `1.250` is one thousand or one and a quarter will guess wrong in
 * one of the three languages this OS runs in. The writers format at the edge —
 * only Excel is told a number is a number, because only Excel can use that.
 */
import type { VfsContentType } from '@/platform/kernel/abi';

/** One provenance line: which rate, which day, which horizon. */
export interface TableMeta {
  readonly label: string;
  readonly value: string;
}

export interface TableDocument {
  /** Heading for the page, the sheet tab, and the file dialog. */
  readonly title: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Printed above the table by the formats that have a page. */
  readonly meta?: readonly TableMeta[];
  /** Reading order, honoured by the formats that can express it. */
  readonly rtl?: boolean;
}

export type ExportFormat = 'csv' | 'xlsx' | 'docx' | 'pdf';

/** Menu order: the two a finance reader actually opens first. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'xlsx', 'docx', 'pdf'];

export interface ExportedFile {
  readonly bytes: Uint8Array;
  readonly contentType: VfsContentType;
  /** With its dot, so a file name is a concatenation and not a template. */
  readonly extension: string;
}

const CONTENT_TYPES: Readonly<Record<ExportFormat, VfsContentType>> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

export const contentTypeOf = (format: ExportFormat): VfsContentType => CONTENT_TYPES[format];

export function tableDocument(
  title: string,
  header: readonly string[],
  rows: readonly (readonly string[])[],
  meta?: readonly TableMeta[],
): TableDocument {
  return meta === undefined ? { title, header, rows } : { title, header, rows, meta };
}

/**
 * The extension belongs to the format, never to the call site.
 *
 * Six report modules used to hardcode `.csv` into their suggested name, which is
 * how a file called `treasury-cash-2026-08-29.csv` could arrive holding a PDF.
 */
export const fileNameFor = (base: string, format: ExportFormat): string =>
  `${base.replace(/\.(csv|xlsx|docx|pdf)$/i, '')}.${format}`;

/** UTF-8 bytes. Every one of the four formats is UTF-8 underneath. */
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Whether a cell should reach Excel as a number rather than a string.
 *
 * Deliberately strict: a plain decimal with an optional sign and nothing else.
 * `1 250,00 DA` stays text, `12/08/2026` stays text, and an account code like
 * `1000` becomes a number — which is correct, because a reader who sums a column
 * of codes has made their own mistake and one who filters `> 4000` has not.
 */
export const isNumeric = (value: string): boolean => /^-?(?:\d+|\d*\.\d+)$/.test(value);

/**
 * The typographic slots WinAnsi keeps in the 0x80–0x9F block, keyed by code
 * point. The euro sign, the dashes, the curly quotes and the ellipsis are the
 * ones a finance report actually contains; the rest come along because the
 * table is short either way.
 */
export const WINANSI_TYPOGRAPHIC: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * The few glyphs a finance report reaches for that WinAnsi has no slot for at
 * all, and the ASCII that says the same thing.
 *
 * Eight report modules write an arrow into a provenance line or a cell —
 * `2026-08-01 → 2026-08-31`, `Documents → Accounting`, an opening balance
 * arrowed to a closing one. One arrow is not a reason to send an otherwise-Latin
 * report to the browser's print dialog, which is what the check below would
 * otherwise decide for nearly every PDF the suite produces.
 *
 * These are substitutions, not escapes: they change what the page says, so the
 * list is short and holds only pairs a reader loses nothing by. Anything with a
 * real WinAnsi slot — the dashes, the curly quotes, the ellipsis, the bullet —
 * belongs in the table above instead, where it is drawn rather than replaced.
 */
export const WINANSI_FOLD: Readonly<Record<string, string>> = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~',
  '−': '-', '‑': '-',
};

/** Applied before the check below and before the PDF draws, so the two agree. */
export const winAnsiFold = (text: string): string =>
  text.replace(/[→←↔⇒⇐≤≥≠≈−‑]/g, (glyph) => WINANSI_FOLD[glyph] ?? glyph);

/** Text no PDF standard-14 font can draw. Arabic is the case that matters here. */
export const isWinAnsi = (text: string): boolean => {
  const folded = winAnsiFold(text);
  for (let i = 0; i < folded.length; i += 1) {
    const code = folded.charCodeAt(i);
    if (code < 0x7f || (code >= 0xa0 && code <= 0xff)) continue;
    if (WINANSI_TYPOGRAPHIC[code] === undefined) return false;
  }
  return true;
};

/** Every string in the document, for the writers that need to vet them all. */
export function* everyCell(doc: TableDocument): Generator<string> {
  yield doc.title;
  for (const meta of doc.meta ?? []) {
    yield meta.label;
    yield meta.value;
  }
  yield* doc.header;
  for (const row of doc.rows) yield* row;
}
