/**
 * Sheets — math, statistics, logic, text and lookup.
 *
 * Fifty-odd functions with no `switch` in sight: each one is a `fn(signature, min,
 * max, call)` in a table the evaluator looks names up in, so arity is declared
 * once and checked once instead of being re-guarded in fifty bodies. A body only
 * has to say what the function *means*.
 *
 * Two things are deliberately missing. `RAND` and `RANDBETWEEN` are absent because
 * a workbook whose numbers differ between two openings cannot be reconciled, and
 * this OS is for books that must tie. `TEXT` is absent because number formatting
 * belongs to the cell, not to a formula that would bake one locale into the data.
 */
import {
  type Arg,
  BLANK,
  type CellValue,
  type FunctionTable,
  type SheetFunction,
  argAt,
  argInt,
  argNumber,
  argText,
  bool,
  cellAt,
  compare,
  err,
  first,
  firstError,
  flatten,
  fn,
  isValue,
  num,
  numbersOf,
  str,
  toBoolean,
  toText,
} from './values';

/** The shared body of every aggregate: collect numbers, or answer the error. */
const aggregate = (reduce: (values: readonly number[]) => number, empty: CellValue = num(0)): SheetFunction =>
  (args) => {
    const numbers = numbersOf(args);
    if (isValue(numbers)) return numbers;
    return numbers.length === 0 ? empty : num(reduce(numbers));
  };

/** One numeric argument in, one number out — `ABS`, `SQRT`, `LN` and friends. */
const unary = (apply: (value: number) => number): SheetFunction => (args) => {
  const value = argNumber(args, 0);
  return isValue(value) ? value : num(apply(value));
};

const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);
const mean = (values: readonly number[]): number => total(values) / values.length;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? high : (low + high) / 2;
}

/** Sample variance — the `n - 1` one, which is what `STDEV` means in Excel. */
const variance = (values: readonly number[], population: boolean): number => {
  const centre = mean(values);
  const squares = total(values.map((value) => (value - centre) ** 2));
  const divisor = population ? values.length : values.length - 1;
  return divisor <= 0 ? Number.NaN : squares / divisor;
};

/** Excel rounds half away from zero; JavaScript rounds half up. They differ at −0.5. */
function roundTo(value: number, digits: number, mode: 'half' | 'up' | 'down'): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const rounded =
    mode === 'up'
      ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
      : mode === 'down'
        ? Math.sign(scaled) * Math.floor(Math.abs(scaled))
        : Math.sign(scaled) * Math.round(Math.abs(scaled));
  return rounded / factor;
}

const rounding = (mode: 'half' | 'up' | 'down'): SheetFunction => (args) => {
  const value = argNumber(args, 0);
  if (isValue(value)) return value;
  const digits = args.length > 1 ? argInt(args, 1) : 0;
  if (isValue(digits)) return digits;
  return num(roundTo(value, digits, mode));
};

/**
 * A `SUMIF` criterion.
 *
 * `">100"`, `"<>"`, `"Paris"` and `"*ris"` are all one string as far as the sheet
 * is concerned, so the operator has to be peeled off the front before anything can
 * be compared, and a bare value means `=`. Wildcards are the two Excel has: `*`
 * for any run and `?` for one character.
 */
