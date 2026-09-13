/**
 * Analytics — the readers.
 *
 * Ten datasets, one hook, and about thirty pure functions in between. This is the
 * only file in the app where the database's own spelling appears: `display_name`,
 * `filter_json`, `usage_7d`, `most_queried`, `default_time_column`. Everything
 * downstream reads {@link BiOverview}, {@link BiCatalog} and their neighbours, and
 * would not compile against a column name.
 *
 * That boundary earns its keep because of how the two kinds of mistake fail. A
 * wrong *field* name is caught by `tsc` before the code ever runs. A wrong *wire*
 * key is caught by nothing at all: the mapper reads a name the payload does not
 * carry, the guard answers `null` or `0` or `''`, and a panel states a confident
 * falsehood. So every key below was read out of
 * `supabase/migrations/20260901120000_bi_studio_vertical_slice.sql` rather than
 * remembered, and the renames that cost something to find carry a comment.
 *
 * Six of the ten reads answer with a single jsonb object and four with an array.
 * The broker wraps a lone object as a one-row page, so both arrive here the same
 * way and the difference surfaces only in the return type: {@link Feed} for a
 * list, {@link Report} for a thing that is either there or is not.
 *
 * There is no client fetch stamp anywhere in this file. Every BI payload carries
 * its own `generated_at` or `measured_at`, and that is the number worth showing —
 * when the server computed the answer, not when this tab happened to receive it.
 *
 * The chart taxonomy lives here too, above the mappers, because the shape a chart
 * needs is a property of the chart type and not of any one screen.
 */

import { useCallback, useMemo, useRef } from 'react';

import { useMappedDataset } from '@/platform/sdk';
import { asBoolean, asNumber, asString, num, str } from '../shared/guards';

import {
  AGGREGATE_LABEL,
  CHART_LABEL,
  DRILL_LABEL,
  ENTITY_KIND_LABEL,
  GRAIN_LABEL,
  METRIC_FORMAT_LABEL,
  OUTCOME_LABEL,
  STATUS_LABEL,
} from './labels';
import {
  BI_OPERATOR_ARITY,
  type BiAnalysis,
  type BiAnalysisDefinition,
  type BiCatalog,
  type BiChartRun,
  type BiChartType,
  type BiColumn,
  type BiCounts,
  type BiDashboard,
  type BiDashboardDetail,
  type BiDashboardRecord,
  type BiDataType,
  type BiDataset,
  type BiDatasetDetail,
  type BiDatasetRecord,
  type BiDatasetSource,
  type BiDimension,
  type BiDimensionDataType,
  type BiDrillLevel,
  type BiDrillPath,
  type BiDrillResult,
  type BiEntityKind,
  type BiEvent,
  type BiFilter,
  type BiHealth,
  type BiLineage,
  type BiLineageAnalysis,
  type BiLineageColumn,
  type BiLineageDashboard,
  type BiLineageDependent,
  type BiLineageImpact,
  type BiLineageSource,
  type BiLineageStamp,
  type BiLoggedRequest,
  type BiMetric,
  type BiOptions,
  type BiOverview,
  type BiPowers,
  type BiQueryEntry,
  type BiQueryError,
  type BiQueryOutcome,
  type BiQueryResult,
  type BiReport,
  type BiRow,
  type BiScalar,
  type BiSource,
  type BiSourceColumn,
  type BiSourceSyncResult,
  type BiStatus,
  type BiTile,
  type BiTileGrid,
  type BiTopDataset,
  type BiUsage,
  type BiView,
  type SourceRow,
} from './types';

/* ------------------------------------------------------------------ *
 * The chart taxonomy
 * ------------------------------------------------------------------ */

/**
 * Thirty-three chart types collapse to eighteen families, because what a screen
 * needs to know about a chart is rarely its exact name. A stacked column and a
 * Pareto are both bars with a category axis; a donut is a pie with a hole. The
 * families are what the shape rules and the renderer switch on.
 *
 * Six of them are drawn by a component that shares nothing with the others —
 * `LINE`, `BAR`, `PIE`, `SCATTER`, `HEATMAP`, `TABLE` — and the rest are either
 * one-offs or families of one that will grow.
 *
 * `PENDING` has no members and is meant to stay that way. It exists so that a
 * chart type added to the union but not yet drawn has somewhere honest to sit,
 * for the same reason `certify.mjs` keeps `const ABSENT = []`: a list that can
 * name its own gaps is worth more than one that cannot.
 */
export type ChartFamily =
  | 'TABLE' | 'KPI' | 'GAUGE' | 'LINE' | 'BAR' | 'PIE'
  | 'SCATTER' | 'HEATMAP' | 'TREEMAP' | 'FUNNEL' | 'RADAR'
  | 'BOX' | 'FORECAST' | 'TREE' | 'FLOW' | 'GRAPH' | 'SCHEDULE' | 'PENDING';

export const CHART_FAMILY: Readonly<Record<BiChartType, ChartFamily>> = {
  TABLE: 'TABLE', PIVOT: 'TABLE',
  KPI: 'KPI', GAUGE: 'GAUGE',
  LINE: 'LINE', AREA: 'LINE', COMBO: 'LINE', FORECAST_BAND: 'FORECAST',
  BAR: 'BAR', COLUMN: 'BAR', STACKED_BAR: 'BAR', STACKED_COLUMN: 'BAR',
  WATERFALL: 'BAR', BRIDGE: 'BAR', BULLET: 'BAR', HISTOGRAM: 'BAR', PARETO: 'BAR',
  PIE: 'PIE', DONUT: 'PIE',
  SCATTER: 'SCATTER', BUBBLE: 'SCATTER',
  HEATMAP: 'HEATMAP', CORRELATION_MATRIX: 'HEATMAP', SENSITIVITY_MATRIX: 'HEATMAP',
  TREEMAP: 'TREEMAP', FUNNEL: 'FUNNEL', RADAR: 'RADAR',
  BOX_PLOT: 'BOX', DECOMPOSITION_TREE: 'TREE', DRIVER_TREE: 'TREE',
  SANKEY: 'FLOW', DEPENDENCY_GRAPH: 'GRAPH', GANTT: 'SCHEDULE',
};

export const isChartDrawn = (type: BiChartType): boolean => CHART_FAMILY[type] !== 'PENDING';

/**
 * The minimum a family needs before it can be drawn at all.
 *
 * `dims` counts the time grain, because the compiler returns the grain as a
 * dimension column like any other and a line chart of one measure over time is
 * satisfied by it.
 */
