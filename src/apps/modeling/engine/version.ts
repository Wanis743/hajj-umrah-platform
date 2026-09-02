/**
 * Whether two models are the same model, and if not, what changed.
 *
 * A number in a board pack is only evidence if somebody can say which model produced it. That is a
 * harder claim than it sounds: a spreadsheet emailed twice is two files with no way to tell whether
 * the second one is the first one, the first one re-saved, or the first one with a formula quietly
 * edited in row 84. Naming versions by hand — `plan_v3_final_FINAL.xlsx` — is the industry's answer
 * and it does not work, because the name is written by the same person who might have forgotten.
 *
 * So the version is computed from the content, and computed from the *canonical* content. Formulas
 * are printed back out of the parsed tree rather than hashed as typed, which means `a+b`, `a + b`
 * and `(a) + (b)` produce one hash: reformatting is not a change to a model, and a versioning
 * scheme that says it is will cry wolf until nobody reads it.
 *
 * Two hashes rather than one, and this is the part worth understanding. `resultsHash` covers exactly
 * what can change a number — formulas, given values, assumption values and ranges, scenario
 * inheritance, and the length of the horizon. `fullHash` also covers labels, units, notes, period
 * names and declaration order. When `resultsHash` matches and `fullHash` does not, that is a real
 * and useful finding: the plan is arithmetically identical and somebody rewrote its wording. A
 * single hash cannot say that, and would force a reviewer to re-check every number to discover that
 * none of them moved.
 *
 * The hash is FNV-1a over 64 bits. It is not cryptographic and must never be described as one:
 * anybody who can edit a model can compute a matching hash, so this proves *same model*, not
 * *approved model*. Whose approval a version carries is ./certify's question and a signature's job.
 */
import { parseFormula, printFormula } from './expression';
import type { CompiledModel, ModelRow, ModelSpec } from './model';
import type { Assumption, Scenario } from './scenario';

/**
 * One model's identity.
 *
 * `formulas` is kept beside the hashes because a hash that has changed tells a reader nothing about
 * where to look. The canonical text per row is what makes ./version usable rather than merely
 * correct: a diff can be computed against it later, by a screen that never saw the earlier spec.
 */
export interface ModelVersion {
  /** Everything that can change a number. Sixteen lowercase hex digits. */
  readonly resultsHash: string;
  /** The above, plus labels, units, notes, period names and declaration order. */
  readonly fullHash: string;
  readonly periods: number;
  readonly rows: number;
  readonly assumptions: number;
  readonly scenarios: number;
  /** Canonical printed formula per computed row, keyed by row. Given rows are absent rather than
   *  present with null, so the map's size is the count of rows the model calculates. */
  readonly formulas: ReadonlyMap<string, string>;
}

export type ChangeKind =
  /** The horizon grew or shrank. Listed first in a diff because it moves every row at once. */
  | 'PERIODS_CHANGED'
  /** Period names differ at the same length. Presentation, and still worth reporting: a plan
   *  relabelled from months to quarters without changing its length is almost always a mistake. */
  | 'PERIOD_LABELS_CHANGED'
  | 'ROW_ADDED'
  | 'ROW_REMOVED'
  /** Canonical formulas differ. Reformatting alone does not reach this. */
  | 'FORMULA_CHANGED'
  /** A row went from told to calculated, or back. Not reported as a formula change, because it is
   *  a change of kind and a reviewer reads the two differently. */
  | 'ROW_KIND_CHANGED'
  | 'GIVEN_CHANGED'
  | 'UNIT_CHANGED'
  | 'LABEL_CHANGED'
  | 'ASSUMPTION_ADDED'
  | 'ASSUMPTION_REMOVED'
  | 'VALUE_CHANGED'
  /** `low` or `high` moved. Separate from `VALUE_CHANGED` because a range is what ./sensitivity
   *  sweeps and ./monte draws from: widening it changes every risk number without changing the
   *  plan, which is precisely the change a value-only diff would hide. */
  | 'RANGE_CHANGED'
  | 'SCENARIO_ADDED'
  | 'SCENARIO_REMOVED'
  /** The scenario's parent moved, so everything it inherits may have moved with it. */
  | 'PARENT_CHANGED'
  | 'OVERRIDE_ADDED'
  | 'OVERRIDE_REMOVED'
  | 'OVERRIDE_CHANGED';

