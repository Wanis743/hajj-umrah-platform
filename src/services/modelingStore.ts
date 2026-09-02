/**
 * The modelling store: every call the modelling app makes to the database, and the
 * only place a JSON payload becomes an engine type.
 *
 * Three jobs, in this order, and nothing else:
 *
 *   1. Call one function in `20260901180000_modeling_engine_vertical_slice.sql`.
 *   2. Parse what came back, or say the payload was malformed.
 *   3. Translate the wire's vocabulary into the engine's -- `toSpec`, at the bottom.
 *
 * What this file deliberately does not do is compute. No formula is evaluated here, no
 * scenario resolved, no certificate graded. Those live in `src/apps/modeling/engine`
 * as pure functions over `ModelSpec`, and the one function below that touches them
 * (`certifyAndRecord`) calls them and posts the answer -- it does not reimplement a
 * step of them. A second arithmetic in the service layer would be a second answer to
 * "what does this model say", and the two would diverge on a Friday.
 *
 * One result shape for reads and writes, unlike `biAnalytics.ts`. BI needed failure
 * carried inside the payload because a refused query is the one worth auditing and a
 * `raise` would roll back the `bi_query_log` row recording it. Nothing in the
 * modelling schema writes a row on the way to saying no, so a refusal here is an
 * exception, and every caller handles a read exactly as it handles a write.
 */
import { supabase } from '@/lib/supabase';
import {
  certify,
  versionOf,
  type Certificate,
  type CertifySettings,
  type Check,
  type CompiledModel,
  type ModelSpec,
  type Scenario,
  type Target,
} from '@/apps/modeling/engine';
import {
  MODELING_CHECK_KINDS,
  MODELING_GRADES,
  MODELING_OUTCOMES,
  MODELING_STATUSES,
  MODELING_TARGET_KINDS,
  MODELING_UNITS,
  type ModelingAssumptionInput,
  type ModelingAssumptionWire,
  type ModelingCertificateRow,
  type ModelingDocument,
  type ModelingHeader,
  type ModelingModelInput,
  type ModelingOverviewRow,
  type ModelingRowInput,
  type ModelingRowWire,
  type ModelingScenarioInput,
  type ModelingScenarioWire,
  type ModelingSpecWire,
  type ModelingWriteResult,
} from '@/types/modeling';

/** One shape for every call in this file. `error` is already a sentence fit for a
 *  screen; no caller inspects a code. */
export interface ModelingResult<T> {
  readonly data: T | null;
  readonly error: string | null;
}

/* ---------------------------------------------------------------- refusals ---- */

/**
 * Which SQLSTATEs carry a sentence written for the person reading the screen.
 *
 * `22023` and `P0001` are raised only by our own `raise exception` in that migration,
 * and their text is meant to be read: 'Model "x" is PUBLISHED; revise it back to
 * draft before editing, which clears the published hash'. Passing that through is
 * strictly better than replacing it with a generic line, because it names the way out.
 *
 * `23503` is deliberately *not* here even though all three of the migration's explicit
 * foreign-key refusals are authored ('Assumption "%" is used by row "%"; change that
 * formula first'). `private.modeling_set_override` inserts against the composite keys
 * with no prior existence check, so PostgreSQL itself can raise `23503` naming a
 * constraint -- and a constraint name on a screen is worse than no detail at all.
 */
const AUTHORED_CODES: ReadonlySet<string> = new Set(['22023', 'P0001']);

const CANNED: Readonly<Record<string, string>> = {
  '42501': 'لا تملك صلاحية الاطلاع على هذا النموذج أو تعديله',
  '23503': 'هذا العنصر مستخدم في مكان آخر من النموذج؛ عدّل ما يعتمد عليه أولاً',
  '23505': 'هذا المفتاح مستخدم بالفعل في هذا النموذج',
  '23514': 'القيمة المُدخلة لا تحقق شروط النموذج',
  '22P02': 'صيغة إحدى القيم غير صحيحة',
};

const UNEXPECTED = 'تعذّر تنفيذ العملية على النموذج';

function refusal(code: string | undefined, message: string): string {
  if (code !== undefined && AUTHORED_CODES.has(code)) return message;
  if (code !== undefined && CANNED[code] !== undefined) return CANNED[code];
  return UNEXPECTED;
}