const OPERATOR = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/;

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '[\\s\\S]')}$`, 'i');
}

function matcher(criterion: CellValue): (value: CellValue) => boolean {
  if (criterion.kind !== 'text') {
    return (value) => {
      const order = compare(value, criterion);
      return typeof order === 'number' && order === 0;
    };
  }
  const match = OPERATOR.exec(criterion.value);
  const operator = match?.[1] ?? '=';
  const rest = (match?.[2] ?? '').trim();
  const parsed = Number(rest);
  const target: CellValue = rest === '' ? BLANK : Number.isFinite(parsed) ? num(parsed) : str(rest);

  if ((operator === '=' || operator === '<>') && target.kind === 'text' && /[*?]/.test(target.value)) {
    const expression = wildcard(target.value);
    return (value) => expression.test(toText(value)) === (operator === '=');
  }

  return (value) => {
    if (target.kind === 'blank') {
      const empty = value.kind === 'blank' || (value.kind === 'text' && value.value === '');
      return operator === '<>' ? !empty : empty;
    }
    const order = compare(value, target);
    if (typeof order !== 'number') return false;
    if (operator === '=') return order === 0;
    if (operator === '<>') return order !== 0;
    if (operator === '<') return order < 0;
    if (operator === '<=') return order <= 0;
    if (operator === '>') return order > 0;
    return order >= 0;
  };
}

/** `SUMIF`/`COUNTIF`/`AVERAGEIF` all walk one range against one criterion. */
function conditional(args: readonly Arg[], reduce: (picked: readonly number[]) => CellValue): CellValue {
  const range = argAt(args, 0);
  const problem = firstError(range.values);
  if (problem !== null) return problem;

  const test = matcher(first(args[1]));
  // `SUMIF(A1:A9, ">100", B1:B9)` sums the *third* range at the matching offsets.
  const source = args.length > 2 ? argAt(args, 2) : range;
  const picked: number[] = [];
  range.values.forEach((value, index) => {
    if (!test(value)) return;
    const target = source.values[index] ?? BLANK;
    if (target.kind === 'number') picked.push(target.value);
    else if (target.kind === 'boolean') picked.push(target.value ? 1 : 0);
  });
  return reduce(picked);
}

const MATH: FunctionTable = {
  SUM: fn('SUM(number1, [number2], …)', 1, Infinity, aggregate(total)),
  PRODUCT: fn('PRODUCT(number1, [number2], …)', 1, Infinity, aggregate((values) => values.reduce((a, b) => a * b, 1))),
  ABS: fn('ABS(number)', 1, 1, unary(Math.abs)),
  SIGN: fn('SIGN(number)', 1, 1, unary(Math.sign)),
  SQRT: fn('SQRT(number)', 1, 1, (args) => {
    const value = argNumber(args, 0);
    if (isValue(value)) return value;
    // The root of a negative is `#NUM!`, not `NaN` — a sheet has no NaN.
    return value < 0 ? err('#NUM!') : num(Math.sqrt(value));
  }),
  EXP: fn('EXP(number)', 1, 1, unary(Math.exp)),
  LN: fn('LN(number)', 1, 1, (args) => {
    const value = argNumber(args, 0);
    if (isValue(value)) return value;
    return value <= 0 ? err('#NUM!') : num(Math.log(value));
  }),
  LOG10: fn('LOG10(number)', 1, 1, (args) => {
    const value = argNumber(args, 0);
    if (isValue(value)) return value;
    return value <= 0 ? err('#NUM!') : num(Math.log10(value));
  }),
  LOG: fn('LOG(number, [base])', 1, 2, (args) => {
    const value = argNumber(args, 0);
    if (isValue(value)) return value;
    const base = args.length > 1 ? argNumber(args, 1) : 10;
    if (isValue(base)) return base;
    return value <= 0 || base <= 0 || base === 1 ? err('#NUM!') : num(Math.log(value) / Math.log(base));
  }),
  POWER: fn('POWER(number, power)', 2, 2, (args) => {
    const base = argNumber(args, 0);
    if (isValue(base)) return base;
    const exponent = argNumber(args, 1);
    if (isValue(exponent)) return exponent;
    return num(base ** exponent);
  }),
  MOD: fn('MOD(number, divisor)', 2, 2, (args) => {
    const value = argNumber(args, 0);
    if (isValue(value)) return value;
    const divisor = argNumber(args, 1);
    if (isValue(divisor)) return divisor;
    if (divisor === 0) return err('#DIV/0!');
    // Excel's MOD takes the sign of the divisor; `%` takes the dividend's.
    return num(value - divisor * Math.floor(value / divisor));
  }),
  INT: fn('INT(number)', 1, 1, unary(Math.floor)),
  TRUNC: fn('TRUNC(number, [digits])', 1, 2, rounding('down')),
  ROUND: fn('ROUND(number, [digits])', 1, 2, rounding('half')),
  ROUNDUP: fn('ROUNDUP(number, [digits])', 1, 2, rounding('up')),
  ROUNDDOWN: fn('ROUNDDOWN(number, [digits])', 1, 2, rounding('down')),
  CEILING: fn('CEILING(number, [significance])', 1, 2, (args) => {
    const value = argNumber(args, 0);
    if (isValue(value)) return value;
    const step = args.length > 1 ? argNumber(args, 1) : 1;
    if (isValue(step)) return step;
    return step === 0 ? num(0) : num(Math.ceil(value / step) * step);
  }),
  FLOOR: fn('FLOOR(number, [significance])', 1, 2, (args) => {
    const value = argNumber(args, 0);
    if (isValue(value)) return value;
    const step = args.length > 1 ? argNumber(args, 1) : 1;
    if (isValue(step)) return step;
    return step === 0 ? err('#DIV/0!') : num(Math.floor(value / step) * step);
  }),
  SUMPRODUCT: fn('SUMPRODUCT(range1, range2, …)', 1, Infinity, (args) => {
    const problem = firstError(flatten(args));
    if (problem !== null) return problem;
    const length = Math.max(...args.map((arg) => arg.values.length));
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      let product = 1;
      for (const arg of args) {
        const value = arg.values[index] ?? BLANK;
        product *= value.kind === 'number' ? value.value : value.kind === 'boolean' && value.value ? 1 : 0;
      }
      sum += product;
    }
    return num(sum);
  }),
  SUMIF: fn('SUMIF(range, criterion, [sum_range])', 2, 3, (args) =>
    conditional(args, (picked) => num(total(picked))),
  ),
};

