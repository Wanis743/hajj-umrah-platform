/**
 * What moving one number does to another.
 *
 * Three questions, and they are not the same question asked at three sizes. A sweep asks how one
 * output responds across one input's whole plausible range, and its answer is a shape — linear,
 * kinked, saturating. A tornado asks which inputs matter at all, and its answer is an ordering.
 * A two-way matrix asks whether two inputs interact, and its answer is whether the rows of the
 * grid are parallel or not. A model that can only do the first has to be swept twenty times by
 * hand to answer the second, and nobody does that, which is why spreadsheets are full of
 * assumptions nobody has ever tested.
 *
 * Every answer here is the model run again, not a derivative estimated from one run. That is
 * slower and it is the only honest choice: a planning model is full of `min`, `max`, `clamp` and
 * `if`, so its response to an input is piecewise and a slope measured at the base point says
 * nothing about the range. The kink is usually the interesting part — it is where a covenant
 * binds or a discount tier changes — and a linear approximation is precisely the thing that
 * cannot see it.
 *
 * The range swept is the assumption's own declared `low`..`high`, never a blanket ±10%. An
 * assumption whose plausible range somebody wrote down is being stressed the way they meant; an
 * assumption without one is reported as unswept rather than stressed by a number this file
 * invented. ./certify has an opinion about how many of those a model is allowed.
 */
import { runCompiled } from './model';
import type { CompiledModel, ModelFailure, ModelRun } from './model';
import type { Assumption } from './scenario';

/**
 * Which number an answer is about.
 *
 * A sensitivity result is one number per run, and a model produces a grid, so something has to
 * say which cell. Three kinds, because the three are what people actually ask: a period (`AT`,
 * "EBITDA in month nine"), the whole horizon (`TOTAL`, "cash generated over the plan"), and the
 * end state (`FINAL`, "closing balance"). `FINAL` is not `AT` the last period as far as a caller
 * is concerned: a horizon that grows should not silently keep measuring month nine.
 */
export type TargetKind = 'AT' | 'TOTAL' | 'FINAL';

export interface Target {
  readonly key: string;
  readonly kind: TargetKind;
  /** Period index, for `AT`. Ignored by the other two. */
  readonly period: number;
}

export type SensitivityIssueKind =
  /** The target names a row the run has no series for. */
  | 'NO_TARGET'
  /** The key swept is not a declared assumption. */
  | 'NOT_DECLARED'
  /** A declared assumption with no `low`, no `high`, or neither. Nothing to sweep between. */
  | 'NO_RANGE'
  /** `low` equals `high`. A range of zero width is not a stress test, and stepping it would
   *  produce N identical points and a tornado bar of length zero that looks measured. */
  | 'EMPTY_RANGE'
  /** Fewer than two steps. One point is a value, not a response. */
  | 'BAD_STEPS'
  /** The model itself did not run. Carries the failure, because a sweep that failed because a
   *  formula does not parse is not a sensitivity finding. */
  | 'RUN_FAILED';

export interface SensitivityIssue {
  readonly kind: SensitivityIssueKind;
  readonly where: string;
  /** Only for RUN_FAILED; null otherwise. */
  readonly failure: ModelFailure | null;
}

/** One point of a sweep: the input value tried, and what the target came to. */
export interface SweepPoint {
  readonly value: number;
  readonly result: number;
}

export interface Sweep {
  readonly key: string;
  readonly label: string;
  readonly target: Target;
  /** The assumption's value under the scenario, and the target there. The base is kept beside
   *  the points because a sweep without it cannot say whether the plan sits in the middle of
   *  its own plausible range or at one edge of it — which is often the finding. */
  readonly base: number;
  readonly baseResult: number;
  /** Ascending by input value, `low` first and `high` last, both exact. */
  readonly points: readonly SweepPoint[];
}

/**
 * One assumption's contribution to a tornado.
 *
 * `atLow` and `atHigh` are kept unsorted and unsigned-corrected, because which end of the input
 * range produces the larger output is the whole content of "this driver is inverse". A bar that
 * reported only a magnitude would lose the fact that cutting the discount rate raises the
 * valuation, and that fact is the reason anybody looks.
 */
export interface TornadoBar {
  readonly key: string;
  readonly label: string;
  readonly low: number;
  readonly high: number;
  readonly atLow: number;
  readonly atHigh: number;
  /** `|atHigh − atLow|`. What the bars are ordered by. */
  readonly swing: number;
  /**
   * Proportional response: percent change in the target per percent change in the input.
   *
   * Null when it has no meaning — a base input of zero, a base result of zero. Worth having
   * beside `swing` because the two disagree usefully: a big swing on an input that moves across
   * two orders of magnitude is less of a finding than a small swing on one that barely moves,
   * and a tornado ranked only by swing puts the loudest assumption on top rather than the most
   * leveraged one.
   */
  readonly elasticity: number | null;
}

