/**
 * Sheets — the edits that move formulas.
 *
 * Copying `=SUM(B2:B9)` one column right has to make it `=SUM(C2:C9)`, or fill and
 * paste are useless for anything but constants. That translation is the whole of this
 * file, and it is done by rewriting the *source text* rather than re-printing a parsed
 * tree: the tokenizer already reports where every name starts, so each reference can
 * be replaced in place and the rest of the formula — the user's spacing, their choice
 * of `;` or `,`, the capitalisation of their function names — survives untouched.
 *
 * A `$` is not shifted, which is what `$` is for. A reference that would leave the
 * sheet becomes the text `#REF!`, exactly as it does in Excel, so the cell holds a
 * formula that visibly failed rather than one that quietly points somewhere else.
 */
import { type Token, tokenize } from './engine';
import { type Cell, type CellEdit, type Sheet, cellOf, isFormula } from './model';
import { type CellRange, type CellRef, MAX_COLS, MAX_ROWS, indexToCol, keyOf, normalize } from './refs';

const REF_TEXT = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,4})$/;

/** `$B$7` shifted by (1, 2) is `$B$7`; `B7` is `C9`; off the sheet is `#REF!`. */
function shiftRef(text: string, dcol: number, drow: number): string | null {
  const match = REF_TEXT.exec(text);
  if (match === null) return null;
  const [, colFixed = '', letters = '', rowFixed = '', digits = ''] = match;
  const col = letters
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
  const row = Number.parseInt(digits, 10) - 1;
  const nextCol = colFixed === '$' ? col : col + dcol;
  const nextRow = rowFixed === '$' ? row : row + drow;
  if (nextCol < 0 || nextCol >= MAX_COLS || nextRow < 0 || nextRow >= MAX_ROWS) return '#REF!';
  return `${colFixed}${indexToCol(nextCol)}${rowFixed}${nextRow + 1}`;
}

/** `Sheet1!A1` keeps its sheet and shifts its cell. */
function shiftName(text: string, dcol: number, drow: number): string | null {
  const bang = text.lastIndexOf('!');
  const local = bang < 0 ? text : text.slice(bang + 1);
  const shifted = shiftRef(local, dcol, drow);
  if (shifted === null) return null;
  return bang < 0 ? shifted : `${text.slice(0, bang + 1)}${shifted}`;
}

/**
 * True when a token can be rewritten in place.
 *
 * Two exclusions. A name followed by `(` is a function — `LOG10` reads exactly like a
 * cell reference and must not become `LOG11`. And a token whose text is not literally
 * what the source held at that offset is a quoted sheet reference, which the tokenizer
 * has already unquoted; rewriting it by length would cut the formula in the wrong place.
 */
const rewritable = (source: string, token: Token, next: Token | null): boolean =>
  token.kind === 'name' &&
  next?.kind !== 'open' &&
  source.slice(token.at, token.at + token.text.length) === token.text;

export function shiftInput(input: string, dcol: number, drow: number): string {
  if (!isFormula(input) || (dcol === 0 && drow === 0)) return input;
  const source = input.slice(1);
  const tokens = tokenize(source);
  let out = '';
  let cursor = 0;
  tokens.forEach((token, index) => {
    if (!rewritable(source, token, tokens[index + 1] ?? null)) return;
    const shifted = shiftName(token.text, dcol, drow);
    if (shifted === null) return;
    out += source.slice(cursor, token.at) + shifted;
    cursor = token.at + token.text.length;
  });
  return `=${out}${source.slice(cursor)}`;
}

/** The selection as tab-separated lines — what every other program reads as a grid. */
export const toTsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.join('\t')).join('\r\n');

/** Tab-separated text back into a grid, without CSV's quoting rules. */
export const fromTsv = (text: string): readonly (readonly string[])[] =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => line.split('\t'));

/**
 * What a copy holds.
 *
 * `cells` carries the formats and the bold as well as the inputs, because copying a
 * total row and pasting it somewhere that shows the numbers differently is not a copy.
 * `text` records what was put on the system clipboard, so a later paste can tell
 * whether the clipboard is still this copy — see `workbook.ts`.
 */