/* ------------------------------------------------------------------ readers ---- */

/**
 * Parsing by exception, caught at exactly one boundary.
 *
 * `supabase.rpc` types its payload as `unknown` -- correctly, since the function
 * catalogue is a string index -- so every field of every payload has to be checked
 * before a chart or an engine call is handed it. Two ways to do that. Each reader
 * returns `T | null` and every parser checks twenty results, which is the same
 * comparison written twenty times and forgotten in one; or each reader throws with the
 * name of the field it was reading, and the twenty checks collapse into one `catch`.
 *
 * The second, with a caveat that is the whole reason it is safe: `rpcRead` and
 * `rpcWrite` catch `Malformed` *only*, and rethrow everything else. A `TypeError`
 * raised by a bug in a reader below must not be reported as "the server sent something
 * odd" -- that sentence would send somebody to look at the database for a fault that
 * is in this file.
 */
class Malformed extends Error {
  constructor(at: string) {
    super(`malformed modelling payload at ${at}`);
    this.name = 'Malformed';
  }
}

function fail(at: string): never {
  throw new Malformed(at);
}

/** A JSON object. Arrays are excluded: `typeof [] === 'object'` and a reader that
 *  accepted one would then read `length` as a field name. */
function rec(v: unknown, at: string): Readonly<Record<string, unknown>> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(at);
  return v as Readonly<Record<string, unknown>>;
}

/** `Array.isArray` narrows `unknown` to `any[]`, which the zero-`any` gate reads as a
 *  type position it cannot allow. The assertion to `readonly unknown[]` is not a
 *  formality -- it is what keeps `any` from entering here through a lib signature. */
function arr(v: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(v)) fail(at);
  return v as readonly unknown[];
}

function text(v: unknown, at: string): string {
  if (typeof v !== 'string') fail(at);
  return v;
}

function maybeText(v: unknown, at: string): string | null {
  if (v === null || v === undefined) return null;
  return text(v, at);
}

/**
 * A finite number, and nothing else.
 *
 * `NaN` and `±Infinity` are rejected here rather than downstream because the engine is
 * total over finite inputs and says so: `evaluate` guarantees no `NaN` escapes, which
 * is a guarantee about arithmetic it performs, not about a number handed to it. A
 * `null` in a `double precision` column arriving where a value is required is the same
 * fault as a string, so it takes the same path.
 */
function number(v: unknown, at: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(at);
  return v;
}

function maybeNumber(v: unknown, at: string): number | null {
  if (v === null || v === undefined) return null;
  return number(v, at);
}

function flag(v: unknown, at: string): boolean {
  if (typeof v !== 'boolean') fail(at);
  return v;
}

/** Membership in one of the six lists in `src/types/modeling.ts`, which are built from
 *  exhaustive record literals -- so a union that gains a member fails the build there
 *  rather than starting to refuse payloads here. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], at: string): T {
  const s = text(v, at);
  if (!(allowed as readonly string[]).includes(s)) fail(at);
  return s as T;
}

/** For a key a command may legitimately omit: absent stays absent, present is read.
 *  `ModelingWriteResult` is the only place this is needed, and the reason it is needed
 *  is in that type's doc -- each command answers its own question and no more. */
function opt<T>(v: unknown, read: (value: unknown, at: string) => T, at: string): T | undefined {
  if (v === undefined) return undefined;
  return read(v, at);
}

/* ------------------------------------------------------------------ parsers ---- */

function readHeader(v: unknown, at: string): ModelingHeader {
  const r = rec(v, at);
  return {
    id: text(r.id, `${at}.id`),
    key: text(r.key, `${at}.key`),
    name: text(r.name, `${at}.name`),
    nameAr: maybeText(r.nameAr, `${at}.nameAr`),
    description: maybeText(r.description, `${at}.description`),
    status: oneOf(r.status, MODELING_STATUSES, `${at}.status`),
    version: number(r.version, `${at}.version`),
    publishedHash: maybeText(r.publishedHash, `${at}.publishedHash`),
    publishedAt: maybeText(r.publishedAt, `${at}.publishedAt`),
    updatedAt: text(r.updatedAt, `${at}.updatedAt`),
  };
}

