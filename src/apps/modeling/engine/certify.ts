/**
 * Whether a model has earned the right to be believed.
 *
 * Every planning tool has a "review" step and almost all of them mean the same thing by it: a person
 * clicked a button, and now the file has a green tick and a name beside it. That records who is to
 * blame, which is not nothing, but it is not evidence. It says nothing about whether the model
 * divides by zero in month seven, whether nine of its fourteen assumptions have a plausible range
 * anybody wrote down, or whether the assumption somebody spent an afternoon arguing about actually
 * reaches the number they were arguing about.
 *
 * So certification here is measured. Every check in this file runs the model, or walks the graph, or
 * counts something the run produced, and reports what it found next to the threshold it was compared
 * against. A reader who disagrees with a threshold can see the measurement and draw their own line;
 * a reader who cannot see the measurement can only trust or not trust the tick.
 *
 * Four outcomes, not two, and the fourth is the one that matters. `UNMEASURED` is for a check that
 * could not run — no scenarios to compare, no assumption with a range to stress, a target the run
 * has no series for. It is not a pass. A certifier that scored those as passes would grade an empty
 * model highest of all, since a model with nothing in it fails nothing, and that is exactly the
 * failure mode this file exists to avoid.
 *
 * The grade follows from the outcomes mechanically and cannot be set by hand: any `FAIL` means
 * `UNCERTIFIED`, any `WARN` or `UNMEASURED` caps it at `PROVISIONAL`, and `CERTIFIED` requires every
 * check to have run and passed. There is no override, because an override is how a measured
 * certification turns back into an asserted one.
 *
 * What a certificate is *not*: an approval. It carries no signature and names no person. It says the
 * model is sound, not that anybody agreed with it — and it is pinned to ./version's `resultsHash`, so
 * a certificate found beside a model can be checked against it rather than assumed to describe it.
 */
import { runCompiled } from './model';
import type { CompiledModel, ModelRun } from './model';
import { reachOf, tornado } from './sensitivity';
import type { Target } from './sensitivity';
import { versionOf } from './version';

export type CheckKind =
  /** Every declared scenario resolves and runs. Nothing else can be measured until this passes. */
  | 'SCENARIOS_RUN'
  /** At least two scenarios exist. One scenario is a forecast, not a plan: there is nothing to
   *  compare it against and no downside anybody has written down. */
  | 'SCENARIO_COUNT'
  /** No cell produced a note — no division by zero, no non-finite value from storage. */
  | 'CLEAN_ARITHMETIC'
  /** Every scenario's assumption values sit inside their own declared ranges. A scenario that
   *  overrides an assumption past its plausible high is either a range nobody maintained or a plan
   *  nobody believes, and ./scenario already knows which values they are. */
  | 'WITHIN_RANGE'
  /** Enough assumptions carry a `low`..`high` for a tornado to mean something. */
  | 'RANGES_DECLARED'
  /** Every assumption reaches at least one row. An assumption that reaches nothing is a control on
   *  a screen that does nothing, and somebody will move it and believe they changed the plan. */
  | 'NO_DEAD_ASSUMPTIONS'
  /** The certifying target responds to at least one ranged assumption. A target nothing moves is
   *  either disconnected or constant, and either way it cannot be planned with. */
  | 'TARGET_RESPONDS'
  /** The longest same-period dependency chain is short enough to audit by reading. */
  | 'AUDITABLE_DEPTH'
  /** Given rows that ran out of values before the horizon did. Not a fault — three actuals and
   *  nine forecast months is the ordinary shape — but it must be disclosed, because a straight
   *  line in a chart is otherwise indistinguishable from a forecast somebody made. */
  | 'HELD_ROWS_DISCLOSED';

/**
 * What a check found.
 *
 * `UNMEASURED` is separate from `FAIL` because the two demand different actions: a failure is fixed
 * by changing the model, and an unmeasured check is fixed by giving the certifier something to
 * measure. Collapsing them would tell somebody to repair a model that is fine and merely untested.
 */
export type Outcome = 'PASS' | 'WARN' | 'FAIL' | 'UNMEASURED';