export const CHART_SHAPE: Readonly<Record<ChartFamily, { readonly dims: number; readonly measures: number }>> = {
  TABLE: { dims: 0, measures: 0 },
  KPI: { dims: 0, measures: 1 },
  /** Two measures: the value and the target it is measured against. A gauge with
   *  no target is a dial whose full sweep means nothing. */
  GAUGE: { dims: 0, measures: 2 },
  LINE: { dims: 1, measures: 1 },
  BAR: { dims: 1, measures: 1 },
  PIE: { dims: 1, measures: 1 },
  SCATTER: { dims: 1, measures: 2 },
  HEATMAP: { dims: 2, measures: 1 },
  TREEMAP: { dims: 1, measures: 1 },
  FUNNEL: { dims: 1, measures: 1 },
  RADAR: { dims: 1, measures: 1 },
  /** One measure, because the quartiles are computed from the distribution of a
   *  single column — a shape the compiler already returns. */
  BOX: { dims: 1, measures: 1 },
  FORECAST: { dims: 1, measures: 1 },
  /** One dimension is enough for a root and its children. A second and third
   *  deepen it, and the renderer walks however many arrive. */
  TREE: { dims: 1, measures: 1 },
  /** Two dimensions, because one dimension is a list of nodes with nothing
   *  between them, which is not a flow. */
  FLOW: { dims: 2, measures: 1 },
  GRAPH: { dims: 2, measures: 1 },
  /** No measure: a bar on a schedule is a span, not a quantity. The start and end
   *  are dimensions, which is why this defers to `NEEDS_TEMPORAL` rather than
   *  asking for a number it would not know how to place. */
  SCHEDULE: { dims: 1, measures: 0 },
  PENDING: { dims: 0, measures: 0 },
};

/* ------------------------------------------------------------------ *
 * Windows
 * ------------------------------------------------------------------ */

/**
 * Both ledger reads clamp their limit to `least(greatest(coalesce(p_limit, 100),
 * 1), 1000)` server-side, so these sit inside the clamp: asking for more than it
 * allows is asking for a number that will not be honoured.
 *
 * Note this is a different ceiling from the query compiler's 5000. A page of
 * audit lines and a page of result rows are not the same kind of page, and
 * `BI_ROW_LIMIT_MAX` does not apply to either of these.
 */
const LOG = 200;
const EVENTS = 200;

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Text, or `null` for both absent and empty. Every nullable string on the wire
 *  arrives one of those two ways depending on whether the column was null or a
 *  form left it blank, and nothing downstream wants to tell them apart. */
const text = (value: unknown): string | null => {
  const raw = asString(value);
  return raw === null || raw === '' ? null : raw;
};

/** A flag with a stated default, for the many `readable_by_me`-shaped keys where
 *  an unreadable answer and a missing one should land in the same place. */
const bool = (value: unknown, fallback: boolean): boolean => asBoolean(value) ?? fallback;

function objOf(value: unknown): SourceRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as SourceRow;
}

function objThrough<T>(value: unknown, map: (row: SourceRow) => T | null): T | null {
  const row = objOf(value);
  return row === null ? null : map(row);
}

function mapList<T>(value: unknown, map: (row: SourceRow) => T | null): readonly T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const row = objOf(entry);
    if (row === null) continue;
    const mapped = map(row);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function strList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const item = text(entry);
    if (item !== null) out.push(item);
  }
  return out;
}

/** Anything jsonb can hold at a leaf, narrowed to what a cell can display. An
 *  object or an array arriving where a scalar belongs becomes `null` rather than
 *  `[object Object]`. */
function scalar(value: unknown): BiScalar {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return null;
}

function scalarList(value: unknown): readonly BiScalar[] {
  if (!Array.isArray(value)) return [];
  const out: BiScalar[] = [];
  for (const entry of value) out.push(scalar(entry));
  return out;
}

/** A result row, or a bag of chart options — the same operation either way, since
 *  both are flat jsonb objects whose keys this build cannot know in advance. */
function flatten(row: SourceRow): BiRow {
  const out: Record<string, BiScalar> = {};
  for (const [key, value] of Object.entries(row)) out[key] = scalar(value);
  return out;
}

const toOptions = (value: unknown): BiOptions => objThrough(value, flatten) ?? {};

/**
 * The vocabularies, each narrowed against a table that is exhaustive by
 * construction.
 *
 * Eight of them borrow the label tables from `./labels`, which is data rather
 * than presentation: a `Readonly<Record<Union, Localized>>` cannot be written
 * without naming every member, so it already *is* the proof this narrowing needs,
 * and a second list of thirty-three chart types would only be a list that can
 * drift from the first.
 *
 * The six below have no label table because nothing renders them as words. They
 * are declared as records rather than arrays because a `readonly T[]` missing a
 * member compiles happily and a `Record<T, true>` missing one does not.
 */
function vocabulary<T extends string>(table: Record<T, unknown>): (value: unknown) => T | null {
  return (value: unknown): T | null => {
    const raw = asString(value);
    if (raw === null) return null;
    return Object.prototype.hasOwnProperty.call(table, raw) ? (raw as T) : null;
  };
}

const DATA_TYPE: Readonly<Record<BiDataType, true>> = {
  text: true, number: true, date: true, timestamp: true,
  boolean: true, uuid: true, json: true,
};

const DIMENSION_DATA_TYPE: Readonly<Record<BiDimensionDataType, true>> = {
  text: true, number: true, date: true, timestamp: true, boolean: true, uuid: true,
};

const COLUMN_KIND: Readonly<Record<'DIMENSION' | 'METRIC', true>> = {
  DIMENSION: true, METRIC: true,
};

const LINEAGE_VIA: Readonly<Record<'source' | 'expression', true>> = {
  source: true, expression: true,
};

const DEPENDENT_RELATION: Readonly<Record<'numerator' | 'denominator' | 'drills_into', true>> = {
  numerator: true, denominator: true, drills_into: true,
};

/** A dimension has no status of its own — it lives and dies with its dataset — so
 *  `get_bi_lineage` reports the literal `'N/A'` for one rather than borrowing a
 *  status that would read as a governance claim nobody made. */
const LINEAGE_STATUS: Readonly<Record<BiStatus | 'N/A', unknown>> = { ...STATUS_LABEL, 'N/A': true };

const toStatus = vocabulary(STATUS_LABEL);
const toEntityKind = vocabulary(ENTITY_KIND_LABEL);
const toOutcome = vocabulary(OUTCOME_LABEL);
const toAggregate = vocabulary(AGGREGATE_LABEL);
const toGrain = vocabulary(GRAIN_LABEL);
const toMetricFormat = vocabulary(METRIC_FORMAT_LABEL);
const toDrillKind = vocabulary(DRILL_LABEL);
const toChartType = vocabulary(CHART_LABEL);
const toDataType = vocabulary(DATA_TYPE);
const toDimensionDataType = vocabulary(DIMENSION_DATA_TYPE);
const toColumnKind = vocabulary(COLUMN_KIND);
const toVia = vocabulary(LINEAGE_VIA);
const toRelation = vocabulary(DEPENDENT_RELATION);
const toLineageStatus = vocabulary(LINEAGE_STATUS);

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/** The broker's `where` speaks equality, `in` and `is null` — there is no `ilike`
 *  on that path and there should not be, since a search box is a client concern
 *  and a `%` reaching a compiled predicate is not. So the catalog filters here. */
