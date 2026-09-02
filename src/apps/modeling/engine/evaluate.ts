/**
 * The other half of the formula language: a checked tree and a way to read other rows in,
 * one finite number and a list of what happened to it out.
 *
 * ./expression did all of the refusing, so there is no validation here — no arity check, no
 * key check, no shape check, no unknown function. Everything in this file is arithmetic, and
 * its post-condition is the one thing arithmetic over real data will not give you for free:
 * the result is always a finite number. Every node's value passes one guard on the way out,
 * and a value that came back `Infinity` or `NaN` leaves as zero with a note attached.
 *
 * That trade is worth stating plainly, because the other choice is defensible and wrong here.
 * Returning `NaN` is more faithful to IEEE 754 and useless in a statement: one zero
 * denominator in one period turns a margin into `NaN`, the margin into a `NaN` total, and a
 * whole model into blanks with nothing saying which cell started it. A finite number plus a
 * note keeps the statement readable and keeps the fact — and the notes are meant to be shown
 * beside the cell, not swallowed.
 *
 * Four forms are lazy, and that is a correctness property rather than an optimisation.
 * `if(revenue = 0, 0, profit / revenue)` must not report a division by zero: the reader wrote
 * that guard precisely so the division never happens, and an evaluator that computed both
 * arms would answer with a complaint about the arm it threw away. So `if`, the ternary, `and`
 * and `or` evaluate only what they need.
 */
import type { BinaryOp, FnName, Node } from './expression';

export type EvalNoteCode =
  /** A key the context has no row for. Not a parse error: the formula is well formed and the
   *  model is missing a line, which is a different thing to fix. */
  | 'UNKNOWN_KEY'
  /** `prior(k, n)` reached back past the model's first period. */
  | 'BEFORE_START'
  | 'DIV_ZERO'
  /** An operation outside its real domain: a negative base to a fractional power, `sqrt` of a
   *  negative, a discount rate of −100% or worse. */
  | 'DOMAIN'
  | 'NOT_FINITE';

/** What happened, and where. `where` is the key, function or operator the note came from, so
 *  a cell can say "no value for headcount" rather than "something went wrong". */
export interface EvalNote {
  readonly code: EvalNoteCode;
  readonly where: string;
}

export interface Evaluation {
  /** Always finite. The header states what that costs. */
  readonly value: number;
  /** In the order they happened, deduplicated on code and place: one missing key read four
   *  times in one formula is one fact about the model, not four. */
  readonly notes: readonly EvalNote[];
}

/**
 * How a formula reaches the rest of the model.
 *
 * Three reads rather than one, because the three mean different things to ./graph: `value` is
 * a same-period read, `prior` is a read of a period already finished, and `series` is a read
 * of every period at once. A context that offered only `series` would let this evaluator lift
 * the current period out of it and turn a cycle the graph refused into a stale number nobody
 * questioned.
 *
 * Every one of them may answer `undefined`, and that is not an error condition to be argued
 * about here — it is a model with a line missing, reported as a note and carried on from.
 */
export interface EvalContext {
  /** The value of `key` in the period being computed. */
  readonly value: (key: string) => number | undefined;
  /** The value of `key` `back` periods earlier; `undefined` before the model's first period. */
  readonly prior: (key: string, back: number) => number | undefined;
  /** Every period of `key`, in order, for `sum` and `npv`. */
  readonly series: (key: string) => readonly number[] | undefined;
}

interface Frame {
  readonly ctx: EvalContext;
  readonly notes: EvalNote[];
  /** Codes already noted, so the dedup is O(1) rather than a scan per note. */
  readonly seen: Set<string>;
}

/** One formula in one period. Call it once per cell; it holds nothing between calls. */
export function evaluate(ast: Node, ctx: EvalContext): Evaluation {
  const frame: Frame = { ctx, notes: [], seen: new Set() };
  return { value: run(ast, frame), notes: frame.notes };
}

function note(frame: Frame, code: EvalNoteCode, where: string): void {
  const seal = `${code}\u0000${where}`;
  if (frame.seen.has(seal)) return;
  frame.seen.add(seal);
  frame.notes.push({ code, where });
}

/** The post-condition, applied once per node rather than re-argued at every operator. */
function finite(frame: Frame, value: number, where: string): number {
  if (Number.isFinite(value)) return value;
  note(frame, 'NOT_FINITE', where);
  return 0;
}

