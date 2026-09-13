/**
 * Analytics — the contract, transcribed.
 *
 * Every union here is a CHECK constraint in
 * `supabase/migrations/20260901120000_bi_studio_vertical_slice.sql`, and every
 * nullable field is a column that migration leaves nullable. A wider type would
 * let a screen offer a chart the renderer cannot draw or a filter the compiler
 * will not build.
 *
 * Transcribed rather than imported, for the same reason `src/apps/dms/types.ts`
 * is: `verify-os-boundary` allows an app exactly two outside imports —
 * `@/platform/sdk` and `@/platform/kernel/abi` — so `@/types/bi` is out of reach
 * from here even though it says the same thing. An app depends on the ABI and on
 * the migration, never on the admin code it replaced.
 *
 * The two halves read differently and should. The unions and constants below are
 * snake-and-shout because that is how the database spells them and they travel
 * over the wire unchanged. The record interfaces further down are camelCase
 * because they are what the app holds after {@link SourceRow} has been narrowed.
 *
 * One thing here has no counterpart in Documents. A document has a fixed set of
 * columns; a query result does not — its shape is decided at run time by the
 * dimensions and metrics that were asked for. So {@link BiRow} is keyed by
 * strings the compiler invented (`d0`, `m1`) and {@link BiColumn} is the only
 * description of what those keys mean. Nothing in this app may read a row by a
 * literal key.
 */

/* ------------------------------------------------------------------ *
 * Wire vocabulary
 * ------------------------------------------------------------------ */

/** Every status any BI definition can hold. One vocabulary, four tables. */
export type BiStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';

export const BI_STATUSES: readonly BiStatus[] = ['DRAFT', 'PUBLISHED', 'DEPRECATED'];

/** The four kinds `set_bi_status_command` governs. */
export type BiGovernedKind = 'DATASET' | 'METRIC' | 'REPORT' | 'DASHBOARD';

export const BI_GOVERNED_KINDS: readonly BiGovernedKind[] = [
  'DATASET', 'METRIC', 'REPORT', 'DASHBOARD',
];

/** `bi_events.entity_kind`. Wider than {@link BiGovernedKind}: the ledger records
 *  events for things whose status is not governed, such as a source sync. */
export type BiEntityKind =
  | 'DATASET' | 'DIMENSION' | 'METRIC' | 'REPORT'
  | 'VISUALIZATION' | 'DASHBOARD' | 'SOURCE';

/** A column's storage type, as the source catalog reports it. */
export type BiDataType =
  | 'text' | 'number' | 'date' | 'timestamp' | 'boolean' | 'uuid' | 'json';

/** What a dimension may be. A `json` column cannot be grouped by, so it cannot
 *  be a dimension — the constraint says so and this narrows to match. */
export type BiDimensionDataType = Exclude<BiDataType, 'json'>;

/** How a metric collapses many rows into one number.
 *
 *  `RATIO` is the odd one: it ignores `formula` and composes two other metrics,
 *  dividing the sum of one by the sum of the other. That is not the same as
 *  averaging a per-row ratio, which weights every group equally and is
 *  indistinguishable from the right number once it is on a dashboard. */
export type BiAggregate =
  | 'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX' | 'RATIO';

export const BI_AGGREGATES: readonly BiAggregate[] = [
  'SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX', 'RATIO',
];

/** The buckets a time column can be truncated to. */
export type BiTimeGrain = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export const BI_TIME_GRAINS: readonly BiTimeGrain[] = [
  'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR',
];

/** The dimension key the compiler invents when a query asks for a time grain.
 *  Not a column on any source — a screen that offers it as a field is wrong. */
export const BI_PERIOD_KEY = 'bi_period';

/** How a number is written once it has been computed. */
export type BiMetricFormat =
  | 'NUMBER' | 'INTEGER' | 'CURRENCY' | 'PERCENT' | 'DURATION_HOURS';

export const BI_METRIC_FORMATS: readonly BiMetricFormat[] = [
  'NUMBER', 'INTEGER', 'CURRENCY', 'PERCENT', 'DURATION_HOURS',
];

/** What a drill-through lands on. Upper-case, because it names a screen in this
 *  application rather than a table in the database. */
export type BiDrillKind =
  | 'BOOKING' | 'PILGRIM' | 'PACKAGE' | 'INVOICE' | 'PAYMENT' | 'JOURNAL_ENTRY'
  | 'CRM_LEAD' | 'CRM_OPPORTUNITY' | 'CRM_QUOTE' | 'CRM_CUSTOMER' | 'DOCUMENT';

