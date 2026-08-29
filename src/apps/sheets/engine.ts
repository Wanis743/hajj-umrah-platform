/**
 * Sheets — the formula engine.
 *
 * Three passes, in the order a compiler runs them: `tokenize` turns `=A1*1.5` into
 * words, `parse` turns the words into a tree honouring precedence, and `evaluate`
 * walks the tree against a resolver that knows what a cell holds. Splitting them is
 * what lets the formula bar highlight a reference before anything is calculated,
 * and what lets `dependencies()` list a formula's inputs without evaluating it.
 *
 * The parser is recursive descent because the grammar is small enough to read:
 *
 *   comparison → concat (`=` | `<>` | `<` | `<=` | `>` | `>=`) concat
 *   concat     → additive (`&` additive)*
 *   additive   → multiplicative ((`+` | `-`) multiplicative)*
 *   multiplic. → unary ((`*` | `/`) unary)*
 *   unary      → (`+` | `-`)* power
 *   power      → primary (`^` unary)?
 *   primary    → number | text | ref | range | call | `(` comparison `)`
 *
 * Nothing throws. A malformed formula parses to an error node that evaluates to
 * `#NAME?` or `#VALUE!`, because a spreadsheet that refused to store what you typed
 * would lose the half-finished formula you were in the middle of writing.
 */
import { BASE_FUNCTIONS } from './functions';
import { FINANCE_FUNCTIONS } from './finance';
import { type CellRange, type CellRef, MAX_COLS, MAX_ROWS, colToIndex, keyOf, normalize, rangeSize } from './refs';
import {
  type Arg,
  BLANK,
  CELL_ERRORS,
  type CellError,
  type CellValue,
  type FunctionTable,
  bool,
  compare,
  err,
  first,
  firstError,
  isValue,
  num,
  scalarArg,
  str,
  toNumber,
  toText,
} from './values';

/** Every built-in, by upper-case name. */
export const FUNCTIONS: FunctionTable = { ...BASE_FUNCTIONS, ...FINANCE_FUNCTIONS };

export const FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTIONS).sort();

/** A range this large is a mistake, not a request; `SUM(A:A)` is not supported. */
const MAX_RANGE_CELLS = MAX_COLS * 64;

export type TokenKind = 'number' | 'text' | 'name' | 'error' | 'op' | 'open' | 'close' | 'sep' | 'colon' | 'bad';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  /** Offset into the source, which is what a formula-bar highlight needs. */
  readonly at: number;
}

/** Two-character operators are tried first, or `<=` would read as `<` then `=`. */
const OPERATORS: readonly string[] = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '%', '=', '<', '>'];

const NUMBER = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;

/** Arabic and accented letters are allowed in a name, because sheet names are text. */
const NAME = /^[\p{L}_$][\p{L}\p{N}_$.]*/u;

const QUOTED_SHEET = /^'((?:[^']|'')*)'!/;

/** One word lifted off the head of the source, and how much of it was eaten. */
interface Scan {
  readonly token: Token;
  readonly length: number;
}

/**
 * A double-quoted string. `""` inside it is one quote — the only escape a formula
 * has — and an unterminated literal ends at the end of the source rather than
 * failing, because a formula bar is edited from the left and is briefly invalid on
 * the way to being valid.
 */
function scanText(source: string, index: number): Scan {
  let cursor = index + 1;
  let text = '';
  while (cursor < source.length) {
    if (source[cursor] !== '"') {
      text += source[cursor];
      cursor += 1;
      continue;
    }
    if (source[cursor + 1] === '"') {
      text += '"';
      cursor += 2;
      continue;
    }
    cursor += 1;
    break;
  }
  return { token: { kind: 'text', text, at: index }, length: cursor - index };
}

/** `#DIV/0!` and friends. A lone `#` is a bad character, not an error value. */
function scanError(rest: string, index: number): Scan {
  const found = CELL_ERRORS.find((candidate) => rest.startsWith(candidate));
  if (found === undefined) return { token: { kind: 'bad', text: '#', at: index }, length: 1 };
  return { token: { kind: 'error', text: found, at: index }, length: found.length };
}

/** `'Q1 2026'!A1` — the apostrophes are dropped and `''` becomes one. */
function scanQuotedSheet(rest: string, index: number): Scan | null {
  const quoted = QUOTED_SHEET.exec(rest);
  if (quoted === null) return null;
  const tail = NAME.exec(rest.slice(quoted[0].length));
  const sheet = (quoted[1] ?? '').replace(/''/g, "'");
  const local = tail?.[0] ?? '';
  return {
    token: { kind: 'name', text: `${sheet}!${local}`, at: index },
    length: quoted[0].length + local.length,
  };
}