function readRow(v: unknown, at: string): ModelingRowWire {
  const r = rec(v, at);
  return {
    key: text(r.key, `${at}.key`),
    label: text(r.label, `${at}.label`),
    labelAr: maybeText(r.labelAr, `${at}.labelAr`),
    unit: oneOf(r.unit, MODELING_UNITS, `${at}.unit`),
    formula: maybeText(r.formula, `${at}.formula`),
    given: arr(r.given, `${at}.given`).map((n, i) => number(n, `${at}.given[${i}]`)),
    note: text(r.note, `${at}.note`),
  };
}

function readAssumption(v: unknown, at: string): ModelingAssumptionWire {
  const r = rec(v, at);
  return {
    key: text(r.key, `${at}.key`),
    label: text(r.label, `${at}.label`),
    labelAr: maybeText(r.labelAr, `${at}.labelAr`),
    unit: oneOf(r.unit, MODELING_UNITS, `${at}.unit`),
    value: number(r.value, `${at}.value`),
    low: maybeNumber(r.low, `${at}.low`),
    high: maybeNumber(r.high, `${at}.high`),
    note: text(r.note, `${at}.note`),
  };
}

/** `jsonb_object_agg` of assumption key to value, or `'{}'` when a scenario overrides
 *  nothing. Read as a plain object because JSON has no map; `toSpec` is where it
 *  becomes the `ReadonlyMap` the engine's `Scenario` declares. */
function readOverrides(v: unknown, at: string): Readonly<Record<string, number>> {
  const r = rec(v, at);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(r)) out[key] = number(value, `${at}.${key}`);
  return out;
}

function readScenario(v: unknown, at: string): ModelingScenarioWire {
  const r = rec(v, at);
  return {
    id: text(r.id, `${at}.id`),
    name: text(r.name, `${at}.name`),
    nameAr: maybeText(r.nameAr, `${at}.nameAr`),
    baseId: maybeText(r.baseId, `${at}.baseId`),
    note: text(r.note, `${at}.note`),
    overrides: readOverrides(r.overrides, `${at}.overrides`),
  };
}

function readSpecWire(v: unknown): ModelingSpecWire {
  const r = rec(v, 'spec');
  return {
    model: readHeader(r.model, 'spec.model'),
    periods: arr(r.periods, 'spec.periods').map((p, i) => text(p, `spec.periods[${i}]`)),
    rows: arr(r.rows, 'spec.rows').map((x, i) => readRow(x, `spec.rows[${i}]`)),
    assumptions: arr(r.assumptions, 'spec.assumptions')
      .map((x, i) => readAssumption(x, `spec.assumptions[${i}]`)),
    scenarios: arr(r.scenarios, 'spec.scenarios')
      .map((x, i) => readScenario(x, `spec.scenarios[${i}]`)),
  };
}

function readOverviewRow(v: unknown, at: string): ModelingOverviewRow {
  const r = rec(v, at);
  return {
    id: text(r.id, `${at}.id`),
    key: text(r.key, `${at}.key`),
    name: text(r.name, `${at}.name`),
    nameAr: maybeText(r.nameAr, `${at}.nameAr`),
    status: oneOf(r.status, MODELING_STATUSES, `${at}.status`),
    version: number(r.version, `${at}.version`),
    periods: number(r.periods, `${at}.periods`),
    firstPeriod: maybeText(r.firstPeriod, `${at}.firstPeriod`),
    lastPeriod: maybeText(r.lastPeriod, `${at}.lastPeriod`),
    rows: number(r.rows, `${at}.rows`),
    computedRows: number(r.computedRows, `${at}.computedRows`),
    assumptions: number(r.assumptions, `${at}.assumptions`),
    rangedAssumptions: number(r.rangedAssumptions, `${at}.rangedAssumptions`),
    scenarios: number(r.scenarios, `${at}.scenarios`),
    overrides: number(r.overrides, `${at}.overrides`),
    publishedHash: maybeText(r.publishedHash, `${at}.publishedHash`),
    publishedAt: maybeText(r.publishedAt, `${at}.publishedAt`),
    updatedAt: text(r.updatedAt, `${at}.updatedAt`),
    certificateGrade: r.certificateGrade === null || r.certificateGrade === undefined
      ? null
      : oneOf(r.certificateGrade, MODELING_GRADES, `${at}.certificateGrade`),
    certificateAt: maybeText(r.certificateAt, `${at}.certificateAt`),
    certificateStale: flag(r.certificateStale, `${at}.certificateStale`),
  };
}