export const BI_DRILL_KINDS: readonly BiDrillKind[] = [
  'BOOKING', 'PILGRIM', 'PACKAGE', 'INVOICE', 'PAYMENT', 'JOURNAL_ENTRY',
  'CRM_LEAD', 'CRM_OPPORTUNITY', 'CRM_QUOTE', 'CRM_CUSTOMER', 'DOCUMENT',
];

/** Every chart this application can draw, in constraint order.
 *
 *  The list is the CHECK constraint, which means a chart the renderer does not
 *  implement cannot be saved. Adding one is a migration and a renderer arm,
 *  never a string. */
export type BiChartType =
  | 'TABLE' | 'PIVOT' | 'KPI'
  | 'LINE' | 'AREA' | 'BAR' | 'COLUMN' | 'STACKED_BAR' | 'STACKED_COLUMN'
  | 'PIE' | 'DONUT' | 'SCATTER' | 'BUBBLE'
  | 'WATERFALL' | 'BRIDGE' | 'BULLET' | 'HISTOGRAM' | 'BOX_PLOT'
  | 'HEATMAP' | 'TREEMAP' | 'DECOMPOSITION_TREE' | 'SANKEY' | 'FUNNEL' | 'GANTT'
  | 'CORRELATION_MATRIX' | 'PARETO' | 'FORECAST_BAND' | 'SENSITIVITY_MATRIX'
  | 'DEPENDENCY_GRAPH' | 'DRIVER_TREE' | 'RADAR' | 'GAUGE' | 'COMBO';

export const BI_CHART_TYPES: readonly BiChartType[] = [
  'TABLE', 'PIVOT', 'KPI',
  'LINE', 'AREA', 'BAR', 'COLUMN', 'STACKED_BAR', 'STACKED_COLUMN',
  'PIE', 'DONUT', 'SCATTER', 'BUBBLE',
  'WATERFALL', 'BRIDGE', 'BULLET', 'HISTOGRAM', 'BOX_PLOT',
  'HEATMAP', 'TREEMAP', 'DECOMPOSITION_TREE', 'SANKEY', 'FUNNEL', 'GANTT',
  'CORRELATION_MATRIX', 'PARETO', 'FORECAST_BAND', 'SENSITIVITY_MATRIX',
  'DEPENDENCY_GRAPH', 'DRIVER_TREE', 'RADAR', 'GAUGE', 'COMBO',
];

/** The comparisons a filter can make. */
export type BiFilterOperator =
  | 'EQ' | 'NE' | 'GT' | 'GTE' | 'LT' | 'LTE'
  | 'IN' | 'NOT_IN' | 'BETWEEN'
  | 'CONTAINS' | 'STARTS_WITH'
  | 'IS_NULL' | 'IS_NOT_NULL';

export const BI_FILTER_OPERATORS: readonly BiFilterOperator[] = [
  'EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE',
  'IN', 'NOT_IN', 'BETWEEN',
  'CONTAINS', 'STARTS_WITH',
  'IS_NULL', 'IS_NOT_NULL',
];

/** How many values each operator wants, so a builder cannot offer `BETWEEN` a
 *  single box or `IN` a scalar. The compiler enforces the same pairing and
 *  raises 22023; this is what keeps the screen from getting there. */
export const BI_OPERATOR_ARITY: Readonly<Record<BiFilterOperator, 'none' | 'one' | 'two' | 'many'>> = {
  EQ: 'one', NE: 'one', GT: 'one', GTE: 'one', LT: 'one', LTE: 'one',
  CONTAINS: 'one', STARTS_WITH: 'one',
  BETWEEN: 'two',
  IN: 'many', NOT_IN: 'many',
  IS_NULL: 'none', IS_NOT_NULL: 'none',
};

/** How a query ended. `DENIED` is a recorded outcome, not an absence of one. */
export type BiQueryOutcome = 'OK' | 'DENIED' | 'ERROR';

export const BI_QUERY_OUTCOMES: readonly BiQueryOutcome[] = ['OK', 'DENIED', 'ERROR'];

/** What a cell can hold. A query result is scalars all the way down — the
 *  compiler casts anything else to text before it leaves the database. */
export type BiScalar = string | number | boolean | null;

/* ------------------------------------------------------------------ *
 * Constants the screens reason about before the server does
 * ------------------------------------------------------------------ */