/**
 * A bare name, and `Sheet1!A1` with it: the bang binds tighter than any operator,
 * so it is consumed here rather than parsed as one.
 */
function scanName(rest: string, index: number): Scan | null {
  const name = NAME.exec(rest);
  if (name === null) return null;
  const bang = rest[name[0].length] === '!' ? NAME.exec(rest.slice(name[0].length + 1)) : null;
  const text = bang === null ? name[0] : `${name[0]}!${bang[0]}`;
  return { token: { kind: 'name', text, at: index }, length: text.length };
}

/** The single characters that carry structure. Anything else is a bad character. */
const PUNCTUATION: Readonly<Record<string, TokenKind>> = {
  '(': 'open',
  ')': 'close',
  ':': 'colon',
  ',': 'sep',
  ';': 'sep',
};

/**
 * Words, in one left-to-right pass.
 *
 * A sheet-qualified reference is deliberately *one* token: `'Q1 2026'!A1:B9` has a
 * space and an apostrophe in it, and treating the parts separately would make the
 * parser responsible for reassembling something the user typed as a single name.
 *
 * The order of the attempts below is the grammar: a number is tried before a name
 * so `1e5` does not read as a name, and an operator before punctuation so `<=`
 * does not read as `<` then `=`.
 */
export function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);
    const char = source[index] ?? '';

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const scan =
      char === '"' ? scanText(source, index)
      : char === '#' ? scanError(rest, index)
      : scanQuotedSheet(rest, index) ?? scanNumber(rest, index) ?? scanName(rest, index) ?? scanOperator(rest, index);

    if (scan !== null) {
      tokens.push(scan.token);
      index += scan.length;
      continue;
    }

    tokens.push({ kind: PUNCTUATION[char] ?? 'bad', text: char, at: index });
    index += 1;
  }

  return tokens;
}

/** A numeric literal, including `1.5e-3`. */
function scanNumber(rest: string, index: number): Scan | null {
  const number = NUMBER.exec(rest);
  if (number === null) return null;
  return { token: { kind: 'number', text: number[0], at: index }, length: number[0].length };
}

/** Two-character operators are tried first, or `<=` would read as `<` then `=`. */
function scanOperator(rest: string, index: number): Scan | null {
  const operator = OPERATORS.find((candidate) => rest.startsWith(candidate));
  if (operator === undefined) return null;
  return { token: { kind: 'op', text: operator, at: index }, length: operator.length };
}

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';

export type Expr =
  | { readonly kind: 'literal'; readonly value: CellValue }
  | { readonly kind: 'ref'; readonly sheet: string | null; readonly ref: CellRef }
  | { readonly kind: 'range'; readonly sheet: string | null; readonly range: CellRange }
  | { readonly kind: 'negate'; readonly operand: Expr }
  | { readonly kind: 'percent'; readonly operand: Expr }
  | { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Expr[] }
  | { readonly kind: 'bad'; readonly error: CellError };

const bad = (error: CellError): Expr => ({ kind: 'bad', error });

/** Splits `Sheet1!A1` into its parts; a bare `A1` has no sheet. */
function splitName(text: string): { readonly sheet: string | null; readonly local: string } {
  const bang = text.lastIndexOf('!');
  return bang < 0 ? { sheet: null, local: text } : { sheet: text.slice(0, bang), local: text.slice(bang + 1) };
}

/**
 * `A1`, `$B$7` or `AA100` as a reference.
 *
 * Written here rather than reused from `refs.parseRef` because the parser must also
 * reject a *name* that merely looks like one: `LOG10` is a function and `A1000000`
 * is off the sheet, and both have to fail as references without failing as tokens.
 */
function asRef(local: string): CellRef | null {
  const match = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,4})$/.exec(local);
  if (match === null) return null;
  const col = colToIndex(match[1] ?? '');
  const row = Number.parseInt(match[2] ?? '', 10) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null;
  return { col, row };
}

const COMPARISONS: readonly BinaryOp[] = ['=', '<>', '<=', '>=', '<', '>'];

/**
 * Source to tree.
 *
 * The formula is given without its leading `=`. Every failure is a node rather
 * than an exception, so a half-typed formula still round-trips through the file.
 */