export interface Clip {
  readonly origin: CellRef;
  readonly cells: readonly (readonly (Cell | null)[])[];
  readonly text: string;
}

export function readClip(sheet: Sheet, range: CellRange, show: (key: string) => string): Clip {
  const box = normalize(range);
  const cells: (Cell | null)[][] = [];
  const shown: string[][] = [];
  for (let row = box.start.row; row <= box.end.row; row += 1) {
    const line: (Cell | null)[] = [];
    const text: string[] = [];
    for (let col = box.start.col; col <= box.end.col; col += 1) {
      const key = keyOf({ col, row });
      line.push(sheet.cells[key] ?? null);
      text.push(show(key));
    }
    cells.push(line);
    shown.push(text);
  }
  return { origin: box.start, cells, text: toTsv(shown) };
}

export const clipSize = (clip: Clip): { readonly cols: number; readonly rows: number } => ({
  cols: Math.max(...clip.cells.map((row) => row.length), 1),
  rows: Math.max(clip.cells.length, 1),
});

const inBounds = (col: number, row: number): boolean => col >= 0 && col < MAX_COLS && row >= 0 && row < MAX_ROWS;

/** Cells from a copy, with every relative reference moved by the paste distance. */
export function pasteEdits(target: CellRef, clip: Clip): readonly CellEdit[] {
  const dcol = target.col - clip.origin.col;
  const drow = target.row - clip.origin.row;
  const edits: CellEdit[] = [];
  clip.cells.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (!inBounds(target.col + col, target.row + row)) return;
      const key = keyOf({ col: target.col + col, row: target.row + row });
      edits.push({ key, cell: cell === null ? null : { ...cell, input: shiftInput(cell.input, dcol, drow) } });
    });
  });
  return edits;
}

/** A grid of plain text — from another program, or from a `.csv` on the clipboard. */
export function pasteText(sheet: Sheet, target: CellRef, grid: readonly (readonly string[])[]): readonly CellEdit[] {
  const edits: CellEdit[] = [];
  grid.forEach((line, row) => {
    line.forEach((value, col) => {
      if (!inBounds(target.col + col, target.row + row)) return;
      const key = keyOf({ col: target.col + col, row: target.row + row });
      // The destination's format is kept: pasting a column of numbers into a column
      // formatted as money should show money.
      edits.push({ key, cell: value === '' ? null : { ...cellOf(sheet, key), input: value } });
    });
  });
  return edits;
}

/** Ctrl+D and Ctrl+R: the first row (or column) of the selection, repeated across it. */
export function fillEdits(sheet: Sheet, range: CellRange, direction: 'down' | 'right'): readonly CellEdit[] {
  const box = normalize(range);
  const edits: CellEdit[] = [];
  for (let row = box.start.row; row <= box.end.row; row += 1) {
    for (let col = box.start.col; col <= box.end.col; col += 1) {
      const from = direction === 'down' ? { col, row: box.start.row } : { col: box.start.col, row };
      if (from.col === col && from.row === row) continue;
      const source = sheet.cells[keyOf(from)];
      const key = keyOf({ col, row });
      if (source === undefined) {
        edits.push({ key, cell: null });
        continue;
      }
      edits.push({ key, cell: { ...source, input: shiftInput(source.input, col - from.col, row - from.row) } });
    }
  }
  return edits;
}

/**
 * What Σ proposes.
 *
 * The run of numbers directly above the cell, or — when there is nothing above — the
 * run directly to its left. Stopping at the first non-number is what keeps a header
 * out of the sum, and is the behaviour a person expects from the button without having
 * to check what it picked.
 */
export function autoSumRange(ref: CellRef, numeric: (key: string) => boolean): CellRange | null {
  let top = ref.row;
  while (top > 0 && numeric(keyOf({ col: ref.col, row: top - 1 }))) top -= 1;
  if (top < ref.row) return { start: { col: ref.col, row: top }, end: { col: ref.col, row: ref.row - 1 } };
  let left = ref.col;
  while (left > 0 && numeric(keyOf({ col: left - 1, row: ref.row }))) left -= 1;
  if (left < ref.col) return { start: { col: left, row: ref.row }, end: { col: ref.col - 1, row: ref.row } };
  return null;
}

