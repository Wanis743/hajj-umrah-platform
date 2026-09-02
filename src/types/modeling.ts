/**
 * The wire shapes for the modelling store.
 *
 * These are not the engine's types. The engine's `ModelSpec` holds a
 * `ReadonlyMap<string, number>` of overrides and its `Scenario.baseId` names another
 * scenario by id; JSON has no map, and the database's identifier is a user-typed key.
 * So there are two vocabularies on purpose, and exactly one place that translates
 * between them -- `toSpec` in `src/services/modelingStore.ts`.
 *
 * The alternative was to make the engine read whatever PostgREST returns, which would
 * have put a JSON shape inside a pure computation and made every engine test build a
 * payload. The translation is twenty lines. The coupling would have been permanent.
 *
 * Everything here is `readonly` and every field is spelled as the SQL emits it, so a
 * mismatch is a compile error rather than an `undefined` reaching a chart.
 */

import type {
  Assumption,
  AssumptionUnit,
  Check,
  CheckKind,
  Grade,
  ModelRow,
  ModelSpec,
  Outcome,
  Scenario,
  TargetKind,
} from '@/apps/modeling/engine';

/* -------------------------------------------------------------- vocabulary ---- */

/**
 * Every closed set the wire carries, written once.
 *
 * Each list is built from a `Record<Union, true>` rather than declared as an array,
 * and that is the whole point of the helper: a record literal must name every member
 * of its key type, so adding a `CheckKind` to the engine and forgetting it here stops
 * the build. An array would have accepted the omission, and the parser in
 * `src/services/modelingStore.ts` would have begun refusing certificates at runtime
 * -- on a screen, in front of somebody, for a reason no test would have found.
 *
 * One list per set, used by both the parser and the pickers, so there is nothing for
 * a second copy to disagree with.
 *
 * It is written as an overload over a looser implementation because `Object.keys` is
 * typed `(o: object) => string[]`, and `string[] as readonly T[]` is a conversion the
 * compiler refuses on principle: `T` could be instantiated with a narrower subtype of
 * `string` than the keys it is handed. The refusal is correct in general and wrong
 * here -- the keys of a `Record<T, true>` are exactly `T` -- and the two-signature
 * form says so without an assertion, which is better than `as unknown as` because the
 * double cast would also have silenced a genuine mistake in the same position.
 */
function keysOf<T extends string>(members: Readonly<Record<T, true>>): readonly T[];
function keysOf(members: Readonly<Record<string, true>>): readonly string[] {
  return Object.keys(members);
}

/** Mirrors `modeling_models_status_check`. */
export type ModelingStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const MODELING_STATUSES = keysOf<ModelingStatus>({
  DRAFT: true, PUBLISHED: true, ARCHIVED: true,
});

export const MODELING_UNITS = keysOf<AssumptionUnit>({
  CURRENCY: true, RATE: true, COUNT: true, DAYS: true, FACTOR: true,
});

export const MODELING_GRADES = keysOf<Grade>({
  CERTIFIED: true, PROVISIONAL: true, UNCERTIFIED: true,
});

export const MODELING_OUTCOMES = keysOf<Outcome>({
  PASS: true, WARN: true, FAIL: true, UNMEASURED: true,
});

export const MODELING_TARGET_KINDS = keysOf<TargetKind>({
  AT: true, TOTAL: true, FINAL: true,
});

export const MODELING_CHECK_KINDS = keysOf<CheckKind>({
  SCENARIOS_RUN: true,
  SCENARIO_COUNT: true,
  CLEAN_ARITHMETIC: true,
  WITHIN_RANGE: true,
  RANGES_DECLARED: true,
  NO_DEAD_ASSUMPTIONS: true,
  TARGET_RESPONDS: true,
  AUDITABLE_DEPTH: true,
  HELD_ROWS_DISCLOSED: true,
});

/* -------------------------------------------------------------- the header ---- */

/** The `model` object inside `get_modeling_spec`. */
export interface ModelingHeader {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly description: string | null;
  readonly status: ModelingStatus;
  readonly version: number;
  /** What the client claimed the model hashed to when it was published. Never a
   *  server measurement -- `certifies()` is what can refute it. */
  readonly publishedHash: string | null;
  readonly publishedAt: string | null;
  readonly updatedAt: string;
}

/* ---------------------------------------------------------------- the spec ---- */

export interface ModelingRowWire {
  readonly key: string;
  readonly label: string;
  readonly labelAr: string | null;
  readonly unit: AssumptionUnit;
  /** Exclusive with a non-empty `given`; the table refuses both. */
  readonly formula: string | null;
  readonly given: readonly number[];
  readonly note: string;
}

export interface ModelingAssumptionWire {
  readonly key: string;
  readonly label: string;
  readonly labelAr: string | null;
  readonly unit: AssumptionUnit;
  readonly value: number;
  readonly low: number | null;
  readonly high: number | null;
  readonly note: string;
}

export interface ModelingScenarioWire {
  /** The scenario's key. Emitted as `id` because that is what `Scenario.baseId`
   *  points at, and the engine must not have to know the two words are the same. */
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly baseId: string | null;
  readonly note: string;
  /** Assumption key to value. An object rather than a map, because JSON. */
  readonly overrides: Readonly<Record<string, number>>;
}