/** Where a status may go from here.
 *
 *  Documents has a transition table because its review workflow is a path.
 *  Analytics does not, and this is the honest transcription of that: every
 *  status can be set from every other, so this is just "the other two". There is
 *  no `from` check anywhere in `private.bi_set_status`.
 *
 *  What the function checks instead is a single privilege and then a set of
 *  preconditions on the *target*, which is why greying a menu item out cannot
 *  stand in for calling it. Governance is one privilege, not three — the same
 *  role that may publish a definition is the one that may deprecate it, because
 *  splitting them would let someone unpublish what they could never have
 *  published. The refusals a screen must be ready to render:
 *
 *  - DATASET → PUBLISHED needs a source, one dimension and one metric.
 *    → DEPRECATED is refused while a published dashboard still shows it, and
 *    when it succeeds it deprecates every one of that dataset's metrics too.
 *  - METRIC → PUBLISHED needs its dataset published first. → DEPRECATED is
 *    refused while a published dashboard measures it, or while a live RATIO
 *    still divides by it.
 *  - REPORT → PUBLISHED needs at least one analysis on it.
 *  - DASHBOARD → PUBLISHED needs at least one tile, and every tile's dataset
 *    published.
 *
 *  Two of these the server answers directly — a dataset detail carries
 *  `canPublish` and a dashboard detail carries `canPublish`. Prefer those to
 *  re-deriving the rule here. */
export const BI_STATUS_TARGETS: Readonly<Record<BiStatus, readonly BiStatus[]>> = {
  DRAFT: ['PUBLISHED', 'DEPRECATED'],
  PUBLISHED: ['DEPRECATED', 'DRAFT'],
  DEPRECATED: ['DRAFT', 'PUBLISHED'],
};

/** The dashboard grid is twelve columns wide and `grid_x + grid_w <= 12` is a
 *  constraint, not a convention. A tile editor that lets a width past the right
 *  edge is writing a row the database will refuse. */
export const BI_GRID_COLUMNS = 12;
export const BI_GRID_MAX_HEIGHT = 24;

/** `p_limit` is clamped to 1..5000 inside the compiler. A screen reporting
 *  truncation has to apply the same clamp to know what it asked for, because the
 *  logged request records the number that was sent, not the number that was
 *  used. */
export const BI_ROW_LIMIT_MIN = 1;
export const BI_ROW_LIMIT_MAX = 5_000;
export const BI_ROW_LIMIT_DEFAULT = 500;

/** `decimals` is 0..6. */
export const BI_DECIMALS_MAX = 6;

/** The tabs. `overview` rather than `dashboard`, because this app also carries a
 *  list of dashboards and the two words next to each other in a nav rail read as
 *  the same place. */
export const BI_VIEWS = [
  'overview', 'catalog', 'analysis', 'dashboards', 'reports', 'queries', 'events',
] as const;
export type BiView = (typeof BI_VIEWS)[number];

/* ------------------------------------------------------------------ *
 * Rows as they arrive
 * ------------------------------------------------------------------ */

/** One row of a `get_bi_*` payload before it has been narrowed. Every reader in
 *  `model.ts` takes this and returns a record below; nothing else in the app
 *  sees an `unknown`. */
export type SourceRow = Readonly<Record<string, unknown>>;

/** A visualization's free-form drawing options. Scalars only, because they are
 *  written by a form and read by a renderer, and neither wants a tree. */
export type BiOptions = Readonly<Record<string, BiScalar>>;

/* ------------------------------------------------------------------ *
 * The one shape that stays wire-shaped
 * ------------------------------------------------------------------ */

/** A filter, spelled exactly as the compiler parses it.
 *
 *  This is the exception to the camelCase rule above, and deliberately so: a
 *  filter is not something the app holds after narrowing, it is something the app
 *  *sends* — as jsonb, key for key, into `p_filters`. Renaming these fields for
 *  the sake of house style would mean translating them back on every write, and
 *  the translation is exactly where a typo becomes a filter that silently does
 *  nothing.
 *
 *  `field` is resolved as a dimension key first and a source column second, and
 *  is never interpolated into SQL — the compiler looks it up and emits its own
 *  identifier. Which of `value` / `value2` / `values` is required is
 *  {@link BI_OPERATOR_ARITY}. */
export interface BiFilter {
  readonly field: string;
  readonly op: BiFilterOperator;
  /** Scalar operators, and `BETWEEN`'s lower bound. */
  readonly value?: BiScalar;
  /** `BETWEEN`'s upper bound, and nothing else. */
  readonly value2?: BiScalar;
  /** `IN` / `NOT_IN` only, and never empty. */
  readonly values?: readonly BiScalar[];
}

/* ------------------------------------------------------------------ *
 * What a query answers with
 * ------------------------------------------------------------------ */

/** One column of a result, and the only description of what a row's keys mean.
 *
 *  `alias` is generated by the compiler — `d0`, `m1` — never by a caller, which
 *  is what keeps a user-typed string out of every identifier position. `key` is
 *  the dimension or metric key a person recognises. A cell is read by `alias`; a
 *  header is written from `label`. */