export interface Check {
  readonly kind: CheckKind;
  readonly outcome: Outcome;
  /** What the check counted. Null when the check is not a count. */
  readonly measured: number | null;
  /** What `measured` was compared against, so a reader can disagree with the line rather than
   *  only with the verdict. Null when the check has no threshold. */
  readonly threshold: number | null;
  readonly detail: string;
  /** The keys or scenario ids implicated, sorted. Empty for a check that passed, so a screen can
   *  render the list without deciding whether to hide it. */
  readonly where: readonly string[];
}

/**
 * Derived from the checks, never assigned.
 *
 * `PROVISIONAL` is the honest resting place for most real models, and saying so is the point: a
 * model with three unranged assumptions is usable and is not certified, and a scheme with only two
 * grades would have to call it one or the other.
 */
export type Grade = 'CERTIFIED' | 'PROVISIONAL' | 'UNCERTIFIED';

export interface Certificate {
  readonly grade: Grade;
  /** ./version's hash of everything that can change a number. What pins this certificate to one
   *  model — a certificate whose hash does not match the model beside it describes a different
   *  model, and that is the only way to find out. */
  readonly resultsHash: string;
  readonly fullHash: string;
  readonly scenario: string;
  readonly target: Target;
  readonly checks: readonly Check[];
  /**
   * Things true of the method rather than of this model.
   *
   * Stated on every certificate, because they do not go away when a model is good. ./monte draws its
   * assumptions independently and real drivers correlate, so its tails are optimistic; ./drivers
   * attributes one driver at a time and reports the leftover rather than spreading it. Both are
   * written here so that a reader of the certificate learns them without having read the engine.
   */
  readonly limitations: readonly string[];
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly unmeasured: number;
}

export interface CertifySettings {
  /** Longest same-period chain allowed before `AUDITABLE_DEPTH` warns. Twelve: deep enough for a
   *  three-statement model with a working-capital block, shallow enough that a reader can still
   *  trace a number to its inputs in one sitting. */
  readonly maxDepth?: number;
  /** Scenarios required by `SCENARIO_COUNT`. Two: a plan and something to compare it against. */
  readonly minScenarios?: number;
  /** Fraction of assumptions that must carry a range, 0..1. Two thirds by default — high enough
   *  that a tornado covers most of the model, low enough to be reachable by a real registry where
   *  some inputs genuinely have one defensible value. */
  readonly minRanged?: number;
}

const check = (
  kind: CheckKind,
  outcome: Outcome,
  detail: string,
  measured: number | null = null,
  threshold: number | null = null,
  where: readonly string[] = [],
): Check => ({ kind, outcome, measured, threshold, detail, where });

const LIMITATIONS: readonly string[] = [
  'Simulated draws are independent. Real drivers correlate — price with volume, occupancy with '
  + 'rate — and independence understates how often several go wrong together, so simulated tails '
  + 'are optimistic.',
  'Driver attribution moves one assumption at a time from a common base. The contributions are '
  + 'therefore comparable to each other and do not sum to the movement; the leftover is reported '
  + 'as an interaction term rather than spread across the bars.',
  'Sensitivity is measured by re-running the model, never by differentiating it, so a reported '
  + 'response is the response across the declared range and not a slope at the plan.',
  'A certificate states that the model is sound. It carries no signature and records nobody\'s '
  + 'agreement with the plan.',
];

const sortedUnique = (keys: readonly string[]): readonly string[] => [...new Set(keys)].sort();

/* ------------------------------------------------------------------ checks ---- */

/**
 * Every declared scenario, run.
 *
 * All of them rather than the one being certified, because a model that computes under the base
 * case and throws under the downside is a model whose downside nobody has ever seen. The scenarios
 * that failed are named, since the fix is in one of them and not in the model as a whole.
 */
function scenariosRun(total: number, ran: number, broken: readonly string[]): Check {
  if (total === 0) {
    return check('SCENARIOS_RUN', 'UNMEASURED', 'No scenarios are declared, so nothing was run.');
  }
  if (broken.length > 0) {
    return check(
      'SCENARIOS_RUN',
      'FAIL',
      `${broken.length} of ${total} scenarios did not run.`,
      ran,
      total,
      sortedUnique(broken),
    );
  }
  return check('SCENARIOS_RUN', 'PASS', `All ${total} scenarios ran.`, ran, total);
}

