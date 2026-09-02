/**
 * Running the model backwards.
 *
 * Every other file here answers "what happens if". This one answers "what would have to be true":
 * what price clears the covenant, what occupancy breaks even, what mix of the three levers gets
 * EBITDA highest without the current ratio falling through 1.2. That is the question a plan is
 * actually built to answer, and a spreadsheet answers it by hand — somebody types a number, looks
 * at a cell, types another, and stops when it looks close enough. Goal Seek exists in Excel and is
 * a single-variable bisection with no bracket reporting; Solver exists and is an opaque black box
 * whose answer nobody can reproduce.
 *
 * Two things are refused here that a naive solver would do.
 *
 * It does not differentiate. A planning model is piecewise — ./expression allows `min`, `max`,
 * `clamp` and `if`, and a real model is full of them — so a Newton step computed from a slope at
 * the current point will walk confidently off a cliff at the first kink, and worse, will *converge*
 * to something and report it. Everything here is bracketing and bisection over the declared range,
 * which needs no derivative and cannot be fooled by a corner.
 *
 * It does not invent a search range. The bounds are the assumption's own `low`..`high` from the
 * registry, exactly as in ./sensitivity, because an optimum found outside the range somebody wrote
 * down is not an answer — it is the solver saying "if you would accept an impossible price, here is
 * a lovely result". An assumption with no range is refused rather than searched.
 *
 * And two things are reported that a naive solver would hide. A scan for *every* sign change across
 * the range, so a goal reachable at two different prices reads as two roots rather than as whichever
 * one bisection happened to land on — a non-monotone response is the finding, and a solver that
 * returns a single number destroys it. And the constraint that *binds* at the optimum, because
 * "profit is highest at a price of 41" is far less useful than "the optimum sits on the covenant,
 * and the covenant is what is costing you the next million".
 */
import { runCompiled } from './model';
import type { CompiledModel, ModelFailure } from './model';
import type { Assumption } from './scenario';
import { measureRun } from './sensitivity';
import type { Target } from './sensitivity';

export type OptimizeIssueKind =
  /** The key to move is not a declared assumption. */
  | 'NOT_DECLARED'
  /** A declared assumption with no `low`, no `high`, or neither. Nothing to search between, and
   *  this file will not choose a range on the registry's behalf. */
  | 'NO_RANGE'
  /** `low` equals `high`. One point is not a search space. */
  | 'EMPTY_RANGE'
  /** The target names a row the run has no series for. */
  | 'NO_TARGET'
  /** The model itself did not run. Carries the failure — a search that stopped because a formula
   *  does not parse is not a finding about reachability. */
  | 'RUN_FAILED'
  /** A tolerance of zero or less. Bisection on floating point must be told when to stop. */
  | 'BAD_TOLERANCE'
  /** The goal is outside everything the target can reach across the range. Carries the reach, so
   *  the caller can say how far short it falls rather than only that it does. */
  | 'UNREACHABLE'
  /** The target does not move at all as the variable crosses its whole range. Separate from
   *  `UNREACHABLE` because the fix is different: an unreachable goal needs a wider range or a
   *  smaller ambition, and a flat response means this variable is the wrong lever. */
  | 'FLAT'
  /** Nothing satisfied every constraint, and neither did the plan. Refused rather than answered
   *  with the least-bad point, because a plan that breaks a covenant returned as a solution is
   *  the single most dangerous thing a solver can produce. */
  | 'INFEASIBLE';

export interface OptimizeIssue {
  readonly kind: OptimizeIssueKind;
  readonly where: string;
  readonly failure: ModelFailure | null;
  /** For `UNREACHABLE` and `FLAT`: what the target actually did across the range. */
  readonly reach: Reach | null;
}

export type OptimizeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly OptimizeIssue[] };

/** What the target covers as one variable crosses its whole declared range. The answer to "how
 *  close can it get" when the goal cannot be hit. */
export interface Reach {
  readonly lowest: number;
  readonly highest: number;
  /** Where each extreme was found, so a caller can say "at a price of 38" rather than only how
   *  much. Scanned rather than solved, so these are the best of the scanned points. */
  readonly atLowest: number;
  readonly atHighest: number;
}

/** One solution: a value of the variable at which the target meets the goal. */
export interface Root {
  readonly value: number;
  /** The target there. Within `tolerance` of the goal, and reported rather than assumed so a
   *  reader can see how close bisection actually got. */
  readonly result: number;
  readonly iterations: number;
}