/**
 * One difference, with both sides.
 *
 * `before` and `after` are rendered strings rather than typed values because a diff is read, not
 * computed against — and because one shape has to carry a formula, a number, a unit and a list of
 * period values. Null means absent on that side.
 */
export interface Change {
  readonly kind: ChangeKind;
  /** The key, scenario id, or `scenario/assumption` for an override. */
  readonly where: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** True when nothing in the diff can move a number. The presentation-only kinds are listed
 *  explicitly rather than derived, so that adding a kind forces a decision about which it is. */
const PRESENTATION: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  'PERIOD_LABELS_CHANGED',
  'LABEL_CHANGED',
  'UNIT_CHANGED',
]);

export interface Comparison {
  readonly before: ModelVersion;
  readonly after: ModelVersion;
  /** Same numbers. `resultsHash` matched. */
  readonly sameResults: boolean;
  /** Same everything. */
  readonly identical: boolean;
  /** Structural first, then by key. Empty exactly when `identical`. */
  readonly changes: readonly Change[];
  /** True when every change is presentation. Distinct from `sameResults` only in that it is
   *  derived from the changes rather than from the hash, and the two agreeing is the cheapest
   *  check available that the canonical form and the diff are describing the same model. */
  readonly cosmetic: boolean;
}

/* -------------------------------------------------------------------- hash ---- */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/**
 * FNV-1a, 64 bits, over UTF-16 code units taken low byte first.
 *
 * Two bytes per code unit rather than one, so that a character above 0xff cannot collide with a
 * different character sharing its low byte — `Ā` and `\u0000` are not the same string and must
 * not hash alike. Written out rather than taken from a dependency because it has to be identical
 * forever: a hash whose algorithm changes in a minor release invalidates every version anybody has
 * recorded, silently, and there is no migration for that.
 *
 * Not cryptographic. FNV is trivially invertible and collisions can be constructed on purpose. It
 * is chosen for being deterministic, dependency-free and synchronous — `crypto.subtle.digest` is
 * async, and a version that cannot be computed inside a render is a version nobody displays.
 */
export function hash64(text: string): string {
  let value = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    value = ((value ^ BigInt(code & 0xff)) * FNV_PRIME) & MASK;
    value = ((value ^ BigInt(code >>> 8)) * FNV_PRIME) & MASK;
  }
  return value.toString(16).padStart(16, '0');
}

/**
 * The canonical text of one formula, or the source when it does not parse.
 *
 * A draft that does not compile still has to be diffable — that is most of what a reviewer looks at
 * — so an unparseable formula is folded in as its trimmed source with a marker. The marker matters:
 * without it, a source that happens to print identically to a canonical form would compare equal to
 * a formula that works, and a diff would report no change across a break.
 */
export function canonicalFormula(source: string): string {
  const parsed = parseFormula(source);
  return parsed.ok ? printFormula(parsed.ast) : `?${source.trim()}`;
}

/* --------------------------------------------------------------- canonical ---- */

/**
 * A number, written the same way every time.
 *
 * `JSON.stringify` would do for most values and not for all of them: `-0` serialises as `0`, and
 * `1e21` as `1e+21` while `1e20` stays `100000000000000000000`. Neither difference means anything to
 * a model, and both would produce two hashes for one plan. `Infinity` and `NaN` cannot reach a
 * compiled model — ./evaluate guarantees finite — but a *spec* can carry them from storage, and a
 * silent `null` for those would hash a broken model as though a field were missing.
 */
function num(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  if (value === 0) return '0';
  return value.toExponential(15);
}

const escape = (text: string): string => text.replace(/[\\\n|]/g, (char) => (
  char === '\\' ? '\\\\' : (char === '\n' ? '\\n' : '\\|')
));

/**
 * Row lines for the results hash: key, kind, canonical formula or given values.
 *
 * Sorted by key, because the order rows are declared in changes what a screen shows and nothing
 * about what it computes — ./graph decides evaluation order from the dependencies, not from this
 * list. A model whose rows were dragged into a nicer order is the same model.
 *
 * Given values are hashed at their declared length, not padded to the horizon. Holding flat is
 * ./model's rule applied at run time and the same three actuals mean the same thing under a
 * twelve-month and an eighteen-month horizon; padding them here would make the horizon change look
 * like every given row changed too.
 */