/** A number is true when it is not zero, and there is no boolean type: a comparison yields 1
 *  or 0 because a planning model multiplies by a flag far more often than it branches on one,
 *  and `headcount * is_open` should not need a cast to mean what it says. */
const truthy = (value: number): boolean => value !== 0;
const flag = (state: boolean): number => (state ? 1 : 0);

/* ------------------------------------------------------------------ nodes ---- */

function run(node: Node, frame: Frame): number {
  switch (node.kind) {
    case 'NUM':
      return node.value;
    case 'REF':
      return read(frame, node.key);
    case 'UNARY':
      return node.op === '-'
        ? -run(node.operand, frame)
        : flag(!truthy(run(node.operand, frame)));
    case 'BINARY':
      return binary(node.op, node.left, node.right, frame);
    // Lazy, like `if`, and for the same reason.
    case 'COND':
      return truthy(run(node.test, frame))
        ? run(node.whenTrue, frame)
        : run(node.whenFalse, frame);
    case 'CALL':
      return call(node.name, node.args, frame);
    case 'PRIOR':
      return lagged(frame, node.key, node.back);
    // An empty series sums to zero rather than to nothing, which is the right answer for a
    // model whose first period has not been computed yet.
    case 'SUM':
      return finite(frame, total(seriesOf(frame, node.key)), node.key);
    default:
      return npv(run(node.rate, frame), seriesOf(frame, node.key), frame, node.key);
  }
}

const total = (series: readonly number[]): number => series
  .reduce((sum, value) => sum + value, 0);

function read(frame: Frame, key: string): number {
  const value = frame.ctx.value(key);
  if (value === undefined) {
    note(frame, 'UNKNOWN_KEY', key);
    return 0;
  }
  return finite(frame, value, key);
}

function lagged(frame: Frame, key: string, back: number): number {
  const value = frame.ctx.prior(key, back);
  if (value === undefined) {
    // Before the first period. Zero rather than a refusal, because `cash = prior(cash) + net`
    // has to have a first period, and an opening balance that is not zero is an assumption the
    // model states — not a number this evaluator is entitled to invent.
    note(frame, 'BEFORE_START', key);
    return 0;
  }
  return finite(frame, value, key);
}

function seriesOf(frame: Frame, key: string): readonly number[] {
  const series = frame.ctx.series(key);
  if (series === undefined) {
    note(frame, 'UNKNOWN_KEY', key);
    return [];
  }
  return series;
}

/* -------------------------------------------------------------- operators ---- */

function binary(op: BinaryOp, leftNode: Node, rightNode: Node, frame: Frame): number {
  // The two lazy ones go first, before either side is touched.
  if (op === 'and') return flag(truthy(run(leftNode, frame)) && truthy(run(rightNode, frame)));
  if (op === 'or') return flag(truthy(run(leftNode, frame)) || truthy(run(rightNode, frame)));

  const left = run(leftNode, frame);
  const right = run(rightNode, frame);
  switch (op) {
    case '+': return finite(frame, left + right, op);
    case '-': return finite(frame, left - right, op);
    case '*': return finite(frame, left * right, op);
    case '/':
      if (right === 0) {
        // Zero, not Infinity and not NaN. A ratio whose denominator has not happened yet is
        // not infinite — it is unmeasured, and the note is the part that says so.
        note(frame, 'DIV_ZERO', op);
        return 0;
      }
      return finite(frame, left / right, op);
    case '^': return power(left, right, frame);
    case '=': return flag(left === right);
    case '<>': return flag(left !== right);
    case '<': return flag(left < right);
    case '<=': return flag(left <= right);
    case '>': return flag(left > right);
    default: return flag(left >= right);
  }
}

/** `^` refuses exactly the case with no real answer: a negative base raised to a fraction.
 *  A model that produced one has a sign error upstream, and `NaN` would carry that error
 *  forward silently instead of naming the operator it happened at. */
function power(base: number, exponent: number, frame: Frame): number {
  if (base < 0 && !Number.isInteger(exponent)) {
    note(frame, 'DOMAIN', '^');
    return 0;
  }
  return finite(frame, base ** exponent, '^');
}

/**
 * Net present value across every period of the series, with the first period undiscounted.
 *
 * Deliberately not Excel's `NPV`, which discounts its first argument by one whole period on the
 * assumption that the flow is a year away. Here the first period of a model is the period the
 * model is in, and discounting it would price today's money as tomorrow's. A reader who wants
 * Excel's reading writes `npv(rate, flows) / (1 + rate)`; the divergence is named here so that
 * nobody has to discover it from a rounding difference against a spreadsheet.
 *
 * The discount factor is carried forward by multiplication rather than recomputed as a power
 * per period, which is both cheaper and the same number.
 */
