/**
 * `.pdf`, written by hand.
 *
 * A PDF is a list of numbered objects, a cross-reference table giving the byte
 * offset of each, and a trailer pointing at the catalog. This writes the six
 * kinds of object a paginated table needs — catalog, page tree, two fonts, the
 * document info, and one page plus one content stream per sheet of paper — and
 * nothing else. No compression, no embedded font, no outline.
 *
 * The font is the reader's own Helvetica, one of the fourteen every viewer is
 * required to carry, addressed through WinAnsi. That is the trade this writer
 * makes and the one thing it has to be honest about: WinAnsi is Latin script,
 * and a table with an Arabic supplier name has letters this file cannot draw.
 * `pdfNeedsBrowser` says so up front, and the caller routes such a document
 * through the browser's print path instead, where the platform's own text stack
 * shapes Arabic correctly. Embedding a face that could would cost more than every
 * other export writer combined and still need a joining engine on top.
 *
 * Offsets are byte offsets. Everything here is assembled as a string whose every
 * character is below 256 and then encoded one byte per character, so a string
 * index and a byte offset are the same number and the xref table is honest.
 */
import { WINANSI_TYPOGRAPHIC, isNumeric, type TableDocument, winAnsiFold } from './document';

/** Helvetica advance widths for the printable ASCII range, in 1/1000 em. */
const WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];

/** Points. A4, and the space around the table on it. */
const A4 = { short: 595.28, long: 841.89 };
const MARGIN = 40;
const LANDSCAPE_FROM = 7;
const FONT = 8;
const ROW = 13;
const PAD = 4;
/** Baseline lift inside a row: the descender sits just above the rule. */
const BASE = 4;
const MIN_COLUMN = PAD * 2 + 12;
const TITLE = 14;
const META = 8;
const FOOTER = 14;

export function textWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    units += code >= 32 && code <= 126 ? WIDTHS[code - 32] : 556;
  }
  // Helvetica-Bold runs a little wider than the regular face; near enough for
  // sizing a column, which is all this is used for.
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

/**
 * Text as WinAnsi code units, one character per byte-to-be.
 *
 * Latin-1 and WinAnsi agree everywhere except the 0x80–0x9F block, where
 * WinAnsi keeps the euro sign, the dashes and the curly quotes; those are
 * mapped through the table. Anything else is the writer's last defence for a
 * character `pdfNeedsBrowser` should already have rejected.
 */
function winAnsi(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff)) out += text[i];
    else {
      const slot = WINANSI_TYPOGRAPHIC[code];
      out += slot === undefined ? '?' : String.fromCharCode(slot);
    }
  }
  return out;
}

/** A cell is one line in a table; whitespace runs collapse to a space. */
const clean = (text: string): string => text.replace(/[\r\n\t]+/g, ' ');

/** Cleaned, folded and encoded: the form every string takes before it is measured. */
const drawable = (text: string): string => winAnsi(winAnsiFold(clean(text)));

/** A PDF literal string: parentheses and backslashes escaped. */
const literal = (text: string): string => `(${text.replace(/[\\()]/g, '\\$&')})`;

/** A number the way a content stream wants it: no exponent, few decimals. */
const num = (value: number): string => String(Math.round(value * 100) / 100);

function fit(text: string, max: number, bold: boolean): string {
  if (textWidth(text, FONT, bold) <= max) return text;
  const dots = textWidth('...', FONT, bold);
  let end = text.length;
  while (end > 0 && textWidth(text.slice(0, end), FONT, bold) + dots > max) end -= 1;
  return end === 0 ? '' : `${text.slice(0, end)}...`;
}

/**
 * Column widths that fill the page.
 *
 * Each column starts at the width of its widest cell. If that overshoots the
 * page, the widest columns are levelled down first — a long description gives
 * way before an amount does, so the numbers a finance reader came for are the
 * last thing to be truncated. If it undershoots, the slack is shared out.
 */
function columnWidths(doc: TableDocument, columns: number, available: number): number[] {
  const widths = new Array<number>(columns).fill(MIN_COLUMN);
  const note = (cells: readonly string[], bold: boolean): void => {
    cells.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], textWidth(clean(cell), FONT, bold) + PAD * 2);
    });
  };
  note(doc.header, true);
  for (const row of doc.rows) note(row, false);

  let total = widths.reduce((sum, w) => sum + w, 0);
  while (total > available + 0.01) {
    const max = Math.max(...widths);
    const wide: number[] = [];
    widths.forEach((w, i) => {
      if (w > max - 0.01) wide.push(i);
    });
    const next = Math.max(MIN_COLUMN, ...widths.filter((w) => w < max - 0.01));
    const cut = Math.min(max - next, (total - available) / wide.length);
    if (cut <= 0.01) break;
    for (const i of wide) widths[i] -= cut;
    total -= cut * wide.length;
  }
  if (total < available) {
    const scale = available / total;
    return widths.map((w) => w * scale);
  }
  return widths;
}