/**
 * One check from a stored certificate.
 *
 * The keys are the engine's own, because the client serialised its `Check[]` into the
 * `checks` column and `get_modeling_certificates` hands the whole array back untouched.
 * Parsed anyway: the row could have been written by an older build of this app, and a
 * `CheckKind` we no longer recognise is exactly what `MODELING_CHECK_KINDS` is for.
 */
function readCheck(v: unknown, at: string): Check {
  const r = rec(v, at);
  return {
    kind: oneOf(r.kind, MODELING_CHECK_KINDS, `${at}.kind`),
    outcome: oneOf(r.outcome, MODELING_OUTCOMES, `${at}.outcome`),
    measured: maybeNumber(r.measured, `${at}.measured`),
    threshold: maybeNumber(r.threshold, `${at}.threshold`),
    detail: text(r.detail, `${at}.detail`),
    where: arr(r.where, `${at}.where`).map((w, i) => text(w, `${at}.where[${i}]`)),
  };
}

function readCertificate(v: unknown, at: string): ModelingCertificateRow {
  const r = rec(v, at);
  const target = rec(r.target, `${at}.target`);
  return {
    id: text(r.id, `${at}.id`),
    grade: oneOf(r.grade, MODELING_GRADES, `${at}.grade`),
    scenario: text(r.scenario, `${at}.scenario`),
    target: {
      key: text(target.key, `${at}.target.key`),
      kind: oneOf(target.kind, MODELING_TARGET_KINDS, `${at}.target.kind`),
      period: number(target.period, `${at}.target.period`),
    },
    resultsHash: text(r.resultsHash, `${at}.resultsHash`),
    fullHash: text(r.fullHash, `${at}.fullHash`),
    passed: number(r.passed, `${at}.passed`),
    warned: number(r.warned, `${at}.warned`),
    failed: number(r.failed, `${at}.failed`),
    unmeasured: number(r.unmeasured, `${at}.unmeasured`),
    checks: arr(r.checks, `${at}.checks`).map((c, i) => readCheck(c, `${at}.checks[${i}]`)),
    limitations: arr(r.limitations, `${at}.limitations`)
      .map((l, i) => text(l, `${at}.limitations[${i}]`)),
    createdAt: text(r.createdAt, `${at}.createdAt`),
    describesCurrent: flag(r.describesCurrent, `${at}.describesCurrent`),
  };
}

/** Every command's answer, read against the union in `ModelingWriteResult`. `ok` is the
 *  only required key; the rest are `opt` because a command that reported a field it was
 *  never asked about would be the more surprising thing. */
function readWriteResult(v: unknown): ModelingWriteResult {
  const r = rec(v, 'result');
  return {
    ok: flag(r.ok, 'result.ok'),
    id: opt(r.id, text, 'result.id'),
    key: opt(r.key, text, 'result.key'),
    periods: opt(r.periods, number, 'result.periods'),
    version: opt(r.version, number, 'result.version'),
    publishedHash: opt(r.publishedHash, text, 'result.publishedHash'),
    status: opt(r.status, (x, at) => oneOf(x, MODELING_STATUSES, at), 'result.status'),
    changed: opt(r.changed, flag, 'result.changed'),
    created: opt(r.created, flag, 'result.created'),
    computed: opt(r.computed, flag, 'result.computed'),
    deleted: opt(r.deleted, number, 'result.deleted'),
    base: opt(r.base, maybeText, 'result.base'),
    scenario: opt(r.scenario, text, 'result.scenario'),
    assumption: opt(r.assumption, text, 'result.assumption'),
    grade: opt(r.grade, (x, at) => oneOf(x, MODELING_GRADES, at), 'result.grade'),
    stale: opt(r.stale, flag, 'result.stale'),
  };
}

/* -------------------------------------------------------------- translation ---- */