function npv(rate: number, series: readonly number[], frame: Frame, key: string): number {
  if (rate <= -1) {
    note(frame, 'DOMAIN', 'npv');
    return 0;
  }
  let sum = 0;
  let discount = 1;
  for (const flow of series) {
    sum += flow / discount;
    discount *= 1 + rate;
  }
  return finite(frame, sum, key);
}

/* ------------------------------------------------------------------ calls ---- */

/**
 * A function call.
 *
 * `if` is intercepted before its arguments are touched, which is the whole reason it is a form
 * in the language rather than sugar over arithmetic: `if(units = 0, 0, cost / units)` has to be
 * able to guard the thing it guards. Everything else is strict, because everything else needs
 * all of its arguments.
 */
function call(name: FnName, args: readonly Node[], frame: Frame): number {
  if (name === 'if') {
    return truthy(run(args[0], frame)) ? run(args[1], frame) : run(args[2], frame);
  }
  return apply(name, args.map((arg) => run(arg, frame)), frame);
}

function apply(name: FnName, args: readonly number[], frame: Frame): number {
  switch (name) {
    case 'min': return Math.min(...args);
    case 'max': return Math.max(...args);
    case 'avg': return finite(frame, total(args) / args.length, name);
    case 'abs': return Math.abs(args[0]);
    case 'floor': return Math.floor(args[0]);
    case 'ceil': return Math.ceil(args[0]);
    case 'sqrt': return root(args[0], frame);
    case 'round': return rounded(args[0], args.length > 1 ? args[1] : 0, frame);
    case 'pow': return power(args[0], args[1], frame);
    case 'clamp': return clamped(args[0], args[1], args[2], frame);
    case 'growth': return finite(frame, args[0] * power(1 + args[1], args[2], frame), name);
    default: return payment(args[0], args[1], args[2], frame);
  }
}

function root(value: number, frame: Frame): number {
  if (value < 0) {
    note(frame, 'DOMAIN', 'sqrt');
    return 0;
  }
  return Math.sqrt(value);
}

/**
 * Rounding, half away from zero.
 *
 * `Math.round` rounds half towards positive infinity, so it turns −2.5 into −2 while every
 * spreadsheet a finance reader has used turns it into −3. Two directions for the same
 * magnitude is not a rounding rule anyone can reconcile a statement against, so the sign is
 * taken out, the magnitude rounded, and the sign put back.
 *
 * A fractional digit count is truncated rather than refused: `round(x, 2.7)` is a typo whose
 * only sensible reading is two places. Negative digits round to tens and hundreds, which the
 * same arithmetic gives for free.
 */
function rounded(value: number, digits: number, frame: Frame): number {
  const scale = 10 ** Math.trunc(digits);
  const scaled = Math.abs(value) * scale;
  return finite(frame, Math.sign(value) * (Math.round(scaled) / scale), 'round');
}

/** Bounds the wrong way round is an assumption error — a floor above its own ceiling prices
 *  something at a number no reader chose — so it is noted rather than quietly resolved. The
 *  value returned is still the upper bound, because a clamp has to return something inside
 *  the range it was given and there is only one number in that one. */
function clamped(value: number, low: number, high: number, frame: Frame): number {
  if (low > high) {
    note(frame, 'DOMAIN', 'clamp');
    return high;
  }
  return Math.min(Math.max(value, low), high);
}

/**
 * The level payment that amortises `principal` over `periods` at `rate` per period.
 *
 * A zero rate is not a special case bolted on; it is the limit of the general formula, which
 * divides by zero there. Both readings agree everywhere else, so the branch is the formula
 * telling the truth about its own removable singularity.
 */
function payment(rate: number, periods: number, principal: number, frame: Frame): number {
  if (periods === 0) {
    note(frame, 'DIV_ZERO', 'pmt');
    return 0;
  }
  if (rate === 0) return finite(frame, principal / periods, 'pmt');
  const factor = 1 - power(1 + rate, -periods, frame);
  if (factor === 0) {
    note(frame, 'DIV_ZERO', 'pmt');
    return 0;
  }
  return finite(frame, (principal * rate) / factor, 'pmt');
}