export interface BiColumn {
  readonly key: string;
  readonly alias: string;
  readonly kind: 'DIMENSION' | 'METRIC';
  readonly label: string;
  readonly labelAr: string | null;
  readonly dataType: BiDataType;
  readonly ordinal: number;
  /** Set on the invented `bi_period` column only. */
  readonly grain: BiTimeGrain | null;
  /** Dimension only: the key one level down, if this dimension drills. */
  readonly drillToKey: string | null;
  /** Dimension only: what a cell of this column opens. */
  readonly drillKind: BiDrillKind | null;
  /** Metric only. */
  readonly aggregate: BiAggregate | null;
  readonly format: BiMetricFormat | null;
  readonly unit: string | null;
  readonly decimals: number | null;
  /** Metric only. False means stacking or subtotalling this column produces a
   *  number that is wrong — an average and a ratio do not add up. */
  readonly isAdditive: boolean | null;
}

/** One row, keyed by {@link BiColumn.alias}. There is no literal key to write
 *  here and no field to autocomplete — a grid walks `columns` and indexes this. */
export type BiRow = Readonly<Record<string, BiScalar>>;

/** A query that ran. */
export interface BiQueryResult {
  readonly columns: readonly BiColumn[];
  readonly rows: readonly BiRow[];
  readonly rowCount: number;
  /** The limit actually applied, after the 1..5000 clamp. */
  readonly rowLimit: number;
  /** True when the answer is a prefix of the answer. A chart drawn from a
   *  truncated result is not wrong about the rows it has and is wrong about
   *  every total, which is why this has to reach the screen. */
  readonly truncated: boolean;
  readonly durationMs: number;
  readonly datasetKey: string;
  readonly timeGrain: BiTimeGrain | null;
  /** The SQL the compiler built. The only honest answer to "why does this chart
   *  say that", and the reason it is returned rather than reconstructed. */
  readonly compiledSql: string;
}

/** A query that did not run, or ran and failed.
 *
 *  Kept as a record rather than a thrown error because a dashboard tile that
 *  cannot render still occupies a rectangle, and what belongs in that rectangle
 *  is this: a stated reason, not an empty chart. */
export interface BiQueryError {
  readonly code: string;
  readonly message: string;
  readonly durationMs: number;
}

/** How to draw, as distinct from what to draw. Returned alongside a result when
 *  the query ran through a saved visualization. */
export interface BiChartFrame {
  readonly visualizationId: string;
  readonly visualizationKey: string;
  readonly chartType: BiChartType;
  readonly title: string;
  readonly titleAr: string | null;
  readonly options: BiOptions;
}

/** A tile's two halves, kept apart on purpose: one is a saved decision about
 *  presentation, the other is numbers as of now. */
export interface BiChartRun {
  readonly chart: BiChartFrame;
  readonly result: BiQueryResult;
}

/** What sat behind one cell.
 *
 *  `dimensionKey` and `value` are echoed back from the request so a stale
 *  response cannot be applied to a chart the user has since re-filtered. */
export interface BiDrillResult {
  readonly kind: BiDrillKind | null;
  readonly dimensionKey: string;
  readonly value: BiScalar;
  readonly entityIds: readonly string[];
  readonly entityCount: number;
  readonly truncated: boolean;
}

/* ------------------------------------------------------------------ *
 * The catalog
 * ------------------------------------------------------------------ */

/**
 * The seven facts every payload sends about a relation the semantic layer may
 * read.
 *
 * Extracted rather than assumed, because the two reads that describe a source
 * describe it differently and neither is a subset of the other. `get_bi_catalog`
 * sends what the registry measured — a default time column and a column count.
 * `get_bi_dataset_detail` sends the two facts that only matter once a dataset is
 * bound to the thing: whether the relation is still there, and whether this
 * caller may read it. Seven keys are common; four are not, split two and two.
 *
 * `BiDatasetSource extends BiSource` is what this file said before the payloads
 * were read against the migration, and it typechecked cleanly. What it produced
 * was a detail pane claiming a `timeColumn` of `null` and a `columnCount` of `0`
 * for a relation with forty columns — because that is what a mapper honestly
 * returns for a key the payload does not contain.
 */
export interface BiSourceBase {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  /** `schema.table`, as registered. Not a string a query is built from. */
  readonly relation: string;
  /** The permission a caller must hold to query anything built on this source.
   *  Without it a semantic layer is a hole through RBAC: the definer function
   *  has rights the caller does not. */
  readonly requiredPermission: string;
  readonly branchScoped: boolean;
}

/** A source as the catalog lists it: the base, plus the two numbers the last sync
 *  wrote down. */
export interface BiSource extends BiSourceBase {
  readonly timeColumn: string | null;
  readonly columnCount: number;
}

/** A source as a bound dataset's detail reports it: the base, plus the two facts
 *  that decide whether a query on it can run at all. */