/** A count, not a judgement about which scenarios they should be. Under threshold is a warning
 *  rather than a failure: the arithmetic of a one-scenario model can be perfectly sound, and what
 *  is missing is not correctness but anything to compare it against. */
function scenarioCount(total: number, threshold: number): Check {
  const detail = total >= threshold
    ? `${total} scenarios, so the plan has something to be compared against.`
    : `${total} scenario${total === 1 ? '' : 's'}: fewer than ${threshold}, so no downside is `
      + 'written down and the plan is a forecast rather than a decision.';
  return check('SCENARIO_COUNT', total >= threshold ? 'PASS' : 'WARN', detail, total, threshold);
}

/** Notes from every run, not only the certifying one. A division by zero that happens in the
 *  downside case is a defect in the model, and reporting only the base case is how it survives. */
function cleanArithmetic(runs: ReadonlyMap<string, ModelRun>): Check {
  if (runs.size === 0) {
    return check('CLEAN_ARITHMETIC', 'UNMEASURED', 'No run produced cells to inspect.');
  }
  const where: string[] = [];
  for (const [id, run] of runs) for (const note of run.notes) where.push(`${id}/${note.key}`);
  if (where.length === 0) {
    return check('CLEAN_ARITHMETIC', 'PASS', 'No cell reported a note.', 0, 0);
  }
  return check(
    'CLEAN_ARITHMETIC',
    'FAIL',
    `${where.length} cells divided by zero or produced a non-finite value.`,
    where.length,
    0,
    sortedUnique(where),
  );
}

/**
 * Resolved assumption values against their own declared bounds.
 *
 * A warning and never a failure, deliberately, and for the reason ./scenario gives for allowing it
 * in the first place: a stress test that stays inside the plausible range is not a stress test. What
 * the certificate adds is that the excursion is now written down beside the model rather than
 * discoverable only by opening the scenario.
 */
function withinRange(runs: ReadonlyMap<string, ModelRun>): Check {
  if (runs.size === 0) {
    return check('WITHIN_RANGE', 'UNMEASURED', 'No run produced a resolution to inspect.');
  }
  const where: string[] = [];
  for (const [id, run] of runs) {
    for (const one of run.resolution.outOfRange) where.push(`${id}/${one.key}`);
  }
  if (where.length === 0) {
    return check('WITHIN_RANGE', 'PASS', 'Every scenario value sits inside its declared range.', 0, 0);
  }
  return check(
    'WITHIN_RANGE',
    'WARN',
    `${where.length} scenario values sit outside their assumption's declared range.`,
    where.length,
    0,
    sortedUnique(where),
  );
}

/**
 * How much of the model a tornado can actually reach.
 *
 * Measured from ./sensitivity's own answer rather than by re-counting bounds here, so the
 * certificate cannot disagree with the chart: the bars are the assumptions that were swept and
 * `unranged` is exactly the list of ones that could not be, including the zero-width ranges a
 * naive count of non-null bounds would score as ranged.
 */
function rangesDeclared(
  swept: number,
  unranged: readonly string[],
  total: number,
  minRanged: number,
): Check {
  if (total === 0) {
    return check('RANGES_DECLARED', 'UNMEASURED', 'No assumptions are declared.');
  }
  const threshold = Math.ceil(total * minRanged);
  if (swept >= threshold) {
    return check(
      'RANGES_DECLARED',
      'PASS',
      `${swept} of ${total} assumptions carry a range that can be stressed.`,
      swept,
      threshold,
    );
  }
  return check(
    'RANGES_DECLARED',
    'WARN',
    `${swept} of ${total} assumptions can be stressed; ${threshold} needed. The rest have no `
    + 'plausible range for anybody to test, so a tornado covers less of the model than it appears to.',
    swept,
    threshold,
    unranged,
  );
}

/**
 * Whether the number being certified moves at all.
 *
 * Zero movement from every ranged assumption is a failure and not a curiosity: either nothing
 * reaches the target, or everything that does is being clamped or multiplied by zero. A target
 * nothing moves cannot be planned with, and a tornado of empty bars looks like a robust plan.
 */