export function parse(source: string): Expr {
  const tokens = tokenize(source);
  let position = 0;

  const peek = (offset = 0): Token | null => tokens[position + offset] ?? null;
  const take = (): Token | null => tokens[position++] ?? null;
  const at = (kind: TokenKind, text?: string): boolean => {
    const token = peek();
    return token !== null && token.kind === kind && (text === undefined || token.text === text);
  };

  function comparison(): Expr {
    let left = concat();
    while (at('op') && COMPARISONS.includes((peek()?.text ?? '') as BinaryOp)) {
      const op = (take()?.text ?? '=') as BinaryOp;
      left = { kind: 'binary', op, left, right: concat() };
    }
    return left;
  }

  function concat(): Expr {
    let left = additive();
    while (at('op', '&')) {
      take();
      left = { kind: 'binary', op: '&', left, right: additive() };
    }
    return left;
  }

  function additive(): Expr {
    let left = multiplicative();
    while (at('op', '+') || at('op', '-')) {
      const op = (take()?.text ?? '+') as BinaryOp;
      left = { kind: 'binary', op, left, right: multiplicative() };
    }
    return left;
  }

  function multiplicative(): Expr {
    let left = unary();
    while (at('op', '*') || at('op', '/')) {
      const op = (take()?.text ?? '*') as BinaryOp;
      left = { kind: 'binary', op, left, right: unary() };
    }
    return left;
  }

  function unary(): Expr {
    if (at('op', '-')) {
      take();
      return { kind: 'negate', operand: unary() };
    }
    if (at('op', '+')) {
      take();
      return unary();
    }
    return power();
  }

  /** `^` is right-associative and binds tighter than unary minus: `-2^2` is −4. */
  function power(): Expr {
    const base = postfix();
    if (!at('op', '^')) return base;
    take();
    return { kind: 'binary', op: '^', left: base, right: unary() };
  }

  function postfix(): Expr {
    let value = primary();
    while (at('op', '%')) {
      take();
      value = { kind: 'percent', operand: value };
    }
    return value;
  }

  function args(): readonly Expr[] {
    const list: Expr[] = [];
    if (at('close')) {
      take();
      return list;
    }
    for (;;) {
      // `IF(A1,,2)` leaves the middle argument blank, which is legal and means blank.
      list.push(at('sep') || at('close') ? { kind: 'literal', value: BLANK } : comparison());
      if (at('sep')) {
        take();
        continue;
      }
      if (at('close')) take();
      return list;
    }
  }

  /** `SUM(A1:B2)` — the name has been taken and `(` is next. Arity is checked here. */
  function callExpr(text: string): Expr {
    take();
    const name = text.toUpperCase();
    const list = args();
    const spec = FUNCTIONS[name];
    if (spec === undefined) return bad('#NAME?');
    // Arity is the declaration's business, checked once, here.
    if (list.length < spec.min || list.length > spec.max) return bad('#VALUE!');
    return { kind: 'call', name, args: list };
  }

  /** A name that is not a call: `TRUE`, `A1`, `Sheet1!A1`, or a range `A1:B9`. */
  function nameExpr(text: string): Expr {
    const upper = text.toUpperCase();
    if (upper === 'TRUE') return { kind: 'literal', value: bool(true) };
    if (upper === 'FALSE') return { kind: 'literal', value: bool(false) };

    const { sheet, local } = splitName(text);
    const start = asRef(local);
    if (start === null) return bad('#NAME?');
    if (!at('colon') || peek(1)?.kind !== 'name') return { kind: 'ref', sheet, ref: start };

    take();
    const endToken = take();
    const end = asRef(splitName(endToken?.text ?? '').local);
    if (end === null) return bad('#REF!');
    const range = normalize({ start, end });
    return rangeSize(range) > MAX_RANGE_CELLS ? bad('#REF!') : { kind: 'range', sheet, range };
  }

  function primary(): Expr {
    const token = take();
    if (token === null) return bad('#VALUE!');

    if (token.kind === 'number') return { kind: 'literal', value: num(Number(token.text)) };
    if (token.kind === 'text') return { kind: 'literal', value: str(token.text) };
    if (token.kind === 'error') return { kind: 'literal', value: err(token.text as CellError) };

    if (token.kind === 'open') {
      const inner = comparison();
      if (at('close')) take();
      return inner;
    }

    if (token.kind !== 'name') return bad('#VALUE!');
    return at('open') ? callExpr(token.text) : nameExpr(token.text);
  }

  const tree = comparison();
  // Anything left over means the formula does not parse as one expression.
  return position < tokens.length ? bad('#VALUE!') : tree;
}

/**
 * What a formula is evaluated against.
 *
 * One method, because that is the whole of the engine's dependency on the rest of
 * the app: give it a way to read a cell and it can calculate. `workbook.ts` passes
 * a resolver that recurses into other formulas and detects cycles; a test can pass
 * one backed by a plain object.
 */
export interface Resolver {
  (sheet: string | null, ref: CellRef): CellValue;
}