export interface BiDatasetSource extends BiSourceBase {
  /** False when the last sync could not find the relation. A vanished source is
   *  deactivated and not deleted, so the datasets built on it keep their
   *  definitions and the compiler refuses them with a sentence that says why. */
  readonly isActive: boolean;
  /** The server's own answer, evaluated for this caller. Not derived from a role
   *  name anywhere in this app. */
  readonly readableByMe: boolean;
}

/** A dataset as the catalog lists it. */
export interface BiDataset {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly description: string | null;
  readonly status: BiStatus;
  readonly version: number;
  readonly sourceKey: string | null;
  readonly sourceName: string | null;
  readonly requiredPermission: string | null;
  /** Whether this caller may query it at all. False is a fact worth drawing —
   *  a row that says so beats a row that silently returns nothing. */
  readonly readableByMe: boolean;
  readonly timeColumn: string | null;
  readonly dimensionCount: number;
  readonly metricCount: number;
  /** Metrics carry their own status, so a published dataset can still be mostly
   *  draft. The gap between these two numbers is the interesting one. */
  readonly publishedMetricCount: number;
  readonly lastQueriedAt: string | null;
  readonly queryCount: number;
  readonly publishedAt: string | null;
  readonly updatedAt: string | null;
  /** The row as it arrived, so an editor can prefill by column name without a
   *  second fetch. */
  readonly row: SourceRow;
}

