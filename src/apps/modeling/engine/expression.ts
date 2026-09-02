/**
 * The formula language: source text in, a checked tree out.
 *
 * A planning model is only worth arguing with when every number in it traces back to a
 * sentence somebody wrote, so formulas are text and stay text. This file is the half that
 * refuses: it turns one expression into a tree, or into a single error that points at the
 * character it gave up on. All of the refusing happens here so that ./evaluate can be
 * total arithmetic with no validation left in it.
 *
 * Three decisions shape the grammar, and each is a refusal moved earlier:
 *
 * 1. `%` is a suffix on a number and nothing else -- `12%` is 0.12 -- and there is no
 *    modulo operator. A language with both cannot tell `a % b` from `a %` beside `b`, and
 *    a planning model wants percent literals in every third formula and modulo in none.
 * 2. `prior`, `sum` and `npv` take a bare key rather than a value, and the parser enforces
 *    that shape. Each reads another row's whole series, which an expression already
 *    collapsed to one number cannot give back -- so `prior(revenue * 2)` is a parse error
 *    rather than a surprise at run time.
 * 3. A reference is one flat key: no `assume.` or `formula.` prefix. The registry refuses
 *    a key that exists in both places, so the prefix would always be inferable, and a
 *    prefix that is always inferable is one a reader will eventually write wrong.
 *
 * The one subtlety worth reading twice is which reads can close a cycle. `prior(x)` cannot:
 * it reads a period that is already finished, which is what lets `cash = prior(cash) + net`
 * be an ordinary formula rather than a contradiction. `sum(x)` and `npv(r, x)` can, because
 * they read every period of `x` including this one, so ./graph treats them as same-period
 * edges like any other.
 */

/* ------------------------------------------------------------------ tokens ---- */

export type TokenKind = 'NUMBER' | 'NAME' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA';

/**
 * One token, as a union rather than a record with an optional `value`.
 *
 * `value` belongs to NUMBER and to nothing else, and a shape that says so removes the two
 * branches in the parser that could never be reached: an optional field forces every read
 * of it to handle an absence the lexer never produces, and a branch that cannot run is a
 * branch nobody can test.
 *
 * `text` is normalised -- `!=` arrives as `<>`, `&&` as `and`, `==` as `=`. One spelling
 * per operator downstream, so the parser has one branch per meaning rather than one per
 * keyboard habit. `at` is the character offset in the source, so an error can point at the
 * thing it means.
 */
export type Token =
  | {
    readonly kind: 'NUMBER';
    readonly text: string;
    readonly at: number;
    /** Already divided by 100 when the literal carried a `%`. */
    readonly value: number;
  }
  | {
    readonly kind: Exclude<TokenKind, 'NUMBER'>;
    readonly text: string;
    readonly at: number;
  };

/* --------------------------------------------------------------------- ast ---- */

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '^'
  | '=' | '<>' | '<' | '<=' | '>' | '>='
  | 'and' | 'or';

export type FnName =
  | 'min' | 'max' | 'avg' | 'abs' | 'floor' | 'ceil' | 'sqrt'
  | 'round' | 'pow' | 'clamp' | 'if' | 'growth' | 'pmt';

export type Node =
  | { readonly kind: 'NUM'; readonly value: number }
  | { readonly kind: 'REF'; readonly key: string; readonly at: number }
  | { readonly kind: 'UNARY'; readonly op: '-' | 'not'; readonly operand: Node }
  | { readonly kind: 'BINARY'; readonly op: BinaryOp; readonly left: Node; readonly right: Node }
  | {
    readonly kind: 'COND'; readonly test: Node;
    readonly whenTrue: Node; readonly whenFalse: Node;
  }
  | { readonly kind: 'CALL'; readonly name: FnName; readonly args: readonly Node[]; readonly at: number }
  | { readonly kind: 'PRIOR'; readonly key: string; readonly back: number; readonly at: number }
  | { readonly kind: 'SUM'; readonly key: string; readonly at: number }
  | { readonly kind: 'NPV'; readonly rate: Node; readonly key: string; readonly at: number };

/* ------------------------------------------------------------------ errors ---- */

export type ParseErrorCode =
  | 'EMPTY'
  | 'BAD_CHAR'
  | 'BAD_NUMBER'
  | 'UNKNOWN_FUNCTION'
  | 'BAD_ARITY'
  | 'NEEDS_KEY'
  | 'BAD_LAG'
  | 'UNCLOSED'
  | 'UNEXPECTED'
  | 'TRAILING';