export function hit(needle: string, ...fields: readonly (string | null)[]): boolean {
  for (const field of fields) {
    if (field !== null && field.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function filterAll<T>(all: readonly T[], needle: string, match: (item: T) => boolean): readonly T[] {
  return needle === '' ? all : all.filter(match);
}

export function indexBy<T>(rows: readonly T[], key: (row: T) => string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(key(row), row);
  return map;
}

/** Whether any page came back full, which is the only evidence this app has that
 *  a window elided something. The server does not say so for these two reads. */
function windowed(pairs: readonly (readonly [number, number])[]): boolean {
  for (const [count, limit] of pairs) {
    if (count >= limit) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Mappers
 *
 * Module-level and pure, because `useMappedDataset` memoizes on the function's
 * identity and a mapper declared inside a component would remap every row on
 * every render. Each returns `null` for a row it cannot identify, which the hook
 * drops — a row with no id is not a smaller row, it is not a row.
 * ------------------------------------------------------------------ */

/** The operand members are optional rather than nullable, so an operator that
 *  takes none carries none. Arity decides which are written: `IS_NULL` with a
 *  `value: null` attached would be indistinguishable from `EQ null`. */
function toFilter(row: SourceRow): BiFilter | null {
  const field = text(row.field);
  const op = vocabulary(BI_OPERATOR_ARITY)(row.op);
  if (field === null || op === null) return null;
  const arity = BI_OPERATOR_ARITY[op];
  if (arity === 'many') return { field, op, values: scalarList(row.values) };
  if (arity === 'two') return { field, op, value: scalar(row.value), value2: scalar(row.value2) };
  if (arity === 'one') return { field, op, value: scalar(row.value) };
  return { field, op };
}

/**
 * The compiler emits three different column shapes and omits the keys that do not
 * apply rather than nulling them: a period column carries seven keys, a dimension
 * nine, a metric twelve. Seven plus eight, nine plus six and twelve plus three all
 * come to fifteen, which is {@link BiColumn}'s member count.
 *
 * So every optional member below defaults to `null` and never to `0` or `''`. A
 * dimension column with `decimals: 0` would claim the compiler asked for whole
 * numbers; what it actually said was nothing.
 */
function toColumn(row: SourceRow): BiColumn | null {
  const key = text(row.key);
  const alias = text(row.alias);
  const kind = toColumnKind(row.kind);
  if (key === null || alias === null || kind === null) return null;
  return {
    key,
    alias,
    kind,
    label: str(row.label),
    labelAr: text(row.label_ar),
    dataType: toDataType(row.data_type) ?? 'text',
    ordinal: num(row.ordinal),
    grain: toGrain(row.grain),
    drillToKey: text(row.drill_to_key),
    drillKind: toDrillKind(row.drill_through_kind),
    aggregate: toAggregate(row.aggregate),
    format: toMetricFormat(row.format),
    unit: text(row.unit),
    decimals: asNumber(row.decimals),
    isAdditive: asBoolean(row.is_additive),
  };
}

/**
 * The lineage stamp is written by two different triggers with two different
 * shapes, each of three keys. A dimension records `source_columns` and
 * `drill_through_columns`; a metric records `source_columns` and `operands`,
 * where `operands` is the numerator and denominator of a RATIO and an empty array
 * for every other aggregate.
 *
 * Neither carries the other's key, so all four names are read and an absent array
 * becomes an empty one. That is why none of {@link BiLineageStamp}'s fields may be
 * required: the type is the union of two shapes, not either one of them.
 */
function toLineageStamp(value: unknown): BiLineageStamp | null {
  const row = objOf(value);
  if (row === null) return null;
  return {
    sourceColumns: strList(row.source_columns),
    drillColumns: strList(row.drill_through_columns),
    operands: strList(row.operands),
    measuredAt: text(row.measured_at),
  };
}

/* -- Catalog ------------------------------------------------------- */

/** `relation` is `relation_name` server-side and `branchScoped` is the derived
 *  `branch_column is not null`, because what a screen needs to know is whether
 *  rows are scoped, not which column does the scoping. */
function toSource(row: SourceRow): BiSource | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    name: str(row.display_name),
    nameAr: text(row.display_name_ar),
    relation: str(row.relation),
    requiredPermission: str(row.required_permission),
    branchScoped: bool(row.is_branch_scoped, false),
    timeColumn: text(row.default_time_column),
    columnCount: num(row.column_count),
  };
}

/**
 * One payload, two spellings of the same idea: the source's Arabic name arrives as
 * `display_name_ar` and the dataset's as `name_ar`, because sources are physical
 * relations with display names and datasets are governed objects with names.
 *
 * The time column is `default_time_column` in both the catalog and the detail
 * read. It is a default rather than a fact — an analysis may pick another — and
 * mapping it from `time_column` would silently report that no dataset has one.
 */
function toDataset(row: SourceRow): BiDataset | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    name: str(row.name),
    nameAr: text(row.name_ar),
    description: text(row.description),
    status: toStatus(row.status) ?? 'DRAFT',
    version: num(row.version),
    sourceKey: text(row.source_key),
    sourceName: text(row.source_display_name),
    requiredPermission: text(row.required_permission),
    readableByMe: bool(row.readable_by_me, false),
    timeColumn: text(row.default_time_column),
    dimensionCount: num(row.dimension_count),
    metricCount: num(row.metric_count),
    publishedMetricCount: num(row.published_metric_count),
    lastQueriedAt: text(row.last_queried_at),
    queryCount: num(row.query_count),
    publishedAt: text(row.published_at),
    updatedAt: text(row.updated_at),
    row,
  };
}

/** An empty catalog is a real answer — a fresh install has no datasets — so only a
 *  payload carrying neither list is refused. */
function toCatalog(row: SourceRow): BiCatalog | null {
  if (!Array.isArray(row.sources) && !Array.isArray(row.datasets)) return null;
  return {
    sources: mapList(row.sources, toSource),
    datasets: mapList(row.datasets, toDataset),
    generatedAt: text(row.generated_at),
  };
}

/* -- Dataset detail ------------------------------------------------ */

function toSourceColumn(row: SourceRow): BiSourceColumn | null {
  const columnName = text(row.column_name);
  if (columnName === null) return null;
  return {
    columnName,
    dataType: toDataType(row.data_type) ?? 'text',
    name: str(row.display_name),
    isDimension: bool(row.is_dimension, false),
    isMeasure: bool(row.is_measure, false),
  };
}

function toDimension(row: SourceRow): BiDimension | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    name: str(row.display_name),
    nameAr: text(row.display_name_ar),
    description: text(row.description),
    expression: str(row.expression),
    dataType: toDimensionDataType(row.data_type) ?? 'text',
    sortOrder: num(row.sort_order),
    isDefault: bool(row.is_default, false),
    drillToKey: text(row.drill_to_key),
    drillKind: toDrillKind(row.drill_through_kind),
    drillExpression: text(row.drill_through_expression),
    lineage: toLineageStamp(row.lineage),
    row,
  };
}

