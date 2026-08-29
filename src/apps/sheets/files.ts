/**
 * Sheets — reading and writing files.
 *
 * Two formats, and the difference between them is the whole reason both exist.
 * `.csv` is what every other program on earth can read, and it can hold exactly one
 * grid of text: no formulas, no formats, no second sheet. `.fxsheet` is JSON that
 * keeps everything, including the `=SUM(B2:B9)` that produced the number.
 *
 * So saving a workbook as CSV *loses* things, and the app says so before it does it
 * rather than discovering it on reopen. Exported CSV carries values rather than
 * formulas, because that is what the receiving program expects — a bank or an
 * auditor reading the file wants the 1 240,50, not the expression behind it.
 */
import { type VfsContentType } from '@/platform/sdk';
import { type CellAlign, type NumberFormat, NUMBER_FORMATS } from './formats';
import { type Calculated, type Cell, EMPTY_CELL, type Sheet, type Workbook, cellOf, isFormula, newSheet } from './model';
import { MAX_COLS, MAX_ROWS, indexToCol } from './refs';
import { toText } from './values';

export const SHEET_CONTENT_TYPE: VfsContentType = 'application/vnd.financeos.sheet';
export const CSV_CONTENT_TYPE: VfsContentType = 'text/csv';

/** French and Arabic locales export CSV with `;`, so the reader must not assume `,`. */
export function detectSeparator(text: string): ',' | ';' | '\t' {
  const line = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const count = (character: string): number => line.split(character).length - 1;
  const semicolons = count(';');
  const tabs = count('\t');
  const commas = count(',');
  if (tabs > semicolons && tabs > commas) return '\t';
  return semicolons > commas ? ';' : ',';
}

/**
 * RFC 4180, one character at a time.
 *
 * Written out rather than split on commas because a quoted field can contain the
 * separator, a newline and an escaped quote, and every CSV file that matters has at
 * least one of those in it.
 */
export function parseCsv(text: string, separator?: string): readonly (readonly string[])[] {
  const delimiter = separator ?? detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character !== '"') {
        field += character;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      quoted = false;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      endField();
      continue;
    }
    if (character === '\r') continue;
    if (character === '\n') {
      endRow();
      continue;
    }
    field += character;
  }
  if (field !== '' || row.length > 0) endRow();

  // A trailing newline is not an empty last row.
  return rows.filter((line, index) => index < rows.length - 1 || line.some((value) => value !== ''));
}

const QUOTABLE = /[",;\t\n\r]/;

const quote = (value: string): string => (QUOTABLE.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The grid as CSV, values not formulas, clipped to what the sheet actually uses. */
export function toCsv(book: Workbook, index: number, calc: Calculated, separator = ','): string {
  const sheet = book.sheets[index] ?? newSheet('Sheet1');
  const used = usedExtent(sheet);
  const lines: string[] = [];
  for (let row = 0; row < used.rows; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < used.cols; col += 1) {
      cells.push(quote(toText(calc.valueAt(index, `${indexToCol(col)}${row + 1}`))));
    }
    lines.push(cells.join(separator));
  }
  return lines.join('\r\n');
}

/** The tight extent — what is written, with no room to type added. */
export function usedExtent(sheet: Sheet): { readonly cols: number; readonly rows: number } {
  let cols = 0;
  let rows = 0;
  for (const key of Object.keys(sheet.cells)) {
    if (cellOf(sheet, key).input === '') continue;
    const match = /^([A-Z]{1,3})([0-9]{1,4})$/.exec(key);
    if (match === null) continue;
    cols = Math.max(cols, (match[1] ?? '').split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0));
    rows = Math.max(rows, Number.parseInt(match[2] ?? '0', 10));
  }
  return { cols, rows };
}

/** A CSV file becomes one sheet of text and numbers, no formulas invented. */
export function csvToSheet(text: string, name: string): Sheet {
  const rows = parseCsv(text);
  const cells: Record<string, Cell> = {};
  rows.forEach((row, rowIndex) => {
    if (rowIndex >= MAX_ROWS) return;
    row.forEach((value, colIndex) => {
      if (colIndex >= MAX_COLS || value === '') return;
      // A leading `=` in a CSV field is data, not a formula: a file from elsewhere
      // must not be able to make this app calculate something.
      const input = value.startsWith('=') ? `'${value}` : value;
      cells[`${indexToCol(colIndex)}${rowIndex + 1}`] = { ...EMPTY_CELL, input };
    });
  });
  return { ...newSheet(name), cells };
}