function rowLines(rows: readonly ModelRow[]): string[] {
  return [...rows]
    .sort((left, right) => (left.key < right.key ? -1 : (left.key > right.key ? 1 : 0)))
    .map((row) => (row.formula === null
      ? `r|${escape(row.key)}|given|${row.given.map(num).join(',')}`
      : `r|${escape(row.key)}|calc|${escape(canonicalFormula(row.formula))}`));
}

/** Assumption lines: key, value, and the range ./sensitivity and ./monte read. A null bound is
 *  written as `-` rather than omitted, so that a bound removed cannot hash the same as a model
 *  that never had one. */
function assumptionLines(assumptions: readonly Assumption[]): string[] {
  return [...assumptions]
    .sort((left, right) => (left.key < right.key ? -1 : (left.key > right.key ? 1 : 0)))
    .map((one) => [
      'a',
      escape(one.key),
      num(one.value),
      one.low === null ? '-' : num(one.low),
      one.high === null ? '-' : num(one.high),
    ].join('|'));
}

/** Scenario lines: id, parent, and overrides sorted by key. The parent is part of the results
 *  because inheritance is: a scenario re-pointed at a different base resolves to different
 *  numbers without a single one of its own overrides changing. */
function scenarioLines(scenarios: readonly Scenario[]): string[] {
  return [...scenarios]
    .sort((left, right) => (left.id < right.id ? -1 : (left.id > right.id ? 1 : 0)))
    .map((one) => {
      const overrides = [...one.overrides]
        .sort((left, right) => (left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0)))
        .map(([key, value]) => `${escape(key)}=${num(value)}`)
        .join(',');
      return `s|${escape(one.id)}|${one.baseId === null ? '-' : escape(one.baseId)}|${overrides}`;
    });
}

/**
 * The exact text whose hash is `resultsHash`.
 *
 * Exported because a hash nobody can reproduce is a hash nobody can trust. When two systems
 * disagree about a version — a screen and a stored record, say — the only way to find out why is to
 * compare the canonical forms, and that is impossible if the only public surface is the digest.
 *
 * The horizon appears as its length alone. Period *names* are presentation: renaming `M1` to
 * `Jan-26` moves no number, and a results hash that changed would tell a reviewer to re-check
 * ninety rows for nothing.
 */
export function canonicalResults(spec: ModelSpec): string {
  return [
    `p|${spec.periods.length}`,
    ...rowLines(spec.rows),
    ...assumptionLines(spec.assumptions),
    ...scenarioLines(spec.scenarios),
  ].join('\n');
}

/**
 * The exact text whose hash is `fullHash`: the results form, plus everything a reader sees.
 *
 * Declaration order is included here and nowhere else, as a single line of keys. That is the honest
 * place for it — reordering rows changes the screen and not the answer — and keeping it to one line
 * means a reorder produces one differing line rather than making every row look edited.
 */
export function canonicalFull(spec: ModelSpec): string {
  return [
    canonicalResults(spec),
    `pl|${spec.periods.map(escape).join(',')}`,
    `ro|${spec.rows.map((row) => escape(row.key)).join(',')}`,
    ...[...spec.rows]
      .sort((left, right) => (left.key < right.key ? -1 : (left.key > right.key ? 1 : 0)))
      .map((row) => `rm|${escape(row.key)}|${escape(row.label)}|${row.unit}`),
    `ao|${spec.assumptions.map((one) => escape(one.key)).join(',')}`,
    ...[...spec.assumptions]
      .sort((left, right) => (left.key < right.key ? -1 : (left.key > right.key ? 1 : 0)))
      .map((one) => `am|${escape(one.key)}|${escape(one.label)}|${one.unit}|${escape(one.note)}`),
    ...[...spec.scenarios]
      .sort((left, right) => (left.id < right.id ? -1 : (left.id > right.id ? 1 : 0)))
      .map((one) => `sm|${escape(one.id)}|${escape(one.name)}`),
  ].join('\n');
}