/** `filter_json` and the two `*_metric_key` columns keep their storage names on
 *  the wire; they become `filters`, `numeratorKey` and `denominatorKey` here
 *  because nothing above this line should have to know a metric's filters are
 *  stored as jsonb rather than as rows. */
function toMetric(row: SourceRow): BiMetric | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    name: str(row.display_name),
    nameAr: text(row.display_name_ar),
    description: text(row.description),
    formula: str(row.formula),
    aggregate: toAggregate(row.aggregate) ?? 'SUM',
    filters: mapList(row.filter_json, toFilter),
    numeratorKey: text(row.numerator_metric_key),
    denominatorKey: text(row.denominator_metric_key),
    format: toMetricFormat(row.format) ?? 'NUMBER',
    unit: text(row.unit),
    decimals: num(row.decimals),
    isAdditive: bool(row.is_additive, false),
    status: toStatus(row.status) ?? 'DRAFT',
    version: num(row.version),
    sortOrder: num(row.sort_order),
    publishedAt: text(row.published_at),
    lineage: toLineageStamp(row.lineage),
    row,
  };
}

/** The detail read's dataset carries `created_at` as well, which nothing shows: a
 *  governed object's interesting dates are when it was published, deprecated and
 *  last queried, and `updated_at` already answers "is this the version I saw". */
function toDatasetRecord(row: SourceRow): BiDatasetRecord | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    name: str(row.name),
    nameAr: text(row.name_ar),
    description: text(row.description),
    status: toStatus(row.status) ?? 'DRAFT',
    version: num(row.version),
    rowFilters: mapList(row.row_filter_json, toFilter),
    timeColumn: text(row.default_time_column),
    publishedAt: text(row.published_at),
    deprecatedAt: text(row.deprecated_at),
    lastQueriedAt: text(row.last_queried_at),
    queryCount: num(row.query_count),
    updatedAt: text(row.updated_at),
    row,
  };
}

/** The same source, seen from a dataset rather than from the catalog: it gains
 *  `is_active` and loses both the time column and the column count, because the
 *  dataset already resolved the first and the column list below answers the
 *  second exactly rather than as a total. */
function toDatasetSource(row: SourceRow): BiDatasetSource | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    name: str(row.display_name),
    nameAr: text(row.display_name_ar),
    relation: str(row.relation),
    requiredPermission: str(row.required_permission),
    branchScoped: bool(row.is_branch_scoped, false),
    isActive: bool(row.is_active, false),
    readableByMe: bool(row.readable_by_me, false),
  };
}

function toDatasetDetail(row: SourceRow): BiDatasetDetail | null {
  const dataset = objThrough(row.dataset, toDatasetRecord);
  if (dataset === null) return null;
  return {
    dataset,
    source: objThrough(row.source, toDatasetSource),
    columns: mapList(row.source_columns, toSourceColumn),
    dimensions: mapList(row.dimensions, toDimension),
    metrics: mapList(row.metrics, toMetric),
    canPublish: bool(row.can_publish, false),
    generatedAt: text(row.generated_at),
  };
}

/* -- Drill hierarchy ----------------------------------------------- */

/** `has_drill_through` is `drill_through_expression is not null` computed
 *  server-side, not the expression itself: a hierarchy view needs to know that a
 *  rung can be drilled through, and showing it the SQL would be showing it a
 *  detail it has no way to use. */
function toDrillLevel(row: SourceRow): BiDrillLevel | null {
  const key = text(row.key);
  if (key === null) return null;
  return {
    key,
    name: str(row.display_name),
    nameAr: text(row.display_name_ar),
    dataType: toDimensionDataType(row.data_type) ?? 'text',
    drillKind: toDrillKind(row.drill_through_kind),
    hasDrillThrough: bool(row.has_drill_through, false),
    depth: num(row.depth),
  };
}

/** An empty path is the honest answer for a dimension that drills nowhere, so
 *  only a payload with no root at all is refused. */
function toDrillPath(row: SourceRow): BiDrillPath | null {
  const datasetId = text(row.dataset_id);
  const root = text(row.root);
  if (datasetId === null || root === null) return null;
  return { datasetId, root, path: mapList(row.path, toDrillLevel), depth: num(row.depth) };
}

/* -- Lineage ------------------------------------------------------- */

/** Each upstream column also carries the relation it lives in, which is dropped:
 *  every column in one trace comes from the same source, and {@link BiLineage}
 *  already names it once. */
function toLineageColumn(row: SourceRow): BiLineageColumn | null {
  const columnName = text(row.column_name);
  const via = toVia(row.via);
  if (columnName === null || via === null) return null;
  return { columnName, dataType: toDataType(row.data_type), name: text(row.display_name), via };
}

/** The three report fields are nullable by construction — the join to `bi_reports`
 *  is a LEFT JOIN, because an analysis need not belong to a report. */
function toLineageAnalysis(row: SourceRow): BiLineageAnalysis | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    title: str(row.title),
    chartType: toChartType(row.chart_type) ?? 'TABLE',
    reportId: text(row.report_id),
    reportTitle: text(row.report_title),
    reportStatus: toStatus(row.report_status),
    onDashboards: num(row.on_dashboards),
  };
}

function toLineageDashboard(row: SourceRow): BiLineageDashboard | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    title: str(row.title),
    status: toStatus(row.status) ?? 'DRAFT',
    isDefault: bool(row.is_default, false),
  };
}

/** Two branches write this, and only one of them sends a status: a ratio metric
 *  has one, a dimension that drills into another does not. So `status` is read
 *  and left null rather than defaulted, which would print `DRAFT` next to a
 *  dimension that is neither draft nor anything else. */
function toLineageDependent(row: SourceRow): BiLineageDependent | null {
  const kind = toEntityKind(row.kind);
  const id = text(row.id);
  const key = text(row.key);
  const relation = toRelation(row.relation);
  if (kind === null || id === null || key === null || relation === null) return null;
  return { kind, id, key, name: str(row.display_name), status: toStatus(row.status), relation };
}

/** Never null. The four counts are `jsonb_array_length` of arrays this same
 *  payload carries, so a missing impact object means four honest zeroes and not
 *  an unknown — and a deprecate confirmation that cannot show a number is worse
 *  than one that shows nought. */
function toImpact(value: unknown): BiLineageImpact {
  const row = objOf(value) ?? {};
  return {
    analyses: num(row.analyses),
    dashboards: num(row.dashboards),
    publishedDashboards: num(row.published_dashboards),
    dependentDefinitions: num(row.dependent_definitions),
  };
}

