/**
 * Sheets — cell values.
 *
 * A spreadsheet has five kinds of value and one of them is an error, which is the
 * detail that shapes everything else: `#DIV/0!` is *data*, not an exception. It
 * flows through arithmetic, it can be stored, it can be tested by `IFERROR`, and
 * it renders in a cell. Nothing in the engine throws, so nothing in the engine
 * needs a `try` — and `IF` may evaluate both of its branches without that being a
 * bug, because an error in the branch not taken is simply a value nobody reads.
 *
 * Coercion is Excel's, not JavaScript's: `"3"+4` is 7 because a formula asked for
 * arithmetic, but `"three"+4` is `#VALUE!` rather than `NaN`. A blank cell is 0 in
 * arithmetic and `""` in text, and it is *not* zero for `AVERAGE` — which is why
 * `blank` is its own kind instead of a number that happens to be zero.
 */

export type CellError = '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#CYCLE!' | '#N/A' | '#NUM!';

export const CELL_ERRORS: readonly CellError[] = [
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#CYCLE!',
  '#N/A',
  '#NUM!',
];

export type CellValue =
  | { readonly kind: 'blank' }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'error'; readonly value: CellError };

export const BLANK: CellValue = { kind: 'blank' };

/** Non-finite arithmetic is `#NUM!`, so `2^10000` never leaks an `Infinity`. */
export const num = (value: number): CellValue =>
  Number.isFinite(value) ? { kind: 'number', value } : { kind: 'error', value: '#NUM!' };

export const str = (value: string): CellValue => ({ kind: 'text', value });
export const bool = (value: boolean): CellValue => ({ kind: 'boolean', value });
export const err = (value: CellError): CellValue => ({ kind: 'error', value });

export const isError = (value: CellValue): boolean => value.kind === 'error';

/** The first error among the arguments, which is the one Excel would surface. */
export function firstError(values: readonly CellValue[]): CellValue | null {
  for (const value of values) if (value.kind === 'error') return value;
  return null;
}

/**
 * Numeric coercion.
 *
 * Returns an error *value* rather than `null` so callers can propagate it without
 * inventing a message. Text is parsed only when it is entirely a number: Excel
 * accepts `" 12 "` and refuses `"12kg"`, and so does this.
 */