/** The k-th value from either end, shared by `LARGE` and `SMALL`. */
const nth = (fromEnd: boolean): SheetFunction => (args) => {
  const numbers = numbersOf([argAt(args, 0)]);
  if (isValue(numbers)) return numbers;
  const k = argInt(args, 1);
  if (isValue(k)) return k;
  if (k < 1 || k > numbers.length) return err('#NUM!');
  const sorted = [...numbers].sort((a, b) => a - b);
  return num(sorted[fromEnd ? sorted.length - k : k - 1] ?? 0);
};

const STATS: FunctionTable = {
  AVERAGE: fn('AVERAGE(number1, [number2], …)', 1, Infinity, aggregate(mean, err('#DIV/0!'))),
  MEDIAN: fn('MEDIAN(number1, [number2], …)', 1, Infinity, aggregate(median, err('#NUM!'))),
  MIN: fn('MIN(number1, [number2], …)', 1, Infinity, aggregate((values) => Math.min(...values))),
  MAX: fn('MAX(number1, [number2], …)', 1, Infinity, aggregate((values) => Math.max(...values))),
  STDEV: fn('STDEV(number1, [number2], …)', 1, Infinity, aggregate((v) => Math.sqrt(variance(v, false)), err('#DIV/0!'))),
  STDEVP: fn('STDEVP(number1, [number2], …)', 1, Infinity, aggregate((v) => Math.sqrt(variance(v, true)), err('#DIV/0!'))),
  VAR: fn('VAR(number1, [number2], …)', 1, Infinity, aggregate((v) => variance(v, false), err('#DIV/0!'))),
  VARP: fn('VARP(number1, [number2], …)', 1, Infinity, aggregate((v) => variance(v, true), err('#DIV/0!'))),
  LARGE: fn('LARGE(range, k)', 2, 2, nth(true)),
  SMALL: fn('SMALL(range, k)', 2, 2, nth(false)),

  // `COUNT` counts numbers, `COUNTA` counts anything written, `COUNTBLANK` counts
  // what was never written. The three of them are how a person checks a column.
  COUNT: fn('COUNT(value1, [value2], …)', 1, Infinity, (args) => {
    const numbers = numbersOf(args);
    return isValue(numbers) ? num(0) : num(numbers.length);
  }),
  COUNTA: fn('COUNTA(value1, [value2], …)', 1, Infinity, (args) =>
    num(flatten(args).filter((value) => value.kind !== 'blank').length),
  ),
  COUNTBLANK: fn('COUNTBLANK(range)', 1, Infinity, (args) =>
    num(flatten(args).filter((value) => value.kind === 'blank' || (value.kind === 'text' && value.value === '')).length),
  ),
  COUNTIF: fn('COUNTIF(range, criterion)', 2, 2, (args) => {
    const range = argAt(args, 0);
    const test = matcher(first(args[1]));
    return num(range.values.filter((value) => value.kind !== 'error' && test(value)).length);
  }),
  AVERAGEIF: fn('AVERAGEIF(range, criterion, [average_range])', 2, 3, (args) =>
    conditional(args, (picked) => (picked.length === 0 ? err('#DIV/0!') : num(mean(picked)))),
  ),
};