/**
 * The version of a compiled model.
 *
 * Takes a `CompiledModel` rather than a spec, so that a version can only be minted for something
 * that actually runs. A recorded version pointing at a model that does not compile is worse than no
 * version at all: it looks like evidence and cannot produce a number.
 */
export function versionOf(model: CompiledModel): ModelVersion {
  const { spec } = model;
  const formulas = new Map<string, string>();
  for (const [key, ast] of model.asts) formulas.set(key, printFormula(ast));

  return {
    resultsHash: hash64(canonicalResults(spec)),
    fullHash: hash64(canonicalFull(spec)),
    periods: spec.periods.length,
    rows: spec.rows.length,
    assumptions: spec.assumptions.length,
    scenarios: spec.scenarios.length,
    formulas,
  };
}

/** The version of a spec that may not compile, for diffing a draft. Same canonical form, so a
 *  draft's hash is directly comparable to a compiled model's — with unparseable formulas folded
 *  in as marked source by `canonicalFormula`. */
export function versionOfSpec(spec: ModelSpec): ModelVersion {
  const formulas = new Map<string, string>();
  for (const row of spec.rows) {
    if (row.formula !== null) formulas.set(row.key, canonicalFormula(row.formula));
  }
  return {
    resultsHash: hash64(canonicalResults(spec)),
    fullHash: hash64(canonicalFull(spec)),
    periods: spec.periods.length,
    rows: spec.rows.length,
    assumptions: spec.assumptions.length,
    scenarios: spec.scenarios.length,
    formulas,
  };
}

/* -------------------------------------------------------------------- diff ---- */

const change = (
  kind: ChangeKind,
  where: string,
  before: string | null,
  after: string | null,
): Change => ({ kind, where, before, after });

/** `[key, before, after]` for every key on either side, in sorted key order, with undefined for a
 *  side the key is absent from. One walk, so that added, removed and changed are decided in the
 *  same place and a key cannot be reported as two of them. */
