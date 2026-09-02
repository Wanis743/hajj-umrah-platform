/**
 * Where a number comes from, and who moved it.
 *
 * Two questions that look like one. "What drives EBITDA" is answered by structure: the formula
 * reads gross profit and overheads, gross profit reads revenue and cost, revenue reads price and
 * volume, and price and volume are assumptions somebody chose. That is a tree, it is already in
 * ./graph, and drawing it is most of what a driver tree is for — a reader who can see that a
 * ninety-row model has exactly four independent inputs understands it in a way that scrolling
 * ninety rows does not provide.
 *
 * "Why is EBITDA 1.2m higher than the plan" is a different question, and structure cannot answer
 * it. That needs attribution: which of the assumptions that changed is responsible for how much of
 * the movement. This file does both, and keeps them apart, because conflating them is how a
 * spreadsheet ends up with a bridge chart whose bars are the tree's rows — which attributes
 * movement to intermediate calculations rather than to the inputs anybody can act on.
 *
 * The attribution is one-at-a-time from a common base, and the leftover is reported rather than
 * spread. The alternative — walk the drivers in some order, moving each cumulatively so the bars
 * add up exactly — is what most bridges do, and it is order-dependent: the same two drivers swap
 * contributions when the sequence swaps, and whichever went last silently absorbs the entire
 * interaction. Since the order is arbitrary, so is the answer. Here the interaction is a named
 * quantity, which makes it visible when it is large — and a large interaction term is itself the
 * finding, because it means the drivers are not separable and no bridge of any construction should
 * be read as though they were.
 */
import { referencesOf } from './expression';
import { runCompiled } from './model';
import type { CompiledModel, ModelFailure, ModelRun } from './model';
import { resolveScenario } from './scenario';
import { measureRun } from './sensitivity';
import type { Target } from './sensitivity';

/**
 * One node of a driver tree.
 *
 * `value` is the node's own number at the period asked for, so the tree can be read as a
 * calculation rather than as a topology: a reader sees 4.2m decompose into 12.1m and 7.9m and can
 * check the arithmetic against the formula printed beside it.
 *
 * `repeated` is what stops a DAG pretending to be a tree. A model where three rows all read
 * `headcount` has three paths to it, and expanding each would draw the whole subtree three times
 * and — in a model with several diamonds — take exponential time to draw an exponentially
 * misleading picture. The first occurrence expands; later ones are marked and left closed, which
 * says something true and useful: this driver is shared, so moving it moves more than one branch.
 */
export interface DriverNode {
  readonly key: string;
  readonly label: string;
  /** From ./graph: the longest same-period chain ending here. Not the tree position — a node
   *  reached two levels down may have a depth of five, which is exactly the signal that it is also
   *  reached by a longer path somewhere else. */
  readonly depth: number;
  readonly value: number;
  readonly formula: string | null;
  /** True for an assumption or a given row: nothing below it is calculated. */
  readonly leaf: boolean;
  /**
   * True when the formula also reads an earlier period of something.
   *
   * Flagged rather than expanded into children. A roll-forward's prior balance is not a driver
   * anybody can act on — it is this row yesterday — and drawing it as a child would either recurse
   * forever on `cash = prior(cash) + net` or bury the one thing that does move the row, which is
   * `net`. The flag is still worth having, because a node whose value is mostly inherited from last
   * period responds to its same-period drivers far more slowly than the tree above it suggests.
   */
  readonly rollsForward: boolean;
  readonly repeated: boolean;
  readonly children: readonly DriverNode[];
}

export type DriverIssueKind =
  /** The root names a row the run has no series for. */
  | 'NO_ROOT'
  /** The period asked for is outside the horizon. */
  | 'NO_PERIOD'
  /** One of the two scenarios did not resolve, or the model did not run. */
  | 'RUN_FAILED'
  /** The target names a row the run has no series for. */
  | 'NO_TARGET'
  /** Both scenarios resolve every assumption identically, so there is no movement to attribute.
   *  Refused rather than answered with a table of zeroes, which reads as "nothing mattered". */
  | 'NO_DIFFERENCE';

export interface DriverIssue {
  readonly kind: DriverIssueKind;
  readonly where: string;
  readonly failure: ModelFailure | null;
}