export interface GoalSeek {
  readonly key: string;
  readonly label: string;
  readonly target: Target;
  readonly goal: number;
  /** The variable's value under the scenario, and the target there. What the plan currently says. */
  readonly base: number;
  readonly baseResult: number;
  /** Ascending by value. More than one is a real finding about a non-monotone model, not an error. */
  readonly roots: readonly Root[];
  readonly reach: Reach;
  /**
   * Whether the scan found the response moving in one direction throughout.
   *
   * False does not invalidate the roots — it means the response bends, so a caller must not
   * interpolate between them, and a single-root answer from any other tool is probably one of
   * several. Measured on the scan, so it is a statement about the scanned resolution and not a
   * proof; a kink narrower than one step is invisible to it, and to every other method that does
   * not read the formulas.
   */
  readonly monotone: boolean;
  /** Points the scan evaluated, plus the bisection steps. The cost of the answer, stated. */
  readonly evaluations: number;
}

/* -------------------------------------------------------------- machinery ---- */

const optimizeIssue = (
  kind: OptimizeIssueKind,
  where: string,
  failure: ModelFailure | null = null,
  reach: Reach | null = null,
): OptimizeIssue => ({ kind, where, failure, reach });

type Measured =
  | { readonly ok: true; readonly result: number }
  | { readonly ok: false; readonly issue: OptimizeIssue };

/** Every run in this file goes through here, so a failed run and a missing target read the same
 *  whether they happen on the first scanned point or the last bisection step. */
function measure(
  model: CompiledModel,
  scenarioId: string,
  probe: ReadonlyMap<string, number>,
  target: Target,
): Measured {
  const run = runCompiled(model, scenarioId, probe);
  if (!run.ok) return { ok: false, issue: optimizeIssue('RUN_FAILED', scenarioId, run.failure) };
  const result = measureRun(run.run, target);
  if (result === undefined) return { ok: false, issue: optimizeIssue('NO_TARGET', target.key) };
  return { ok: true, result };
}

type Ranged = { readonly low: number; readonly high: number };

/** The searchable range, or the reason there isn't one. Backwards bounds are ordered rather than
 *  refused, matching ./sensitivity: a registry with `low` above `high` is a typing mistake this
 *  file can fix correctly, and refusing the search over it would be a worse answer. */
function rangeOf(assumption: Assumption): Ranged | OptimizeIssueKind {
  const { low, high } = assumption;
  if (low === null || high === null) return 'NO_RANGE';
  if (low === high) return 'EMPTY_RANGE';
  return low < high ? { low, high } : { low: high, high: low };
}

function declared(model: CompiledModel, key: string): Assumption | undefined {
  return model.spec.assumptions.find((one) => one.key === key);
}

/* ------------------------------------------------------------- goal seek ---- */

interface Scanned {
  readonly values: readonly number[];
  readonly results: readonly number[];
}

/**
 * The variable across its range at even steps.
 *
 * The scan is what makes the rest honest. Bisection alone needs one bracket and will happily be
 * handed the whole range, which works for a monotone response and silently returns one of several
 * answers otherwise. Scanning first turns "find the root" into "find every interval where the
 * response crosses the goal", and the count of those intervals is information a bisection cannot
 * produce.
 */
function scan(
  model: CompiledModel,
  scenarioId: string,
  key: string,
  target: Target,
  range: Ranged,
  steps: number,
): Scanned | OptimizeIssue {
  const values: number[] = [];
  const results: number[] = [];
  for (let index = 0; index < steps; index += 1) {
    // Endpoints assigned rather than computed, for the reason ./sensitivity gives: the declared
    // high is the number somebody signed off on, and `low + (high - low) * 1` is not always it.
    const value = index === 0
      ? range.low
      : (index === steps - 1 ? range.high : range.low + ((range.high - range.low) * index) / (steps - 1));
    const point = measure(model, scenarioId, new Map([[key, value]]), target);
    if (!point.ok) return point.issue;
    values.push(value);
    results.push(point.result);
  }
  return { values, results };
}

function reachOfScan(scanned: Scanned): Reach {
  let lowest = scanned.results[0];
  let highest = scanned.results[0];
  let atLowest = scanned.values[0];
  let atHighest = scanned.values[0];
  for (let index = 1; index < scanned.results.length; index += 1) {
    const result = scanned.results[index];
    if (result < lowest) { lowest = result; atLowest = scanned.values[index]; }
    if (result > highest) { highest = result; atHighest = scanned.values[index]; }
  }
  return { lowest, highest, atLowest, atHighest };
}

