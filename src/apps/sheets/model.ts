/**
 * Sheets — the workbook model.
 *
 * Every operation here returns a new workbook and mutates nothing, which is not
 * purity for its own sake: it is what makes undo a stack of references instead of a
 * log of inverse operations, and what lets the calculator memoise against a
 * workbook identity and know its cache is still valid.
 *
 * Cells are a sparse record keyed `A1`, so an empty sheet costs one object and a
 * sheet with a number in `IV4000` costs two. There is no cell array and no row
 * array; a spreadsheet is a map with a coordinate system, and pretending otherwise
 * is how a grid ends up allocating a million objects to show forty.
 */
import { type Expr, type Resolver, evaluate, parse } from './engine';
import { type CellAlign, type NumberFormat, parseLiteral } from './formats';
import { type CellRange, type CellRef, MAX_COLS, MAX_ROWS, cellsOf, colToIndex, keyOf } from './refs';
import { BLANK, type CellValue, err } from './values';

export interface Cell {
  /** Exactly what was typed, `=` and all. The value is derived, never stored. */
  readonly input: string;
  readonly format: NumberFormat;
  readonly bold: boolean;
  readonly italic: boolean;
  /** `auto` defers to the value's natural edge; anything else overrides it. */
  readonly align: CellAlign;
}

export const EMPTY_CELL: Cell = { input: '', format: 'general', bold: false, italic: false, align: 'auto' };

export interface Sheet {
  readonly name: string;
  readonly cells: Readonly<Record<string, Cell>>;
  /** Column index (as a string, because this is written to JSON) to pixel width. */
  readonly widths: Readonly<Record<string, number>>;
}

export interface Workbook {
  readonly sheets: readonly Sheet[];
  readonly active: number;
}

export const DEFAULT_WIDTH = 96;
export const MIN_WIDTH = 40;
export const ROW_HEIGHT = 26;

export const sheetAt = (book: Workbook, index: number): Sheet =>
  book.sheets[index] ?? book.sheets[0] ?? { name: 'Sheet1', cells: {}, widths: {} };

export const activeSheet = (book: Workbook): Sheet => sheetAt(book, book.active);

export const cellOf = (sheet: Sheet, key: string): Cell => sheet.cells[key] ?? EMPTY_CELL;

export const widthOf = (sheet: Sheet, col: number): number => sheet.widths[String(col)] ?? DEFAULT_WIDTH;

export const isFormula = (input: string): boolean => input.startsWith('=') && input.length > 1;

export function newSheet(name: string): Sheet {
  return { name, cells: {}, widths: {} };
}

export function newWorkbook(): Workbook {
  return { sheets: [newSheet('Sheet1')], active: 0 };
}

/** Replaces one sheet, leaving the rest of the workbook identical. */
function withSheet(book: Workbook, index: number, sheet: Sheet): Workbook {
  return { ...book, sheets: book.sheets.map((existing, at) => (at === index ? sheet : existing)) };
}

/**
 * The bottom-right corner that has anything in it, plus room to keep typing.
 *
 * The grid renders this rectangle rather than the sheet's hard limit, because
 * 256 × 4096 is a million cells and a person can see about four hundred.
 */
export function extentOf(sheet: Sheet): { readonly cols: number; readonly rows: number } {
  let cols = 0;
  let rows = 0;
  for (const key of Object.keys(sheet.cells)) {
    if (cellOf(sheet, key).input === '') continue;
    const match = /^([A-Z]{1,3})([0-9]{1,4})$/.exec(key);
    if (match === null) continue;
    cols = Math.max(cols, colToIndex(match[1] ?? '') + 1);
    rows = Math.max(rows, Number.parseInt(match[2] ?? '0', 10));
  }
  for (const key of Object.keys(sheet.widths)) cols = Math.max(cols, Number(key) + 1);
  return {
    cols: Math.min(MAX_COLS, Math.max(cols + 4, 12)),
    rows: Math.min(MAX_ROWS, Math.max(rows + 12, 40)),
  };
}

/** One edit: what to put in a cell, or `null` to take the cell away entirely. */
export interface CellEdit {
  readonly key: string;
  readonly cell: Cell | null;
}

/** A cell with nothing in it and nothing done to it is not stored at all. */
const isVestigial = (cell: Cell): boolean =>
  cell.input === '' && cell.format === 'general' && !cell.bold && !cell.italic && cell.align === 'auto';

/**
 * Applies a batch of edits.
 *
 * A batch rather than one cell at a time because paste, fill and clear are all one
 * undo step: pasting a block that lands on nine cells and then needing nine undos
 * to take it back is the behaviour everyone hates.
 */
export function applyEdits(book: Workbook, index: number, edits: readonly CellEdit[]): Workbook {
  if (edits.length === 0) return book;
  const sheet = sheetAt(book, index);
  const cells: Record<string, Cell> = { ...sheet.cells };
  for (const edit of edits) {
    if (edit.cell === null || isVestigial(edit.cell)) {
      delete cells[edit.key];
      continue;
    }
    cells[edit.key] = edit.cell;
  }
  return withSheet(book, index, { ...sheet, cells });
}

/** Types one thing into one cell, letting the input choose the format if it wants. */
export function setInput(book: Workbook, index: number, ref: CellRef, input: string): Workbook {
  const sheet = sheetAt(book, index);
  const key = keyOf(ref);
  const previous = cellOf(sheet, key);
  const implied = isFormula(input) ? null : parseLiteral(input).format;
  // An implied format only wins over `general`: a cell someone deliberately made a
  // percentage must not become a date because they typed one number into it.
  const format = implied !== null && previous.format === 'general' ? implied : previous.format;
  return applyEdits(book, index, [{ key, cell: { ...previous, input, format } }]);
}