/**
 * One reason a formula did not parse, and where.
 *
 * Deliberately not a sentence: the message is written by the UI in the reader's language,
 * and a code plus the offending text is everything three translations need. `text` is the
 * token as written rather than as normalised, because a reader looking for `!=` in their
 * own formula will not find `<>`.
 */
export interface ParseError {
  readonly code: ParseErrorCode;
  readonly at: number;
  readonly text: string;
}

/** Thrown by the descent and caught once, in `parseFormula`. A recursive-descent parser
 *  that returns a result union at every level spends most of its lines threading the
 *  union; this one spends none, and the throw cannot escape the module. */
class Bail extends Error {
  constructor(readonly issue: ParseError) {
    super(issue.code);
    this.name = 'Bail';
  }
}

/** A `function` rather than a const arrow on purpose: TypeScript only narrows after a
 *  never-returning call when the callee's signature is written out, and a declaration
 *  always writes it out. As an arrow assigned to an inferred const, every `if (x === null)
 *  bail(...)` below would leave `x` nullable and need a redundant `return`. */
function bail(code: ParseErrorCode, at: number, text: string): never {
  throw new Bail({ code, at, text });
}

/** A key the language will accept as a reference. Exported because the registries have to
 *  refuse the same spellings the parser would, and one regex read twice cannot drift. */
export const isValidKey = (key: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);

/* --------------------------------------------------------------- functions ---- */

/** Arity as `[min, max]`. `Infinity` is a variadic tail, which only the reducers take. */
const FN_ARITY: Readonly<Record<FnName, readonly [number, number]>> = {
  min: [1, Infinity],
  max: [1, Infinity],
  avg: [1, Infinity],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  sqrt: [1, 1],
  round: [1, 2],
  pow: [2, 2],
  clamp: [3, 3],
  if: [3, 3],
  growth: [3, 3],
  pmt: [3, 3],
};

const isFnName = (name: string): name is FnName => Object.hasOwn(FN_ARITY, name);

/** The three that read a whole series and therefore take a key, not a value. Checked by
 *  name in the parser rather than by a flag on the token, because their argument shapes
 *  differ from each other as well as from an ordinary call. */
const SERIES_FORMS: ReadonlySet<string> = new Set(['prior', 'sum', 'npv']);

/* ------------------------------------------------------------------- lexer ---- */

const TWO_CHAR: Readonly<Record<string, string>> = {
  '<=': '<=', '>=': '>=', '<>': '<>', '!=': '<>', '==': '=', '&&': 'and', '||': 'or',
};

const ONE_CHAR: ReadonlySet<string> = new Set(['+', '-', '*', '/', '^', '<', '>', '=', '?', ':']);

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isNameStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
const isNamePart = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/**
 * Source into tokens, or a bail at the first character that has no reading.
 *
 * A number swallows one optional trailing `%`, which is the whole reason there is no
 * modulo operator -- see the header. Two-character operators are tried before
 * one-character ones so `<=` is never read as `<` beside `=`.
 */
function lex(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (isSpace(ch)) { i += 1; continue; }
    if (ch === '(') { out.push({ kind: 'LPAREN', text: ch, at: i }); i += 1; continue; }
    if (ch === ')') { out.push({ kind: 'RPAREN', text: ch, at: i }); i += 1; continue; }
    if (ch === ',') { out.push({ kind: 'COMMA', text: ch, at: i }); i += 1; continue; }

    if (isDigit(ch) || (ch === '.' && isDigit(source.charAt(i + 1)))) {
      const start = i;
      while (i < source.length && (isDigit(source.charAt(i)) || source.charAt(i) === '.')) i += 1;
      const raw = source.slice(start, i);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) bail('BAD_NUMBER', start, raw);
      const percent = source.charAt(i) === '%';
      if (percent) i += 1;
      out.push({
        kind: 'NUMBER',
        text: percent ? `${raw}%` : raw,
        value: percent ? parsed / 100 : parsed,
        at: start,
      });
      continue;
    }

    if (isNameStart(ch)) {
      const start = i;
      while (i < source.length && isNamePart(source.charAt(i))) i += 1;
      const raw = source.slice(start, i);
      const lower = raw.toLowerCase();
      const isWordOp = lower === 'and' || lower === 'or' || lower === 'not';
      out.push({ kind: isWordOp ? 'OP' : 'NAME', text: isWordOp ? lower : raw, at: start });
      continue;
    }

    const pair = TWO_CHAR[source.slice(i, i + 2)];
    if (pair !== undefined) { out.push({ kind: 'OP', text: pair, at: i }); i += 2; continue; }
    if (ONE_CHAR.has(ch)) { out.push({ kind: 'OP', text: ch, at: i }); i += 1; continue; }
    bail('BAD_CHAR', i, ch);
  }
  return out;
}

