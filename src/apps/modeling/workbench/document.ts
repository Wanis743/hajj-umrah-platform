/**
 * Modeling workbench — reading a model document.
 *
 * The projection half of this window reads flat snake_case projections and maps them with
 * `../../shared/ledger`. This half reads three RPCs that answer with nested camelCase JSON,
 * because a model is a document rather than a table — so the shapes below are the app's own,
 * and like every other app on this desktop it reaches the database only through the SDK.
 *
 * The translation is nearly free, and deliberately so. `get_modeling_spec` emits the engine's
 * `ModelRow`, `Assumption` and `Scenario` field for field, so the shapes here are structural
 * *supersets*: they carry the Arabic labels the RPC also sends, and an array of them drops
 * straight into `ModelSpec` without a copy. The one thing JSON cannot spell is
 * `Scenario.overrides`, which the engine holds as a `ReadonlyMap`.
 *
 * Certificates come back the same way and are rebuilt into the engine's own `Certificate`.
 * That is what lets a certificate read out of the table and one computed thirty milliseconds
 * ago render through the same component, instead of two that agree only by hand.
 *
 * The ledger mappers' rule holds throughout: a document missing its id is a projection that
 * changed shape, not a document with an empty id, so it is dropped rather than half-built.
 */
import type { DatasetRow } from '@/platform/sdk';
import { asNumber, asString, num, str } from '../../shared/guards';
import type {
  Assumption,
  AssumptionUnit,
  Certificate,
  Check,
  CheckKind,
  Grade,
  ModelRow,
  ModelSpec,
  Outcome,
  Scenario,
  Target,
  TargetKind,
} from '../engine';

/* ------------------------------------------------------------------ *
 * Narrowing nested JSON
 * ------------------------------------------------------------------ */

/**
 * A nested object, or `null`.
 *
 * `guards.ts` narrows leaves, because a flat projection only ever has leaves. A document has
 * branches, so the same job has to be done one level up before those guards can run at all.
 */
function obj(value: unknown): DatasetRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as DatasetRow;
}

/** A nested array, or empty: an absent list and an empty list mean the same thing here. */
function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/** Every string in an array, skipping whatever is not one. */
function strings(value: unknown): readonly string[] {
  const out: string[] = [];
  for (const item of list(value)) {
    const text = asString(item);
    if (text !== null) out.push(text);
  }
  return out;
}

/**
 * Every finite number in an array, positionally.
 *
 * `given` is a series indexed by period, so a hole cannot be skipped the way a bad label can
 * — dropping element three would silently shift every later month one to the left. A
 * non-number becomes zero and keeps its place.
 */
function numbers(value: unknown): readonly number[] {
  return list(value).map((item) => num(item));
}

/* ------------------------------------------------------------------ *
 * The vocabularies
 * ------------------------------------------------------------------ */

/** Three states, and the two transitions between them that anybody quotes. */
export type ModelStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

const STATUSES: readonly ModelStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

/** Unknown text reads as a draft: the safe end, because a draft is what the verbs allow. */
export function toModelStatus(value: unknown): ModelStatus {
  const text = str(value).toUpperCase();
  return STATUSES.find((status) => status === text) ?? 'DRAFT';
}

const UNITS: readonly AssumptionUnit[] = ['CURRENCY', 'RATE', 'COUNT', 'DAYS', 'FACTOR'];

/**
 * Defaulted rather than refused, like the ledger's currency.
 *
 * A unit this build does not recognise is a formatting question — the arithmetic is the same
 * either way — whereas dropping the row would quietly remove a line from a model somebody is
 * about to publish, and the total at the bottom would still look plausible.
 */
export function toUnit(value: unknown): AssumptionUnit {
  const text = str(value).toUpperCase();
  return UNITS.find((unit) => unit === text) ?? 'FACTOR';
}

const GRADES: readonly Grade[] = ['CERTIFIED', 'PROVISIONAL', 'UNCERTIFIED'];

/** Refused rather than defaulted: a grade is the one thing here nobody may guess at. */
export function toGrade(value: unknown): Grade | null {
  const text = str(value).toUpperCase();
  return GRADES.find((grade) => grade === text) ?? null;
}

const TARGET_KINDS: readonly TargetKind[] = ['AT', 'TOTAL', 'FINAL'];

export function toTargetKind(value: unknown): TargetKind {
  const text = str(value).toUpperCase();
  return TARGET_KINDS.find((kind) => kind === text) ?? 'FINAL';
}