export const SHEET_VERSION = 1;

/**
 * The `.fxsheet` envelope.
 *
 * Only fields that differ from the default are written, so a sheet of plain numbers
 * serialises as `{"A1":{"input":"12"}}` rather than five keys per cell. The file is
 * indented JSON rather than a packed blob because a workbook someone can read in a
 * text editor is a workbook they can still recover when this app is gone.
 */
interface StoredCell {
  readonly input: string;
  readonly format?: NumberFormat;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly align?: CellAlign;
}

const storeCell = (cell: Cell): StoredCell => ({
  input: cell.input,
  ...(cell.format === 'general' ? {} : { format: cell.format }),
  ...(cell.bold ? { bold: true } : {}),
  ...(cell.italic ? { italic: true } : {}),
  ...(cell.align === 'auto' ? {} : { align: cell.align }),
});

export function serialize(book: Workbook): string {
  return JSON.stringify(
    {
      kind: 'financeos.sheet',
      version: SHEET_VERSION,
      active: book.active,
      sheets: book.sheets.map((sheet) => ({
        name: sheet.name,
        cells: Object.fromEntries(Object.entries(sheet.cells).map(([key, cell]) => [key, storeCell(cell)])),
        widths: sheet.widths,
      })),
    },
    null,
    2,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ALIGNS: readonly CellAlign[] = ['auto', 'start', 'center', 'end'];

/**
 * Reading is total: anything that is not a workbook comes back `null`.
 *
 * A file on disk was written by an older version of this app, by a future one, or by
 * something else entirely, so every field is checked and every unknown field is
 * dropped. The alternative — trusting the JSON and crashing on `sheets.map` — turns a
 * corrupt file into a broken app.
 */
function readCell(value: unknown): Cell | null {
  if (!isRecord(value) || typeof value.input !== 'string') return null;
  const format = NUMBER_FORMATS.find((candidate) => candidate === value.format);
  const align = ALIGNS.find((candidate) => candidate === value.align);
  return {
    input: value.input,
    format: format ?? 'general',
    bold: value.bold === true,
    italic: value.italic === true,
    align: align ?? 'auto',
  };
}

function readWidths(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const widths: Record<string, number> = {};
  for (const [key, width] of Object.entries(value)) {
    if (typeof width === 'number' && Number.isFinite(width) && /^[0-9]{1,3}$/.test(key)) {
      widths[key] = Math.round(width);
    }
  }
  return widths;
}

function readSheet(value: unknown, fallback: string): Sheet | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' && value.name.trim() !== '' ? value.name : fallback;
  const cells: Record<string, Cell> = {};
  if (isRecord(value.cells)) {
    for (const [key, stored] of Object.entries(value.cells)) {
      const cell = readCell(stored);
      if (cell !== null && cell.input !== '' && /^[A-Z]{1,3}[0-9]{1,4}$/.test(key)) cells[key] = cell;
    }
  }
  return { name, cells, widths: readWidths(value.widths) };
}

/** The one `try` in the app: `JSON.parse` is the only thing here that throws. */
function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function deserialize(text: string): Workbook | null {
  const parsed = readJson(text);
  if (!isRecord(parsed) || parsed.kind !== 'financeos.sheet' || !Array.isArray(parsed.sheets)) return null;
  const sheets = parsed.sheets
    .map((sheet, index) => readSheet(sheet, `Sheet${index + 1}`))
    .filter((sheet): sheet is Sheet => sheet !== null);
  if (sheets.length === 0) return null;
  const active = typeof parsed.active === 'number' ? parsed.active : 0;
  return { sheets, active: Math.min(Math.max(Math.trunc(active), 0), sheets.length - 1) };
}

/** What a path's extension says it is; anything else is read as CSV. */
export const isSheetPath = (path: string): boolean => path.toLowerCase().endsWith('.fxsheet');

/**
 * Whether saving as CSV would drop something.
 *
 * Asked before the write, so the warning names a real loss rather than appearing every
 * time. A single sheet of typed numbers loses nothing by becoming a CSV, and a person
 * exporting one should not have to dismiss a dialog to learn that.
 */
export function losesData(book: Workbook): boolean {
  if (book.sheets.length > 1) return true;
  const sheet = book.sheets[0];
  if (sheet === undefined) return false;
  return Object.values(sheet.cells).some(
    (cell) => isFormula(cell.input) || cell.format !== 'general' || cell.bold || cell.italic,
  );
}