/** Five keys, not nine. See {@link BiLineageSource} for why this is its own shape
 *  rather than a partial catalog source. */
function toLineageSource(row: SourceRow): BiLineageSource | null {
  const key = text(row.key);
  if (key === null) return null;
  return {
    key,
    name: str(row.display_name),
    relation: str(row.relation),
    requiredPermission: str(row.required_permission),
    readableByMe: bool(row.readable_by_me, false),
  };
}

/**
 * Fourteen keys in, thirteen fields out: `generated_at` is dropped because a
 * trace already carries `measured_at`, which is the number that means something —
 * when the registry last looked at the source columns, not when this call
 * assembled them.
 *
 * The status narrows against `BiStatus` plus the literal `'N/A'`, which is what a
 * dimension gets. A dimension has no status of its own; it lives and dies with its
 * dataset. Coercing that to `DRAFT` would be a governance claim nobody made.
 */
function toLineage(row: SourceRow): BiLineage | null {
  const kind = toEntityKind(row.kind);
  const id = text(row.id);
  const key = text(row.key);
  const status = toLineageStatus(row.status);
  if (kind === null || id === null || key === null || status === null) return null;
  return {
    kind,
    id,
    key,
    label: str(row.label),
    status,
    datasetId: text(row.dataset_id),
    source: objThrough(row.source, toLineageSource),
    upstream: mapList(row.upstream_columns, toLineageColumn),
    analyses: mapList(row.downstream_analyses, toLineageAnalysis),
    dashboards: mapList(row.downstream_dashboards, toLineageDashboard),
    dependents: mapList(row.dependent_definitions, toLineageDependent),
    impact: toImpact(row.impact),
    measuredAt: text(row.measured_at),
  };
}

/* -- Analyses, reports, dashboards --------------------------------- */

/** The query half of a saved analysis. Read from two places with two shapes
 *  around it: nested under `visualization` in a dashboard tile, and flat inside a
 *  report's `visualizations` array where the presentation keys sit alongside. The
 *  fourteen keys below are the intersection, and are identical in both. */
function toAnalysisDefinition(row: SourceRow): BiAnalysisDefinition | null {
  const id = text(row.id);
  const key = text(row.key);
  const datasetId = text(row.dataset_id);
  if (id === null || key === null || datasetId === null) return null;
  return {
    id,
    key,
    chartType: toChartType(row.chart_type) ?? 'TABLE',
    datasetId,
    datasetKey: str(row.dataset_key),
    datasetName: text(row.dataset_name),
    datasetStatus: toStatus(row.dataset_status),
    dimensions: strList(row.dimensions),
    measures: strList(row.measures),
    filters: mapList(row.filters, toFilter),
    timeGrain: toGrain(row.time_grain),
    orderBy: text(row.order_by),
    orderDesc: bool(row.order_desc, false),
    rowLimit: num(row.row_limit),
  };
}

/** `readable_by_me` defaults to `false`, so a payload that somehow omits it
 *  renders a stated refusal rather than a chart drawn from nothing. */
function toAnalysis(row: SourceRow): BiAnalysis | null {
  const definition = toAnalysisDefinition(row);
  if (definition === null) return null;
  return {
    ...definition,
    title: str(row.title),
    titleAr: text(row.title_ar),
    options: toOptions(row.options),
    sortOrder: num(row.sort_order),
    readableByMe: bool(row.readable_by_me, false),
    row,
  };
}

function toReport(row: SourceRow): BiReport | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    title: str(row.title),
    titleAr: text(row.title_ar),
    description: text(row.description),
    status: toStatus(row.status) ?? 'DRAFT',
    version: num(row.version),
    layout: toOptions(row.layout),
    sortOrder: num(row.sort_order),
    publishedAt: text(row.published_at),
    deprecatedAt: text(row.deprecated_at),
    updatedAt: text(row.updated_at),
    analyses: mapList(row.visualizations, toAnalysis),
    row,
  };
}

function toDashboard(row: SourceRow): BiDashboard | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    title: str(row.title),
    titleAr: text(row.title_ar),
    description: text(row.description),
    status: toStatus(row.status) ?? 'DRAFT',
    version: num(row.version),
    isDefault: bool(row.is_default, false),
    sortOrder: num(row.sort_order),
    publishedAt: text(row.published_at),
    deprecatedAt: text(row.deprecated_at),
    updatedAt: text(row.updated_at),
    tileCount: num(row.tile_count),
    fullyReadableByMe: bool(row.fully_readable_by_me, false),
    row,
  };
}

/** The server's own defaults, restated: `w` 6 and `h` 4 are the column defaults,
 *  so a grid object missing them lands where a newly placed tile would. */
function toGrid(value: unknown): BiTileGrid {
  const row = objOf(value) ?? {};
  return {
    x: num(row.x),
    y: num(row.y),
    w: asNumber(row.w) ?? 6,
    h: asNumber(row.h) ?? 4,
  };
}

/** `title` arrives already resolved as `coalesce(title_override, v.title)` and
 *  `options` already merged as `t.options || v.options`, so neither is recomputed
 *  here: the override precedence is a server decision and duplicating it would
 *  give this app a second opinion about which one wins. */
function toTile(row: SourceRow): BiTile | null {
  const id = text(row.id);
  const analysis = objThrough(row.visualization, toAnalysisDefinition);
  if (id === null || analysis === null) return null;
  return {
    id,
    title: str(row.title),
    titleAr: text(row.title_ar),
    grid: toGrid(row.grid),
    options: toOptions(row.options),
    sortOrder: num(row.sort_order),
    analysis,
    readableByMe: bool(row.readable_by_me, false),
  };
}

/** Fourteen keys in, twelve fields out: `sort_order` orders dashboards in the
 *  list and means nothing once one is open, and `created_at` is the date nobody
 *  asks about. */
function toDashboardRecord(row: SourceRow): BiDashboardRecord | null {
  const id = text(row.id);
  const key = text(row.key);
  if (id === null || key === null) return null;
  return {
    id,
    key,
    title: str(row.title),
    titleAr: text(row.title_ar),
    description: text(row.description),
    status: toStatus(row.status) ?? 'DRAFT',
    version: num(row.version),
    layout: toOptions(row.layout),
    isDefault: bool(row.is_default, false),
    publishedAt: text(row.published_at),
    deprecatedAt: text(row.deprecated_at),
    updatedAt: text(row.updated_at),
    row,
  };
}

/** `tile_count` is dropped: it is `jsonb_array_length(tiles)` of an array this
 *  same payload carries, and a count that can disagree with the list beside it is
 *  a bug waiting for a partial mapper. */
function toDashboardDetail(row: SourceRow): BiDashboardDetail | null {
  const dashboard = objThrough(row.dashboard, toDashboardRecord);
  if (dashboard === null) return null;
  return {
    dashboard,
    tiles: mapList(row.tiles, toTile),
    canEdit: bool(row.can_edit, false),
    canPublish: bool(row.can_publish, false),
    generatedAt: text(row.generated_at),
  };
}