/**
 * `AND`/`OR`/`XOR`.
 *
 * Text and blanks inside a *range* are ignored rather than refused, because
 * `AND(A1:A9)` over a column that has a header is a normal thing to write. A
 * scalar that cannot be a truth value is still `#VALUE!`.
 */
const truths = (args: readonly Arg[]): readonly boolean[] | CellValue => {
  const out: boolean[] = [];
  for (const arg of args) {
    for (const value of arg.values) {
      if (value.kind === 'error') return value;
      if (arg.range && (value.kind === 'blank' || value.kind === 'text')) continue;
      const flag = toBoolean(value);
      if (isValue(flag)) return flag;
      out.push(flag);
    }
  }
  return out;
};

const junction = (reduce: (flags: readonly boolean[]) => boolean): SheetFunction => (args) => {
  const flags = truths(args);
  if (isValue(flags)) return flags;
  return flags.length === 0 ? err('#VALUE!') : bool(reduce(flags));
};

const LOGIC: FunctionTable = {
  // Both branches are already evaluated by the time this runs, and that is safe:
  // an error in the branch not taken is a value nobody reads.
  IF: fn('IF(test, then, [else])', 2, 3, (args) => {
    const test = toBoolean(first(args[0]));
    if (isValue(test)) return test;
    if (test) return first(args[1]);
    return args.length > 2 ? first(args[2]) : bool(false);
  }),
  IFS: fn('IFS(test1, value1, [test2, value2], …)', 2, Infinity, (args) => {
    for (let index = 0; index + 1 < args.length; index += 2) {
      const test = toBoolean(first(args[index]));
      if (isValue(test)) return test;
      if (test) return first(args[index + 1]);
    }
    return err('#N/A');
  }),
  SWITCH: fn('SWITCH(value, case1, result1, …, [default])', 3, Infinity, (args) => {
    const subject = first(args[0]);
    if (subject.kind === 'error') return subject;
    let index = 1;
    for (; index + 1 < args.length; index += 2) {
      const order = compare(subject, first(args[index]));
      if (isValue(order)) return order;
      if (order === 0) return first(args[index + 1]);
    }
    // An odd tail is the default; an even one means no case matched.
    return index < args.length ? first(args[index]) : err('#N/A');
  }),
  IFERROR: fn('IFERROR(value, fallback)', 2, 2, (args) => {
    const value = first(args[0]);
    return value.kind === 'error' ? first(args[1]) : value;
  }),
  IFNA: fn('IFNA(value, fallback)', 2, 2, (args) => {
    const value = first(args[0]);
    return value.kind === 'error' && value.value === '#N/A' ? first(args[1]) : value;
  }),
  AND: fn('AND(test1, [test2], …)', 1, Infinity, junction((flags) => flags.every(Boolean))),
  OR: fn('OR(test1, [test2], …)', 1, Infinity, junction((flags) => flags.some(Boolean))),
  XOR: fn('XOR(test1, [test2], …)', 1, Infinity, junction((flags) => flags.filter(Boolean).length % 2 === 1)),
  NOT: fn('NOT(test)', 1, 1, (args) => {
    const flag = toBoolean(first(args[0]));
    return isValue(flag) ? flag : bool(!flag);
  }),
  TRUE: fn('TRUE()', 0, 0, () => bool(true)),
  FALSE: fn('FALSE()', 0, 0, () => bool(false)),
  NA: fn('NA()', 0, 0, () => err('#N/A')),
};