/** One direction throughout, allowing flat stretches. A model that rises, plateaus and rises again
 *  is monotone for this purpose, because nothing between two scanned points can be a second root
 *  of a response that never turns back. */
function monotoneOn(results: readonly number[]): boolean {
  let rising = false;
  let falling = false;
  for (let index = 1; index < results.length; index += 1) {
    const step = results[index] - results[index - 1];
    if (step > 0) rising = true;
    if (step < 0) falling = true;
  }
  return !(rising && falling);
}

/**
 * Bisect one bracket to the goal.
 *
 * Terminates on the interval rather than on the residual, and both are checked: an interval narrower
 * than `tolerance` in the *input* is the answer to "what value", and a residual inside `tolerance`
 * in the *output* is the answer to "does it meet the goal". A bisection that watched only the
 * residual would spin at a discontinuity where the target jumps across the goal without ever
 * equalling it — which is exactly what a step in a tiered price does — and one that watched only the
 * interval would report a precise input for an output that missed.
 */
function bisect(
  model: CompiledModel,
  scenarioId: string,
  key: string,
  target: Target,
  goal: number,
  lowValue: number,
  lowResidual: number,
  highValue: number,
  tolerance: number,
  limit: number,
): { readonly root: Root; readonly evaluations: number } | OptimizeIssue {
  let left = lowValue;
  let leftSign = lowResidual >= 0;
  let right = highValue;
  let best = { value: lowValue, result: lowResidual + goal };
  let evaluations = 0;

  for (let iteration = 1; iteration <= limit; iteration += 1) {
    const middle = (left + right) / 2;
    const point = measure(model, scenarioId, new Map([[key, middle]]), target);
    if (!point.ok) return point.issue;
    evaluations += 1;
    const residual = point.result - goal;
    if (Math.abs(residual) < Math.abs(best.result - goal)) {
      best = { value: middle, result: point.result };
    }
    if (Math.abs(residual) <= tolerance || Math.abs(right - left) <= tolerance) {
      return { root: { value: middle, result: point.result, iterations: iteration }, evaluations };
    }
    if ((residual >= 0) === leftSign) { left = middle; leftSign = residual >= 0; } else right = middle;
  }
  return {
    root: { value: best.value, result: best.result, iterations: limit },
    evaluations,
  };
}

/**
 * What one assumption would have to be for the target to hit a goal.
 *
 * Scans the declared range, collects every interval where the response crosses the goal, and
 * bisects each one. The cost is `steps` runs plus about `log2(range / tolerance)` per root, all
 * re-using one compile.
 *
 * `steps` defaults to seventeen — sixteen intervals, which resolves a response with two or three
 * turns in it without making the scan the expensive part. A caller that knows the model is monotone
 * can drop it to two and get a plain bisection over the whole range.
 */
export function goalSeek(
  model: CompiledModel,
  scenarioId: string,
  key: string,
  target: Target,
  goal: number,
  tolerance = 1e-6,
  steps = 17,
  limit = 60,
): OptimizeResult<GoalSeek> {
  const assumption = declared(model, key);
  if (assumption === undefined) return { ok: false, issues: [optimizeIssue('NOT_DECLARED', key)] };
  if (!(tolerance > 0)) return { ok: false, issues: [optimizeIssue('BAD_TOLERANCE', key)] };
  const range = rangeOf(assumption);
  if (typeof range === 'string') return { ok: false, issues: [optimizeIssue(range, key)] };

  const base = measure(model, scenarioId, new Map(), target);
  if (!base.ok) return { ok: false, issues: [base.issue] };

  const scanned = scan(model, scenarioId, key, target, range, Math.max(2, steps));
  if (!('values' in scanned)) return { ok: false, issues: [scanned] };
  const reach = reachOfScan(scanned);
  let evaluations = scanned.values.length + 1;

  if (reach.lowest === reach.highest) {
    return { ok: false, issues: [optimizeIssue('FLAT', key, null, reach)] };
  }
  if (goal < reach.lowest || goal > reach.highest) {
    return { ok: false, issues: [optimizeIssue('UNREACHABLE', key, null, reach)] };
  }

  const roots: Root[] = [];
  for (let index = 1; index < scanned.values.length; index += 1) {
    const before = scanned.results[index - 1] - goal;
    const after = scanned.results[index] - goal;
    if (before === 0) {
      roots.push({ value: scanned.values[index - 1], result: scanned.results[index - 1], iterations: 0 });
      continue;
    }
    if ((before > 0) === (after > 0)) continue;
    const found = bisect(
      model, scenarioId, key, target, goal,
      scanned.values[index - 1], before, scanned.values[index], tolerance, limit,
    );
    if (!('root' in found)) return { ok: false, issues: [found] };
    roots.push(found.root);
    evaluations += found.evaluations;
  }
  const last = scanned.results.length - 1;
  if (scanned.results[last] - goal === 0) {
    roots.push({ value: scanned.values[last], result: scanned.results[last], iterations: 0 });
  }

  return {
    ok: true,
    value: {
      key,
      label: assumption.label,
      target,
      goal,
      base: assumption.value,
      baseResult: base.result,
      roots: roots.sort((left, right) => left.value - right.value),
      reach,
      monotone: monotoneOn(scanned.results),
      evaluations,
    },
  };
}