export interface Tornado {
  readonly target: Target;
  readonly baseResult: number;
  /** Widest swing first; ties broken by key, so one model gives one tornado. */
  readonly bars: readonly TornadoBar[];
  /** Assumptions that could not be swept, sorted. Reported rather than dropped: a tornado that
   *  silently omitted them reads as "these six drivers matter" when the truth is "six of the
   *  nine were asked, and three have no range for anyone to test". */
  readonly unranged: readonly string[];
}

export interface Matrix {
  readonly target: Target;
  readonly rowKey: string;
  readonly colKey: string;
  readonly rowValues: readonly number[];
  readonly colValues: readonly number[];
  /** `cells[row][col]`, with `rowKey` at `rowValues[row]` and `colKey` at `colValues[col]`. */
  readonly cells: readonly (readonly number[])[];
  readonly baseResult: number;
}

export type SensitivityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SensitivityIssue[] };

/* ------------------------------------------------------------- measurement ---- */

/**
 * One number out of one run.
 *
 * Undefined rather than zero for a target the run has no series for. Zero is a legitimate answer
 * — a flat sweep at zero is a real finding about a row that does not respond — so a missing row
 * that returned zero would be indistinguishable from a real insensitivity, which is the one
 * mistake this file exists to avoid making.
 */
export function measureRun(run: ModelRun, target: Target): number | undefined {
  const line = run.series.get(target.key);
  if (line === undefined || line.length === 0) return undefined;
  if (target.kind === 'TOTAL') {
    let total = 0;
    for (const value of line) total += value;
    return total;
  }
  if (target.kind === 'FINAL') return line[line.length - 1];
  if (target.period < 0 || target.period >= line.length) return undefined;
  return line[target.period];
}

const issue = (
  kind: SensitivityIssueKind,
  where: string,
  failure: ModelFailure | null = null,
): SensitivityIssue => ({ kind, where, failure });

type Measured =
  | { readonly ok: true; readonly result: number }
  | { readonly ok: false; readonly issue: SensitivityIssue };

/**
 * Run the model with the probe applied and measure the target.
 *
 * The one funnel every point in this file goes through, so that a failed run and a missing target
 * are reported the same way whether they happen on step one of a sweep or cell 40 of a matrix.
 */
function measure(
  model: CompiledModel,
  scenarioId: string,
  probe: ReadonlyMap<string, number>,
  target: Target,
): Measured {
  const run = runCompiled(model, scenarioId, probe);
  if (!run.ok) return { ok: false, issue: issue('RUN_FAILED', scenarioId, run.failure) };
  const result = measureRun(run.run, target);
  if (result === undefined) return { ok: false, issue: issue('NO_TARGET', target.key) };
  return { ok: true, result };
}

/** The assumption's own registry entry, which is where its range lives. */
function declared(model: CompiledModel, key: string): Assumption | undefined {
  return model.spec.assumptions.find((one) => one.key === key);
}

type Ranged = { readonly low: number; readonly high: number };

/**
 * The range to sweep, or the reason there isn't one.
 *
 * `low > high` is not refused, only ordered. A registry that has them backwards is a data-entry
 * mistake this file can fix locally and correctly, and refusing the whole tornado over it would
 * be a worse answer than the right one.
 */
function rangeOf(assumption: Assumption): Ranged | SensitivityIssueKind {
  const { low, high } = assumption;
  if (low === null || high === null) return 'NO_RANGE';
  if (low === high) return 'EMPTY_RANGE';
  return low < high ? { low, high } : { low: high, high: low };
}

/**
 * `steps` values from `low` to `high`, with both ends exact.
 *
 * The endpoints are assigned rather than computed. `0.1 + (0.3 - 0.1) * 1` is `0.30000000000000004`,
 * and a sweep whose last point is labelled `0.30000000000000004` when the registry says `0.3` reads
 * as a rounding bug in the model rather than in the axis — and a tornado's `high` really must be
 * the declared high, because that is the number somebody signed off on.
 */
function stepsBetween(low: number, high: number, steps: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < steps; index += 1) {
    if (index === 0) out.push(low);
    else if (index === steps - 1) out.push(high);
    else out.push(low + ((high - low) * index) / (steps - 1));
  }
  return out;
}

/* ------------------------------------------------------------------ sweeps ---- */