/* ------------------------------------------------------------------ parser ---- */

/** The one mutable thing in the file. A recursive descent needs a shared position, and
 *  threading an index through twelve returns would be the same state with more ceremony. */
interface Cursor {
  readonly tokens: readonly Token[];
  index: number;
}

const peek = (c: Cursor): Token | null => c.tokens[c.index] ?? null;

const isOp = (c: Cursor, ...ops: readonly string[]): boolean => {
  const token = peek(c);
  return token !== null && token.kind === 'OP' && ops.includes(token.text);
};

/** Offset just past the last token, so "ran out of expression" points at the end of what
 *  the reader wrote rather than at character zero. */
function endOf(c: Cursor): number {
  const last = c.tokens[c.tokens.length - 1];
  return last === undefined ? 0 : last.at + last.text.length;
}

function take(c: Cursor): Token {
  const token = peek(c);
  if (token === null) bail('UNEXPECTED', endOf(c), '');
  c.index += 1;
  return token;
}

function expectClose(c: Cursor, openedAt: number): void {
  const token = peek(c);
  if (token === null || token.kind !== 'RPAREN') bail('UNCLOSED', openedAt, '(');
  c.index += 1;
}

/**
 * The precedence ladder, lowest binding first: ternary, `or`, `and`, comparison, `+ -`,
 * `* /`, unary, `^`, primary.
 *
 * Comparison is deliberately non-associative -- one operator, no chain. `a < b < c` reads
 * in mathematics as a conjunction and in most languages as a comparison against a boolean,
 * and a planning tool that silently picks the second reading is a planning tool that will
 * one day price something off `(a < b) < c`.
 */
function parseExpr(c: Cursor): Node {
  const test = parseOr(c);
  if (!isOp(c, '?')) return test;
  c.index += 1;
  const whenTrue = parseExpr(c);
  if (!isOp(c, ':')) {
    const at = peek(c);
    bail('UNEXPECTED', at?.at ?? endOf(c), at?.text ?? '');
  }
  c.index += 1;
  return { kind: 'COND', test, whenTrue, whenFalse: parseExpr(c) };
}

function parseOr(c: Cursor): Node {
  let left = parseAnd(c);
  while (isOp(c, 'or')) {
    c.index += 1;
    left = { kind: 'BINARY', op: 'or', left, right: parseAnd(c) };
  }
  return left;
}

function parseAnd(c: Cursor): Node {
  let left = parseCompare(c);
  while (isOp(c, 'and')) {
    c.index += 1;
    left = { kind: 'BINARY', op: 'and', left, right: parseCompare(c) };
  }
  return left;
}

const COMPARISONS: readonly BinaryOp[] = ['=', '<>', '<=', '>=', '<', '>'];

function parseCompare(c: Cursor): Node {
  const left = parseAdditive(c);
  const token = peek(c);
  if (token === null || token.kind !== 'OP') return left;
  const op = COMPARISONS.find((candidate) => candidate === token.text);
  if (op === undefined) return left;
  c.index += 1;
  return { kind: 'BINARY', op, left, right: parseAdditive(c) };
}

function parseAdditive(c: Cursor): Node {
  let left = parseMultiplicative(c);
  while (isOp(c, '+', '-')) {
    const op = take(c).text === '+' ? '+' : '-';
    left = { kind: 'BINARY', op, left, right: parseMultiplicative(c) };
  }
  return left;
}

function parseMultiplicative(c: Cursor): Node {
  let left = parseUnary(c);
  while (isOp(c, '*', '/')) {
    const op = take(c).text === '*' ? '*' : '/';
    left = { kind: 'BINARY', op, left, right: parseUnary(c) };
  }
  return left;
}

