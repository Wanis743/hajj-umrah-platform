/**
 * The thing that actually runs.
 *
 * ./expression parses one formula, ./evaluate computes one formula in one period, ./graph decides
 * what order formulas go in and ./scenario decides what the assumptions are worth. This file is
 * where those four become a model: a set of rows, a horizon, and one number per row per period.
 *
 * The one decision in here that matters is the order of the two loops. A spreadsheet is computed
 * period-major — you fill in a column, then the next — and that is why `sum()` in a spreadsheet
 * is a range over cells that already exist rather than a function of a row. Do the same thing
 * here and `sum(revenue)` in the first period would sum one number and call it a total, silently,
 * every time.
 *
 * So this is computed row-major: every period of a row, then the next row, in the graph's order.
 * That order guarantees a row's same-period reads are already finished — all of them, in every
 * period — which is what lets `sum(x)` and `npv(r, x)` mean the whole series and not the part of
 * it that happens to have been filled in. A row's own lagged reads are safe for the same reason
 * from the other direction: `prior(cash)` at period 4 reads period 3 of the row being computed,
 * and the inner loop finished it a moment ago.
 *
 * Nothing here refuses arithmetic. The refusals are all structural and all happen before the
 * first multiplication: a key that is not an identifier, a key defined twice, a formula that does
 * not parse, a name nothing defines, a cycle, a scenario that does not resolve. Once past those,
 * every cell produces a finite number, because ./evaluate's post-condition says so.
 */
import { isValidKey, parseFormula, referencesOf } from './expression';
import type { Node, ParseError, Refs } from './expression';
import { evaluate } from './evaluate';
import type { EvalContext, EvalNote } from './evaluate';
import { buildGraph } from './graph';
import type { GraphIssue, ModelGraph } from './graph';
import { resolveScenario } from './scenario';
import type { Assumption, AssumptionUnit, Resolution, Scenario, ScenarioIssue } from './scenario';

/**
 * One line of the model.
 *
 * `formula` is the whole distinction between a row the model computes and a row it is told. Null
 * means told, and then `given` is read; a string means computed, and then `given` is ignored
 * rather than used as a fallback — a row that has both is a row whose author changed their mind
 * and did not finish, and quietly preferring one would hide that.
 */
export interface ModelRow {
  readonly key: string;
  readonly label: string;
  readonly unit: AssumptionUnit;
  /** Formula source, in ./expression's language. Null for a row whose numbers are given. */
  readonly formula: string | null;
  /**
   * Values for a given row, earliest period first.
   *
   * Shorter than the horizon is allowed and means held flat at the last value — the ordinary
   * shape of a model with three months of actuals and nine of forecast. Which rows were held,
   * and from which period, is reported in `ModelRun.held` rather than left for the reader to
   * infer from a suspiciously straight line.
   */
  readonly given: readonly number[];
}

export interface ModelSpec {
  /** Period labels, earliest first. The length is the horizon; there is no separate count to
   *  disagree with it. */
  readonly periods: readonly string[];
  readonly rows: readonly ModelRow[];
  readonly assumptions: readonly Assumption[];
  readonly scenarios: readonly Scenario[];
}

export type SpecIssueKind =
  /** A key that is not an identifier, so no formula could ever read it. */
  | 'BAD_KEY'
  /** One key claimed by two rows, or by a row and an assumption. */
  | 'DUPLICATE_KEY'
  /** No periods. A model with no horizon has nothing to compute, and returning an empty run
   *  would let a screen render a model that does not exist. */
  | 'NO_PERIODS';

export interface SpecIssue {
  readonly kind: SpecIssueKind;
  readonly where: string;
}

/** A formula that did not parse, and which row's it was. ./expression's error already carries
 *  the position and the reason; this adds the only thing it cannot know. */
export interface FormulaIssue {
  readonly key: string;
  readonly error: ParseError;
}

/** A note from ./evaluate, pinned to the cell that produced it. Notes are per-cell because
 *  that is where they are shown, and because a DIV_ZERO in one period of twelve is a different
 *  fact about a model than a DIV_ZERO in all of them. */
export interface CellNote {
  readonly key: string;
  /** Index into `ModelSpec.periods`. */
  readonly period: number;
  readonly note: EvalNote;
}