/**
 * One input across its range, one output measured at each step.
 *
 * `steps` defaults to nine, which is four either side of a midpoint: enough to show a kink and
 * cheap enough to redraw while somebody drags a slider. Every point is a full run of the model.
 *
 * The base is measured with an empty probe rather than by finding the base value in `points`,
 * because the scenario's value need not be one of the steps and usually isn't. That extra run is
 * the difference between a chart that can mark where the plan actually sits and one that implies
 * the plan is at the midpoint of every range it has.
 */
export function sweepOne(
  model: CompiledModel,
  scenarioId: string,
  key: string,
  target: Target,
  steps = 9,
): SensitivityResult<Sweep> {
  const assumption = declared(model, key);
  if (assumption === undefined) return { ok: false, issues: [issue('NOT_DECLARED', key)] };
  if (steps < 2) return { ok: false, issues: [issue('BAD_STEPS', key)] };

  const range = rangeOf(assumption);
  if (typeof range === 'string') return { ok: false, issues: [issue(range, key)] };

  const base = measure(model, scenarioId, new Map(), target);
  if (!base.ok) return { ok: false, issues: [base.issue] };

  const points: SweepPoint[] = [];
  for (const value of stepsBetween(range.low, range.high, steps)) {
    const point = measure(model, scenarioId, new Map([[key, value]]), target);
    if (!point.ok) return { ok: false, issues: [point.issue] };
    points.push({ value, result: point.result });
  }

  return {
    ok: true,
    value: {
      key,
      label: assumption.label,
      target,
      base: assumption.value,
      baseResult: base.result,
      points,
    },
  };
}

/* ---------------------------------------------------------------- tornadoes ---- */

/**
 * Every ranged assumption at both of its bounds, ordered by how much it moved the target.
 *
 * Two runs per assumption rather than `steps`, because a tornado is a question about ordering and
 * the ordering is settled by the ends. A twenty-assumption model is forty-one runs including the
 * base — which is why ./model separates compiling from running.
 *
 * `keys` narrows the field when a caller already knows which drivers it cares about. Omitted, it
 * asks every assumption in the registry, which is the honest default: the point of a tornado is
 * to find the drivers nobody nominated.
 */
export function tornado(
  model: CompiledModel,
  scenarioId: string,
  target: Target,
  keys?: readonly string[],
): SensitivityResult<Tornado> {
  const base = measure(model, scenarioId, new Map(), target);
  if (!base.ok) return { ok: false, issues: [base.issue] };

  const asked = keys === undefined
    ? model.spec.assumptions
    : model.spec.assumptions.filter((one) => keys.includes(one.key));
  const undeclared = keys === undefined
    ? []
    : keys.filter((key) => declared(model, key) === undefined);
  if (undeclared.length > 0) {
    return { ok: false, issues: undeclared.sort().map((key) => issue('NOT_DECLARED', key)) };
  }

  const bars: TornadoBar[] = [];
  const unranged: string[] = [];

  for (const assumption of asked) {
    const range = rangeOf(assumption);
    if (typeof range === 'string') {
      unranged.push(assumption.key);
      continue;
    }
    const atLow = measure(model, scenarioId, new Map([[assumption.key, range.low]]), target);
    if (!atLow.ok) return { ok: false, issues: [atLow.issue] };
    const atHigh = measure(model, scenarioId, new Map([[assumption.key, range.high]]), target);
    if (!atHigh.ok) return { ok: false, issues: [atHigh.issue] };

    bars.push({
      key: assumption.key,
      label: assumption.label,
      low: range.low,
      high: range.high,
      atLow: atLow.result,
      atHigh: atHigh.result,
      swing: Math.abs(atHigh.result - atLow.result),
      elasticity: elasticityOf(
        assumption.value,
        base.result,
        range,
        atLow.result,
        atHigh.result,
      ),
    });
  }

  return {
    ok: true,
    value: {
      target,
      baseResult: base.result,
      bars: bars.sort(bySwing),
      unranged: unranged.sort(),
    },
  };
}

/** Widest first, then by key. The tie-break is not cosmetic: two assumptions with identical
 *  swings are ordinary in a model built from symmetric ranges, and without it the same model
 *  would draw its tornado in registry order one day and filter order the next. */
const bySwing = (left: TornadoBar, right: TornadoBar): number => {
  if (right.swing !== left.swing) return right.swing - left.swing;
  return left.key < right.key ? -1 : (left.key > right.key ? 1 : 0);
};

