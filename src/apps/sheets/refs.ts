/**
 * Sheets — A1 addressing.
 *
 * Everything in a spreadsheet is a coordinate wearing a costume. `B7` is a pair,
 * `B7:D9` is a rectangle, and the reason both need a module of their own is that
 * three separate things read them: the parser (a formula names cells), the grid (a
 * selection is a rectangle) and the file format (a `.csv` row is a row index).
 *
 * Columns are base-26 with no zero digit — `Z` then `AA`, not `Z` then `BA` — so
 * the two conversions are written out rather than borrowed from `parseInt`.
 */

/** Hard ceiling on a sheet, so a runaway formula cannot allocate the world. */
export const MAX_COLS = 256;
export const MAX_ROWS = 4096;

export interface CellRef {
  /** Zero-based. `A` is 0. */
  readonly col: number;
  /** Zero-based. Row `1` is 0. */
  readonly row: number;
}

export interface CellRange {
  readonly start: CellRef;
  readonly end: CellRef;
}

/** `0` → `A`, `25` → `Z`, `26` → `AA`. */
export function indexToCol(index: number): string {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/** `'A'` → `0`, `'AA'` → `26`; `-1` for anything that is not a column name. */
export function colToIndex(name: string): number {
  if (name === '') return -1;
  let n = 0;
  for (const character of name.toUpperCase()) {
    const digit = character.charCodeAt(0) - 64;
    if (digit < 1 || digit > 26) return -1;
    n = n * 26 + digit;
  }
  return n - 1;
}

/** The canonical key a cell is stored under: `A1`, never `a1` or `$A$1`. */
export const keyOf = (ref: CellRef): string => `${indexToCol(ref.col)}${ref.row + 1}`;

const A1 = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,4})$/;

/** Parses `A1`, `$B$7`, `c12` — the `$` is accepted and dropped, not honoured. */
export function parseRef(token: string): CellRef | null {
  const match = A1.exec(token.trim());
  if (match === null) return null;
  const col = colToIndex(match[1] ?? '');
  const row = Number.parseInt(match[2] ?? '', 10) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null;
  return { col, row };
}

/** Normalises a rectangle so `start` is always its top-left corner. */
export function normalize(range: CellRange): CellRange {
  return {
    start: { col: Math.min(range.start.col, range.end.col), row: Math.min(range.start.row, range.end.row) },
    end: { col: Math.max(range.start.col, range.end.col), row: Math.max(range.start.row, range.end.row) },
  };
}

export const rangeWidth = (range: CellRange): number => Math.abs(range.end.col - range.start.col) + 1;
export const rangeHeight = (range: CellRange): number => Math.abs(range.end.row - range.start.row) + 1;
export const rangeSize = (range: CellRange): number => rangeWidth(range) * rangeHeight(range);

export const contains = (range: CellRange, ref: CellRef): boolean => {
  const box = normalize(range);
  return ref.col >= box.start.col && ref.col <= box.end.col && ref.row >= box.start.row && ref.row <= box.end.row;
};

/** Row-major, which is the order a person reads a selection and CSV writes one. */
export function* cellsOf(range: CellRange): Generator<CellRef> {
  const box = normalize(range);
  for (let row = box.start.row; row <= box.end.row; row += 1) {
    for (let col = box.start.col; col <= box.end.col; col += 1) yield { col, row };
  }
}

/** `A1` for one cell, `A1:C3` for a rectangle — how the name box shows it. */
export function formatRange(range: CellRange): string {
  const box = normalize(range);
  const from = keyOf(box.start);
  return rangeSize(box) === 1 ? from : `${from}:${keyOf(box.end)}`;
}

/** Keeps a ref inside the sheet after an arrow key. */
export const clampRef = (ref: CellRef): CellRef => ({
  col: Math.min(Math.max(ref.col, 0), MAX_COLS - 1),
  row: Math.min(Math.max(ref.row, 0), MAX_ROWS - 1),
});

export const sameRef = (a: CellRef, b: CellRef): boolean => a.col === b.col && a.row === b.row;