/** The `IS…` family, which is the only place an error is data to be inspected. */
const INFO: FunctionTable = {
  ISBLANK: fn('ISBLANK(value)', 1, 1, (args) => bool(first(args[0]).kind === 'blank')),
  ISNUMBER: fn('ISNUMBER(value)', 1, 1, (args) => bool(first(args[0]).kind === 'number')),
  ISTEXT: fn('ISTEXT(value)', 1, 1, (args) => bool(first(args[0]).kind === 'text')),
  ISNONTEXT: fn('ISNONTEXT(value)', 1, 1, (args) => bool(first(args[0]).kind !== 'text')),
  ISLOGICAL: fn('ISLOGICAL(value)', 1, 1, (args) => bool(first(args[0]).kind === 'boolean')),
  ISERROR: fn('ISERROR(value)', 1, 1, (args) => bool(first(args[0]).kind === 'error')),
  ISERR: fn('ISERR(value)', 1, 1, (args) => {
    const value = first(args[0]);
    return bool(value.kind === 'error' && value.value !== '#N/A');
  }),
  ISNA: fn('ISNA(value)', 1, 1, (args) => {
    const value = first(args[0]);
    return bool(value.kind === 'error' && value.value === '#N/A');
  }),
  ISEVEN: fn('ISEVEN(number)', 1, 1, (args) => {
    const value = argInt(args, 0);
    return isValue(value) ? value : bool(Math.abs(value) % 2 === 0);
  }),
  ISODD: fn('ISODD(number)', 1, 1, (args) => {
    const value = argInt(args, 0);
    return isValue(value) ? value : bool(Math.abs(value) % 2 === 1);
  }),
};

/** One text argument in, one string out — `UPPER`, `TRIM` and the rest. */
const rewrite = (apply: (value: string) => string): SheetFunction => (args) => {
  const value = argText(args, 0);
  return isValue(value) ? value : str(apply(value));
};

/** `LEFT`/`RIGHT` differ only in which end they count from. */
const edge = (fromEnd: boolean): SheetFunction => (args) => {
  const value = argText(args, 0);
  if (isValue(value)) return value;
  const count = args.length > 1 ? argInt(args, 1) : 1;
  if (isValue(count)) return count;
  if (count < 0) return err('#VALUE!');
  return str(fromEnd ? value.slice(value.length - Math.min(count, value.length)) : value.slice(0, count));
};

/** `FIND` is case-sensitive and `SEARCH` is not; both are 1-based. */
const locate = (fold: boolean): SheetFunction => (args) => {
  const needle = argText(args, 0);
  if (isValue(needle)) return needle;
  const haystack = argText(args, 1);
  if (isValue(haystack)) return haystack;
  const from = args.length > 2 ? argInt(args, 2) : 1;
  if (isValue(from)) return from;
  if (from < 1) return err('#VALUE!');
  const subject = fold ? haystack.toLowerCase() : haystack;
  const at = subject.indexOf(fold ? needle.toLowerCase() : needle, from - 1);
  return at < 0 ? err('#VALUE!') : num(at + 1);
};

