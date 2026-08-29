/**
 * Calculator — the arithmetic engine.
 *
 * A pure state machine, not an expression parser, because that is what a keypad
 * calculator *is*: there is no expression to parse, only an accumulator, one
 * pending operator and the number being typed. Windows Calculator behaves this
 * way and the muscle memory that goes with it is the point of the app — so the
 * details are honoured rather than approximated:
 *
 *   • `2 + 3 =` then `=` again gives 8: equals repeats the last operation.
 *   • `12 + ×` is `12 ×`: an operator typed after an operator replaces it.
 *   • `200 + 10 %` is `200 + 20`: percent means "of the left operand" for plus
 *     and minus, and plain division by a hundred for times and divide.
 *   • Dividing by zero does not produce `Infinity`. It produces a locked display
 *     that only Clear recovers, the way every desk calculator has since 1970.
 *
 * Nothing here formats for a locale except through the caller's `locale` string,
 * and nothing here knows React exists.
 */

export type BinaryOp = 'add' | 'sub' | 'mul' | 'div';
export type UnaryOp = 'negate' | 'reciprocal' | 'square' | 'sqrt' | 'percent';

/** Every press the keypad, the keyboard and the palette can produce. */
export type CalcKey =
  | { readonly kind: 'digit'; readonly digit: string }
  | { readonly kind: 'dot' }
  | { readonly kind: 'binary'; readonly op: BinaryOp }
  | { readonly kind: 'unary'; readonly op: UnaryOp }
  | { readonly kind: 'equals' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'clearEntry' }
  | { readonly kind: 'back' };

/** The four conditions a desk calculator refuses to continue from. */
export type CalcError = 'divideByZero' | 'zeroDivZero' | 'invalidInput' | 'overflow';

export interface CalcState {
  /** Digits typed since the last commit; `null` while the display is a result. */
  readonly entry: string | null;
  /** The displayed number when nothing is being typed. */
  readonly value: number;
  /** The committed left operand, waiting for `op` to be applied. */
  readonly left: number | null;
  readonly op: BinaryOp | null;
  /** Operation to repeat when `=` is pressed again. */
  readonly repeat: { readonly op: BinaryOp; readonly operand: number } | null;
  /** The faint line above the display — `12 + `, or `sqr(9)`. */
  readonly trail: string;
  readonly error: CalcError | null;
}

/** What a completed calculation leaves for the history tape. */
export interface Committed {
  readonly expression: string;
  readonly value: number;
}

export interface CalcResult {
  readonly state: CalcState;
  /** Set only by `=`, which is the one key that finishes a calculation. */
  readonly committed: Committed | null;
}

export const START: CalcState = {
  entry: null,
  value: 0,
  left: null,
  op: null,
  repeat: null,
  trail: '',
  error: null,
};

/** Proper operator glyphs, as the display shows them. */
export const SYMBOL: Readonly<Record<BinaryOp, string>> = { add: '+', sub: '−', mul: '×', div: '÷' };

/** Windows shows sixteen digits and then stops accepting them. */
const MAX_DIGITS = 16;

/** The number the display is showing, typed or computed. */
export function current(state: CalcState): number {
  if (state.entry === null) return state.value;
  const parsed = Number(state.entry);
  return Number.isFinite(parsed) ? parsed : 0;
}

const settled = (state: CalcState, value: number, trail: string): CalcState =>
  Number.isFinite(value)
    ? { ...state, entry: null, value, trail }
    : { ...START, error: 'overflow', trail };

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/**
 * Plain, ungrouped text for a number — used inside the trail and the history
 * tape, where a value is quoted back as part of an expression.
 */
export function plain(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value !== 0 && (Math.abs(value) >= 1e16 || Math.abs(value) < 1e-9)) return value.toExponential(9);
  // 16 significant digits, then trim the float noise a decimal fraction leaves.
  return String(Number(value.toPrecision(16)));
}

/**
 * The display line. A number being typed is shown exactly as typed — grouped in
 * the integer part, but with its trailing dot and zeros intact, because deleting
 * `1.50` back to `1.5` on the user's behalf is how a calculator loses trust.
 */