export function toNumber(value: CellValue): number | CellValue {
  if (value.kind === 'number') return value.value;
  if (value.kind === 'blank') return 0;
  if (value.kind === 'boolean') return value.value ? 1 : 0;
  if (value.kind === 'error') return value;
  const trimmed = value.value.trim();
  if (trimmed === '') return 0;
  const parsed = Number(trimmed.replace(/\s/g, '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : err('#VALUE!');
}

export function toText(value: CellValue): string {
  if (value.kind === 'text') return value.value;
  if (value.kind === 'blank') return '';
  if (value.kind === 'boolean') return value.value ? 'TRUE' : 'FALSE';
  if (value.kind === 'error') return value.value;
  return String(value.value);
}

export function toBoolean(value: CellValue): boolean | CellValue {
  if (value.kind === 'boolean') return value.value;
  if (value.kind === 'error') return value;
  if (value.kind === 'blank') return false;
  if (value.kind === 'number') return value.value !== 0;
  const upper = value.value.trim().toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE' || upper === '') return false;
  return err('#VALUE!');
}

/**
 * One argument to a function.
 *
 * `range` is kept because it changes meaning, not just shape: `SUM(A1:A9)` skips
 * text and blanks in the range, while `SUM("x")` is an error the user asked for.
 * `width` and `height` are kept because `VLOOKUP` cannot work without them: the
 * values arrive row-major, so cell `(row, col)` is `values[row * width + col]`,
 * and a rectangle that forgot its shape is just a list.
 */
export interface Arg {
  readonly values: readonly CellValue[];
  readonly range: boolean;
  readonly width: number;
  readonly height: number;
}

export const scalarArg = (value: CellValue): Arg => ({ values: [value], range: false, width: 1, height: 1 });

/** The cell at a position inside a rectangular argument. */
export function cellAt(arg: Arg, row: number, col: number): CellValue {
  if (row < 0 || col < 0 || row >= arg.height || col >= arg.width) return err('#REF!');
  return arg.values[row * arg.width + col] ?? BLANK;
}

/** The single value of an argument; a range collapses to its first cell. */
export const first = (arg: Arg | undefined): CellValue => arg?.values[0] ?? BLANK;

/**
 * The numbers an argument contributes to a statistic.
 *
 * A range donates only its numeric cells — that is what makes `AVERAGE(A1:A9)`
 * ignore the header text instead of failing on it. A scalar is coerced, because
 * `AVERAGE(1, "2")` is a request, not an accident.
 */
export function numbersOf(args: readonly Arg[]): readonly number[] | CellValue {
  const out: number[] = [];
  for (const arg of args) {
    for (const value of arg.values) {
      if (value.kind === 'error') return value;
      if (arg.range) {
        if (value.kind === 'number') out.push(value.value);
        else if (value.kind === 'boolean') out.push(value.value ? 1 : 0);
        continue;
      }
      if (value.kind === 'blank') continue;
      const numeric = toNumber(value);
      if (typeof numeric !== 'number') return numeric;
      out.push(numeric);
    }
  }
  return out;
}

/** Every value an argument list denotes, ranges flattened, order preserved. */
export function flatten(args: readonly Arg[]): readonly CellValue[] {
  const out: CellValue[] = [];
  for (const arg of args) out.push(...arg.values);
  return out;
}

/**
 * Excel's comparison order: numbers below text, text below booleans.
 *
 * Comparing a number to text never coerces — `1 < "0"` is TRUE — which surprises
 * people once and then explains every sort they have ever seen in a spreadsheet.
 */
const rank = (value: CellValue): number =>
  value.kind === 'number' || value.kind === 'blank' ? 0 : value.kind === 'text' ? 1 : 2;

export function compare(left: CellValue, right: CellValue): number | CellValue {
  const problem = firstError([left, right]);
  if (problem !== null) return problem;

  // A blank compared with text is the empty string, not zero.
  const a = left.kind === 'blank' && right.kind === 'text' ? str('') : left;
  const b = right.kind === 'blank' && left.kind === 'text' ? str('') : right;

  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 1) return toText(a).toLowerCase().localeCompare(toText(b).toLowerCase());
  const x = toNumber(a);
  const y = toNumber(b);
  if (typeof x !== 'number') return x;
  if (typeof y !== 'number') return y;
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * One built-in function.
 *
 * `signature` is shown by the formula bar while you type, so it is written the way
 * Excel writes one — square brackets for the optional tail. Arity is declared
 * rather than checked inside each body, which is the difference between fifty
 * functions and fifty functions plus fifty copies of the same guard.
 */
export type SheetFunction = (args: readonly Arg[]) => CellValue;

export interface FunctionSpec {
  readonly signature: string;
  readonly min: number;
  /** `Infinity` for a variadic tail. */
  readonly max: number;
  readonly call: SheetFunction;
}

export type FunctionTable = Readonly<Record<string, FunctionSpec>>;

/** Declares one function; the name is the key in the table that holds it. */
export const fn = (signature: string, min: number, max: number, call: SheetFunction): FunctionSpec => ({
  signature,
  min,
  max,
  call,
});

/** Argument readers. Each returns the coerced value or the error to propagate. */
export const argNumber = (args: readonly Arg[], index: number): number | CellValue => toNumber(first(args[index]));

/**
 * The argument at `index`, or a blank one when it was not written.
 *
 * An omitted argument is a 1×1 blank rather than `undefined` so that every body
 * below can read positionally without a guard: `VLOOKUP` with no table looks
 * through one empty cell and answers `#N/A`, which is the truth.
 */
export const argAt = (args: readonly Arg[], index: number): Arg => args[index] ?? scalarArg(BLANK);

export function argInt(args: readonly Arg[], index: number): number | CellValue {
  const value = argNumber(args, index);
  return typeof value === 'number' ? Math.trunc(value) : value;
}

export const argText = (args: readonly Arg[], index: number): string | CellValue => {
  const value = first(args[index]);
  return value.kind === 'error' ? value : toText(value);
};

export const argBoolean = (args: readonly Arg[], index: number): boolean | CellValue => toBoolean(first(args[index]));

/** `true` when the reader above returned an error rather than a value. */
export const isValue = <T>(value: T | CellValue): value is CellValue =>
  typeof value === 'object' && value !== null && 'kind' in (value as object);