function parseUnary(c: Cursor): Node {
  if (isOp(c, '-')) {
    c.index += 1;
    return { kind: 'UNARY', op: '-', operand: parseUnary(c) };
  }
  // A leading `+` is dropped rather than represented. It changes nothing, and a UNARY node
  // that is the identity would show up in the printed form and in the version hash.
  if (isOp(c, '+')) {
    c.index += 1;
    return parseUnary(c);
  }
  if (isOp(c, 'not')) {
    c.index += 1;
    return { kind: 'UNARY', op: 'not', operand: parseUnary(c) };
  }
  return parsePower(c);
}

/** Right-associative, and the exponent goes back through `parseUnary` so `2 ^ -1` is a
 *  half rather than a parse error. `-2 ^ 2` is therefore `-(2 ^ 2)`, which is the reading
 *  every spreadsheet a finance reader has ever used disagrees with -- Excel gives 4. The
 *  mathematical reading wins here because the alternative is an operator that binds
 *  differently depending on which side of it you are standing. */
function parsePower(c: Cursor): Node {
  const base = parsePrimary(c);
  if (!isOp(c, '^')) return base;
  c.index += 1;
  return { kind: 'BINARY', op: '^', left: base, right: parseUnary(c) };
}

/* -------------------------------------------------------------- primaries ---- */

/**
 * A number, a parenthesised expression, a call, or a reference.
 *
 * A NAME is a call only when `(` follows it, and that is the entire distinction. There are
 * no reserved words beyond the three the lexer turns into operators, so a model is free to
 * name an assumption `growth` -- it becomes the function only if somebody puts a paren
 * after it.
 */
function parsePrimary(c: Cursor): Node {
  const token = take(c);

  if (token.kind === 'NUMBER') return { kind: 'NUM', value: token.value };

  if (token.kind === 'LPAREN') {
    const inner = parseExpr(c);
    expectClose(c, token.at);
    return inner;
  }

  if (token.kind === 'NAME') {
    if (peek(c)?.kind === 'LPAREN') return parseCall(c, token);
    return { kind: 'REF', key: token.text, at: token.at };
  }

  bail('UNEXPECTED', token.at, token.text);
}

/**
 * A name followed by `(`.
 *
 * The unknown-function check runs before the arity check, because `revenu(3)` is a
 * misspelled name rather than a call with the wrong count, and the error a reader can act
 * on is the one that names the function. Arity is settled here rather than in ./evaluate,
 * which is the header's contract: nothing downstream re-checks a tree this file returned.
 */
function parseCall(c: Cursor, name: Token): Node {
  const open = take(c);
  const lower = name.text.toLowerCase();
  if (SERIES_FORMS.has(lower)) return parseSeriesForm(c, lower, name, open.at);
  if (!isFnName(lower)) bail('UNKNOWN_FUNCTION', name.at, name.text);
  const args = parseArgs(c, open.at);
  const [least, most] = FN_ARITY[lower];
  if (args.length < least || args.length > most) bail('BAD_ARITY', name.at, name.text);
  return { kind: 'CALL', name: lower, args, at: name.at };
}

/** The arguments of an ordinary call: one or more, comma-separated, then the close paren.
 *  `f()` reports UNEXPECTED at the `)` rather than returning an empty list -- every entry
 *  in FN_ARITY takes at least one argument, so an empty list would exist only to be
 *  refused one frame later, and at a worse offset. */
function parseArgs(c: Cursor, openedAt: number): Node[] {
  const args: Node[] = [parseExpr(c)];
  while (peek(c)?.kind === 'COMMA') {
    c.index += 1;
    args.push(parseExpr(c));
  }
  expectClose(c, openedAt);
  return args;
}

/**
 * `prior(key)`, `prior(key, n)`, `sum(key)`, `npv(rate, key)`.
 *
 * The key goes through `takeKey` instead of `parseExpr`, which is what makes
 * `prior(revenue * 2)` a parse error rather than a surprise at run time -- see the header.
 * `npv`'s rate is an ordinary expression, because a discount rate is one number and an
 * assumption holding it is an ordinary reference.
 */