export function display(state: CalcState, locale: string): string {
  if (state.entry === null) return grouped(state.value, locale);
  const negative = state.entry.startsWith('-');
  const bare = negative ? state.entry.slice(1) : state.entry;
  const [whole = '0', fraction] = bare.split('.');
  const head = grouped(Number(whole), locale);
  const tail = fraction === undefined ? (bare.includes('.') ? decimalOf(locale) : '') : `${decimalOf(locale)}${fraction}`;
  return `${negative ? '-' : ''}${head}${tail}`;
}

const decimalOf = (locale: string): string =>
  new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';

function grouped(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '∞';
  if (value !== 0 && (Math.abs(value) >= 1e16 || Math.abs(value) < 1e-9)) return value.toExponential(9);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 12, useGrouping: true }).format(value);
}

/* ------------------------------------------------------------------ *
 * Typing
 * ------------------------------------------------------------------ */

function typeDigit(state: CalcState, digit: string): CalcState {
  const entry = state.entry;
  if (entry === null) return { ...state, entry: digit === '0' ? '0' : digit };
  const digits = entry.replace(/[-.]/g, '').length;
  if (digits >= MAX_DIGITS) return state;
  if (entry === '0') return { ...state, entry: digit };
  if (entry === '-0') return { ...state, entry: `-${digit}` };
  return { ...state, entry: entry + digit };
}

function typeDot(state: CalcState): CalcState {
  if (state.entry === null) return { ...state, entry: '0.' };
  return state.entry.includes('.') ? state : { ...state, entry: `${state.entry}.` };
}

function backspace(state: CalcState): CalcState {
  if (state.entry === null) return state;
  const shorter = state.entry.slice(0, -1);
  return { ...state, entry: shorter === '' || shorter === '-' ? null : shorter };
}

/* ------------------------------------------------------------------ *
 * Arithmetic
 * ------------------------------------------------------------------ */

/** `null` marks the two divisions a calculator refuses rather than computes. */
function fold(left: number, op: BinaryOp, right: number): { readonly value: number } | { readonly error: CalcError } {
  if (op === 'add') return { value: left + right };
  if (op === 'sub') return { value: left - right };
  if (op === 'mul') return { value: left * right };
  if (right === 0) return { error: left === 0 ? 'zeroDivZero' : 'divideByZero' };
  return { value: left / right };
}

function applyBinary(state: CalcState, op: BinaryOp): CalcState {
  // An operator typed straight after another replaces it: `12 + ×` is `12 ×`.
  if (state.op !== null && state.entry === null && state.left !== null) {
    return { ...state, op, trail: `${plain(state.left)} ${SYMBOL[op]} ` };
  }
  const right = current(state);
  if (state.op === null || state.left === null) {
    return { ...state, entry: null, value: right, left: right, op, trail: `${plain(right)} ${SYMBOL[op]} ` };
  }
  const folded = fold(state.left, state.op, right);
  if ('error' in folded) return { ...START, error: folded.error };
  const next = settled(state, folded.value, `${plain(folded.value)} ${SYMBOL[op]} `);
  return next.error === null ? { ...next, left: folded.value, op } : next;
}

function applyEquals(state: CalcState): CalcResult {
  const shown = current(state);
  const pending =
    state.op !== null && state.left !== null
      ? { left: state.left, op: state.op, right: shown }
      : state.repeat !== null
        ? { left: shown, op: state.repeat.op, right: state.repeat.operand }
        : null;
  if (pending === null) {
    const finished = { ...state, entry: null, value: shown, trail: `${plain(shown)} =` };
    return { state: finished, committed: null };
  }
  const folded = fold(pending.left, pending.op, pending.right);
  const expression = `${plain(pending.left)} ${SYMBOL[pending.op]} ${plain(pending.right)} =`;
  if ('error' in folded) return { state: { ...START, error: folded.error, trail: expression }, committed: null };
  const settledState = settled(state, folded.value, expression);
  if (settledState.error !== null) return { state: settledState, committed: null };
  return {
    state: {
      ...settledState,
      left: null,
      op: null,
      repeat: { op: pending.op, operand: pending.right },
    },
    committed: { expression, value: folded.value },
  };
}