const TEXT: FunctionTable = {
  CONCAT: fn('CONCAT(text1, [text2], …)', 1, Infinity, (args) => {
    const problem = firstError(flatten(args));
    return problem ?? str(flatten(args).map(toText).join(''));
  }),
  CONCATENATE: fn('CONCATENATE(text1, [text2], …)', 1, Infinity, (args) => {
    const problem = firstError(flatten(args));
    return problem ?? str(flatten(args).map(toText).join(''));
  }),
  TEXTJOIN: fn('TEXTJOIN(separator, ignore_empty, text1, …)', 3, Infinity, (args) => {
    const separator = argText(args, 0);
    if (isValue(separator)) return separator;
    const skip = toBoolean(first(args[1]));
    if (isValue(skip)) return skip;
    const rest = args.slice(2);
    const problem = firstError(flatten(rest));
    if (problem !== null) return problem;
    const parts = flatten(rest)
      .map(toText)
      .filter((part) => !skip || part !== '');
    return str(parts.join(separator));
  }),
  LEN: fn('LEN(text)', 1, 1, (args) => {
    const value = argText(args, 0);
    return isValue(value) ? value : num(value.length);
  }),
  LEFT: fn('LEFT(text, [count])', 1, 2, edge(false)),
  RIGHT: fn('RIGHT(text, [count])', 1, 2, edge(true)),
  MID: fn('MID(text, start, count)', 3, 3, (args) => {
    const value = argText(args, 0);
    if (isValue(value)) return value;
    const start = argInt(args, 1);
    if (isValue(start)) return start;
    const count = argInt(args, 2);
    if (isValue(count)) return count;
    if (start < 1 || count < 0) return err('#VALUE!');
    return str(value.slice(start - 1, start - 1 + count));
  }),
  UPPER: fn('UPPER(text)', 1, 1, rewrite((value) => value.toUpperCase())),
  LOWER: fn('LOWER(text)', 1, 1, rewrite((value) => value.toLowerCase())),
  PROPER: fn(
    'PROPER(text)',
    1,
    1,
    rewrite((value) => value.replace(/\p{L}+/gu, (word) => (word[0] ?? '').toUpperCase() + word.slice(1).toLowerCase())),
  ),
  TRIM: fn('TRIM(text)', 1, 1, rewrite((value) => value.trim().replace(/\s+/g, ' '))),
  REPT: fn('REPT(text, count)', 2, 2, (args) => {
    const value = argText(args, 0);
    if (isValue(value)) return value;
    const count = argInt(args, 1);
    if (isValue(count)) return count;
    // A repeat wide enough to be a denial of service is refused, not truncated.
    if (count < 0 || value.length * count > 32_767) return err('#VALUE!');
    return str(value.repeat(count));
  }),
  FIND: fn('FIND(needle, text, [start])', 2, 3, locate(false)),
  SEARCH: fn('SEARCH(needle, text, [start])', 2, 3, locate(true)),
  SUBSTITUTE: fn('SUBSTITUTE(text, old, new)', 3, 3, (args) => {
    const value = argText(args, 0);
    if (isValue(value)) return value;
    const target = argText(args, 1);
    if (isValue(target)) return target;
    const replacement = argText(args, 2);
    if (isValue(replacement)) return replacement;
    return str(target === '' ? value : value.split(target).join(replacement));
  }),
  REPLACE: fn('REPLACE(text, start, count, new)', 4, 4, (args) => {
    const value = argText(args, 0);
    if (isValue(value)) return value;
    const start = argInt(args, 1);
    if (isValue(start)) return start;
    const count = argInt(args, 2);
    if (isValue(count)) return count;
    const replacement = argText(args, 3);
    if (isValue(replacement)) return replacement;
    if (start < 1 || count < 0) return err('#VALUE!');
    return str(value.slice(0, start - 1) + replacement + value.slice(start - 1 + count));
  }),
  EXACT: fn('EXACT(text1, text2)', 2, 2, (args) => {
    const left = argText(args, 0);
    if (isValue(left)) return left;
    const right = argText(args, 1);
    return isValue(right) ? right : bool(left === right);
  }),
  VALUE: fn('VALUE(text)', 1, 1, (args) => {
    const value = argNumber(args, 0);
    return isValue(value) ? value : num(value);
  }),
  CHAR: fn('CHAR(code)', 1, 1, (args) => {
    const code = argInt(args, 0);
    if (isValue(code)) return code;
    return code < 1 || code > 0x10_ff_ff ? err('#VALUE!') : str(String.fromCodePoint(code));
  }),
  CODE: fn('CODE(text)', 1, 1, (args) => {
    const value = argText(args, 0);
    if (isValue(value)) return value;
    return value === '' ? err('#VALUE!') : num(value.codePointAt(0) ?? 0);
  }),
};

/**
 * The index of `key` in one line of cells.
 *
 * `mode` is Excel's `MATCH` third argument: `0` is exact, `1` wants an ascending
 * line and takes the largest value not above the key, `-1` wants a descending one
 * and takes the smallest not below. The approximate modes are what make a rate
 * table work, and the reason a mis-sorted table lies rather than fails.
 */