/**
 * Percent out per percent in, measured across the range rather than at a point.
 *
 * Null whenever the ratio would be a lie: a base input of zero has no percentage, and a base
 * result of zero makes every response infinitely proportional. Both are common — a new-product
 * volume assumption starts at zero, and a net-cash target crosses zero — so this returns null far
 * more often than a textbook would suggest, and a caller that renders it must be ready to say
 * "not meaningful" rather than print a dash and let it read as "no effect".
 */
function elasticityOf(
  base: number,
  baseResult: number,
  range: Ranged,
  atLow: number,
  atHigh: number,
): number | null {
  if (base === 0 || baseResult === 0) return null;
  const inputChange = (range.high - range.low) / base;
  if (inputChange === 0) return null;
  const outputChange = (atHigh - atLow) / baseResult;
  const ratio = outputChange / inputChange;
  return Number.isFinite(ratio) ? ratio : null;
}

/* ----------------------------------------------------------------- matrices ---- */

/**
 * Two inputs at once, every combination.
 *
 * This is the only one of the three that can answer a question about interaction, and interaction
 * is the thing one-way analysis is structurally unable to see. Sweep price, sweep volume, and both
 * look linear; sweep them together against a capacity constraint and the corner of the grid goes
 * flat. Nine by nine is eighty-one runs, so five is the default — enough to see the surface bend,
 * few enough to redraw on a change.
 *
 * Both probes are applied in one run rather than composed from two, which is the whole point: a
 * matrix built by adding two one-way sweeps together assumes the very additivity it was asked to
 * test.
 */
export function twoWay(
  model: CompiledModel,
  scenarioId: string,
  rowKey: string,
  colKey: string,
  target: Target,
  rowSteps = 5,
  colSteps = 5,
): SensitivityResult<Matrix> {
  const rowAssumption = declared(model, rowKey);
  const colAssumption = declared(model, colKey);
  const missing = [
    ...(rowAssumption === undefined ? [issue('NOT_DECLARED', rowKey)] : []),
    ...(colAssumption === undefined ? [issue('NOT_DECLARED', colKey)] : []),
  ];
  if (missing.length > 0 || rowAssumption === undefined || colAssumption === undefined) {
    return { ok: false, issues: missing };
  }
  if (rowSteps < 2 || colSteps < 2) {
    return { ok: false, issues: [issue('BAD_STEPS', rowSteps < 2 ? rowKey : colKey)] };
  }

  const rowRange = rangeOf(rowAssumption);
  const colRange = rangeOf(colAssumption);
  const unusable = [
    ...(typeof rowRange === 'string' ? [issue(rowRange, rowKey)] : []),
    ...(typeof colRange === 'string' ? [issue(colRange, colKey)] : []),
  ];
  if (unusable.length > 0 || typeof rowRange === 'string' || typeof colRange === 'string') {
    return { ok: false, issues: unusable };
  }

  const base = measure(model, scenarioId, new Map(), target);
  if (!base.ok) return { ok: false, issues: [base.issue] };

  const rowValues = stepsBetween(rowRange.low, rowRange.high, rowSteps);
  const colValues = stepsBetween(colRange.low, colRange.high, colSteps);
  const cells: number[][] = [];

  for (const rowValue of rowValues) {
    const line: number[] = [];
    for (const colValue of colValues) {
      const cell = measure(
        model,
        scenarioId,
        new Map([[rowKey, rowValue], [colKey, colValue]]),
        target,
      );
      if (!cell.ok) return { ok: false, issues: [cell.issue] };
      line.push(cell.result);
    }
    cells.push(line);
  }

  return {
    ok: true,
    value: { target, rowKey, colKey, rowValues, colValues, cells, baseResult: base.result },
  };
}

/* ------------------------------------------------------------------- reach ---- */

/**
 * Every row that moving one key can possibly change, transitively.
 *
 * The structural half of sensitivity, and it needs no runs at all: ./graph already holds the
 * reverse edges, so this is a walk rather than an experiment. Worth having beside the numeric
 * answers for two reasons. It tells a screen which targets are even worth offering for a given
 * assumption — an input that reaches nothing is a dead assumption, and offering to sweep it
 * against a row it cannot touch produces a flat line that looks like a finding. And when a sweep
 * does come back flat, this is what distinguishes "no path" from "there is a path and the model
 * genuinely does not respond along it", which are different problems with different fixes.
 *
 * Lagged edges are absent by construction: `dependents` holds same-period reads only. That is
 * correct for reach in a way that is easy to doubt — `cash = prior(cash) + net` means an input
 * reaching `net` reaches `cash`, and it does, through the same-period edge to `net`. What is
 * excluded is only the self-edge a roll-forward has to itself.
 */
export function reachOf(model: CompiledModel, key: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [key];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const next of model.graph.dependents.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen].sort();
}