/* --------------------------------------------------------------- solving ---- */

export type ConstraintOp =
  /** The row must stay at or below the bound. A covenant ceiling: leverage at most 3.5×. */
  | 'AT_MOST'
  /** At or above. A covenant floor: current ratio at least 1.2. */
  | 'AT_LEAST'
  /** Within `tolerance` of the bound. A balancing condition: sources equal uses. */
  | 'EQUALS';

/**
 * One condition a solution must satisfy.
 *
 * The target is a full ./sensitivity `Target`, so a constraint can be a single period, a total or
 * a minimum across the horizon — and the last of those is the one that matters: a covenant is not
 * "leverage at the end of the year", it is "leverage in every month", and a solver that tested only
 * the final period would happily return a plan that breaches in month four and recovers by
 * December.
 */
export interface Constraint {
  readonly target: Target;
  readonly op: ConstraintOp;
  readonly bound: number;
  /** For the reader, not the solver. `'Leverage covenant'` beats `'net_debt_ebitda AT_MOST 3.5'`. */
  readonly label: string;
}

export type Direction = 'MAXIMISE' | 'MINIMISE';

/** One lever's move, from what the scenario says to what the solver chose. */
export interface SolvedValue {
  readonly key: string;
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly low: number;
  readonly high: number;
  /**
   * True when the chosen value sits on its own `low` or `high` rather than in between.
   *
   * The single most useful flag on this object. A lever pinned to its bound means the model would
   * go further if the range allowed it, so the answer is not "this is the best price" but "this is
   * the best price you told me was possible" — and the next conversation is about whether the bound
   * is real.
   */
  readonly atBound: boolean;
}

/** Where one constraint ended up at the answer. */
export interface ConstraintStanding {
  readonly label: string;
  readonly op: ConstraintOp;
  readonly bound: number;
  readonly value: number;
  /**
   * Room left, signed the same way for every operator: positive is room, zero is sitting exactly
   * on the line, negative is a breach. One convention across `AT_MOST`, `AT_LEAST` and `EQUALS`
   * means a screen can sort by it and a reader can compare two constraints without first working
   * out which direction each one points.
   */
  readonly slack: number;
  /** Slack inside `tolerance`. The constraints that are *costing* something at the optimum. */
  readonly binds: boolean;
}

export interface Solution {
  readonly target: Target;
  readonly direction: Direction;
  /** The target under the scenario, before anything moved. What the answer has to beat. */
  readonly baseResult: number;
  readonly result: number;
  /** Whether the plan as written already satisfied every constraint. A `false` here changes what
   *  the whole object means: the solver was not improving a working plan, it was repairing a
   *  broken one, and `result` may well be worse than `baseResult`. */
  readonly baseFeasible: boolean;
  /** Declaration order, so a caller can render them beside the levers it offered. */
  readonly values: readonly SolvedValue[];
  /** Declaration order, matching `constraints` as passed. */
  readonly standing: readonly ConstraintStanding[];
  /** Runs of the model. Each one measures the objective and every constraint together, which is
   *  why adding a constraint costs nothing per evaluation. */
  readonly evaluations: number;
  readonly passes: number;
  /**
   * Whether the last pass moved anything.
   *
   * False means the search was still improving when it ran out of passes, so the answer is the
   * best found and not a converged optimum. Reported rather than silently returned, because "the
   * solver stopped" and "the solver finished" are different facts about the same number.
   */
  readonly settled: boolean;
}

/* ----------------------------------------------------------- constraints ---- */