/* -- The overview -------------------------------------------------- */

/** Five of the twelve flip a suffix into a prefix — `datasets_published` becomes
 *  `publishedDatasets` — which is the one rename in this file that a careless
 *  reader would call cosmetic. It is not: `datasets_published` and
 *  `published_datasets` are both plausible spellings, and only one of them is on
 *  the wire. */
function toCounts(row: SourceRow): BiCounts {
  return {
    sources: num(row.sources),
    datasets: num(row.datasets),
    publishedDatasets: num(row.datasets_published),
    draftDatasets: num(row.datasets_draft),
    deprecatedDatasets: num(row.datasets_deprecated),
    dimensions: num(row.dimensions),
    metrics: num(row.metrics),
    publishedMetrics: num(row.metrics_published),
    reports: num(row.reports),
    visualizations: num(row.visualizations),
    dashboards: num(row.dashboards),
    publishedDashboards: num(row.dashboards_published),
  };
}

function toHealth(value: unknown): BiHealth {
  const row = objOf(value) ?? {};
  return {
    datasetsWithoutSource: num(row.datasets_without_source),
    datasetsWithoutMetric: num(row.datasets_without_metric),
    datasetsNeverQueried: num(row.datasets_never_queried),
    datasetsStale30d: num(row.datasets_stale_30d),
    orphanVisualizations: num(row.orphan_visualizations),
    publishedOnDeprecated: num(row.published_on_deprecated),
  };
}

/**
 * Invisible unless the server says otherwise.
 *
 * `visible` is written by the server as a literal `true` inside a branch guarded
 * on `has_permission('bi_query_log', 'read')`, and as `{visible: false}` when that
 * branch did not run. Reading it as `bool(…, false)` and then filling six zeroes
 * would turn "you may not know" into "there were none", which is the one thing
 * this discriminated union exists to prevent.
 */
function toUsage(value: unknown): BiUsage {
  const row = objOf(value);
  if (row === null || asBoolean(row.visible) !== true) return { visible: false };
  return {
    visible: true,
    queries7d: num(row.queries_7d),
    denied7d: num(row.denied_7d),
    errors7d: num(row.errors_7d),
    p95DurationMs: num(row.p95_duration_ms),
    slowestMs: num(row.slowest_ms),
    truncated7d: num(row.truncated_7d),
  };
}

function toTopDataset(row: SourceRow): BiTopDataset | null {
  const datasetId = text(row.dataset_id);
  if (datasetId === null) return null;
  return {
    datasetId,
    datasetKey: str(row.dataset_key),
    name: str(row.name),
    status: toStatus(row.status) ?? 'DRAFT',
    queryCount: num(row.query_count),
    lastQueriedAt: text(row.last_queried_at),
  };
}

/** Every power defaults to `false`. A missing capabilities object is a payload
 *  this app does not understand, and the safe reading of that is that it may do
 *  nothing — the server will refuse anyway, but the buttons should not be there
 *  to be pressed. */
function toPowers(value: unknown): BiPowers {
  const row = objOf(value) ?? {};
  return {
    canDefine: bool(row.can_define, false),
    canPublishDefinitions: bool(row.can_publish_definitions, false),
    canSaveAnalysis: bool(row.can_save_analysis, false),
    canBuildDashboards: bool(row.can_build_dashboards, false),
    canPublishDashboards: bool(row.can_publish_dashboards, false),
    canReadQueryLog: bool(row.can_read_query_log, false),
    canSyncSources: bool(row.can_sync_sources, false),
  };
}

/** Guarded on `counts` alone. The other four sub-objects degrade to zeroes and a
 *  stated absence, but a payload with no counts at all is not a slow overview —
 *  it is a different payload. */
function toOverview(row: SourceRow): BiOverview | null {
  const counts = objOf(row.counts);
  if (counts === null) return null;
  return {
    counts: toCounts(counts),
    health: toHealth(row.health),
    usage: toUsage(row.usage_7d),
    topDatasets: mapList(row.most_queried, toTopDataset),
    powers: toPowers(row.capabilities),
    generatedAt: text(row.generated_at),
  };
}

/* -- The two ledgers ----------------------------------------------- */

/**
 * The arguments a run was called with, as the ledger stored them.
 *
 * Two writers use one column. A query stores nine keys; a drill-through stores
 * three — `drill_through`, `value` and sometimes `filters` — and none of the nine.
 * So every field here degrades rather than defaults: a drill line reports no
 * dataset, no metrics and no limit, which is true of it.
 *
 * `orderDesc` and `limit` are nullable rather than defaulted for the same reason.
 * `limit: 0` would claim a caller asked for nothing back.
 */
function toLoggedRequest(value: unknown): BiLoggedRequest {
  const row = objOf(value) ?? {};
  return {
    datasetId: text(row.dataset_id),
    dimensions: strList(row.dimensions),
    metrics: strList(row.metrics),
    filters: mapList(row.filters, toFilter),
    timeGrain: toGrain(row.time_grain),
    orderBy: text(row.order_by),
    orderDesc: asBoolean(row.order_desc),
    limit: asNumber(row.limit),
    visualizationId: text(row.visualization_id),
  };
}

/** Four of the eighteen keys are null by construction — the reads to
 *  `bi_datasets`, `bi_visualizations` and `staff_profiles` are all LEFT JOINs, and
 *  a denied query legitimately has no dataset to name. */
function toQueryEntry(row: SourceRow): BiQueryEntry | null {
  const id = text(row.id);
  const outcome = toOutcome(row.outcome);
  if (id === null || outcome === null) return null;
  return {
    id,
    createdAt: text(row.created_at),
    datasetId: text(row.dataset_id),
    datasetKey: text(row.dataset_key),
    datasetName: text(row.dataset_name),
    visualizationId: text(row.visualization_id),
    visualizationTitle: text(row.visualization_title),
    actorId: text(row.actor_id),
    actorRole: text(row.actor_role),
    isMine: bool(row.is_mine, false),
    request: toLoggedRequest(row.request),
    compiledSql: text(row.compiled_sql),
    columnCount: asNumber(row.column_count),
    rowCount: asNumber(row.row_count),
    durationMs: asNumber(row.duration_ms),
    outcome,
    errorCode: text(row.error_code),
    errorMessage: text(row.error_message),
  };
}

/**
 * Eight keys arrive and eleven fields leave.
 *
 * `from`, `to` and `note` are not top-level: all four `bi_set_status` branches
 * write them into the event payload with `jsonb_build_object('from', …, 'to', …,
 * 'note', …)`, and `get_bi_events` returns `payload` whole. So they are lifted
 * out here rather than read off the row, where they would each be null forever
 * and a history pane would show every transition as an arrow from nothing to
 * nothing.
 *
 * The payload itself is kept as well, because two of the four branches merge
 * extra keys into it that this app does not model.
 */