const arithmetic = (op: BinaryOp, left: number, right: number): CellValue => {
  if (op === '+') return num(left + right);
  if (op === '-') return num(left - right);
  if (op === '*') return num(left * right);
  if (op === '/') return right === 0 ? err('#DIV/0!') : num(left / right);
  // A negative base with a fractional exponent is imaginary, which a sheet calls
  // `#NUM!` rather than `NaN`.
  const power = left ** right;
  return Number.isNaN(power) ? err('#NUM!') : num(power);
};

function compareOp(op: BinaryOp, left: CellValue, right: CellValue): CellValue {
  const order = compare(left, right);
  if (isValue(order)) return order;
  if (op === '=') return bool(order === 0);
  if (op === '<>') return bool(order !== 0);
  if (op === '<') return bool(order < 0);
  if (op === '<=') return bool(order <= 0);
  if (op === '>') return bool(order > 0);
  return bool(order >= 0);
}

function binary(op: BinaryOp, left: CellValue, right: CellValue): CellValue {
  const problem = firstError([left, right]);
  if (problem !== null) return problem;
  if (op === '&') return str(toText(left) + toText(right));
  if (COMPARISONS.includes(op)) return compareOp(op, left, right);
  const x = toNumber(left);
  if (isValue(x)) return x;
  const y = toNumber(right);
  if (isValue(y)) return y;
  return arithmetic(op, x, y);
}

/** The cells of a range, row-major, as one function argument. */
function rangeArg(sheet: string | null, range: CellRange, resolve: Resolver): Arg {
  const box = normalize(range);
  const values: CellValue[] = [];
  for (let row = box.start.row; row <= box.end.row; row += 1) {
    for (let col = box.start.col; col <= box.end.col; col += 1) values.push(resolve(sheet, { col, row }));
  }
  return {
    values,
    range: true,
    width: box.end.col - box.start.col + 1,
    height: box.end.row - box.start.row + 1,
  };
}

/** One argument, kept as a range when it is one so `SUM` can tell the difference. */
function argOf(expr: Expr, resolve: Resolver): Arg {
  if (expr.kind === 'range') return rangeArg(expr.sheet, expr.range, resolve);
  return scalarArg(evaluate(expr, resolve));
}

export function evaluate(expr: Expr, resolve: Resolver): CellValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'bad':
      return err(expr.error);
    case 'ref':
      return resolve(expr.sheet, expr.ref);
    case 'range': {
      // A range where a value is wanted collapses to its first cell, which is what
      // makes `=A1:A9` show a number instead of refusing.
      const arg = rangeArg(expr.sheet, expr.range, resolve);
      return first(arg);
    }
    case 'negate': {
      const value = toNumber(evaluate(expr.operand, resolve));
      return isValue(value) ? value : num(-value);
    }
    case 'percent': {
      const value = toNumber(evaluate(expr.operand, resolve));
      return isValue(value) ? value : num(value / 100);
    }
    case 'binary':
      return binary(expr.op, evaluate(expr.left, resolve), evaluate(expr.right, resolve));
    case 'call': {
      const spec = FUNCTIONS[expr.name];
      if (spec === undefined) return err('#NAME?');
      return spec.call(expr.args.map((argument) => argOf(argument, resolve)));
    }
  }
}

/**
 * Every range a formula reads, in the order it reads them.
 *
 * The grid uses this to outline a formula's inputs while it is being edited — the
 * coloured boxes every spreadsheet draws — so a single cell comes back as a 1×1
 * range rather than as a different kind of thing.
 */
export function references(expr: Expr, sheet: string | null = null): readonly (CellRange & { readonly sheet: string | null })[] {
  const out: (CellRange & { readonly sheet: string | null })[] = [];
  const walk = (node: Expr): void => {
    switch (node.kind) {
      case 'ref':
        if (node.sheet === null || node.sheet.toLowerCase() === (sheet ?? '').toLowerCase()) {
          out.push({ sheet: node.sheet, start: node.ref, end: node.ref });
        }
        return;
      case 'range':
        if (node.sheet === null || node.sheet.toLowerCase() === (sheet ?? '').toLowerCase()) {
          out.push({ sheet: node.sheet, ...normalize(node.range) });
        }
        return;
      case 'negate':
      case 'percent':
        walk(node.operand);
        return;
      case 'binary':
        walk(node.left);
        walk(node.right);
        return;
      case 'call':
        node.args.forEach(walk);
        return;
      default:
        return;
    }
  };
  walk(expr);
  return out;
}

/** `A1` and `Sheet1!A1` — the key a dependency is recorded under. */
export const dependencyKey = (sheet: string | null, ref: CellRef): string =>
  sheet === null ? keyOf(ref) : `${sheet.toLowerCase()}!${keyOf(ref)}`;