/** How far a value is from satisfying a condition. Zero when satisfied. */
function violationOf(one: Constraint, value: number, tolerance: number): number {
  if (one.op === 'AT_MOST') return Math.max(0, value - one.bound);
  if (one.op === 'AT_LEAST') return Math.max(0, one.bound - value);
  return Math.max(0, Math.abs(value - one.bound) - tolerance);
}

/** Room left, positive-is-room for every operator. `EQUALS` has no room by construction, so its
 *  slack is the negated distance: zero on the bound, negative anywhere else. */
function slackOf(one: Constraint, value: number): number {
  if (one.op === 'AT_MOST') return one.bound - value;
  if (one.op === 'AT_LEAST') return value - one.bound;
  return -Math.abs(value - one.bound);
}

/** One run, every number the search needs from it. Measuring the objective and the constraints
 *  from the same run is not an optimisation — it is a correctness requirement, since two runs of a
 *  probe would be two chances for them to disagree about which point is being described. */
interface Point {
  readonly objective: number;
  readonly measures: readonly number[];
  readonly violation: number;
  readonly feasible: boolean;
  readonly values: ReadonlyMap<string, number>;
}

function pointAt(
  model: CompiledModel,
  scenarioId: string,
  probe: ReadonlyMap<string, number>,
  target: Target,
  constraints: readonly Constraint[],
  tolerance: number,
): Point | OptimizeIssue {
  const run = runCompiled(model, scenarioId, probe);
  if (!run.ok) return optimizeIssue('RUN_FAILED', scenarioId, run.failure);
  const objective = measureRun(run.run, target);
  if (objective === undefined) return optimizeIssue('NO_TARGET', target.key);

  const measures: number[] = [];
  let violation = 0;
  for (const one of constraints) {
    const value = measureRun(run.run, one.target);
    if (value === undefined) return optimizeIssue('NO_TARGET', one.target.key);
    measures.push(value);
    violation += violationOf(one, value, tolerance);
  }
  return {
    objective,
    measures,
    violation,
    feasible: violation === 0,
    values: new Map(probe),
  };
}

/* ---------------------------------------------------------------- search ---- */

/**
 * Whether one point is a better answer than another.
 *
 * Lexicographic, and the order is the whole ethic of the file: feasibility first, objective second.
 * A point that satisfies every constraint beats one that does not *however good its objective is*,
 * which is what stops the search trading a covenant breach for another half-million of EBITDA. Only
 * when both are infeasible does the comparison fall through to total violation — and that sum
 * crosses units, so it is a heuristic for climbing out of an infeasible start and never a claim
 * that two breaches are commensurable.
 */
function better(left: Point, right: Point, direction: Direction): boolean {
  if (left.feasible !== right.feasible) return left.feasible;
  if (!left.feasible) return left.violation < right.violation;
  return direction === 'MAXIMISE'
    ? left.objective > right.objective
    : left.objective < right.objective;
}

interface Lever {
  readonly key: string;
  readonly label: string;
  readonly base: number;
  readonly low: number;
  readonly high: number;
}

function leversOf(
  model: CompiledModel,
  keys: readonly string[],
): { readonly levers: readonly Lever[] } | OptimizeIssue {
  const levers: Lever[] = [];
  for (const key of keys) {
    const assumption = declared(model, key);
    if (assumption === undefined) return optimizeIssue('NOT_DECLARED', key);
    const range = rangeOf(assumption);
    if (typeof range === 'string') return optimizeIssue(range, key);
    levers.push({
      key,
      label: assumption.label,
      base: assumption.value,
      low: range.low,
      high: range.high,
    });
  }
  return { levers };
}

/** The values to try for one lever this pass: an even grid across the window, clamped into the
 *  declared bounds so a shrinking window near an edge still probes the edge itself. */
function windowValues(lever: Lever, centre: number, width: number, probes: number): readonly number[] {
  const left = Math.max(lever.low, centre - width / 2);
  const right = Math.min(lever.high, centre + width / 2);
  if (left === right) return [left];
  const values: number[] = [];
  for (let index = 0; index < probes; index += 1) {
    values.push(index === probes - 1 ? right : left + ((right - left) * index) / (probes - 1));
  }
  return values;
}

/**
 * Coordinate descent over the declared box.
 *
 * One lever at a time, keeping whatever improves, then narrowing the window and going round again.
 * Derivative-free by necessity — see the header — and bounded by construction, since every probe
 * is clamped into the assumption's own range and the search can therefore never propose a number
 * nobody declared possible.
 *
 * The first pass uses the *full* range for every lever, so it is a complete grid scan of each axis
 * before any narrowing happens. That is what keeps the local-optimum risk small on the models this
 * is for: a response with one bend is found on pass one, and only a response with a narrow spike
 * between two probe points is missed. It is still a local method, and a caller who needs more
 * confidence should raise `probes` rather than `passes`.
 */