function targetResponds(bars: readonly { readonly key: string; readonly swing: number }[]): Check {
  if (bars.length === 0) {
    return check('TARGET_RESPONDS', 'UNMEASURED', 'No assumption had a range to move the target with.');
  }
  const moving = bars.filter((bar) => bar.swing !== 0);
  if (moving.length === 0) {
    return check(
      'TARGET_RESPONDS',
      'FAIL',
      `None of the ${bars.length} stressed assumptions moved the target at all.`,
      0,
      1,
      sortedUnique(bars.map((bar) => bar.key)),
    );
  }
  return check(
    'TARGET_RESPONDS',
    'PASS',
    `${moving.length} of ${bars.length} stressed assumptions move the target.`,
    moving.length,
    1,
  );
}

/** Structural, so it needs no runs: ./graph already holds the reverse edges and ./sensitivity's
 *  `reachOf` walks them. An assumption reaching nothing is a slider wired to no formula. */
function noDeadAssumptions(model: CompiledModel): Check {
  const total = model.spec.assumptions.length;
  if (total === 0) return check('NO_DEAD_ASSUMPTIONS', 'UNMEASURED', 'No assumptions are declared.');
  const dead = model.spec.assumptions
    .filter((one) => reachOf(model, one.key).length === 0)
    .map((one) => one.key);
  if (dead.length === 0) {
    return check('NO_DEAD_ASSUMPTIONS', 'PASS', `All ${total} assumptions reach at least one row.`, 0, 0);
  }
  return check(
    'NO_DEAD_ASSUMPTIONS',
    'FAIL',
    `${dead.length} assumptions reach no row. Moving them changes nothing, and a screen that `
    + 'offers them says otherwise.',
    dead.length,
    0,
    sortedUnique(dead),
  );
}

/** The longest same-period chain, from ./graph's `depth`. A warning past the threshold rather than
 *  a failure — a deep model is hard to audit, which is not the same as being wrong. */
function auditableDepth(model: CompiledModel, maxDepth: number): Check {
  const depths = [...model.graph.depth.values()];
  if (depths.length === 0) {
    return check('AUDITABLE_DEPTH', 'UNMEASURED', 'The graph has no rows to measure.');
  }
  let deepest = 0;
  for (const one of depths) deepest = Math.max(deepest, one);
  const deepestKeys = [...model.graph.depth]
    .filter(([, one]) => one === deepest)
    .map(([key]) => key);
  if (deepest <= maxDepth) {
    return check(
      'AUDITABLE_DEPTH',
      'PASS',
      `The longest dependency chain is ${deepest} deep.`,
      deepest,
      maxDepth,
    );
  }
  return check(
    'AUDITABLE_DEPTH',
    'WARN',
    `The longest dependency chain is ${deepest} deep, past ${maxDepth}. A reader cannot trace a `
    + 'number back to its inputs in one sitting.',
    deepest,
    maxDepth,
    sortedUnique(deepestKeys),
  );
}

/**
 * The one check that cannot fail.
 *
 * Held rows are the ordinary shape of a model with actuals: three months stated, nine inherited.
 * The check exists because the *chart* cannot say which is which — a flat line reads as a forecast
 * somebody made — so certification's job here is disclosure rather than judgement, and a nonzero
 * count beside a `PASS` is exactly what it should read as.
 */
function heldRows(subject: ModelRun | undefined): Check {
  if (subject === undefined) {
    return check('HELD_ROWS_DISCLOSED', 'UNMEASURED', 'The certifying scenario did not run.');
  }
  const keys = subject.held.map((one) => one.key);
  const detail = keys.length === 0
    ? 'Every given row states a value for every period.'
    : `${keys.length} given rows run out of values before the horizon does and are held flat `
      + 'from there. The values after that point are inherited, not forecast.';
  return check('HELD_ROWS_DISCLOSED', 'PASS', detail, keys.length, null, sortedUnique(keys));
}

/* --------------------------------------------------------------- assembly ---- */