function indexOfKey(key: CellValue, line: readonly CellValue[], mode: number): number {
  if (mode === 0) {
    const test = matcher(key);
    return line.findIndex((value) => value.kind !== 'error' && test(value));
  }
  let best = -1;
  for (let index = 0; index < line.length; index += 1) {
    const value = line[index] ?? BLANK;
    if (value.kind === 'blank' || value.kind === 'error') continue;
    const order = compare(value, key);
    if (typeof order !== 'number') continue;
    if (mode > 0 ? order <= 0 : order >= 0) best = index;
    else break;
  }
  return best;
}

const column = (arg: Arg, index: number): readonly CellValue[] =>
  Array.from({ length: arg.height }, (_unused, row) => cellAt(arg, row, index));

const row = (arg: Arg, index: number): readonly CellValue[] =>
  Array.from({ length: arg.width }, (_unused, col) => cellAt(arg, index, col));

/** `VLOOKUP` and `HLOOKUP` are the same search along different axes. */
const tableLookup = (vertical: boolean): SheetFunction => (args) => {
  const key = first(args[0]);
  if (key.kind === 'error') return key;
  const table = argAt(args, 1);
  const offset = argInt(args, 2);
  if (isValue(offset)) return offset;
  // Excel's fourth argument defaults to TRUE — an approximate match on a table
  // nobody sorted. It is kept because a sheet that disagrees with Excel here is
  // worse than one that inherits the surprise.
  const approximate = args.length > 3 ? toBoolean(first(args[3])) : true;
  if (isValue(approximate)) return approximate;

  const span = vertical ? table.width : table.height;
  if (offset < 1 || offset > span) return err('#REF!');
  const line = vertical ? column(table, 0) : row(table, 0);
  const at = indexOfKey(key, line, approximate ? 1 : 0);
  if (at < 0) return err('#N/A');
  return vertical ? cellAt(table, at, offset - 1) : cellAt(table, offset - 1, at);
};

const LOOKUP: FunctionTable = {
  VLOOKUP: fn('VLOOKUP(key, table, column, [approximate])', 3, 4, tableLookup(true)),
  HLOOKUP: fn('HLOOKUP(key, table, row, [approximate])', 3, 4, tableLookup(false)),
  MATCH: fn('MATCH(key, range, [mode])', 2, 3, (args) => {
    const key = first(args[0]);
    if (key.kind === 'error') return key;
    const mode = args.length > 2 ? argInt(args, 2) : 1;
    if (isValue(mode)) return mode;
    const at = indexOfKey(key, argAt(args, 1).values, mode);
    return at < 0 ? err('#N/A') : num(at + 1);
  }),
  INDEX: fn('INDEX(range, row, [column])', 2, 3, (args) => {
    const range = argAt(args, 0);
    const one = argInt(args, 1);
    if (isValue(one)) return one;
    if (args.length > 2) {
      const two = argInt(args, 2);
      if (isValue(two)) return two;
      return cellAt(range, one - 1, two - 1);
    }
    // With one index a line is walked along its length, whichever way it runs.
    if (range.height === 1) return cellAt(range, 0, one - 1);
    if (range.width === 1) return cellAt(range, one - 1, 0);
    return err('#REF!');
  }),
  XLOOKUP: fn('XLOOKUP(key, lookup_range, result_range, [if_not_found])', 3, 4, (args) => {
    const key = first(args[0]);
    if (key.kind === 'error') return key;
    const at = indexOfKey(key, argAt(args, 1).values, 0);
    if (at < 0) return args.length > 3 ? first(args[3]) : err('#N/A');
    return argAt(args, 2).values[at] ?? err('#REF!');
  }),
  CHOOSE: fn('CHOOSE(index, value1, [value2], …)', 2, Infinity, (args) => {
    const index = argInt(args, 0);
    if (isValue(index)) return index;
    return index < 1 || index >= args.length ? err('#VALUE!') : first(args[index]);
  }),
  ROWS: fn('ROWS(range)', 1, 1, (args) => num(argAt(args, 0).height)),
  COLUMNS: fn('COLUMNS(range)', 1, 1, (args) => num(argAt(args, 0).width)),
};

/** Everything in this file, in one table the evaluator can look a name up in. */
export const BASE_FUNCTIONS: FunctionTable = { ...MATH, ...STATS, ...LOGIC, ...INFO, ...TEXT, ...LOOKUP };