function toEvent(row: SourceRow): BiEvent | null {
  const id = text(row.id);
  const eventType = text(row.event_type);
  if (id === null || eventType === null) return null;
  const payload = objOf(row.payload) ?? {};
  return {
    id,
    createdAt: text(row.created_at),
    entityKind: str(row.entity_kind),
    entityId: text(row.entity_id),
    eventType,
    actorId: text(row.actor_id),
    actorRole: text(row.actor_role),
    from: toStatus(payload.from),
    to: toStatus(payload.to),
    note: text(payload.note),
    payload,
  };
}

/* ------------------------------------------------------------------ *
 * The four commands that answer with data
 * ------------------------------------------------------------------ */

/**
 * Ran, or did not.
 *
 * Not `T | null`. Three of these four report failure as a payload rather than by
 * raising — `{ok: false, error_code, error_message}` — because a refused query is
 * a fact about the request and not an accident of transport. A null would discard
 * that fact at the exact moment something needs it: a chart that cannot draw
 * still occupies a rectangle, and what belongs in the rectangle is the reason.
 */
export type BiRun<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BiQueryError };

/** Neither shape a handler can send. Reached only when the reply is not an object
 *  at all, which means the transport failed rather than the query. */
const UNREADABLE: BiQueryError = {
  code: 'UNREADABLE',
  message: 'The server answered in a shape this app does not recognise.',
  durationMs: 0,
};

const failed = (error: BiQueryError): BiRun<never> => ({ ok: false, error });

/** `duration_ms` is on both query branches and on neither drill branch, so it
 *  degrades to zero rather than being invented. A drill that failed took a length
 *  of time nobody measured, and zero is the only number that says as much. */
function toQueryError(row: SourceRow): BiQueryError {
  return {
    code: text(row.error_code) ?? 'UNKNOWN',
    message: text(row.error_message) ?? UNREADABLE.message,
    durationMs: num(row.duration_ms),
  };
}

/**
 * Nine of the ten success keys; `ok` is the discriminant and does not survive
 * into the record.
 *
 * `truncated` is read rather than recomputed. The server states it as
 * `row_count >= row_limit` *after* the 1..5000 clamp, and this app knows only the
 * limit it asked for — comparing against that would answer a question about the
 * request when the question is about the answer.
 */
function toQueryResult(row: SourceRow): BiQueryResult {
  return {
    columns: mapList(row.columns, toColumn),
    rows: mapList(row.rows, flatten),
    rowCount: num(row.row_count),
    rowLimit: num(row.row_limit),
    truncated: bool(row.truncated, false),
    durationMs: num(row.duration_ms),
    datasetKey: str(row.dataset_key),
    timeGrain: toGrain(row.time_grain),
    compiledSql: str(row.compiled_sql),
  };
}

/** The failure branch still carries `columns` and an empty `rows`, and both are
 *  dropped: an empty grid under a stated error is a grid saying there were no
 *  rows, and there were no rows because the query never ran. */
export function readQuery(payload: unknown): BiRun<BiQueryResult> {
  const row = objOf(payload);
  if (row === null) return failed(UNREADABLE);
  if (asBoolean(row.ok) !== true) return failed(toQueryError(row));
  return { ok: true, value: toQueryResult(row) };
}

/**
 * The two branches share `ok` and the two entity keys and nothing else — a failed
 * drill carries no `kind`, no `dimension_key` and no `value`.
 *
 * So there is no partial drill here. A list of identifiers with no statement of
 * what they sit under is a list of identifiers, and handing one to a screen that
 * knows how to open a booking would be handing it the wrong bookings quietly.
 */
export function readDrill(payload: unknown): BiRun<BiDrillResult> {
  const row = objOf(payload);
  if (row === null) return failed(UNREADABLE);
  if (asBoolean(row.ok) !== true) return failed(toQueryError(row));
  return {
    ok: true,
    value: {
      kind: toDrillKind(row.kind),
      dimensionKey: str(row.dimension_key),
      value: scalar(row.value),
      entityIds: strList(row.entity_ids),
      entityCount: num(row.entity_count),
      truncated: bool(row.truncated, false),
    },
  };
}

/**
 * One flat object, split in two.
 *
 * `bi_run_visualization` merges six presentation keys onto whatever
 * `bi_run_query` returned, with `||` — so a success carries sixteen keys and a
 * failure thirteen, the six riding along either way. They are separated here
 * because they answer different questions and go stale at different rates: the
 * frame is a saved decision about presentation, the result is numbers as of now.
 */
export function readChart(payload: unknown): BiRun<BiChartRun> {
  const row = objOf(payload);
  if (row === null) return failed(UNREADABLE);
  if (asBoolean(row.ok) !== true) return failed(toQueryError(row));
  return {
    ok: true,
    value: {
      chart: {
        visualizationId: str(row.visualization_id),
        visualizationKey: str(row.visualization_key),
        // The same fallback the migration itself used when it backfilled the
        // column against its new CHECK: a chart whose type is unrecognised is
        // drawn as its own data.
        chartType: toChartType(row.chart_type) ?? 'TABLE',
        title: str(row.title),
        titleAr: text(row.title_ar),
        options: toOptions(row.options),
      },
      result: toQueryResult(row),
    },
  };
}

/**
 * The one write here that cannot answer `ok: false`.
 *
 * `bi_sync_sources` raises 42501 at anyone who is not an ADMIN and otherwise runs
 * to completion, so there is no failure payload to model and a {@link BiRun}
 * would carry a branch nothing can reach. It answers null instead, for the single
 * case a `BiRun` could not describe either: a reply that is not an object.
 */