/**
 * The grade, derived.
 *
 * Written as a function of the outcomes and nothing else, so that there is no argument to it that
 * a caller could use to raise a grade. `UNMEASURED` caps at `PROVISIONAL` for the same reason a
 * `WARN` does: a check that could not run is a check nobody has passed, and treating silence as
 * assent would grade an empty model higher than a real one.
 */
function gradeOf(checks: readonly Check[]): Grade {
  if (checks.some((one) => one.outcome === 'FAIL')) return 'UNCERTIFIED';
  if (checks.some((one) => one.outcome === 'WARN' || one.outcome === 'UNMEASURED')) {
    return 'PROVISIONAL';
  }
  return 'CERTIFIED';
}

const countOf = (checks: readonly Check[], outcome: Outcome): number => (
  checks.filter((one) => one.outcome === outcome).length
);

/**
 * Measure a model against one target under one scenario.
 *
 * The target is a parameter rather than a property of the model because certification is always
 * *of something*: "the model is sound" is not a claim anybody can check, while "EBITDA in month
 * twelve responds to nine of eleven assumptions and no cell divides by zero in any scenario" is.
 * Two certificates of one model against two targets are both true and say different things.
 *
 * Runs every scenario once, then one tornado over the certifying scenario — so the cost is
 * `scenarios + 2·ranged + 1` runs of a model that was compiled once. Everything else is a walk
 * over what those runs already produced, which is why the certificate can be recomputed on a
 * change rather than stored and trusted.
 */
export function certify(
  model: CompiledModel,
  scenarioId: string,
  target: Target,
  settings: CertifySettings = {},
): Certificate {
  const maxDepth = settings.maxDepth ?? 12;
  const minScenarios = settings.minScenarios ?? 2;
  const minRanged = settings.minRanged ?? 2 / 3;

  const runs = new Map<string, ModelRun>();
  const broken: string[] = [];
  for (const one of model.spec.scenarios) {
    const run = runCompiled(model, one.id);
    if (run.ok) runs.set(one.id, run.run);
    else broken.push(one.id);
  }
  const subject = runs.get(scenarioId);

  // One tornado, read by two checks. Failure here is not a finding about the model's soundness —
  // it means the target names a row the run has no series for, or the scenario did not resolve —
  // so both checks it feeds report UNMEASURED rather than inventing a verdict from the absence.
  const swings = tornado(model, scenarioId, target);
  const bars = swings.ok ? swings.value.bars : [];
  const unranged = swings.ok ? swings.value.unranged : [];

  const checks: readonly Check[] = [
    scenariosRun(model.spec.scenarios.length, runs.size, broken),
    scenarioCount(model.spec.scenarios.length, minScenarios),
    cleanArithmetic(runs),
    withinRange(runs),
    swings.ok
      ? rangesDeclared(bars.length, unranged, model.spec.assumptions.length, minRanged)
      : check('RANGES_DECLARED', 'UNMEASURED', 'The target could not be measured, so nothing was swept.'),
    swings.ok
      ? targetResponds(bars)
      : check('TARGET_RESPONDS', 'UNMEASURED', 'The target could not be measured under this scenario.'),
    noDeadAssumptions(model),
    auditableDepth(model, maxDepth),
    heldRows(subject),
  ];

  const version = versionOf(model);
  return {
    grade: gradeOf(checks),
    resultsHash: version.resultsHash,
    fullHash: version.fullHash,
    scenario: scenarioId,
    target,
    checks,
    limitations: LIMITATIONS,
    passed: countOf(checks, 'PASS'),
    warned: countOf(checks, 'WARN'),
    failed: countOf(checks, 'FAIL'),
    unmeasured: countOf(checks, 'UNMEASURED'),
  };
}

/**
 * Whether a certificate describes the model in front of you.
 *
 * The reason the hash is on the certificate at all. A stored certificate is a claim about a model
 * as it was, and a model is edited in place; without this, a screen showing `CERTIFIED` beside a
 * model that has moved since is not merely stale but actively misleading. Compares `resultsHash`
 * rather than `fullHash`, because a renamed row does not invalidate a measurement — and a caller
 * that wants to know about the rename can compare the two hashes itself.
 */
export function certifies(certificate: Certificate, model: CompiledModel): boolean {
  return certificate.resultsHash === versionOf(model).resultsHash;
}
