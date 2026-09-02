/**
 * Assumptions, and the scenarios that change them.
 *
 * Two things live here because they are one idea seen from two sides. An assumption is a number
 * somebody chose, and a scenario is a claim about choosing it differently. Keeping them apart
 * would let a model hold an override for a number no assumption declares, which is the exact
 * failure a spreadsheet has when a "downside" tab is three months behind the base.
 *
 * A scenario carries only what it changes. That is what makes inheritance worth having: a
 * downside that restated every assumption would silently freeze the ones it did not mean to
 * touch, so the day the base's tax rate changed, every scenario built from it would keep the
 * old one and nobody would be told.
 *
 * The chain is resolved root-first, so a child's override wins over its parent's. Depth is not
 * limited, but a loop is refused — an inheritance cycle has no root, and there is no value to
 * resolve to.
 */

/** What kind of number an assumption is. Not cosmetic: it decides how a value is displayed, how
 *  a sweep steps it, and whether a bound of zero means anything. */
export type AssumptionUnit = 'CURRENCY' | 'RATE' | 'COUNT' | 'DAYS' | 'FACTOR';

/**
 * One declared input to the model.
 *
 * `low` and `high` are the plausible range rather than a validation rule, and they are what
 * ./sensitivity sweeps between and ./monte draws inside. An assumption with no range can still
 * be modelled; it just cannot be stressed, and a model that cannot stress its own inputs is
 * something ./certify has an opinion about.
 *
 * `note` is where the number came from. It is a string on the record rather than a comment
 * somewhere else, because the provenance of an assumption is the first thing asked about a
 * forecast and the last thing anybody can reconstruct.
 */
export interface Assumption {
  readonly key: string;
  readonly label: string;
  readonly unit: AssumptionUnit;
  readonly value: number;
  readonly low: number | null;
  readonly high: number | null;
  readonly note: string;
}

/** A named set of changes, and where it starts from. `baseId === null` is a root. */
export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly baseId: string | null;
  readonly overrides: ReadonlyMap<string, number>;
}

export type ScenarioIssueKind =
  /** The scenario asked for does not exist. */
  | 'NO_SCENARIO'
  /** A `baseId` pointing at nothing. Separated from NO_SCENARIO because the reader is holding a
   *  scenario that does exist and it is the parent that has gone. */
  | 'NO_BASE'
  /** An inheritance loop. */
  | 'CHAIN_CYCLE'
  /** An override on a key no assumption declares. */
  | 'UNDECLARED';

export interface ScenarioIssue {
  readonly kind: ScenarioIssueKind;
  /** The scenario id, or for UNDECLARED the assumption key. */
  readonly where: string;
  /** For CHAIN_CYCLE, the ids in the order they inherit: each inherits from the next, and the
   *  last inherits from the first. */
  readonly path: readonly string[];
}

/** An override that resolved but landed outside its assumption's declared range. A warning and
 *  not a refusal: a stress test that stays inside the plausible range is not a stress test. */
export interface OutOfRange {
  readonly key: string;
  readonly value: number;
  readonly low: number | null;
  readonly high: number | null;
}

export interface Resolution {
  /** Every declared assumption's value under this scenario, whether overridden or not. */
  readonly values: ReadonlyMap<string, number>;
  /** The chain, root first. What a screen prints as `Base → Downside → Downside + FX`. */
  readonly chain: readonly Scenario[];
  /** Which keys this resolution actually moved, and by which scenario. Sorted, so two readings
   *  of one scenario produce one list. */
  readonly changed: readonly { readonly key: string; readonly by: string }[];
  readonly outOfRange: readonly OutOfRange[];
}

export type ScenarioResult =
  | { readonly ok: true; readonly resolution: Resolution }
  | { readonly ok: false; readonly issues: readonly ScenarioIssue[] };

/**
 * Every assumption's value under one scenario.
 *
 * The chain is walked leaf-to-root to find it and applied root-to-leaf to resolve it, which is
 * the only order that makes a child's override win. Walking one direction and applying in the
 * same one would make the *root* authoritative, and an inheritance where the parent overrules
 * the child is not inheritance.
 */