/**
 * The one place the wire's vocabulary becomes the engine's.
 *
 * Two differences, both deliberate, both named in `src/types/modeling.ts`:
 * `overrides` arrives as an object because JSON has no map and the engine's `Scenario`
 * declares a `ReadonlyMap`; and a scenario's `key` arrives spelled `id` because that is
 * what `Scenario.baseId` points at, so the engine never has to learn that the two words
 * are the same word.
 *
 * The fields dropped here -- `labelAr` and `note` on a row, `nameAr` and `note` on a
 * scenario -- are not lost. `ModelingDocument` carries the whole wire payload beside the
 * spec for the editors, which need them. The engine does not, and a pure computation
 * that carries a display string is a computation whose hash changes when somebody fixes
 * a typo in a label: `canonicalResults` would report a different model.
 */
export function toSpec(wire: ModelingSpecWire): ModelSpec {
  const scenarios: readonly Scenario[] = wire.scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    baseId: s.baseId,
    overrides: new Map(Object.entries(s.overrides)),
  }));
  return {
    periods: wire.periods,
    rows: wire.rows.map((r) => ({
      key: r.key,
      label: r.label,
      unit: r.unit,
      formula: r.formula,
      given: r.given,
    })),
    assumptions: wire.assumptions.map((a) => ({
      key: a.key,
      label: a.label,
      unit: a.unit,
      value: a.value,
      low: a.low,
      high: a.high,
      note: a.note,
    })),
    scenarios,
  };
}

/* ---------------------------------------------------------------- transport ---- */

/**
 * One call, one parse, one place that decides what an exception meant.
 *
 * The `catch` is narrowed to `Malformed` on purpose. Anything else thrown inside `read`
 * is a fault in the readers above -- a mistyped field name, a reader called with the
 * wrong arity -- and reporting it as "the server sent an unexpected response" would
 * send somebody to inspect a database that is behaving perfectly. It rethrows, the
 * error boundary catches it, and the stack points at this file, which is where the bug
 * is.
 */
async function rpcRead<T>(
  fn: string,
  args: Record<string, unknown>,
  read: (value: unknown) => T,
): Promise<ModelingResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: refusal(error.code, error.message) };
  try {
    return { data: read(data), error: null };
  } catch (caught) {
    if (caught instanceof Malformed) return { data: null, error: `استجابة غير متوقعة من ${fn}` };
    throw caught;
  }
}

/** Every write goes through the read path, because a command's answer is a payload like
 *  any other and deserves the same parse. The only difference is that the parser is
 *  always `readWriteResult`. */
function rpcWrite(
  fn: string,
  args: Record<string, unknown>,
): Promise<ModelingResult<ModelingWriteResult>> {
  return rpcRead(fn, args, readWriteResult);
}

/* -------------------------------------------------------------------- calls ---- */

/**
 * Every database call the modelling app makes, and no others.
 *
 * Read methods are one line each because there is nothing for them to do but name the
 * function and the parser. Write methods are one line each for the same reason, plus the
 * argument names -- which are spelled exactly as the migration declares them, since
 * PostgREST matches named arguments and a typo becomes `PGRST202` at runtime rather than
 * a compile error. That is the one class of mistake this file cannot protect against, so
 * the names are written once, here, and nowhere else in the app.
 */