const OUTCOMES: readonly Outcome[] = ['PASS', 'WARN', 'FAIL', 'UNMEASURED'];

const CHECK_KINDS: readonly CheckKind[] = [
  'SCENARIOS_RUN',
  'SCENARIO_COUNT',
  'CLEAN_ARITHMETIC',
  'WITHIN_RANGE',
  'RANGES_DECLARED',
  'NO_DEAD_ASSUMPTIONS',
  'TARGET_RESPONDS',
  'AUDITABLE_DEPTH',
  'HELD_ROWS_DISCLOSED',
];

/* ------------------------------------------------------------------ *
 * The overview: one row per model
 * ------------------------------------------------------------------ */

/**
 * What the rail shows without opening anything.
 *
 * Every count here is computed by `get_modeling_overview` in SQL rather than by loading each
 * model's spec and counting in the browser: the rail lists every model in the book, and
 * "twelve rows, two of them computed" is a fact the database can answer in one pass.
 */
export interface ModelSummary {
  readonly id: string;
  /** The unique name somebody typed. The window selects by this, not by id. */
  readonly key: string;
  readonly name: string;
  readonly nameAr: string;
  readonly status: ModelStatus;
  readonly version: number;
  /** How many periods, not what they are: the rail shows a span, not an axis. */
  readonly periods: number;
  readonly firstPeriod: string;
  readonly lastPeriod: string;
  readonly rows: number;
  /** Rows carrying a formula. The rest are typed series. */
  readonly computedRows: number;
  readonly assumptions: number;
  /** Assumptions with a `low`..`high`, which is what a tornado needs. */
  readonly rangedAssumptions: number;
  readonly scenarios: number;
  readonly overrides: number;
  readonly publishedHash: string | null;
  readonly publishedAt: string | null;
  readonly updatedAt: string | null;
  readonly certificateGrade: Grade | null;
  readonly certificateAt: string | null;
  /**
   * A certificate exists, and describes a shape the model no longer has.
   *
   * The distinction the rail has to draw is not certified/uncertified but certified/*was*
   * certified — a stale CERTIFIED badge on a model edited since is the exact failure the
   * whole certificate mechanism exists to prevent.
   */
  readonly certificateStale: boolean;
}

export function toModelSummary(row: DatasetRow): ModelSummary | null {
  const id = asString(row.id);
  const key = asString(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    name: str(row.name),
    nameAr: str(row.nameAr),
    status: toModelStatus(row.status),
    version: num(row.version),
    periods: num(row.periods),
    firstPeriod: str(row.firstPeriod),
    lastPeriod: str(row.lastPeriod),
    rows: num(row.rows),
    computedRows: num(row.computedRows),
    assumptions: num(row.assumptions),
    rangedAssumptions: num(row.rangedAssumptions),
    scenarios: num(row.scenarios),
    overrides: num(row.overrides),
    publishedHash: asString(row.publishedHash),
    publishedAt: asString(row.publishedAt),
    updatedAt: asString(row.updatedAt),
    certificateGrade: toGrade(row.certificateGrade),
    certificateAt: asString(row.certificateAt),
    certificateStale: row.certificateStale === true,
  };
}