export interface ModelingSpecWire {
  readonly model: ModelingHeader;
  readonly periods: readonly string[];
  readonly rows: readonly ModelingRowWire[];
  readonly assumptions: readonly ModelingAssumptionWire[];
  readonly scenarios: readonly ModelingScenarioWire[];
}

/** What the store hands the rest of the app: the header, and a spec the engine can
 *  compile without further conversion. The two travel together because a spec with
 *  no header cannot be published and a header with no spec cannot be run. */
export interface ModelingDocument {
  readonly header: ModelingHeader;
  readonly spec: ModelSpec;
  /** Kept for the editors, which need `labelAr` and `note` -- fields the engine has
   *  no use for and therefore does not carry. */
  readonly wire: ModelingSpecWire;
}

/* ------------------------------------------------------------- the listing ---- */

export interface ModelingOverviewRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly status: ModelingStatus;
  readonly version: number;
  readonly periods: number;
  readonly firstPeriod: string | null;
  readonly lastPeriod: string | null;
  readonly rows: number;
  readonly computedRows: number;
  readonly assumptions: number;
  readonly rangedAssumptions: number;
  readonly scenarios: number;
  readonly overrides: number;
  readonly publishedHash: string | null;
  readonly publishedAt: string | null;
  readonly updatedAt: string;
  readonly certificateGrade: Grade | null;
  readonly certificateAt: string | null;
  /** True when the newest certificate was issued against a different version of the
   *  model. It says the certificate is out of date; it does not say the model would
   *  fail, because that is a measurement and this is a comparison of two hashes. */
  readonly certificateStale: boolean;
}

/* --------------------------------------------------------- the certificate ---- */

export interface ModelingCertificateRow {
  readonly id: string;
  readonly grade: Grade;
  readonly scenario: string;
  readonly target: {
    readonly key: string;
    readonly kind: TargetKind;
    readonly period: number;
  };
  readonly resultsHash: string;
  readonly fullHash: string;
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly unmeasured: number;
  readonly checks: readonly Check[];
  readonly limitations: readonly string[];
  readonly createdAt: string;
  /** Whether `fullHash` still matches the model's published hash. */
  readonly describesCurrent: boolean;
}

/* -------------------------------------------------------------- the writes ---- */

export interface ModelingModelInput {
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly description: string | null;
  readonly periods: readonly string[];
}

export interface ModelingAssumptionInput {
  readonly key: string;
  readonly label: string;
  readonly labelAr: string | null;
  readonly unit: AssumptionUnit;
  readonly value: number;
  readonly low: number | null;
  readonly high: number | null;
  readonly note: string;
  readonly sortOrder: number;
}

export interface ModelingRowInput {
  readonly key: string;
  readonly label: string;
  readonly labelAr: string | null;
  readonly unit: AssumptionUnit;
  readonly formula: string | null;
  readonly given: readonly number[];
  readonly note: string;
  readonly sortOrder: number;
}

export interface ModelingScenarioInput {
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly baseKey: string | null;
  readonly note: string;
  readonly sortOrder: number;
}

/**
 * The result of every write.
 *
 * `ok` is always true when it arrives -- a refusal comes back as an `error` string,
 * because the commands `raise` rather than returning a failure flag. The BI layer
 * needed the other convention because its query log had to survive the refusal;
 * nothing here writes a row on the way to saying no.
 *
 * Everything after `ok` is optional because each command answers the question its
 * caller asked and no more, and the fields are listed with who sets them so that a
 * screen reads the one it is owed rather than testing for three:
 *
 *   id, periods            create model
 *   id                     update model
 *   id, version,
 *   publishedHash          publish
 *   id, status, changed    revise (`changed: false` when it was already a draft)
 *   id, status             archive and restore
 *   key, created           upsert assumption
 *   key, created, computed upsert row (`computed` distinguishes a formula from givens)
 *   key, created, base     upsert scenario
 *   key, deleted           any of the three deletes (`deleted` is a row count, and 0
 *                          is a legitimate answer: the key was already gone)
 *   scenario, assumption,
 *   created                set override
 *   deleted                clear override
 *   id, grade, stale       record certificate (`stale` when the model's published
 *                          hash is not the hash just certified)
 */
export interface ModelingWriteResult {
  readonly ok: boolean;
  readonly id?: string;
  readonly key?: string;
  readonly periods?: number;
  readonly version?: number;
  readonly publishedHash?: string;
  readonly status?: ModelingStatus;
  readonly changed?: boolean;
  readonly created?: boolean;
  readonly computed?: boolean;
  readonly deleted?: number;
  readonly base?: string | null;
  readonly scenario?: string;
  readonly assumption?: string;
  readonly grade?: Grade;
  readonly stale?: boolean;
}

/* --------------------------------------------------------------- re-export ---- */

/** Re-exported so a screen can hold a model without importing from two places. */
export type { Assumption, AssumptionUnit, ModelRow, ModelSpec, Scenario };