function parseSeriesForm(c: Cursor, form: string, name: Token, openedAt: number): Node {
  if (form === 'npv') {
    const rate = parseExpr(c);
    const comma = peek(c);
    if (comma === null || comma.kind !== 'COMMA') {
      bail('NEEDS_KEY', comma?.at ?? endOf(c), comma?.text ?? '');
    }
    c.index += 1;
    const key = takeKey(c);
    expectClose(c, openedAt);
    return { kind: 'NPV', rate, key, at: name.at };
  }

  const key = takeKey(c);
  if (form === 'sum') {
    expectClose(c, openedAt);
    return { kind: 'SUM', key, at: name.at };
  }

  // `prior(x)` is one period back and a second argument says how many. Zero is refused
  // rather than folded to a plain reference: it would be a same-period read wearing a
  // lag's clothing, and ./graph exempts lagged reads from the cycle check on trust.
  let back = 1;
  if (peek(c)?.kind === 'COMMA') {
    c.index += 1;
    const lag = take(c);
    if (lag.kind !== 'NUMBER' || !Number.isInteger(lag.value) || lag.value < 1) {
      bail('BAD_LAG', lag.at, lag.text);
    }
    back = lag.value;
  }
  expectClose(c, openedAt);
  return { kind: 'PRIOR', key, back, at: name.at };
}

/**
 * A bare key where a series form wants one.
 *
 * A NAME followed by `(` is refused rather than read as a key, because `prior(round(x))`
 * is a reader asking for the lagged value of an expression -- the one thing these forms
 * cannot give -- and quietly taking `round` as the key would answer a question nobody
 * asked. The word operators never reach here: the lexer emits `and`, `or` and `not` as OP,
 * so `sum(or)` is a NEEDS_KEY and not a reference to a column called `or`.
 */
function takeKey(c: Cursor): string {
  const token = peek(c);
  if (token === null || token.kind !== 'NAME' || !isValidKey(token.text)) {
    bail('NEEDS_KEY', token?.at ?? endOf(c), token?.text ?? '');
  }
  c.index += 1;
  if (peek(c)?.kind === 'LPAREN') bail('NEEDS_KEY', token.at, token.text);
  return token.text;
}

/* ------------------------------------------------------------------ entry ---- */

export type ParseResult =
  | { readonly ok: true; readonly ast: Node }
  | { readonly ok: false; readonly error: ParseError };

/**
 * The whole of this module's public refusal: one string in, a tree or one error out.
 *
 * `TRAILING` is kept apart from `UNEXPECTED` deliberately. `1 + 2)` parsed cleanly and
 * then had something left over, which is a different mistake from `1 +` and sits at a
 * different character; a reader fixing a stray bracket does not want to be told their
 * expression is incomplete.
 */
export function parseFormula(source: string): ParseResult {
  try {
    const tokens = lex(source);
    if (tokens.length === 0) return { ok: false, error: { code: 'EMPTY', at: 0, text: '' } };
    const cursor: Cursor = { tokens, index: 0 };
    const ast = parseExpr(cursor);
    const rest = peek(cursor);
    if (rest !== null) {
      return { ok: false, error: { code: 'TRAILING', at: rest.at, text: rest.text } };
    }
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof Bail) return { ok: false, error: err.issue };
    throw err;
  }
}

/* ------------------------------------------------------------- references ---- */

export interface Refs {
  /** Same-period reads. These are the edges that can close a cycle. */
  readonly direct: readonly string[];
  /** Reads of an earlier period. Ordered by the graph, exempt from its cycle check. */
  readonly lagged: readonly string[];
}

/**
 * Every key the formula reads, split by whether the read can close a cycle.
 *
 * A key read both ways -- `cash = prior(cash) + sum(cash)` -- lands in both lists, and the
 * graph is right to call that a cycle: the same-period read is real regardless of the
 * lagged one sitting beside it. Sorted so two spellings of one formula produce one Refs,
 * which is what lets ./version hash a model rather than a traversal order.
 */
export function referencesOf(ast: Node): Refs {
  const direct = new Set<string>();
  const lagged = new Set<string>();
  collect(ast, direct, lagged);
  return { direct: [...direct].sort(), lagged: [...lagged].sort() };
}