function pairs<T>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (one: T) => string,
): [string, T | undefined, T | undefined][] {
  const left = new Map(before.map((one) => [keyOf(one), one]));
  const right = new Map(after.map((one) => [keyOf(one), one]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys.map((key) => [key, left.get(key), right.get(key)]);
}

/** Formula, kind, given values, label and unit. A row that changed from told to calculated is
 *  reported once as `ROW_KIND_CHANGED` and not also as a formula or given change, because the two
 *  sides are not comparable and printing `— → revenue * price` reads as nonsense. */
function rowChanges(before: readonly ModelRow[], after: readonly ModelRow[]): Change[] {
  const out: Change[] = [];
  for (const [key, left, right] of pairs(before, after, (one) => one.key)) {
    if (left === undefined || right === undefined) {
      const one = left ?? right;
      if (one === undefined) continue;
      const shown = one.formula === null
        ? one.given.join(', ')
        : canonicalFormula(one.formula);
      out.push(left === undefined
        ? change('ROW_ADDED', key, null, shown)
        : change('ROW_REMOVED', key, shown, null));
      continue;
    }
    if ((left.formula === null) !== (right.formula === null)) {
      out.push(change('ROW_KIND_CHANGED', key,
        left.formula === null ? 'given' : 'calculated',
        right.formula === null ? 'given' : 'calculated'));
    } else if (left.formula !== null && right.formula !== null) {
      const one = canonicalFormula(left.formula);
      const two = canonicalFormula(right.formula);
      if (one !== two) out.push(change('FORMULA_CHANGED', key, one, two));
    } else if (left.given.map(num).join(',') !== right.given.map(num).join(',')) {
      out.push(change('GIVEN_CHANGED', key, left.given.join(', '), right.given.join(', ')));
    }
    if (left.unit !== right.unit) out.push(change('UNIT_CHANGED', key, left.unit, right.unit));
    if (left.label !== right.label) out.push(change('LABEL_CHANGED', key, left.label, right.label));
  }
  return out;
}

/** Value, range, label and unit. Value and range are reported separately even when both moved:
 *  they are read by different things — the plan reads the value, ./monte draws from the range — and
 *  a reviewer checking whether the risk numbers moved should not have to infer it. */
function assumptionChanges(
  before: readonly Assumption[],
  after: readonly Assumption[],
): Change[] {
  const out: Change[] = [];
  const range = (one: Assumption): string => (
    `${one.low === null ? '—' : one.low} … ${one.high === null ? '—' : one.high}`
  );
  for (const [key, left, right] of pairs(before, after, (one) => one.key)) {
    if (left === undefined || right === undefined) {
      const one = left ?? right;
      if (one === undefined) continue;
      out.push(left === undefined
        ? change('ASSUMPTION_ADDED', key, null, String(one.value))
        : change('ASSUMPTION_REMOVED', key, String(one.value), null));
      continue;
    }
    if (num(left.value) !== num(right.value)) {
      out.push(change('VALUE_CHANGED', key, String(left.value), String(right.value)));
    }
    if (left.low !== right.low || left.high !== right.high) {
      out.push(change('RANGE_CHANGED', key, range(left), range(right)));
    }
    if (left.unit !== right.unit) out.push(change('UNIT_CHANGED', key, left.unit, right.unit));
    if (left.label !== right.label) out.push(change('LABEL_CHANGED', key, left.label, right.label));
  }
  return out;
}

/** Parent, then overrides one key at a time. Overrides are keyed `scenario/assumption` so a diff
 *  across ten scenarios that all moved the same driver reads as ten lines about that driver rather
 *  than ten identical lines about "overrides". */
function scenarioChanges(before: readonly Scenario[], after: readonly Scenario[]): Change[] {
  const out: Change[] = [];
  for (const [id, left, right] of pairs(before, after, (one) => one.id)) {
    if (left === undefined || right === undefined) {
      const one = left ?? right;
      if (one === undefined) continue;
      out.push(left === undefined
        ? change('SCENARIO_ADDED', id, null, one.name)
        : change('SCENARIO_REMOVED', id, one.name, null));
      continue;
    }
    if (left.baseId !== right.baseId) {
      out.push(change('PARENT_CHANGED', id, left.baseId, right.baseId));
    }
    if (left.name !== right.name) out.push(change('LABEL_CHANGED', id, left.name, right.name));

    for (const key of [...new Set([...left.overrides.keys(), ...right.overrides.keys()])].sort()) {
      const one = left.overrides.get(key);
      const two = right.overrides.get(key);
      const where = `${id}/${key}`;
      if (one === undefined && two !== undefined) {
        out.push(change('OVERRIDE_ADDED', where, null, String(two)));
      } else if (one !== undefined && two === undefined) {
        out.push(change('OVERRIDE_REMOVED', where, String(one), null));
      } else if (one !== undefined && two !== undefined && num(one) !== num(two)) {
        out.push(change('OVERRIDE_CHANGED', where, String(one), String(two)));
      }
    }
  }
  return out;
}

/**
 * Everything that differs between two specs, and whether any of it can move a number.
 *
 * The horizon comes first because it is the one change that moves every row at once, and a reviewer
 * who reads "twelve periods became thirteen" first will interpret the ninety row changes below it
 * correctly rather than as ninety separate edits.
 *
 * `cosmetic` is computed from the changes and `sameResults` from the hashes, deliberately by two
 * different routes over the same two specs. They should always agree; when they do not, one of the
 * two is wrong about what counts as content, and that disagreement is far easier to notice with
 * both present than with either alone.
 */
export function compareSpecs(before: ModelSpec, after: ModelSpec): Comparison {
  const changes: Change[] = [];
  if (before.periods.length !== after.periods.length) {
    changes.push(change('PERIODS_CHANGED', '',
      String(before.periods.length), String(after.periods.length)));
  } else if (before.periods.join(',') !== after.periods.join(',')) {
    changes.push(change('PERIOD_LABELS_CHANGED', '',
      before.periods.join(', '), after.periods.join(', ')));
  }

  changes.push(
    ...rowChanges(before.rows, after.rows),
    ...assumptionChanges(before.assumptions, after.assumptions),
    ...scenarioChanges(before.scenarios, after.scenarios),
  );

  const left = versionOfSpec(before);
  const right = versionOfSpec(after);
  return {
    before: left,
    after: right,
    sameResults: left.resultsHash === right.resultsHash,
    identical: left.fullHash === right.fullHash,
    changes,
    cosmetic: changes.length > 0 && changes.every((one) => PRESENTATION.has(one.kind)),
  };
}