export function resolveScenario(
  scenarios: readonly Scenario[],
  scenarioId: string,
  registry: readonly Assumption[],
): ScenarioResult {
  const byId = new Map(scenarios.map((one) => [one.id, one]));
  const chain = chainOf(byId, scenarioId);
  if (chain.kind === 'ISSUE') return { ok: false, issues: [chain.issue] };

  const declared = new Map(registry.map((one) => [one.key, one]));
  const undeclared: ScenarioIssue[] = [];
  const values = new Map<string, number>(registry.map((one) => [one.key, one.value]));
  const source = new Map<string, string>();

  for (const scenario of chain.chain) {
    for (const [key, value] of [...scenario.overrides].sort(byKey)) {
      if (!declared.has(key)) {
        undeclared.push({ kind: 'UNDECLARED', where: key, path: [scenario.id] });
        continue;
      }
      values.set(key, value);
      source.set(key, scenario.name);
    }
  }
  if (undeclared.length > 0) return { ok: false, issues: undeclared };

  return {
    ok: true,
    resolution: {
      values,
      chain: chain.chain,
      changed: [...source].sort(byKey).map(([key, by]) => ({ key, by })),
      outOfRange: ranges(values, source, declared),
    },
  };
}

const byKey = (left: readonly [string, unknown], right: readonly [string, unknown]): number => (
  left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0)
);

/** Only overridden values are range-checked. A declared value outside its own declared range is
 *  a registry that contradicts itself, and ./certify says so once rather than here every time a
 *  scenario is opened. */
function ranges(
  values: ReadonlyMap<string, number>,
  source: ReadonlyMap<string, string>,
  declared: ReadonlyMap<string, Assumption>,
): OutOfRange[] {
  const out: OutOfRange[] = [];
  for (const key of [...source.keys()].sort()) {
    const assumption = declared.get(key);
    const value = values.get(key);
    if (assumption === undefined || value === undefined) continue;
    const under = assumption.low !== null && value < assumption.low;
    const over = assumption.high !== null && value > assumption.high;
    if (under || over) {
      out.push({ key, value, low: assumption.low, high: assumption.high });
    }
  }
  return out;
}

type ChainOutcome =
  | { readonly kind: 'CHAIN'; readonly chain: readonly Scenario[] }
  | { readonly kind: 'ISSUE'; readonly issue: ScenarioIssue };

/**
 * The inheritance chain, root first.
 *
 * Walked child-to-parent because that is the only direction the data supports — a scenario knows
 * its base and a base knows nothing of its children — and reversed at the end so the caller can
 * apply it in the order that lets a child win.
 *
 * A missing base is not treated as a root. Silently rooting a scenario whose parent was deleted
 * would resolve it against raw declared values and call that an answer, when what actually
 * happened is that half of the reader's assumptions vanished.
 */
function chainOf(byId: ReadonlyMap<string, Scenario>, scenarioId: string): ChainOutcome {
  const leaf = byId.get(scenarioId);
  if (leaf === undefined) {
    return { kind: 'ISSUE', issue: { kind: 'NO_SCENARIO', where: scenarioId, path: [] } };
  }

  const seen = new Set<string>();
  const walk: Scenario[] = [];
  let current: Scenario | undefined = leaf;

  while (current !== undefined) {
    if (seen.has(current.id)) {
      const ids = walk.map((one) => one.id);
      return {
        kind: 'ISSUE',
        issue: {
          kind: 'CHAIN_CYCLE',
          where: current.id,
          path: ids.slice(ids.indexOf(current.id)),
        },
      };
    }
    seen.add(current.id);
    walk.push(current);

    const baseId: string | null = current.baseId;
    if (baseId === null) break;
    const parent = byId.get(baseId);
    if (parent === undefined) {
      return { kind: 'ISSUE', issue: { kind: 'NO_BASE', where: baseId, path: [current.id] } };
    }
    current = parent;
  }

  return { kind: 'CHAIN', chain: walk.reverse() };
}