/** The whole rail, in the order the RPC returned it — newest first. */
export function readModels(rows: readonly DatasetRow[]): readonly ModelSummary[] {
  const out: ModelSummary[] = [];
  for (const row of rows) {
    const summary = toModelSummary(row);
    if (summary !== null) out.push(summary);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The document: one model, in full
 * ------------------------------------------------------------------ */

/** Everything about a model that is not a row, an assumption or a scenario. */
export interface ModelHeader {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string;
  readonly description: string;
  readonly status: ModelStatus;
  readonly version: number;
  /** The `fullHash` of what was published, which is what a reader is quoting. */
  readonly publishedHash: string | null;
  readonly publishedAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * A row, plus the two things the engine has no use for.
 *
 * `extends ModelRow` is the load-bearing word: `readonly DocRow[]` is assignable to
 * `ModelSpec['rows']` with no copy and no mapping pass, so the grid and the compiler read the
 * same objects. An Arabic label is a fact about presentation and the engine is monolingual by
 * design, which is why it lives out here rather than in `../engine`.
 */
export interface DocRow extends ModelRow {
  readonly labelAr: string;
  readonly note: string;
}

/** An assumption, plus its Arabic label. `note` the engine already carries. */
export interface DocAssumption extends Assumption {
  readonly labelAr: string;
}

/**
 * A scenario, plus its Arabic name.
 *
 * The RPC already spells `id` and `baseId` the engine's way, so inheritance needs no
 * translation at all — only `overrides` does, because an object is not a `Map`.
 */
export interface DocScenario extends Scenario {
  readonly nameAr: string;
  readonly note: string;
}

export interface ModelDocument {
  readonly header: ModelHeader;
  /** The four fields the engine compiles, holding the same objects as the three arrays below. */
  readonly spec: ModelSpec;
  readonly rows: readonly DocRow[];
  readonly assumptions: readonly DocAssumption[];
  readonly scenarios: readonly DocScenario[];
}

/**
 * A row.
 *
 * `formula` is null-or-present rather than empty-or-present because the engine reads a
 * non-null formula as "this row is computed and `given` is ignored" — an empty string would
 * be a formula that fails to parse, not a row that has none.
 */
function toDocRow(value: unknown): DocRow | null {
  const row = obj(value);
  if (row === null) return null;
  const key = asString(row.key);
  if (key === null || key === '') return null;
  const formula = asString(row.formula);
  return {
    key,
    label: str(row.label),
    labelAr: str(row.labelAr),
    unit: toUnit(row.unit),
    formula: formula === null || formula.trim() === '' ? null : formula,
    given: numbers(row.given),
    note: str(row.note),
  };
}

/**
 * An assumption.
 *
 * `low` and `high` stay `null` when absent rather than collapsing onto `value`: the engine
 * counts ranged assumptions to decide whether a tornado means anything, and a range invented
 * here would earn a certification check the model has not passed.
 */
function toDocAssumption(value: unknown): DocAssumption | null {
  const row = obj(value);
  if (row === null) return null;
  const key = asString(row.key);
  if (key === null || key === '') return null;
  return {
    key,
    label: str(row.label),
    labelAr: str(row.labelAr),
    unit: toUnit(row.unit),
    value: num(row.value),
    low: asNumber(row.low),
    high: asNumber(row.high),
    note: str(row.note),
  };
}

/** The overrides object, keyed by assumption key. The one shape JSON cannot express. */
function toOverrides(value: unknown): ReadonlyMap<string, number> {
  const row = obj(value);
  const out = new Map<string, number>();
  if (row === null) return out;
  for (const [key, raw] of Object.entries(row)) {
    const amount = asNumber(raw);
    if (amount !== null) out.set(key, amount);
  }
  return out;
}

function toDocScenario(value: unknown): DocScenario | null {
  const row = obj(value);
  if (row === null) return null;
  const id = asString(row.id);
  if (id === null || id === '') return null;
  return {
    id,
    name: str(row.name),
    nameAr: str(row.nameAr),
    baseId: asString(row.baseId),
    overrides: toOverrides(row.overrides),
    note: str(row.note),
  };
}

/**
 * The whole document, out of the single row `modelingSpec` is.
 *
 * `get_modeling_spec` answers with one JSON object and the broker wraps it as a one-row page,
 * so an absent model reads as an empty page — the same way a missing table row already does.
 * A document whose header has no id is refused outright: everything downstream keys off it.
 */
export function readDocument(rows: readonly DatasetRow[]): ModelDocument | null {
  const page = rows[0];
  if (page === undefined) return null;
  const head = obj(page.model);
  if (head === null) return null;
  const id = asString(head.id);
  const key = asString(head.key);
  if (id === null || key === null) return null;

  const docRows: DocRow[] = [];
  for (const item of list(page.rows)) {
    const row = toDocRow(item);
    if (row !== null) docRows.push(row);
  }
  const assumptions: DocAssumption[] = [];
  for (const item of list(page.assumptions)) {
    const assumption = toDocAssumption(item);
    if (assumption !== null) assumptions.push(assumption);
  }
  const scenarios: DocScenario[] = [];
  for (const item of list(page.scenarios)) {
    const scenario = toDocScenario(item);
    if (scenario !== null) scenarios.push(scenario);
  }
  const periods = strings(page.periods);

  return {
    header: {
      id,
      key,
      name: str(head.name),
      nameAr: str(head.nameAr),
      description: str(head.description),
      status: toModelStatus(head.status),
      version: num(head.version),
      publishedHash: asString(head.publishedHash),
      publishedAt: asString(head.publishedAt),
      updatedAt: asString(head.updatedAt),
    },
    spec: { periods, rows: docRows, assumptions, scenarios },
    rows: docRows,
    assumptions,
    scenarios,
  };
}

/* ------------------------------------------------------------------ *
 * Certificates
 * ------------------------------------------------------------------ */

/**
 * A stored certificate: the engine's own `Certificate`, plus the three facts only the table
 * knows.
 *
 * Composition here rather than `extends`, unlike `DocRow` above, and for the opposite reason.
 * `DocRow` inherits because arrays of it are handed straight back to the compiler. A
 * certificate is never fed back into the engine — it is *rendered* — so the badge takes a bare
 * `Certificate` and this record hands it `record.certificate`. One component then serves a row
 * read out of the table and a certificate computed thirty milliseconds ago, instead of two that
 * agree only as long as somebody keeps them agreeing.
 */
export interface CertificateRecord {
  readonly id: string;
  readonly certificate: Certificate;
  readonly createdAt: string | null;
  /**
   * The certificate describes the model as it stands now.
   *
   * Computed in SQL by comparing the stored `results_hash` against the model's current one,
   * which is the comparison `certifies()` makes in the engine — so the rail can mark a
   * certificate stale without recompiling the model to find out.
   */
  readonly describesCurrent: boolean;
}

/**
 * One check.
 *
 * A `kind` this build cannot name is dropped, because rendering it would mean inventing a label
 * for a check whose meaning is unknown here. The counts do not come from this array — they are
 * columns on the record — so a dropped check leaves the summary truthful rather than short.
 *
 * An unrecognised `outcome` reads as `UNMEASURED` instead. That is the one value that cannot
 * flatter the model: defaulting to `PASS` would launder an unknown into a pass.
 */
function toCheck(value: unknown): Check | null {
  const row = obj(value);
  if (row === null) return null;
  const text = str(row.kind).toUpperCase();
  const kind = CHECK_KINDS.find((candidate) => candidate === text);
  if (kind === undefined) return null;
  const outcome = str(row.outcome).toUpperCase();
  return {
    kind,
    outcome: OUTCOMES.find((candidate) => candidate === outcome) ?? 'UNMEASURED',
    measured: asNumber(row.measured),
    threshold: asNumber(row.threshold),
    detail: str(row.detail),
    where: strings(row.where),
  };
}

/**
 * What was certified: a row key, and which number in its series.
 *
 * `period` is floored at zero and rounded, the same two operations the broker applies on the
 * way in, so a target read back out lands on the index it was written with.
 */
function toTarget(value: unknown): Target {
  const row = obj(value);
  if (row === null) return { key: '', kind: 'FINAL', period: 0 };
  return {
    key: str(row.key),
    kind: toTargetKind(row.kind),
    period: Math.max(0, Math.round(num(row.period))),
  };
}

/**
 * One stored certificate.
 *
 * Dropped outright when the grade is unreadable, which is the refusal `toGrade` exists for: a
 * certificate whose verdict this build cannot name has nothing left to say, and a defaulted
 * grade in a list somebody scans for CERTIFIED is worse than no row at all.
 */
function toCertificateRecord(row: DatasetRow): CertificateRecord | null {
  const id = asString(row.id);
  const grade = toGrade(row.grade);
  if (id === null || grade === null) return null;
  const checks: Check[] = [];
  for (const item of list(row.checks)) {
    const check = toCheck(item);
    if (check !== null) checks.push(check);
  }
  return {
    id,
    certificate: {
      grade,
      resultsHash: str(row.resultsHash),
      fullHash: str(row.fullHash),
      scenario: str(row.scenario),
      target: toTarget(row.target),
      checks,
      limitations: strings(row.limitations),
      passed: num(row.passed),
      warned: num(row.warned),
      failed: num(row.failed),
      unmeasured: num(row.unmeasured),
    },
    createdAt: asString(row.createdAt),
    describesCurrent: row.describesCurrent === true,
  };
}

/** The certificate history, newest first, in the order the RPC returned it. */
export function readCertificates(rows: readonly DatasetRow[]): readonly CertificateRecord[] {
  const out: CertificateRecord[] = [];
  for (const row of rows) {
    const record = toCertificateRecord(row);
    if (record !== null) out.push(record);
  }
  return out;
}