/** Everything a person may see of the semantic layer, in one read. */
export interface BiCatalog {
  readonly sources: readonly BiSource[];
  readonly datasets: readonly BiDataset[];
  readonly generatedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * One dataset, in full
 * ------------------------------------------------------------------ */

/** What a definition was computed from, stamped when it was last analysed. */
export interface BiLineageStamp {
  readonly sourceColumns: readonly string[];
  readonly drillColumns: readonly string[];
  readonly operands: readonly string[];
  readonly measuredAt: string | null;
}

/** A column of the underlying relation, as the source catalog knows it. */
export interface BiSourceColumn {
  readonly columnName: string;
  readonly dataType: BiDataType;
  readonly name: string;
  readonly isDimension: boolean;
  readonly isMeasure: boolean;
}

/** Something a query may group by. */
export interface BiDimension {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly description: string | null;
  /** A SQL expression over the source, validated by a BEFORE trigger. Shown, not
   *  parsed — this app does not have a SQL parser and should not grow one. */
  readonly expression: string;
  readonly dataType: BiDimensionDataType;
  readonly sortOrder: number;
  readonly isDefault: boolean;
  /** The dimension one level down, forming a drill hierarchy. */
  readonly drillToKey: string | null;
  readonly drillKind: BiDrillKind | null;
  readonly drillExpression: string | null;
  readonly lineage: BiLineageStamp | null;
  readonly row: SourceRow;
}

/** A number, and everything governing what it means. */
export interface BiMetric {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly description: string | null;
  /** The expression the aggregate wraps — never an aggregate itself. Empty for a
   *  RATIO, which the trigger blanks because its operands are the two keys
   *  below. */
  readonly formula: string;
  readonly aggregate: BiAggregate;
  /** A metric-level filter, applied before the aggregate. */
  readonly filters: readonly BiFilter[];
  readonly numeratorKey: string | null;
  readonly denominatorKey: string | null;
  readonly format: BiMetricFormat;
  readonly unit: string | null;
  readonly decimals: number;
  /** SUM and COUNT only. A chart that stacks a non-additive metric is showing a
   *  number that is wrong, and this is the flag that lets it refuse. */
  readonly isAdditive: boolean;
  readonly status: BiStatus;
  readonly version: number;
  readonly sortOrder: number;
  readonly publishedAt: string | null;
  readonly lineage: BiLineageStamp | null;
  readonly row: SourceRow;
}

/** The dataset half of a detail read. */
export interface BiDatasetRecord {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly description: string | null;
  readonly status: BiStatus;
  readonly version: number;
  /** Rows every query on this dataset is silently narrowed to. Part of the
   *  definition, not of any one query. */
  readonly rowFilters: readonly BiFilter[];
  readonly timeColumn: string | null;
  readonly publishedAt: string | null;
  readonly deprecatedAt: string | null;
  readonly lastQueriedAt: string | null;
  readonly queryCount: number;
  readonly updatedAt: string | null;
  readonly row: SourceRow;
}

/** A dataset and everything defined on it. */
export interface BiDatasetDetail {
  readonly dataset: BiDatasetRecord;
  /** Null when the dataset has no source yet — which is also the first reason
   *  {@link canPublish} would be false. */
  readonly source: BiDatasetSource | null;
  readonly columns: readonly BiSourceColumn[];
  readonly dimensions: readonly BiDimension[];
  readonly metrics: readonly BiMetric[];
  /** The server's verdict on the publish preconditions, evaluated for this
   *  caller. `bi_datasets.publish` is held by no seeded role, so for most people
   *  this is false because of privilege rather than because of shape — which is
   *  another reason to render the server's answer instead of re-deriving one. */
  readonly canPublish: boolean;
  readonly generatedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Hierarchy and lineage
 * ------------------------------------------------------------------ */

/** One rung of a drill hierarchy. */
export interface BiDrillLevel {
  readonly key: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly dataType: BiDimensionDataType;
  readonly drillKind: BiDrillKind | null;
  readonly hasDrillThrough: boolean;
  readonly depth: number;
}

/** A hierarchy walked from one dimension down. Walked server-side because the
 *  32-level cycle guard has to live where a UI cannot skip it. */
export interface BiDrillPath {
  readonly datasetId: string;
  readonly root: string;
  readonly path: readonly BiDrillLevel[];
  readonly depth: number;
}

/** A source column a definition reads, and how. */
export interface BiLineageColumn {
  readonly columnName: string;
  readonly dataType: BiDataType | null;
  readonly name: string | null;
  /** `source` when the column is registered in the catalog, `expression` when it
   *  was found by reading the definition's own SQL. The second is a weaker
   *  claim and a screen should say so. */
  readonly via: 'source' | 'expression';
}

/** A saved analysis that would change if this definition changed. */
export interface BiLineageAnalysis {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly chartType: BiChartType;
  readonly reportId: string | null;
  readonly reportTitle: string | null;
  readonly reportStatus: BiStatus | null;
  readonly onDashboards: number;
}

/** A dashboard that would change if this definition changed. */
export interface BiLineageDashboard {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly status: BiStatus;
  readonly isDefault: boolean;
}

/** Another definition that reads this one. */
export interface BiLineageDependent {
  readonly kind: BiEntityKind;
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: BiStatus | null;
  readonly relation: 'numerator' | 'denominator' | 'drills_into';
}

/** How much would move. The four numbers a deprecate confirmation needs, and
 *  `publishedDashboards` is the one that decides whether it will be refused. */
export interface BiLineageImpact {
  readonly analyses: number;
  readonly dashboards: number;
  readonly publishedDashboards: number;
  readonly dependentDefinitions: number;
}

/**
 * The source, as a lineage trace reports it.
 *
 * Five fields where {@link BiSource} has nine, and its own interface rather than a
 * `Partial<BiSource>` because the missing four are not missing — `get_bi_lineage`
 * never sends them. A trace answers "what does this definition read and who may
 * read it", so the key, the relation, a name and the permission are the whole
 * question; the source's id, Arabic name, default time column, branch scoping and
 * column count belong to the catalog screen and are read there.
 *
 * Typing this as `BiSource | null` — which is what this file said before the
 * payload was checked against the migration rather than against the legacy type
 * declarations — compiles perfectly and puts five empty strings and a zero into a
 * lineage pane.
 */
export interface BiLineageSource {
  readonly key: string;
  readonly name: string;
  readonly relation: string;
  readonly requiredPermission: string;
  /** The server's own answer for this caller, the same fact `BiDatasetSource`
   *  carries. Never re-derived from a role name in this app. */
  readonly readableByMe: boolean;
}

/** One definition, traced both ways: what it reads, and who reads it. */
export interface BiLineage {
  readonly kind: BiEntityKind;
  readonly id: string;
  readonly key: string;
  readonly label: string;
  /** `'N/A'` for a dimension, whose status is its dataset's. Not a fourth
   *  status — the absence of one. */
  readonly status: BiStatus | 'N/A';
  /** The dataset this definition belongs to, by id only. The trace carries no
   *  dataset key, so a pane that wants to name it reads the catalog. */
  readonly datasetId: string | null;
  readonly source: BiLineageSource | null;
  readonly upstream: readonly BiLineageColumn[];
  readonly analyses: readonly BiLineageAnalysis[];
  readonly dashboards: readonly BiLineageDashboard[];
  readonly dependents: readonly BiLineageDependent[];
  readonly impact: BiLineageImpact;
  /** When the registry last re-measured the source columns. Lifted out of the
   *  stored `lineage` jsonb with `->` rather than `->>`, so it arrives as a JSON
   *  string and not as text — the same value either way, but the reason
   *  {@link BiScalar} narrowing is worth doing on it. */
  readonly measuredAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Analyses, reports, dashboards
 * ------------------------------------------------------------------ */

/** The query a saved analysis stands for.
 *
 *  `dimensions` and `measures` are keys, not ids — one vocabulary, so a
 *  definition cannot be referenced two different ways. A saved analysis is
 *  validated by being compiled: the trigger hands this row to the compiler and
 *  refuses the write if it will not build. */
export interface BiAnalysisDefinition {
  readonly id: string;
  readonly key: string;
  readonly chartType: BiChartType;
  readonly datasetId: string;
  readonly datasetKey: string;
  readonly datasetName: string | null;
  readonly datasetStatus: BiStatus | null;
  readonly dimensions: readonly string[];
  readonly measures: readonly string[];
  readonly filters: readonly BiFilter[];
  readonly timeGrain: BiTimeGrain | null;
  readonly orderBy: string | null;
  readonly orderDesc: boolean;
  readonly rowLimit: number;
}

/** A saved analysis: a query, plus how it presents itself. */
export interface BiAnalysis extends BiAnalysisDefinition {
  readonly title: string;
  readonly titleAr: string | null;
  readonly options: BiOptions;
  readonly sortOrder: number;
  /** False renders a stated refusal in the tile, not an error dialog. */
  readonly readableByMe: boolean;
  readonly row: SourceRow;
}

/** A report: an ordered set of analyses, governed as one thing. */
export interface BiReport {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly titleAr: string | null;
  readonly description: string | null;
  readonly status: BiStatus;
  readonly version: number;
  readonly layout: BiOptions;
  readonly sortOrder: number;
  readonly publishedAt: string | null;
  readonly deprecatedAt: string | null;
  readonly updatedAt: string | null;
  readonly analyses: readonly BiAnalysis[];
  readonly row: SourceRow;
}

/** A dashboard as the list shows it. */
export interface BiDashboard {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly titleAr: string | null;
  readonly description: string | null;
  readonly status: BiStatus;
  readonly version: number;
  readonly isDefault: boolean;
  readonly sortOrder: number;
  readonly publishedAt: string | null;
  readonly deprecatedAt: string | null;
  readonly updatedAt: string | null;
  readonly tileCount: number;
  /** False before opening it. A grid where four tiles render and two say
   *  "denied" reads as a broken page, so the list says so first. */
  readonly fullyReadableByMe: boolean;
  readonly row: SourceRow;
}

/** Where a tile sits. `x + w <= 12`, `h <= 24`, both enforced by constraint. */
export interface BiTileGrid {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One tile of a dashboard.
 *
 *  It carries the analysis definition but not its numbers: each tile fetches its
 *  own, because every tile is separately authorized and separately logged.
 *  `options` is the analysis's own merged with the tile's override. */
export interface BiTile {
  readonly id: string;
  readonly title: string;
  readonly titleAr: string | null;
  readonly grid: BiTileGrid;
  readonly options: BiOptions;
  readonly sortOrder: number;
  readonly analysis: BiAnalysisDefinition;
  readonly readableByMe: boolean;
}

/** The dashboard half of a detail read. */
export interface BiDashboardRecord {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly titleAr: string | null;
  readonly description: string | null;
  readonly status: BiStatus;
  readonly version: number;
  readonly layout: BiOptions;
  readonly isDefault: boolean;
  readonly publishedAt: string | null;
  readonly deprecatedAt: string | null;
  readonly updatedAt: string | null;
  readonly row: SourceRow;
}

/** A dashboard and its tiles. */
export interface BiDashboardDetail {
  readonly dashboard: BiDashboardRecord;
  readonly tiles: readonly BiTile[];
  readonly canEdit: boolean;
  readonly canPublish: boolean;
  readonly generatedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * The overview
 * ------------------------------------------------------------------ */

/**
 * How much of everything there is.
 *
 * Twelve numbers, and they are exactly the twelve `get_bi_studio_overview` builds
 * — no more. Datasets are counted four ways because a dataset's status is what the
 * catalog is mostly about; reports and visualizations are counted once, and there
 * is deliberately no published-report or tile total here even though both would be
 * natural to want. A field with no key behind it does not fail a typecheck: the
 * mapper reads a name the payload lacks, `num()` returns 0, and a health panel
 * states with confidence that there are no tiles.
 */
export interface BiCounts {
  readonly sources: number;
  readonly datasets: number;
  readonly publishedDatasets: number;
  readonly draftDatasets: number;
  readonly deprecatedDatasets: number;
  readonly dimensions: number;
  readonly metrics: number;
  readonly publishedMetrics: number;
  readonly reports: number;
  readonly visualizations: number;
  readonly dashboards: number;
  readonly publishedDashboards: number;
}

/** Six ways the semantic layer can be quietly wrong. Each is a count of things
 *  that exist and should not, or should exist and do not. */
export interface BiHealth {
  readonly datasetsWithoutSource: number;
  readonly datasetsWithoutMetric: number;
  readonly datasetsNeverQueried: number;
  readonly datasetsStale30d: number;
  readonly orphanVisualizations: number;
  /** A published dashboard standing on a deprecated definition. The worst of the
   *  six, because it is the one someone is still reading. */
  readonly publishedOnDeprecated: number;
}

/** Seven days of the query log, or a stated absence of it.
 *
 *  Discriminated rather than zeroed: zero denials and "you may not know" are
 *  different facts, and a dashboard that prints 0 for the second is lying. */
export type BiUsage =
  | { readonly visible: false }
  | {
      readonly visible: true;
      readonly queries7d: number;
      readonly denied7d: number;
      readonly errors7d: number;
      readonly p95DurationMs: number;
      readonly slowestMs: number;
      readonly truncated7d: number;
    };

/** A dataset people actually use. */
export interface BiTopDataset {
  readonly datasetId: string;
  readonly datasetKey: string;
  readonly name: string;
  readonly status: BiStatus;
  readonly queryCount: number;
  readonly lastQueriedAt: string | null;
}

/** What this caller may do, answered by the server.
 *
 *  Seven booleans rather than a role name, because the seed grants publish on
 *  datasets and metrics to no role at all — an ADMIN-only power by implication,
 *  which no client-side role check would ever get right. */
export interface BiPowers {
  readonly canDefine: boolean;
  readonly canPublishDefinitions: boolean;
  readonly canSaveAnalysis: boolean;
  readonly canBuildDashboards: boolean;
  readonly canPublishDashboards: boolean;
  readonly canReadQueryLog: boolean;
  readonly canSyncSources: boolean;
}

/** The landing tab, in one read. */
export interface BiOverview {
  readonly counts: BiCounts;
  readonly health: BiHealth;
  readonly usage: BiUsage;
  readonly topDatasets: readonly BiTopDataset[];
  readonly powers: BiPowers;
  readonly generatedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * The two ledgers
 * ------------------------------------------------------------------ */

/** A request as it was logged — the arguments, not the answer.
 *
 *  `limit` is what the caller sent, which may be outside 1..5000: the clamp
 *  happens after this is written. A screen explaining a truncation has to
 *  re-apply it rather than quote this number. */
export interface BiLoggedRequest {
  readonly datasetId: string | null;
  readonly dimensions: readonly string[];
  readonly metrics: readonly string[];
  readonly filters: readonly BiFilter[];
  readonly timeGrain: BiTimeGrain | null;
  readonly orderBy: string | null;
  readonly orderDesc: boolean | null;
  readonly limit: number | null;
  readonly visualizationId: string | null;
}

/** One line of the query log. Every run lands here, including the denied ones —
 *  which is the point: a semantic layer with no record of its refusals cannot be
 *  audited. */
export interface BiQueryEntry {
  readonly id: string;
  readonly createdAt: string | null;
  readonly datasetId: string | null;
  readonly datasetKey: string | null;
  readonly datasetName: string | null;
  readonly visualizationId: string | null;
  readonly visualizationTitle: string | null;
  readonly actorId: string | null;
  /** Untyped text, same choice as Documents makes: a role recorded last year is
   *  a historical fact, and a union would refuse to read it once the role was
   *  renamed. */
  readonly actorRole: string | null;
  readonly isMine: boolean;
  readonly request: BiLoggedRequest;
  readonly compiledSql: string | null;
  readonly columnCount: number | null;
  readonly rowCount: number | null;
  readonly durationMs: number | null;
  readonly outcome: BiQueryOutcome;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/** One line of the event ledger.
 *
 *  `eventType` is widened past the status vocabulary on purpose:
 *  `bi_events.event_type` has no CHECK constraint, so a reader has to tolerate a
 *  value this app has never heard of rather than refuse the row.
 *
 *  There is no key here: `get_bi_events` returns an id and a kind and nothing that
 *  names the entity, so a ledger line reads `DATASET · 8f2c1a44` and a reader who
 *  wants the name opens the row. Carrying a `entityKey` field would have meant
 *  printing an empty string beside every event in the ledger. */
export interface BiEvent {
  readonly id: string;
  readonly createdAt: string | null;
  readonly entityKind: BiEntityKind | string;
  readonly entityId: string | null;
  readonly eventType: string;
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly from: BiStatus | null;
  readonly to: BiStatus | null;
  readonly note: string | null;
  readonly payload: SourceRow;
}

/** What a source sync did.
 *
 *  Two totals for the whole registry rather than a row per source, because that is
 *  what `private.bi_sync_sources` returns: it walks every source, re-measures the
 *  ones whose relation still exists, deactivates the ones whose relation is gone,
 *  and reports the sum. `sourcesDeactivated` is the number worth surfacing — a
 *  source that lost its table takes every dataset built on it out of service, and
 *  the sync is where that becomes known. */
export interface BiSourceSyncResult {
  readonly columnsRegistered: number;
  readonly sourcesDeactivated: number;
}