/** One driver's share of a movement. */
export interface Contribution {
  readonly key: string;
  readonly label: string;
  readonly from: number;
  readonly to: number;
  /**
   * What the target does when this assumption alone moves from its `from` value to its `to` value,
   * every other assumption held at the base scenario's value.
   *
   * Signed, and signed relative to the movement being explained: a negative delta inside a
   * positive total is a driver that worked against the improvement, and that is usually the most
   * interesting bar on the chart.
   */
  readonly delta: number;
}

export interface Attribution {
  readonly target: Target;
  readonly fromScenario: string;
  readonly toScenario: string;
  readonly fromResult: number;
  readonly toResult: number;
  /** `toResult − fromResult`. What the bars have to explain. */
  readonly total: number;
  /** Largest absolute delta first, ties by key. */
  readonly contributions: readonly Contribution[];
  /**
   * `total` minus the sum of the deltas: everything the drivers do not explain separately.
   *
   * Zero for a purely additive model, and not zero the moment two drivers multiply — which is
   * most models, since revenue is price times volume. Reported as its own quantity because it is
   * the one number that says whether the rest of the table can be trusted as a decomposition: an
   * interaction the size of the largest bar means the drivers are not separable, and a reader who
   * cannot see it will confidently attribute a movement to the wrong cause.
   */
  readonly interaction: number;
}

export type DriverResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly DriverIssue[] };

const driverIssue = (
  kind: DriverIssueKind,
  where: string,
  failure: ModelFailure | null = null,
): DriverIssue => ({ kind, where, failure });

/* -------------------------------------------------------------------- tree ---- */

interface Meta {
  readonly label: string;
  readonly formula: string | null;
}

/** Label and formula for any key in the model. Assumptions have no formula by definition, so the
 *  two registries are searched in the order that makes a row's own label win — a key cannot be
 *  both, since ./model refuses that outright. */
function metaOf(model: CompiledModel, key: string): Meta {
  const row = model.spec.rows.find((one) => one.key === key);
  if (row !== undefined) return { label: row.label, formula: row.formula };
  const assumption = model.spec.assumptions.find((one) => one.key === key);
  if (assumption !== undefined) return { label: assumption.label, formula: null };
  return { label: key, formula: null };
}

/**
 * The tree below one row, at one period.
 *
 * Depth-limited and repeat-marked, both for the same reason: the thing being drawn is a DAG, and
 * the tree is a rendering of it rather than its true shape. Six levels is the default because a
 * driver tree deeper than that is not read — past six the reader is scrolling, and what they
 * actually want at that point is ./sensitivity's ordering rather than another level of structure.
 *
 * Children are the formula's same-period reads, in the order the formula reads them rather than
 * sorted. That order is the author's: `revenue − cost` puts revenue first, and re-sorting it to
 * `cost, revenue` would draw a subtraction as though the deduction came first.
 */
export function driverTree(
  model: CompiledModel,
  run: ModelRun,
  rootKey: string,
  period: number,
  maxDepth = 6,
): DriverResult<DriverNode> {
  if (!run.series.has(rootKey)) {
    return { ok: false, issues: [driverIssue('NO_ROOT', rootKey)] };
  }
  if (period < 0 || period >= run.periods.length) {
    return { ok: false, issues: [driverIssue('NO_PERIOD', String(period))] };
  }

  const expanded = new Set<string>();

  const build = (key: string, level: number): DriverNode => {
    const meta = metaOf(model, key);
    const line = run.series.get(key);
    // The AST is the whole test for "computed": ./model only holds one for a row with a formula,
    // so its absence is exactly what makes an assumption or a given row a leaf. Read from the
    // tree rather than re-parsing the source, so a node cannot claim a dependency the formula
    // does not have.
    const ast = model.asts.get(key);
    const reads = ast === undefined ? null : referencesOf(ast);
    const first = !expanded.has(key);
    expanded.add(key);

    const children = reads === null || !first || level >= maxDepth
      ? []
      : reads.direct.map((read) => build(read, level + 1));

    return {
      key,
      label: meta.label,
      depth: model.graph.depth.get(key) ?? 0,
      value: line === undefined ? 0 : (line[period] ?? 0),
      formula: meta.formula,
      leaf: reads === null,
      rollsForward: reads !== null && reads.lagged.length > 0,
      repeated: !first,
      children,
    };
  };

  return { ok: true, value: build(rootKey, 0) };
}