/** Restyles every cell of a selection, creating the ones that do not exist yet. */
export function restyle(book: Workbook, index: number, range: CellRange, patch: Partial<Cell>): Workbook {
  const sheet = sheetAt(book, index);
  const edits: CellEdit[] = [];
  for (const ref of cellsOf(range)) {
    const key = keyOf(ref);
    edits.push({ key, cell: { ...cellOf(sheet, key), ...patch } });
  }
  return applyEdits(book, index, edits);
}

export function clearRange(book: Workbook, index: number, range: CellRange): Workbook {
  const edits: CellEdit[] = [];
  for (const ref of cellsOf(range)) edits.push({ key: keyOf(ref), cell: null });
  return applyEdits(book, index, edits);
}

export function setWidth(book: Workbook, index: number, col: number, width: number): Workbook {
  const sheet = sheetAt(book, index);
  return withSheet(book, index, {
    ...sheet,
    widths: { ...sheet.widths, [String(col)]: Math.max(MIN_WIDTH, Math.round(width)) },
  });
}

/** A sheet name has to be unique, because a formula addresses sheets by name. */
export function uniqueName(book: Workbook, wanted: string, skip = -1): string {
  const taken = new Set(
    book.sheets.filter((_sheet, index) => index !== skip).map((sheet) => sheet.name.toLowerCase()),
  );
  const base = wanted.trim() === '' ? 'Sheet' : wanted.trim();
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base} (${suffix})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export function addSheet(book: Workbook, name?: string): Workbook {
  const sheet = newSheet(uniqueName(book, name ?? `Sheet${book.sheets.length + 1}`));
  return { sheets: [...book.sheets, sheet], active: book.sheets.length };
}

export function renameSheet(book: Workbook, index: number, name: string): Workbook {
  return withSheet(book, index, { ...sheetAt(book, index), name: uniqueName(book, name, index) });
}

/** The last sheet cannot be removed; a workbook with no sheets has no formula bar. */
export function removeSheet(book: Workbook, index: number): Workbook {
  if (book.sheets.length <= 1) return book;
  const sheets = book.sheets.filter((_sheet, at) => at !== index);
  return { sheets, active: Math.min(book.active, sheets.length - 1) };
}

export function moveSheet(book: Workbook, index: number, to: number): Workbook {
  if (to < 0 || to >= book.sheets.length || to === index) return book;
  const sheets = [...book.sheets];
  const [moved] = sheets.splice(index, 1);
  if (moved === undefined) return book;
  sheets.splice(to, 0, moved);
  return { sheets, active: to };
}

export const activate = (book: Workbook, index: number): Workbook => ({
  ...book,
  active: Math.min(Math.max(index, 0), book.sheets.length - 1),
});

/**
 * A calculated view of one workbook.
 *
 * Values are computed on demand and cached, so scrolling a sheet with two thousand
 * formulas costs the four hundred the screen actually shows. The cache lives as long
 * as the workbook object does — which, because every edit produces a new workbook,
 * means it is never stale and never needs invalidating.
 *
 * Cycles are caught by marking a cell while it is being computed: a formula that
 * reaches a cell already on the stack gets `#CYCLE!` back, which then propagates
 * through the arithmetic exactly like any other error value. No recursion limit is
 * needed and no `try` is involved.
 */
export interface Calculated {
  readonly book: Workbook;
  valueAt(index: number, key: string): CellValue;
  /** The parsed tree of a formula cell, for the grid's reference outlines. */
  formulaAt(index: number, key: string): Expr | null;
}

export function calculator(book: Workbook): Calculated {
  const values = new Map<string, CellValue>();
  const trees = new Map<string, Expr>();
  const visiting = new Set<string>();
  const byName = new Map<string, number>();
  book.sheets.forEach((sheet, index) => byName.set(sheet.name.toLowerCase(), index));

  /** Parsing is cached by source text, so a column of `=A1*2` parses once. */
  const treeOf = (input: string): Expr => {
    const cached = trees.get(input);
    if (cached !== undefined) return cached;
    const tree = parse(input.slice(1));
    trees.set(input, tree);
    return tree;
  };

  const resolverFor =
    (index: number): Resolver =>
    (sheetName, ref) => {
      const target = sheetName === null ? index : byName.get(sheetName.toLowerCase());
      return target === undefined ? err('#REF!') : valueAt(target, keyOf(ref));
    };

  function valueAt(index: number, key: string): CellValue {
    const id = `${index}!${key}`;
    const cached = values.get(id);
    if (cached !== undefined) return cached;

    const cell = sheetAt(book, index).cells[key];
    if (cell === undefined || cell.input === '') return BLANK;
    if (!isFormula(cell.input)) {
      const literal = parseLiteral(cell.input).value;
      values.set(id, literal);
      return literal;
    }
    if (visiting.has(id)) return err('#CYCLE!');

    visiting.add(id);
    const result = evaluate(treeOf(cell.input), resolverFor(index));
    visiting.delete(id);
    values.set(id, result);
    return result;
  }

  return {
    book,
    valueAt,
    formulaAt: (index, key) => {
      const cell = sheetAt(book, index).cells[key];
      return cell !== undefined && isFormula(cell.input) ? treeOf(cell.input) : null;
    },
  };
}