export const modelingStore = {
  /** The listing screen: one row per model in scope, newest activity first, each with
   *  its newest certificate's grade and whether that grade still describes it. */
  overview: () =>
    rpcRead('get_modeling_overview', {}, (v) =>
      arr(v, 'overview').map((x, i) => readOverviewRow(x, `overview[${i}]`))),

  /** One model, ready to run. Returns the header, a `ModelSpec` the engine can compile
   *  with no further conversion, and the wire payload the editors need for the fields a
   *  spec does not carry. */
  document: (modelId: string): Promise<ModelingResult<ModelingDocument>> =>
    rpcRead('get_modeling_spec', { p_model_id: modelId }, (v) => {
      const wire = readSpecWire(v);
      return { header: wire.model, spec: toSpec(wire), wire };
    }),

  /** The certificate ledger for one model, newest first. `describesCurrent` is measured
   *  by the database against the model's published hash, not by comparing dates. */
  certificates: (modelId: string, limit = 50) =>
    rpcRead('get_modeling_certificates', { p_model_id: modelId, p_limit: limit }, (v) =>
      arr(v, 'certificates').map((x, i) => readCertificate(x, `certificates[${i}]`))),

  /* ------------------------------------------------------------- the model ---- */

  createModel: (input: ModelingModelInput) =>
    rpcWrite('create_modeling_model_command', {
      p_key: input.key,
      p_name: input.name,
      p_periods: input.periods,
      p_name_ar: input.nameAr,
      p_description: input.description,
    }),

  updateModel: (modelId: string, input: Omit<ModelingModelInput, 'key'>) =>
    rpcWrite('update_modeling_model_command', {
      p_model_id: modelId,
      p_name: input.name,
      p_periods: input.periods,
      p_name_ar: input.nameAr,
      p_description: input.description,
    }),

  /** Back to draft, which clears the published hash. `changed: false` comes back when it
   *  was already a draft, so a screen can stay quiet instead of claiming a change. */
  reviseModel: (modelId: string) =>
    rpcWrite('revise_modeling_model_command', { p_model_id: modelId }),

  /** One command for both directions: `archived: false` restores. A separate restore
   *  command would have been a second place for the status transition rules to live. */
  archiveModel: (modelId: string, archived = true) =>
    rpcWrite('archive_modeling_model_command', {
      p_model_id: modelId,
      p_archived: archived,
    }),

  /* --------------------------------------------------------- the assumptions ---- */

  upsertAssumption: (modelId: string, input: ModelingAssumptionInput) =>
    rpcWrite('upsert_modeling_assumption_command', {
      p_model_id: modelId,
      p_key: input.key,
      p_label: input.label,
      p_unit: input.unit,
      p_value: input.value,
      p_low: input.low,
      p_high: input.high,
      p_label_ar: input.labelAr,
      p_note: input.note,
      p_sort: input.sortOrder,
    }),

  /** Refused with an authored `23503` when a formula still names it. `deleted: 0` is a
   *  success: the key was already gone, and asking twice is not an error. */
  deleteAssumption: (modelId: string, key: string) =>
    rpcWrite('delete_modeling_assumption_command', { p_model_id: modelId, p_key: key }),

  /* ----------------------------------------------------------------- the rows ---- */

  /**
   * A row is either computed or given, and this passes both fields through unchanged.
   *
   * It would be easy to send `null` for `given` whenever a formula is present and never
   * trip the table's exclusivity check. That would also mean the check never fires, and a
   * constraint that cannot fire is a comment. The caller's contradiction is the caller's
   * to hear about, in the words the migration wrote for it.
   */
  upsertRow: (modelId: string, input: ModelingRowInput) =>
    rpcWrite('upsert_modeling_row_command', {
      p_model_id: modelId,
      p_key: input.key,
      p_label: input.label,
      p_unit: input.unit,
      p_formula: input.formula,
      p_given: input.given,
      p_label_ar: input.labelAr,
      p_note: input.note,
      p_sort: input.sortOrder,
    }),

  deleteRow: (modelId: string, key: string) =>
    rpcWrite('delete_modeling_row_command', { p_model_id: modelId, p_key: key }),

  /* ------------------------------------------------------------ the scenarios ---- */

  /** `base` comes back so a screen can show what this scenario inherits from without a
   *  second read. A cycle in the chain is refused by the database, not detected here. */
  upsertScenario: (modelId: string, input: ModelingScenarioInput) =>
    rpcWrite('upsert_modeling_scenario_command', {
      p_model_id: modelId,
      p_key: input.key,
      p_name: input.name,
      p_base_key: input.baseKey,
      p_name_ar: input.nameAr,
      p_note: input.note,
      p_sort: input.sortOrder,
    }),

  deleteScenario: (modelId: string, key: string) =>
    rpcWrite('delete_modeling_scenario_command', { p_model_id: modelId, p_key: key }),

  /* ------------------------------------------------------------- the overrides ---- */

  setOverride: (modelId: string, scenarioKey: string, assumptionKey: string,
                value: number, note = '') =>
    rpcWrite('set_modeling_override_command', {
      p_model_id: modelId,
      p_scenario_key: scenarioKey,
      p_assumption_key: assumptionKey,
      p_value: value,
      p_note: note,
    }),

  /** `deleted: 0` when the scenario did not override that assumption -- which is the
   *  state the caller asked for, so it is not a refusal. */
  clearOverride: (modelId: string, scenarioKey: string, assumptionKey: string) =>
    rpcWrite('clear_modeling_override_command', {
      p_model_id: modelId,
      p_scenario_key: scenarioKey,
      p_assumption_key: assumptionKey,
    }),
};