/* ------------------------------------------------------------- attribution ---- */

/**
 * Which assumptions differ between two scenarios, and by how much each one moves the target.
 *
 * Every delta is measured from the same base — the `from` scenario with exactly one assumption
 * replaced — which is what makes the contributions comparable to each other. The cost is that they
 * do not sum to the total, and the leftover is reported as `interaction` rather than hidden.
 *
 * Both scenarios are resolved rather than diffed by their `overrides`, because two scenarios can
 * reach the same value by different inheritance and an override that restates its parent's value
 * changes nothing. Diffing the declarations would list drivers with a delta of zero and omit ones
 * that moved because a shared parent moved.
 */
export function attribute(
  model: CompiledModel,
  fromScenario: string,
  toScenario: string,
  target: Target,
): DriverResult<Attribution> {
  const before = resolveScenario(model.spec.scenarios, fromScenario, model.spec.assumptions);
  if (!before.ok) {
    return {
      ok: false,
      issues: [driverIssue('RUN_FAILED', fromScenario, { stage: 'SCENARIO', issues: before.issues })],
    };
  }
  const after = resolveScenario(model.spec.scenarios, toScenario, model.spec.assumptions);
  if (!after.ok) {
    return {
      ok: false,
      issues: [driverIssue('RUN_FAILED', toScenario, { stage: 'SCENARIO', issues: after.issues })],
    };
  }

  const moved: { key: string; from: number; to: number }[] = [];
  for (const [key, value] of [...before.resolution.values].sort(byFirst)) {
    const target2 = after.resolution.values.get(key);
    if (target2 !== undefined && target2 !== value) moved.push({ key, from: value, to: target2 });
  }
  if (moved.length === 0) {
    return { ok: false, issues: [driverIssue('NO_DIFFERENCE', `${fromScenario}→${toScenario}`)] };
  }

  const fromResult = measureAt(model, fromScenario, new Map(), target);
  if (!fromResult.ok) return { ok: false, issues: [fromResult.issue] };
  const toResult = measureAt(model, toScenario, new Map(), target);
  if (!toResult.ok) return { ok: false, issues: [toResult.issue] };

  const contributions: Contribution[] = [];
  let explained = 0;
  for (const one of moved) {
    const shifted = measureAt(model, fromScenario, new Map([[one.key, one.to]]), target);
    if (!shifted.ok) return { ok: false, issues: [shifted.issue] };
    const delta = shifted.result - fromResult.result;
    explained += delta;
    contributions.push({
      key: one.key,
      label: metaOf(model, one.key).label,
      from: one.from,
      to: one.to,
      delta,
    });
  }

  const total = toResult.result - fromResult.result;
  return {
    ok: true,
    value: {
      target,
      fromScenario,
      toScenario,
      fromResult: fromResult.result,
      toResult: toResult.result,
      total,
      contributions: contributions.sort(byImpact),
      interaction: total - explained,
    },
  };
}

const byFirst = (left: readonly [string, number], right: readonly [string, number]): number => (
  left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0)
);

const byImpact = (left: Contribution, right: Contribution): number => {
  const size = Math.abs(right.delta) - Math.abs(left.delta);
  if (size !== 0) return size;
  return left.key < right.key ? -1 : (left.key > right.key ? 1 : 0);
};

type Measured =
  | { readonly ok: true; readonly result: number }
  | { readonly ok: false; readonly issue: DriverIssue };

function measureAt(
  model: CompiledModel,
  scenarioId: string,
  probe: ReadonlyMap<string, number>,
  target: Target,
): Measured {
  const run = runCompiled(model, scenarioId, probe);
  if (!run.ok) return { ok: false, issue: driverIssue('RUN_FAILED', scenarioId, run.failure) };
  const result = measureRun(run.run, target);
  if (result === undefined) return { ok: false, issue: driverIssue('NO_TARGET', target.key) };
  return { ok: true, result };
}