/** A given row whose values ran out before the horizon did. */
export interface HeldRow {
  readonly key: string;
  /** The first period that repeats rather than states a value. */
  readonly from: number;
  readonly value: number;
}

export interface ModelRun {
  readonly periods: readonly string[];
  /** Every row, computed and given alike, one value per period. Assumptions appear here too,
   *  flat across the horizon, so a screen can chart an assumption beside the rows it drives
   *  without knowing which kind of thing it is. */
  readonly series: ReadonlyMap<string, readonly number[]>;
  readonly notes: readonly CellNote[];
  readonly held: readonly HeldRow[];
  /** Kept because everything downstream needs it: ./sensitivity walks `dependents`, ./drivers
   *  walks `depth`, and ./version hashes `order`. */
  readonly graph: ModelGraph;
  /** What the scenario alone says the assumptions are worth, with its chain and its own
   *  out-of-range warnings. Not necessarily what this run used — see `values`. */
  readonly resolution: Resolution;
  /** The assumption values this run actually used: the scenario's, with any probe applied. */
  readonly values: ReadonlyMap<string, number>;
  /** What a caller moved on top of the scenario, and by how much. Empty for an ordinary run.
   *  Present so that a run can never be mistaken for the scenario's own answer when it is
   *  actually the ninth step of somebody's sweep. */
  readonly probe: ReadonlyMap<string, number>;
}

/**
 * Why there is no run.
 *
 * Staged rather than merged into one list, and reported one stage at a time, because the stages
 * are causally ordered: a formula that does not parse has no references, so it cannot be checked
 * for missing names, so reporting graph issues alongside parse errors would report the absence
 * of names that a syntax error simply hid.
 */
export type ModelFailure =
  | { readonly stage: 'SPEC'; readonly issues: readonly SpecIssue[] }
  | { readonly stage: 'PARSE'; readonly issues: readonly FormulaIssue[] }
  | { readonly stage: 'GRAPH'; readonly issues: readonly GraphIssue[] }
  | { readonly stage: 'SCENARIO'; readonly issues: readonly ScenarioIssue[] };

export type ModelResult =
  | { readonly ok: true; readonly run: ModelRun }
  | { readonly ok: false; readonly failure: ModelFailure };

/**
 * A model whose structure has been settled: formulas parsed, names resolved, order decided.
 *
 * Kept as a value because the structure is the expensive part and the part that does not change
 * when an assumption does. ./sensitivity runs a model forty times to draw one tornado and ./monte
 * runs it ten thousand times; re-lexing every formula and re-sorting the graph on each pass would
 * make both of them slow for no reason, and would mean a sweep could in principle report a parse
 * error halfway through — a structural failure discovered on step nine of twenty.
 */
export interface CompiledModel {
  readonly spec: ModelSpec;
  readonly asts: ReadonlyMap<string, Node>;
  readonly graph: ModelGraph;
}

export type CompileResult =
  | { readonly ok: true; readonly model: CompiledModel }
  | { readonly ok: false; readonly failure: ModelFailure };

/** The three structural gates. Everything they pass is a model that will run for every scenario
 *  it has, so a caller that compiles once can treat later failures as scenario problems only. */
export function compileModel(spec: ModelSpec): CompileResult {
  const structure = checkSpec(spec);
  if (structure.length > 0) return { ok: false, failure: { stage: 'SPEC', issues: structure } };

  const parsed = parseAll(spec.rows);
  if (parsed.kind === 'ISSUES') {
    return { ok: false, failure: { stage: 'PARSE', issues: parsed.issues } };
  }

  const built = buildGraph({ formulas: refsOf(parsed.asts), inputs: givenKeys(spec) });
  if (!built.ok) return { ok: false, failure: { stage: 'GRAPH', issues: built.issues } };

  return { ok: true, model: { spec, asts: parsed.asts, graph: built.graph } };
}

/**
 * One compiled model, one scenario, one grid of numbers.
 *
 * `probe` is how a caller asks "and what if this assumption were that instead" without inventing
 * a scenario to hold the question. It sits on top of the resolved values rather than inside the
 * inheritance chain, which is the honest place for it: a sweep step is not a thing anybody saved,
 * and a `Resolution` that reported it as an override would attribute somebody's exploratory
 * keystroke to a named scenario.
 *
 * A probe on a key no assumption declares is refused, for the same reason ./scenario refuses the
 * same thing: a sweep over a misspelled key would report a flat line and call it insensitivity.
 */