/* --------------------------------------------------------------- the ledger ---- */

/**
 * Publish a model that has been proved to compile.
 *
 * This is the only way to publish, and the argument is a `CompiledModel` rather than a
 * `ModelSpec` on purpose: there is no way to obtain one except from a `compileModel` that
 * succeeded, so a model whose formulas do not parse cannot reach this function. The
 * database cannot make that check -- it would need a parser -- so the type system makes
 * it instead, at the one place where publishing happens.
 *
 * The hash is measured here rather than accepted as an argument for the same reason.
 * `versionOf` is the function `certifies()` will later measure against; a caller free to
 * supply its own hash would be free to supply one computed differently, and the published
 * hash would stop meaning anything. The database still only stores a client claim -- it
 * has no canonicaliser of its own, and a second one written in plpgsql would be a second
 * answer to "is this the same model" -- but the claim now has exactly one author.
 */
export function publishModel(
  modelId: string,
  model: CompiledModel,
): Promise<ModelingResult<ModelingWriteResult>> {
  return rpcWrite('publish_modeling_model_command', {
    p_model_id: modelId,
    p_full_hash: versionOf(model).fullHash,
  });
}

export interface RecordedCertificate {
  readonly certificate: Certificate;
  /** The database's answer to whether this certificate describes what is published.
   *  `true` means the model was published at a different hash than the one just
   *  certified -- so the certificate is true about a model nobody is looking at. */
  readonly stale: boolean;
}

/** Post a certificate the engine has already produced. Separate from `certifyAndRecord`
 *  for the caller that re-checks a stored certificate with `certifies()` and wants to
 *  record the fresh measurement without choosing a target again. */
export function recordCertificate(
  modelId: string,
  certificate: Certificate,
): Promise<ModelingResult<ModelingWriteResult>> {
  return rpcWrite('record_modeling_certificate_command', {
    p_model_id: modelId,
    p_scenario_key: certificate.scenario,
    p_target_key: certificate.target.key,
    p_target_kind: certificate.target.kind,
    p_target_period: certificate.target.period,
    p_grade: certificate.grade,
    p_results_hash: certificate.resultsHash,
    p_full_hash: certificate.fullHash,
    p_passed: certificate.passed,
    p_warned: certificate.warned,
    p_failed: certificate.failed,
    p_unmeasured: certificate.unmeasured,
    p_checks: certificate.checks,
    p_limitations: certificate.limitations,
  });
}

/**
 * Measure a model and write down what was measured.
 *
 * The grade is computed by `certify` and *sent* rather than derived by the database,
 * which looks like duplication and is the opposite. `modeling_certificates` carries a
 * CHECK that the grade agrees with the four counts -- any FAIL means UNCERTIFIED, any
 * WARN or UNMEASURED means PROVISIONAL, otherwise CERTIFIED. Sending the grade is what
 * makes that constraint a live test of this client on every insert. If the database
 * derived it, the constraint would be checking its own arithmetic and would pass forever,
 * including on the day a change to `certify` started grading leniently.
 *
 * `stale` comes back from the same insert rather than a second read, because the answer
 * is only meaningful as of the moment the row was written.
 */
export async function certifyAndRecord(
  modelId: string,
  model: CompiledModel,
  scenarioId: string,
  target: Target,
  settings: CertifySettings = {},
): Promise<ModelingResult<RecordedCertificate>> {
  const certificate = certify(model, scenarioId, target, settings);
  const { data, error } = await recordCertificate(modelId, certificate);
  if (error !== null) return { data: null, error };
  if (data === null) return { data: null, error: UNEXPECTED };
  return { data: { certificate, stale: data.stale ?? false }, error: null };
}