function descend(
  model: CompiledModel,
  scenarioId: string,
  levers: readonly Lever[],
  target: Target,
  constraints: readonly Constraint[],
  direction: Direction,
  tolerance: number,
  passes: number,
  probes: number,
  start: Point,
): { readonly best: Point; readonly evaluations: number; readonly settled: boolean } | OptimizeIssue {
  const at = new Map<string, number>(start.values);
  let best = start;
  let evaluations = 0;
  let settled = true;

  for (let pass = 1; pass <= passes; pass += 1) {
    let moved = false;
    for (const lever of levers) {
      const width = (lever.high - lever.low) / Math.pow(2, pass - 1);
      const centre = at.get(lever.key) ?? lever.base;
      for (const value of windowValues(lever, centre, width, probes)) {
        if (value === centre && pass > 1) continue;
        const probe = new Map(at);
        probe.set(lever.key, value);
        const point = pointAt(model, scenarioId, probe, target, constraints, tolerance);
        if (!('objective' in point)) return point;
        evaluations += 1;
        if (better(point, best, direction)) {
          best = point;
          at.set(lever.key, value);
          moved = true;
        }
      }
      // Back to the incumbent for the next lever: coordinate descent's whole premise is that each
      // axis is explored from the best point found so far, not from wherever the last probe left.
      at.set(lever.key, best.values.get(lever.key) ?? lever.base);
    }
    settled = !moved;
    if (settled) break;
  }
  return { best, evaluations, settled };
}

/**
 * The best a target can be made, within the declared ranges and subject to constraints.
 *
 * Costs at most `passes × levers × probes + 1` runs of a once-compiled model — 5 × 3 × 9 + 1 = 136
 * for a three-lever plan at the defaults — and stops early the moment a pass improves nothing.
 * Every constraint is measured from the same runs as the objective, so the tenth covenant costs no
 * more evaluations than the first.
 *
 * Refuses rather than answers when nothing feasible is found and the plan itself was infeasible.
 * The alternative is to return the least-bad point, and a screen that shows a plan breaching a
 * covenant under the heading "solution" is worse than one that shows nothing.
 */
export function solve(
  model: CompiledModel,
  scenarioId: string,
  keys: readonly string[],
  target: Target,
  direction: Direction,
  constraints: readonly Constraint[] = [],
  tolerance = 1e-6,
  passes = 5,
  probes = 9,
): OptimizeResult<Solution> {
  if (!(tolerance > 0)) return { ok: false, issues: [optimizeIssue('BAD_TOLERANCE', target.key)] };
  const found = leversOf(model, keys);
  if (!('levers' in found)) return { ok: false, issues: [found] };
  if (found.levers.length === 0) {
    return { ok: false, issues: [optimizeIssue('NO_RANGE', target.key)] };
  }

  const start = pointAt(model, scenarioId, new Map(), target, constraints, tolerance);
  if (!('objective' in start)) return { ok: false, issues: [start] };

  const run = descend(
    model, scenarioId, found.levers, target, constraints,
    direction, tolerance, Math.max(1, passes), Math.max(2, probes), start,
  );
  if (!('best' in run)) return { ok: false, issues: [run] };
  if (!run.best.feasible) {
    return { ok: false, issues: [optimizeIssue('INFEASIBLE', target.key)] };
  }

  const values = found.levers.map((lever): SolvedValue => {
    const to = run.best.values.get(lever.key) ?? lever.base;
    return {
      key: lever.key,
      label: lever.label,
      from: lever.base,
      to,
      low: lever.low,
      high: lever.high,
      atBound: to === lever.low || to === lever.high,
    };
  });

  const standing = constraints.map((one, index): ConstraintStanding => {
    const value = run.best.measures[index];
    const slack = slackOf(one, value);
    return {
      label: one.label,
      op: one.op,
      bound: one.bound,
      value,
      slack,
      binds: Math.abs(slack) <= tolerance,
    };
  });

  return {
    ok: true,
    value: {
      target,
      direction,
      baseResult: start.objective,
      result: run.best.objective,
      baseFeasible: start.feasible,
      values,
      standing,
      evaluations: run.evaluations + 1,
      passes: Math.max(1, passes),
      settled: run.settled,
    },
  };
}