export function runCompiled(
  model: CompiledModel,
  scenarioId: string,
  probe: ReadonlyMap<string, number> = new Map(),
): ModelResult {
  const scenario = resolveScenario(model.spec.scenarios, scenarioId, model.spec.assumptions);
  if (!scenario.ok) return { ok: false, failure: { stage: 'SCENARIO', issues: scenario.issues } };

  const values = new Map(scenario.resolution.values);
  const undeclared: ScenarioIssue[] = [];
  for (const key of [...probe.keys()].sort()) {
    const value = probe.get(key);
    if (value === undefined) continue;
    if (!values.has(key)) undeclared.push({ kind: 'UNDECLARED', where: key, path: [] });
    else values.set(key, value);
  }
  if (undeclared.length > 0) {
    return { ok: false, failure: { stage: 'SCENARIO', issues: undeclared } };
  }

  return { ok: true, run: compute(model, values, scenario.resolution, probe) };
}

/** Compile and run, for the ordinary case of asking one question once. */
export function runModel(spec: ModelSpec, scenarioId: string): ModelResult {
  const compiled = compileModel(spec);
  if (!compiled.ok) return { ok: false, failure: compiled.failure };
  return runCompiled(compiled.model, scenarioId);
}

/* ------------------------------------------------------------------- gates ---- */

/**
 * Keys and horizon.
 *
 * Reported in the spec's own order rather than sorted, because these are the issues a reader
 * fixes by looking at a list of rows on a screen, and that list is in this order.
 *
 * Assumptions are walked before rows so that a collision between the two is reported against the
 * row. An assumption is the older, more shared thing — it is what other scenarios override — and
 * the row is what somebody just added.
 */
function checkSpec(spec: ModelSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (spec.periods.length === 0) issues.push({ kind: 'NO_PERIODS', where: '' });

  const seen = new Set<string>();
  for (const key of [...spec.assumptions.map((one) => one.key), ...spec.rows.map((one) => one.key)]) {
    if (!isValidKey(key)) {
      issues.push({ kind: 'BAD_KEY', where: key });
      continue;
    }
    if (seen.has(key)) issues.push({ kind: 'DUPLICATE_KEY', where: key });
    seen.add(key);
  }
  return issues;
}

type ParseOutcome =
  | { readonly kind: 'ASTS'; readonly asts: ReadonlyMap<string, Node> }
  | { readonly kind: 'ISSUES'; readonly issues: readonly FormulaIssue[] };

/** Every formula in the model, or every reason there isn't one. Rows in spec order, for the
 *  same reason `checkSpec` uses it. */
function parseAll(rows: readonly ModelRow[]): ParseOutcome {
  const asts = new Map<string, Node>();
  const issues: FormulaIssue[] = [];
  for (const row of rows) {
    if (row.formula === null) continue;
    const parsed = parseFormula(row.formula);
    if (parsed.ok) asts.set(row.key, parsed.ast);
    else issues.push({ key: row.key, error: parsed.error });
  }
  return issues.length > 0 ? { kind: 'ISSUES', issues } : { kind: 'ASTS', asts };
}

/** What each formula reads, taken from the tree rather than from the source, so that a caller
 *  cannot describe a dependency the formula does not actually have. */
function refsOf(asts: ReadonlyMap<string, Node>): ReadonlyMap<string, Refs> {
  const refs = new Map<string, Refs>();
  for (const [key, ast] of asts) refs.set(key, referencesOf(ast));
  return refs;
}

/** Everything with a value rather than a formula: assumptions, and rows whose numbers are
 *  given. ./graph does not distinguish them, and does not need to — both are leaves. */
function givenKeys(spec: ModelSpec): ReadonlySet<string> {
  const keys = new Set<string>(spec.assumptions.map((one) => one.key));
  for (const row of spec.rows) if (row.formula === null) keys.add(row.key);
  return keys;
}

/* --------------------------------------------------------------- arithmetic ---- */

/** Somewhere for the two side facts to land while the grid is being filled in, so that
 *  `compute` and `givenSeries` can both report without either returning a pair. */
interface Sink {
  readonly notes: CellNote[];
  readonly held: HeldRow[];
}