function collect(node: Node, direct: Set<string>, lagged: Set<string>): void {
  switch (node.kind) {
    case 'NUM':
      return;
    case 'REF':
    case 'SUM':
      direct.add(node.key);
      return;
    case 'PRIOR':
      lagged.add(node.key);
      return;
    // The key is a same-period read of the whole series; the rate is an expression that may
    // read anything, so both sides are walked.
    case 'NPV':
      direct.add(node.key);
      collect(node.rate, direct, lagged);
      return;
    case 'UNARY':
      collect(node.operand, direct, lagged);
      return;
    case 'BINARY':
      collect(node.left, direct, lagged);
      collect(node.right, direct, lagged);
      return;
    case 'COND':
      collect(node.test, direct, lagged);
      collect(node.whenTrue, direct, lagged);
      collect(node.whenFalse, direct, lagged);
      return;
    default:
      for (const arg of node.args) collect(arg, direct, lagged);
  }
}

/* --------------------------------------------------------------- printing ---- */

/** Binding power as printed, matching the ladder the parser reads. Unary sits above `* /`
 *  and below `^`; a ternary binds loosest; a leaf never needs a bracket, so it takes the
 *  top of the ladder rather than a special case at every use. */
const BINDS: Readonly<Record<BinaryOp, number>> = {
  or: 1, and: 2,
  '=': 3, '<>': 3, '<': 3, '<=': 3, '>': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5,
  '^': 7,
};

const BINDS_COND = 0;
const BINDS_UNARY = 6;
const BINDS_LEAF = 9;

/**
 * The tree back to text, in one spelling.
 *
 * This is what ./version hashes, so `a+b`, `a + b` and `(a) + (b)` all print the same and
 * one model never looks like two. Brackets are printed wherever a child binds more loosely
 * than the operator above it, which is very nearly -- though not exactly -- only where the
 * grammar needs them: `2 ^ (-1)` keeps a pair `2 ^ -1` would not require, because a printer
 * that reasoned about that case would be a second grammar to keep in step with the first.
 *
 * A percent literal prints as the fraction it means. `12%` and `0.12` are the same number,
 * and a hash that told them apart would report a change nobody made.
 */
export function printFormula(ast: Node): string {
  return print(ast);
}

function bindsOf(node: Node): number {
  if (node.kind === 'BINARY') return BINDS[node.op];
  if (node.kind === 'UNARY') return BINDS_UNARY;
  if (node.kind === 'COND') return BINDS_COND;
  return BINDS_LEAF;
}

const bracket = (node: Node, floor: number): string => (bindsOf(node) < floor
  ? `(${print(node)})`
  : print(node));

function print(node: Node): string {
  switch (node.kind) {
    case 'NUM':
      return printNumber(node.value);
    case 'REF':
      return node.key;
    case 'UNARY':
      return node.op === '-'
        ? `-${bracket(node.operand, BINDS_UNARY)}`
        : `not ${bracket(node.operand, BINDS_UNARY)}`;
    // `^` is right-associative and every other operator is left, so the side allowed to
    // hold an equal-binding child without brackets flips with it.
    case 'BINARY': {
      const binds = BINDS[node.op];
      const rightward = node.op === '^';
      const left = bracket(node.left, rightward ? binds + 1 : binds);
      const right = bracket(node.right, rightward ? binds : binds + 1);
      return `${left} ${node.op} ${right}`;
    }
    case 'COND':
      return `${bracket(node.test, BINDS_COND + 1)} ? ${bracket(node.whenTrue, BINDS_COND + 1)}`
        + ` : ${bracket(node.whenFalse, BINDS_COND + 1)}`;
    case 'CALL':
      return `${node.name}(${node.args.map((arg) => print(arg)).join(', ')})`;
    // A lag of one is the default and prints as one, so `prior(cash)` does not become
    // `prior(cash, 1)` the first time a model is saved.
    case 'PRIOR':
      return node.back === 1 ? `prior(${node.key})` : `prior(${node.key}, ${node.back})`;
    case 'SUM':
      return `sum(${node.key})`;
    default:
      return `npv(${print(node.rate)}, ${node.key})`;
  }
}

/**
 * A number as one spelling, and one the lexer can read back.
 *
 * `String` reaches for exponent form outside roughly 1e-7 to 1e21 and the grammar has no
 * `e`, so those are expanded: large magnitudes are integers already, small ones get the
 * twenty places `toFixed` allows. Below 1e-20 that rounds to zero, which is the one place
 * this printer is not exact -- the grammar can type such a literal, and a model whose
 * answer turns on it has a problem no printer can fix.
 */
function printNumber(value: number): string {
  const text = String(value);
  if (!text.includes('e')) return text;
  if (Math.abs(value) >= 1) return value.toFixed(0);
  return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}