/** `%` reads the pending operator: additive means "of the left operand". */
function percentOf(state: CalcState): number {
  const shown = current(state);
  const additive = state.op === 'add' || state.op === 'sub';
  return additive && state.left !== null ? (state.left * shown) / 100 : shown / 100;
}

function applyUnary(state: CalcState, op: UnaryOp): CalcState {
  const shown = current(state);
  if (op === 'negate') {
    if (state.entry === null) return { ...state, value: -shown };
    const flipped = state.entry.startsWith('-') ? state.entry.slice(1) : `-${state.entry}`;
    return { ...state, entry: flipped };
  }
  if (op === 'percent') return { ...state, entry: null, value: percentOf(state) };
  if (op === 'reciprocal') {
    if (shown === 0) return { ...START, error: 'divideByZero', trail: `1/(${plain(shown)})` };
    return settled(state, 1 / shown, `1/(${plain(shown)})`);
  }
  if (op === 'square') return settled(state, shown * shown, `sqr(${plain(shown)})`);
  if (shown < 0) return { ...START, error: 'invalidInput', trail: `√(${plain(shown)})` };
  return settled(state, Math.sqrt(shown), `√(${plain(shown)})`);
}

/* ------------------------------------------------------------------ *
 * The one entry point
 * ------------------------------------------------------------------ */

/**
 * Applies one press. While an error is displayed only Clear, Clear-entry and
 * Backspace are live — every other key is swallowed, which is exactly what a
 * locked display means.
 */
export function press(state: CalcState, key: CalcKey): CalcResult {
  if (key.kind === 'clear') return { state: START, committed: null };
  if (key.kind === 'clearEntry') return { state: { ...state, entry: null, value: 0, error: null }, committed: null };
  if (state.error !== null) return { state, committed: null };
  if (key.kind === 'back') return { state: backspace(state), committed: null };
  if (key.kind === 'digit') return { state: typeDigit(state, key.digit), committed: null };
  if (key.kind === 'dot') return { state: typeDot(state), committed: null };
  if (key.kind === 'binary') return { state: applyBinary(state, key.op), committed: null };
  if (key.kind === 'unary') return { state: applyUnary(state, key.op), committed: null };
  return applyEquals(state);
}

/**
 * The physical keyboard, as a table.
 *
 * Windows' own bindings, and a table rather than a ladder of comparisons because
 * the mapping is data: `*` and `x` both multiply, `Delete` is Clear-entry while
 * `Escape` is Clear, and the letters are the ones the on-screen keys name in their
 * tooltips. Digits are matched separately — ten more entries would say nothing.
 */
const KEYBOARD: Readonly<Record<string, CalcKey>> = {
  '.': { kind: 'dot' },
  ',': { kind: 'dot' },
  '+': { kind: 'binary', op: 'add' },
  '-': { kind: 'binary', op: 'sub' },
  '*': { kind: 'binary', op: 'mul' },
  x: { kind: 'binary', op: 'mul' },
  '/': { kind: 'binary', op: 'div' },
  Enter: { kind: 'equals' },
  '=': { kind: 'equals' },
  Backspace: { kind: 'back' },
  Escape: { kind: 'clear' },
  Delete: { kind: 'clearEntry' },
  '%': { kind: 'unary', op: 'percent' },
  r: { kind: 'unary', op: 'reciprocal' },
  q: { kind: 'unary', op: 'square' },
  F9: { kind: 'unary', op: 'negate' },
};

/** Physical keyboard to keypad press. `null` means "not ours — let it through". */
export function keyFor(key: string): CalcKey | null {
  if (/^[0-9]$/.test(key)) return { kind: 'digit', digit: key };
  // Single characters fold to lower case; named keys (`Enter`, `F9`) must not.
  const lookup = key.length === 1 ? key.toLowerCase() : key;
  return KEYBOARD[lookup] ?? null;
}