/**
 * Row-major, in the graph's order: every period of one row, then the next row.
 *
 * The header argues the order; this is what it buys. When a formula runs, every key it reads in
 * the same period is a row already finished across the whole horizon, so `value`, `prior` and
 * `series` are all reads of settled numbers and none of them can see a half-filled row. The one
 * apparent exception is a row reading itself, and it is not an exception: `prior(cash)` reads
 * periods the inner loop already did, and `cash` in its own period is a cycle ./graph refused
 * before this function was called.
 */
function compute(
  model: CompiledModel,
  values: ReadonlyMap<string, number>,
  resolution: Resolution,
  probe: ReadonlyMap<string, number>,
): ModelRun {
  const { spec, asts, graph } = model;
  const span = spec.periods.length;
  const rows = new Map(spec.rows.map((one) => [one.key, one]));
  const series = new Map<string, readonly number[]>();
  const sink: Sink = { notes: [], held: [] };

  for (const key of graph.order) {
    const ast = asts.get(key);
    if (ast === undefined) {
      series.set(key, givenSeries(key, rows.get(key), values, span, sink));
      continue;
    }
    const line: number[] = [];
    // Published before the loop, not after, so that `prior(self)` can read the periods this
    // loop has already finished. Every other read is of a row that is wholly done.
    series.set(key, line);
    for (let period = 0; period < span; period += 1) {
      const cell = evaluate(ast, contextAt(series, period));
      line.push(cell.value);
      for (const note of cell.notes) sink.notes.push({ key, period, note });
    }
  }

  return {
    periods: spec.periods,
    series,
    notes: sink.notes,
    held: sink.held,
    graph,
    resolution,
    values,
    probe,
  };
}

/** ./evaluate's three reads, bound to one period. */
function contextAt(series: ReadonlyMap<string, readonly number[]>, period: number): EvalContext {
  return {
    value: (key) => at(series.get(key), period),
    prior: (key, back) => at(series.get(key), period - back),
    series: (key) => series.get(key),
  };
}

/**
 * Indexing, with the bounds check written out.
 *
 * `noUncheckedIndexedAccess` is off in this project, so `line[7]` on a three-element array is
 * typed `number` and is `undefined` at runtime. The compiler will not ask for this guard, and
 * the three reads above are exactly where a missing one would hand an undefined to ./evaluate,
 * which would add it to something and produce a `NaN` two files from the mistake. Written once,
 * here, rather than trusted three times.
 */
function at(line: readonly number[] | undefined, index: number): number | undefined {
  if (line === undefined || index < 0 || index >= line.length) return undefined;
  return line[index];
}

const flat = (span: number, value: number): number[] => new Array<number>(span).fill(value);

/**
 * A row the model is told rather than computes.
 *
 * Assumptions first, because an assumption is a scalar and a scalar has no short series to hold
 * flat — it is the same number in every period by definition, and the resolved values have
 * already decided which number. A key that were both an assumption and a row would make that
 * order a silent precedence rule, which is why `checkSpec` refuses one.
 *
 * Non-finite values are the one thing checked here. ./evaluate guarantees finite for everything
 * it computes, but a given row never goes through it, so an `Infinity` that arrived from storage
 * would otherwise be the one number in the model with no note against it.
 */
function givenSeries(
  key: string,
  row: ModelRow | undefined,
  values: ReadonlyMap<string, number>,
  span: number,
  sink: Sink,
): readonly number[] {
  const scalar = values.get(key);
  if (scalar !== undefined) {
    if (Number.isFinite(scalar)) return flat(span, scalar);
    sink.notes.push({ key, period: 0, note: { code: 'NOT_FINITE', where: key } });
    return flat(span, 0);
  }

  const given = row === undefined ? [] : row.given;
  const line: number[] = [];
  let last = 0;
  for (let period = 0; period < span; period += 1) {
    const value = at(given, period);
    if (value === undefined) {
      // Recorded once, at the first period that repeats. A row with no values at all is held at
      // zero from the first period, which is worth saying rather than drawing.
      if (period === given.length) sink.held.push({ key, from: period, value: last });
      line.push(last);
      continue;
    }
    if (!Number.isFinite(value)) {
      sink.notes.push({ key, period, note: { code: 'NOT_FINITE', where: key } });
      last = 0;
    } else {
      last = value;
    }
    line.push(last);
  }
  return line;
}