export function readSync(payload: unknown): BiSourceSyncResult | null {
  const row = objOf(payload);
  if (row === null) return null;
  return {
    columnsRegistered: num(row.columns_registered),
    sourcesDeactivated: num(row.sources_deactivated),
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

interface ReadState {
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/** A list read. */
export interface Feed<T> extends ReadState {
  readonly rows: readonly T[];
}

/**
 * A single-object read.
 *
 * `value` is null while loading, null on error, and null when the mapper refused
 * the payload — three different situations a screen tells apart by reading
 * `loading` and `error` beside it. They are deliberately not folded together: a
 * pane that renders "nothing here" during the first two is lying twice.
 */
export interface Report<T> extends ReadState {
  readonly value: T | null;
}

/**
 * Six of the ten reads answer with one jsonb object, which the broker wraps as a
 * one-row page and `useMappedDataset` then drops if the mapper refused it. So a
 * payload that did not narrow arrives here as an empty page and leaves as a null
 * value, which is the honest translation of both.
 */
function report<T>(feed: Feed<T>): Report<T> {
  return {
    value: feed.rows[0] ?? null,
    loading: feed.loading,
    error: feed.error,
    refetch: feed.refetch,
  };
}

/**
 * Rail badges, for the three views whose totals the overview actually knows.
 *
 * `queries` and `events` are absent on purpose. Both ledgers are read a page at a
 * time and the page is {@link LOG} rows, so a feed's length is a ceiling and not
 * a total; a rail printing 200 beside the query log would be stating the page
 * size as a fact. `overview` and `analysis` are absent because neither is a list.
 *
 * Absent is a badge that is not drawn. Zero is a badge that says there are none.
 * Only one of those is true of a number this app does not have.
 */
export type BiRailCounts = Readonly<Partial<Record<BiView, number>>>;

const NO_COUNTS: BiRailCounts = {};
const NO_SOURCES: readonly BiSource[] = [];
const NO_DATASETS: readonly BiDataset[] = [];
const NO_POWERS: BiPowers = toPowers(null);

function railCounts(overview: BiOverview | null): BiRailCounts {
  if (overview === null) return NO_COUNTS;
  const { counts } = overview;
  return { catalog: counts.datasets, dashboards: counts.dashboards, reports: counts.reports };
}

/**
 * The three kinds `get_bi_lineage` accepts. Narrower than {@link BiEntityKind},
 * which also names reports, dashboards and analyses — none of which the lineage
 * read describes, and all of which it refuses with 22023.
 */
export type BiLineageKind = 'DATASET' | 'DIMENSION' | 'METRIC';

export interface BiLineageTarget {
  readonly kind: BiLineageKind;
  readonly id: string;
}

export interface BiDrillTarget {
  readonly datasetId: string;
  readonly dimensionKey: string;
}

/** Both halves nullable, and both null means the whole studio's history rather
 *  than none of it — which is what `get_bi_events` does with two null arguments. */
export interface BiEventScope {
  readonly kind: BiEntityKind | null;
  readonly id: string | null;
}

/** Every member nullable, and null is not a missing argument — it is the read
 *  switched off, which is exactly what `enabled: false` does downstream. */
export interface BiModelParams {
  readonly datasetId: string | null;
  readonly dashboardId: string | null;
  readonly lineage: BiLineageTarget | null;
  readonly drill: BiDrillTarget | null;
  readonly outcome: BiQueryOutcome | null;
  readonly events: BiEventScope;
}

export interface BiModel {
  readonly overview: Report<BiOverview>;
  readonly catalog: Report<BiCatalog>;
  readonly dataset: Report<BiDatasetDetail>;
  readonly drillPath: Report<BiDrillPath>;
  readonly lineage: Report<BiLineage>;
  readonly dashboards: Feed<BiDashboard>;
  readonly dashboard: Report<BiDashboardDetail>;
  readonly reports: Feed<BiReport>;
  readonly queries: Feed<BiQueryEntry>;
  readonly events: Feed<BiEvent>;
  /** Lifted off the catalog so a source list does not reach through a nullable
   *  report to find out it is empty. */
  readonly sources: readonly BiSource[];
  readonly datasets: readonly BiDataset[];
  readonly counts: BiRailCounts;
  /** All seven false until the overview lands. The server refuses regardless;
   *  this is about not offering a button that will be refused. */
  readonly powers: BiPowers;
  /** True when either ledger came back exactly full, the only evidence this app
   *  has that a page elided something. */
  readonly ledgerWindowed: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refreshAll: () => void;
}

/**
 * Ten reads, one object.
 *
 * Four are always on. Six carry an `enabled` that is false whenever their subject
 * is null, so opening the app costs four round trips rather than ten and a
 * dataset pane nobody has opened does not fetch a dataset.
 *
 * The `where` objects are fresh literals on every render and that is safe:
 * `useDataset` keys its effect on `JSON.stringify` of the query-shaping options,
 * not on their identity.
 *
 * `loading` and `error` are folded across all ten because the chrome shows one
 * spinner and one banner. The individual reads stay on the model for the panes
 * that want to be precise about which of them is late.
 */
export function useBiModel(params: BiModelParams): BiModel {
  const { datasetId, dashboardId, lineage: target, drill, outcome, events: scope } = params;

  const overview: Feed<BiOverview> = useMappedDataset('biOverview', toOverview);
  const catalog: Feed<BiCatalog> = useMappedDataset('biCatalog', toCatalog);
  const dashboards: Feed<BiDashboard> = useMappedDataset('biDashboards', toDashboard);
  const reports: Feed<BiReport> = useMappedDataset('biReports', toReport);
  const dataset: Feed<BiDatasetDetail> = useMappedDataset('biDatasetDetail', toDatasetDetail, {
    where: { datasetId },
    enabled: datasetId !== null,
  });
  const dashboard: Feed<BiDashboardDetail> = useMappedDataset('biDashboard', toDashboardDetail, {
    where: { dashboardId },
    enabled: dashboardId !== null,
  });
  const drillPath: Feed<BiDrillPath> = useMappedDataset('biDrillPath', toDrillPath, {
    where: { datasetId: drill?.datasetId ?? null, dimensionKey: drill?.dimensionKey ?? null },
    enabled: drill !== null,
  });
  const lineage: Feed<BiLineage> = useMappedDataset('biLineage', toLineage, {
    where: { kind: target?.kind ?? null, id: target?.id ?? null },
    enabled: target !== null,
  });
  const queries: Feed<BiQueryEntry> = useMappedDataset('biQueryLog', toQueryEntry, {
    limit: LOG,
    where: { outcome },
  });
  const events: Feed<BiEvent> = useMappedDataset('biEvents', toEvent, {
    limit: EVENTS,
    where: { entityKind: scope.kind, entityId: scope.id },
  });

  const states: readonly ReadState[] = [
    overview, catalog, dashboards, reports, dataset,
    dashboard, drillPath, lineage, queries, events,
  ];
  const statesRef = useRef(states);
  statesRef.current = states;

  /** Stable across renders, because it goes into a toolbar button and a stale
   *  dependency list is a button that refreshes yesterday's ten reads. */
  const refreshAll = useCallback(() => {
    for (const state of statesRef.current) state.refetch();
  }, []);

  let loading = false;
  let error: string | null = null;
  for (const state of states) {
    if (state.loading) loading = true;
    if (error === null) error = state.error;
  }

  const summary = report(overview);
  const catalogue = report(catalog);
  const counts = useMemo(() => railCounts(summary.value), [summary.value]);

  return {
    overview: summary,
    catalog: catalogue,
    dataset: report(dataset),
    drillPath: report(drillPath),
    lineage: report(lineage),
    dashboards,
    dashboard: report(dashboard),
    reports,
    queries,
    events,
    sources: catalogue.value?.sources ?? NO_SOURCES,
    datasets: catalogue.value?.datasets ?? NO_DATASETS,
    counts,
    powers: summary.value?.powers ?? NO_POWERS,
    ledgerWindowed: windowed([[queries.rows.length, LOG], [events.rows.length, EVENTS]]),
    loading,
    error,
    refreshAll,
  };
}