interface Layout {
  readonly widths: readonly number[];
  readonly rtl: boolean;
  readonly left: number;
}

function drawRow(ops: string[], cells: readonly string[], top: number, bold: boolean, layout: Layout): void {
  const { widths, rtl } = layout;
  let x = layout.left;
  for (let c = 0; c < widths.length; c += 1) {
    const index = rtl ? widths.length - 1 - c : c;
    const width = widths[index];
    const value = fit(drawable(cells[index] ?? ''), width - PAD * 2, bold);
    if (value !== '') {
      // Amounts hug the right edge so a column lines up on its decimal point;
      // text follows the reading direction of the page.
      const right = !bold && isNumeric(value) ? true : rtl;
      const tx = right ? x + width - PAD - textWidth(value, FONT, bold) : x + PAD;
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${FONT} Tf ${num(tx)} ${num(top - ROW + BASE)} Td ${literal(value)} Tj ET`);
    }
    x += width;
  }
}

const rule = (y: number, left: number, width: number, grey: number): string =>
  `${num(grey)} G 0.5 w ${num(left)} ${num(y)} m ${num(left + width)} ${num(y)} l S`;

const stamp = (at: Date): string => {
  const two = (v: number): string => String(v).padStart(2, '0');
  return `D:${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
};

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Lays the table out page by page; each entry is one content stream. */
function paginate(doc: TableDocument, pageW: number, pageH: number, layout: Layout): string[][] {
  const available = pageW - MARGIN * 2;
  const floor = MARGIN + FOOTER;
  const pages: string[][] = [];
  let next = 0;
  let first = true;

  while (first || next < doc.rows.length) {
    const ops: string[] = [];
    let y = pageH - MARGIN;
    if (first) {
      y -= TITLE;
      ops.push(`BT /F2 ${TITLE} Tf ${num(MARGIN)} ${num(y)} Td ${literal(drawable(doc.title))} Tj ET`);
      y -= 6;
      for (const meta of doc.meta ?? []) {
        y -= META + 3;
        const line = fit(drawable(`${meta.label}: ${meta.value}`), available, false);
        ops.push(`BT /F1 ${META} Tf ${num(MARGIN)} ${num(y)} Td ${literal(line)} Tj ET`);
      }
      y -= 10;
      first = false;
    }

    ops.push(`0.94 g ${num(MARGIN)} ${num(y - ROW)} ${num(available)} ${num(ROW)} re f 0 g`);
    drawRow(ops, doc.header, y, true, layout);
    y -= ROW;
    ops.push(rule(y, MARGIN, available, 0.6));

    let placed = 0;
    while (next < doc.rows.length && (placed === 0 || y - ROW >= floor)) {
      drawRow(ops, doc.rows[next], y, false, layout);
      y -= ROW;
      ops.push(rule(y, MARGIN, available, 0.85));
      next += 1;
      placed += 1;
    }
    pages.push(ops);
  }

  // The footer needs the page count, which only exists once every page does.
  pages.forEach((ops, i) => {
    const label = `${i + 1} / ${pages.length}`;
    const title = fit(drawable(doc.title), available * 0.7, false);
    ops.push(`BT /F1 7 Tf ${num(MARGIN)} ${num(MARGIN)} Td ${literal(title)} Tj ET`);
    ops.push(`BT /F1 7 Tf ${num(pageW - MARGIN - textWidth(label, 7, false))} ${num(MARGIN)} Td ${literal(label)} Tj ET`);
  });
  return pages;
}

export function writePdf(doc: TableDocument, at: Date): Uint8Array {
  const rtl = doc.rtl === true;
  const columns = Math.max(doc.header.length, ...doc.rows.map((row) => row.length));
  const landscape = columns >= LANDSCAPE_FROM;
  const pageW = landscape ? A4.long : A4.short;
  const pageH = landscape ? A4.short : A4.long;
  const layout: Layout = { widths: columnWidths(doc, columns, pageW - MARGIN * 2), rtl, left: MARGIN };
  const pages = paginate(doc, pageW, pageH, layout);

  // Object 1 is the catalog and 2 the page tree; both are fixed so the trailer
  // and every page can name them before the page list is known.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '', // page tree, filled in once the pages exist
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${literal(drawable(doc.title))} /Producer (Finance OS) /CreationDate (${stamp(at)}) >>`,
  ];
  const pageIds: number[] = [];
  for (const ops of pages) {
    const content = ops.join('\n');
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] `
        + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // The second line is the conventional binary marker: four bytes above 127 so
  // a transfer agent never mistakes the file for text.
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(out);
}
