/**
 * BI Studio contract. Mirrors supabase/migrations/20260901120000_bi_studio_vertical_slice.sql
 * exactly: every union below is a CHECK constraint in that file, every optional
 * field is a column it leaves nullable, and every interface named `*Payload` is the
 * jsonb one `get_bi_*` function returns.
 *
 * Two shapes here are not ordinary row types and deserve reading before use.
 *
 * `BiFilter` is the wire format the compiler parses. Its `field` is resolved against
 * the dataset's dimensions first and its source's columns second, so a filter can
 * name either without the caller knowing which -- and a name that is neither is
 * refused at compile time rather than interpolated.
 *
 * `BiQueryResult` carries `ok`. run_bi_query_command reports failure as data rather
 * than raising, because an exception would roll back the bi_query_log row that
 * records the attempt, and a denied query is exactly the attempt worth keeping. The
 * service layer in src/services/biAnalytics.ts is what turns `ok: false` back into
 * an error, so nothing above it has to remember to check.
 */

/** Every status any BI definition can hold. One vocabulary, four tables. */
export type BiStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';

/** private.bi_set_status's p_kind. */
export type BiGovernedKind = 'DATASET' | 'METRIC' | 'REPORT' | 'DASHBOARD';

/** bi_events.entity_kind. Wider than BiGovernedKind: the ledger records events for
 *  things whose status is not governed, such as a source sync. */
export type BiEntityKind =
  | 'DATASET' | 'DIMENSION' | 'METRIC' | 'REPORT'
  | 'VISUALIZATION' | 'DASHBOARD' | 'SOURCE';

/** bi_source_columns.data_type. bi_dimensions.data_type is the same list minus
 *  'json' -- a json column cannot be grouped by, so it cannot be a dimension. */
export type BiDataType = 'text' | 'number' | 'date' | 'timestamp' | 'boolean' | 'uuid' | 'json';

export type BiDimensionDataType = Exclude<BiDataType, 'json'>;

/**
 * bi_metrics.aggregate.
 *
 * `formula` is the row-level expression; the aggregate says how it folds. RATIO is
 * the one member that ignores `formula` entirely and composes two other metrics --
 * the trigger blanks the formula and refuses a ratio of ratios, because an average
 * of averages weights every group equally and is indistinguishable from the right
 * number once it is on a dashboard.
 */
export type BiAggregate = 'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX' | 'RATIO';

export const BI_AGGREGATES: readonly BiAggregate[] = [
  'SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX', 'RATIO',
];

/** date_trunc units the compiler will emit, and nothing else. */
export type BiTimeGrain = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export const BI_TIME_GRAINS: readonly BiTimeGrain[] = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

/** The reserved dimension key the compiler answers a time grain under. */
export const BI_PERIOD_KEY = 'bi_period';

export type BiMetricFormat = 'NUMBER' | 'INTEGER' | 'CURRENCY' | 'PERCENT' | 'DURATION_HOURS';

export const BI_METRIC_FORMATS: readonly BiMetricFormat[] = [
  'NUMBER', 'INTEGER', 'CURRENCY', 'PERCENT', 'DURATION_HOURS',
];

/** bi_dimensions.drill_through_kind: what one cell drills into. Upper-case, because
 *  it names a screen in this application rather than a table in the database. */
export type BiDrillThroughKind =
  | 'BOOKING' | 'PILGRIM' | 'PACKAGE' | 'INVOICE' | 'PAYMENT' | 'JOURNAL_ENTRY'
  | 'CRM_LEAD' | 'CRM_OPPORTUNITY' | 'CRM_QUOTE' | 'CRM_CUSTOMER' | 'DOCUMENT';

export const BI_DRILL_THROUGH_KINDS: readonly BiDrillThroughKind[] = [
  'BOOKING', 'PILGRIM', 'PACKAGE', 'INVOICE', 'PAYMENT', 'JOURNAL_ENTRY',
  'CRM_LEAD', 'CRM_OPPORTUNITY', 'CRM_QUOTE', 'CRM_CUSTOMER', 'DOCUMENT',
];

/**
 * bi_visualizations.chart_type, all thirty-three, in the order the constraint lists
 * them. The registry side of "twenty interactive chart types, not decorative": a
 * chart the renderer does not implement cannot be saved, because this union and the
 * CHECK constraint are the same list.
 */
export type BiChartType =
  | 'TABLE' | 'PIVOT' | 'KPI'
  | 'LINE' | 'AREA' | 'BAR' | 'COLUMN' | 'STACKED_BAR' | 'STACKED_COLUMN'
  | 'PIE' | 'DONUT' | 'SCATTER' | 'BUBBLE'
  | 'WATERFALL' | 'BRIDGE' | 'BULLET' | 'HISTOGRAM' | 'BOX_PLOT'
  | 'HEATMAP' | 'TREEMAP' | 'DECOMPOSITION_TREE' | 'SANKEY' | 'FUNNEL'
  | 'GANTT' | 'CORRELATION_MATRIX' | 'PARETO' | 'FORECAST_BAND'
  | 'SENSITIVITY_MATRIX' | 'DEPENDENCY_GRAPH' | 'DRIVER_TREE'
  | 'RADAR' | 'GAUGE' | 'COMBO';

export const BI_CHART_TYPES: readonly BiChartType[] = [
  'TABLE', 'PIVOT', 'KPI',
  'LINE', 'AREA', 'BAR', 'COLUMN', 'STACKED_BAR', 'STACKED_COLUMN',
  'PIE', 'DONUT', 'SCATTER', 'BUBBLE',
  'WATERFALL', 'BRIDGE', 'BULLET', 'HISTOGRAM', 'BOX_PLOT',
  'HEATMAP', 'TREEMAP', 'DECOMPOSITION_TREE', 'SANKEY', 'FUNNEL',
  'GANTT', 'CORRELATION_MATRIX', 'PARETO', 'FORECAST_BAND',
  'SENSITIVITY_MATRIX', 'DEPENDENCY_GRAPH', 'DRIVER_TREE',
  'RADAR', 'GAUGE', 'COMBO',
];

/**
 * The thirteen operators private.bi_compile_filters emits, and no others. A
 * fourteenth sent from a screen is refused with 22023 rather than ignored.
 */
export type BiFilterOperator =
  | 'EQ' | 'NE' | 'GT' | 'GTE' | 'LT' | 'LTE'
  | 'IN' | 'NOT_IN' | 'BETWEEN'
  | 'CONTAINS' | 'STARTS_WITH'
  | 'IS_NULL' | 'IS_NOT_NULL';

export const BI_FILTER_OPERATORS: readonly BiFilterOperator[] = [
  'EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE',
  'IN', 'NOT_IN', 'BETWEEN', 'CONTAINS', 'STARTS_WITH', 'IS_NULL', 'IS_NOT_NULL',
];

/** Which operators take which payload, so a builder cannot offer BETWEEN a single
 *  box or IN a scalar. The compiler enforces the same pairing and raises 22023. */
export const BI_OPERATOR_ARITY: Readonly<Record<BiFilterOperator, 'none' | 'one' | 'two' | 'many'>> = {
  EQ: 'one', NE: 'one', GT: 'one', GTE: 'one', LT: 'one', LTE: 'one',
  CONTAINS: 'one', STARTS_WITH: 'one',
  BETWEEN: 'two',
  IN: 'many', NOT_IN: 'many',
  IS_NULL: 'none', IS_NOT_NULL: 'none',
};

/** A scalar as it survives a round trip through jsonb. */
export type BiScalar = string | number | boolean | null;

/**
 * One filter, in the shape private.bi_compile_filters parses.
 *
 * `field` names a dimension of the dataset or a column of its source; the compiler
 * tries dimensions first. It is never interpolated as an identifier -- a dimension
 * resolves to its stored expression and a column to a quoted `%I.%I` -- so a field
 * that is neither is refused rather than compiled.
 */
export interface BiFilter {
  field: string;
  op: BiFilterOperator;
  /** EQ/NE/GT/GTE/LT/LTE/CONTAINS/STARTS_WITH, and the lower bound of BETWEEN. */
  value?: BiScalar;
  /** BETWEEN only: the upper bound. */
  value2?: BiScalar;
  /** IN/NOT_IN only, and it must be non-empty. */
  values?: readonly BiScalar[];
}

/**
 * A column of a compiled result. `alias` is the key to read out of a row -- `d0`,
 * `m1` -- and it is generated by the compiler, never by a caller, which is what
 * keeps a user-typed string out of every identifier position in the statement.
 */
export interface BiResultColumn {
  key: string;
  alias: string;
  kind: 'DIMENSION' | 'METRIC';
  label: string;
  label_ar: string | null;
  data_type: BiDataType;
  ordinal: number;
  /** DIMENSION, time grain only. */
  grain?: BiTimeGrain;
  /** DIMENSION: the next level down, and what one cell opens. */
  drill_to_key?: string | null;
  drill_through_kind?: BiDrillThroughKind | null;
  /** METRIC: how to fold it and how to print it. */
  aggregate?: BiAggregate;
  format?: BiMetricFormat;
  unit?: string | null;
  decimals?: number;
  is_additive?: boolean;
}

/** One result row, keyed by column alias. */
export type BiResultRow = Readonly<Record<string, BiScalar>>;

/** What a caller asks for. Mirrors run_bi_query_command's arguments one for one. */
export interface BiQueryRequest {
  datasetId: string;
  dimensions?: readonly string[];
  metrics?: readonly string[];
  filters?: readonly BiFilter[];
  timeGrain?: BiTimeGrain | null;
  /** A dimension or metric key. Resolved to an ordinal by the compiler. */
  orderBy?: string | null;
  orderDesc?: boolean;
  /** Clamped server-side to 1..5000; 500 when omitted. */
  limit?: number;
  /** Set when the query came from a saved analysis, so the ledger row says so. */
  visualizationId?: string | null;
}

/**
 * What run_bi_query_command returns.
 *
 * `ok` is part of the payload rather than an exception because the ledger row and
 * the raise cannot both survive one transaction. src/services/biAnalytics.ts is the
 * only place that reads `ok: false`; above it, a failed query is an ordinary error.
 */
export interface BiQuerySuccess {
  ok: true;
  columns: BiResultColumn[];
  rows: BiResultRow[];
  row_count: number;
  row_limit: number;
  /** row_count reached row_limit, so there may be more. Say so on the screen. */
  truncated: boolean;
  duration_ms: number;
  dataset_key: string;
  time_grain: BiTimeGrain | null;
  /** The statement that ran. Shown in the studio, and the only honest answer to
   *  "why does this chart say that". */
  compiled_sql: string;
}

export interface BiQueryFailure {
  ok: false;
  error_code: string;
  error_message: string;
  columns: BiResultColumn[];
  rows: never[];
  row_count: 0;
  duration_ms: number;
}

export type BiQueryResult = BiQuerySuccess | BiQueryFailure;

/** Drill-through returns identifiers, not records: the screen that opens a booking
 *  already exists and is already authorized, and returning whole rows here would be
 *  a second read path around the one that guards them. */
export interface BiDrillThroughSuccess {
  ok: true;
  kind: BiDrillThroughKind | null;
  dimension_key: string;
  /** The cell that was clicked, echoed back so a stale response cannot be applied
   *  to a chart the user has since re-filtered. */
  value: BiScalar;
  entity_ids: string[];
  entity_count: number;
  truncated: boolean;
}

export interface BiDrillThroughFailure {
  ok: false;
  error_code: string;
  error_message: string;
  entity_ids: never[];
  entity_count: 0;
}

export type BiDrillThroughResult = BiDrillThroughSuccess | BiDrillThroughFailure;

/** Chart metadata merged onto a query result by run_bi_visualization_command, so a
 *  tile gets its numbers and how to draw them in one round trip. */
export interface BiVisualizationChrome {
  chart_type: BiChartType;
  title: string;
  title_ar: string | null;
  options: Readonly<Record<string, BiScalar>>;
  visualization_id: string;
  visualization_key: string;
}

export type BiVisualizationResult = BiQueryResult & BiVisualizationChrome;

/* -------------------------------------------------------------------------- */
/* The catalog: what get_bi_catalog returns.                                   */
/* -------------------------------------------------------------------------- */

/** A physical relation the compiler is allowed to read. The list is measured from
 *  information_schema by sync_bi_sources_command, never hand-maintained, and it has
 *  no client write path at all -- not even for ADMIN through PostgREST. */
export interface BiSourceSummary {
  id: string;
  key: string;
  display_name: string;
  display_name_ar: string | null;
  relation: string;
  /** has_permission(this, 'read') is checked before any query on this source runs,
   *  in addition to bi_datasets.read. Without it a semantic layer is a hole through
   *  RBAC: the definer function has rights the caller does not. */
  required_permission: string;
  default_time_column: string | null;
  is_branch_scoped: boolean;
  column_count: number;
}

export interface BiDatasetSummary {
  id: string;
  key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  status: BiStatus;
  version: number;
  source_key: string | null;
  source_display_name: string | null;
  required_permission: string | null;
  readable_by_me: boolean;
  default_time_column: string | null;
  dimension_count: number;
  metric_count: number;
  published_metric_count: number;
  last_queried_at: string | null;
  query_count: number;
  published_at: string | null;
  updated_at: string;
}

export interface BiCatalog {
  sources: BiSourceSummary[];
  datasets: BiDatasetSummary[];
  generated_at: string;
}

/* -------------------------------------------------------------------------- */
/* One dataset: what get_bi_dataset_detail returns, and what the builder edits. */
/* -------------------------------------------------------------------------- */

/** Which columns an expression reads, measured by the same token scan that
 *  validated it -- so lineage and safety can never disagree about what runs. */
export interface BiLineageStamp {
  source_columns?: string[];
  drill_through_columns?: string[];
  operands?: (string | null)[];
  measured_at?: string;
}

export interface BiSourceColumn {
  column_name: string;
  data_type: BiDataType;
  display_name: string;
  is_dimension: boolean;
  is_measure: boolean;
}

export interface BiDimension {
  id: string;
  key: string;
  display_name: string;
  display_name_ar: string | null;
  description: string | null;
  /** A row-level SQL expression over the source's columns, already validated by
   *  private.bi_assert_safe_expression at write time. */
  expression: string;
  data_type: BiDimensionDataType;
  sort_order: number;
  is_default: boolean;
  /** The next level down in the hierarchy. May name a dimension that does not exist
   *  yet -- a hierarchy is authored top-down -- but never a cycle back to itself. */
  drill_to_key: string | null;
  drill_through_kind: BiDrillThroughKind | null;
  drill_through_expression: string | null;
  lineage: BiLineageStamp;
}

export interface BiMetric {
  id: string;
  key: string;
  display_name: string;
  display_name_ar: string | null;
  description: string | null;
  /** The inner, row-level expression -- never an aggregate. `aggregate` says how it
   *  folds. Empty string for a RATIO, which the trigger blanks. */
  formula: string;
  aggregate: BiAggregate;
  /** A metric-local filter, folded into the aggregate as a FILTER clause, which is
   *  how one dataset can carry "revenue" and "confirmed revenue" as two metrics
   *  rather than two datasets. */
  filter_json: BiFilter[];
  numerator_metric_key: string | null;
  denominator_metric_key: string | null;
  format: BiMetricFormat;
  unit: string | null;
  decimals: number;
  /** SUM and COUNT only. A non-additive metric must not be totalled across a
   *  subtotal row, and a chart that stacks one is showing a number that is wrong. */
  is_additive: boolean;
  status: BiStatus;
  version: number;
  sort_order: number;
  published_at: string | null;
  lineage: BiLineageStamp;
}

export interface BiDatasetDetail {
  dataset: {
    id: string;
    key: string;
    name: string;
    name_ar: string | null;
    description: string | null;
    status: BiStatus;
    version: number;
    row_filter_json: BiFilter[];
    default_time_column: string | null;
    published_at: string | null;
    deprecated_at: string | null;
    last_queried_at: string | null;
    query_count: number;
    created_at: string;
    updated_at: string;
  };
  source: (BiSourceSummary & { is_active: boolean; readable_by_me: boolean }) | null;
  source_columns: BiSourceColumn[];
  dimensions: BiDimension[];
  metrics: BiMetric[];
  can_publish: boolean;
  generated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Hierarchy and lineage: what get_bi_drill_path and get_bi_lineage return.     */
/* -------------------------------------------------------------------------- */

export interface BiDrillPathNode {
  key: string;
  display_name: string;
  display_name_ar: string | null;
  data_type: BiDimensionDataType;
  drill_through_kind: BiDrillThroughKind | null;
  /** Whether this level has a drill_through_expression, i.e. whether a cell here
   *  opens records rather than only the next level. */
  has_drill_through: boolean;
  depth: number;
}

/** The walk is done in the database, not here: a hierarchy is a property of the
 *  dataset, and the 32-level cycle guard has to live where a UI cannot skip it. */
export interface BiDrillPath {
  dataset_id: string;
  root: string;
  path: BiDrillPathNode[];
  depth: number;
}

/** One physical column a definition reads. `via` is 'source' for a whole dataset
 *  and 'expression' for a single dimension or metric. */
export interface BiLineageColumn {
  relation: string;
  column_name: string;
  data_type: BiDataType;
  display_name: string;
  via: 'source' | 'expression';
}

export interface BiLineageAnalysis {
  id: string;
  key: string;
  title: string;
  chart_type: BiChartType;
  report_id: string | null;
  report_title: string | null;
  report_status: BiStatus | null;
  on_dashboards: number;
}

export interface BiLineageDashboard {
  id: string;
  key: string;
  title: string;
  status: BiStatus;
  is_default: boolean;
}

/** An edge inside the semantic layer itself: a RATIO built on this metric, or a
 *  dimension that drills into this dimension. Neither is discoverable by reading
 *  the row being edited, which is why the function returns them. */
export interface BiLineageDependent {
  kind: 'METRIC' | 'DIMENSION';
  id: string;
  key: string;
  display_name: string;
  status?: BiStatus;
  relation: 'numerator' | 'denominator' | 'drills_into';
}

/** What a change would touch, in four numbers, so an editor can warn before the
 *  save rather than explain after it. */
export interface BiLineageImpact {
  analyses: number;
  dashboards: number;
  published_dashboards: number;
  dependent_definitions: number;
}

export interface BiLineage {
  kind: 'DATASET' | 'DIMENSION' | 'METRIC';
  id: string;
  key: string;
  label: string;
  /** 'N/A' for a dimension, whose status is the dataset's. */
  status: BiStatus | 'N/A';
  dataset_id: string;
  source: {
    key: string;
    relation: string;
    display_name: string;
    required_permission: string;
    readable_by_me: boolean;
  } | null;
  upstream_columns: BiLineageColumn[];
  downstream_analyses: BiLineageAnalysis[];
  downstream_dashboards: BiLineageDashboard[];
  dependent_definitions: BiLineageDependent[];
  measured_at: string | null;
  impact: BiLineageImpact;
  generated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Saved analyses, reports and dashboards.                                     */
/* -------------------------------------------------------------------------- */

/**
 * A saved analysis, as the drag-and-drop builder produces it: the query it stands
 * for, by key, plus how to draw it.
 *
 * `dimensions` and `measures` are arrays of dimension and metric keys, not ids.
 * Keys are what bi_set_status checks when deciding whether deprecating a metric
 * would blank a dashboard, and what get_bi_lineage matches on -- one vocabulary,
 * so a definition cannot be referenced two different ways.
 */
export interface BiVisualizationDefinition {
  id: string;
  key: string;
  chart_type: BiChartType;
  dataset_id: string;
  dataset_key: string;
  dataset_name: string;
  dataset_status: BiStatus;
  dimensions: string[];
  measures: string[];
  filters: BiFilter[];
  time_grain: BiTimeGrain | null;
  order_by: string | null;
  order_desc: boolean;
  row_limit: number;
}

export interface BiSavedVisualization extends BiVisualizationDefinition {
  title: string;
  title_ar: string | null;
  options: Readonly<Record<string, BiScalar>>;
  sort_order: number;
  /** Whether the caller may read the source behind this analysis. False renders a
   *  stated refusal in the tile, not an error dialog. */
  readable_by_me: boolean;
}

/** A report is a document -- an ordered set of analyses with a title. A dashboard is
 *  a grid. They are separate tables because they are edited by different people for
 *  different reasons, and one shape would fit neither well. */
export interface BiReport {
  id: string;
  key: string;
  title: string;
  title_ar: string | null;
  description: string | null;
  status: BiStatus;
  version: number;
  layout: Readonly<Record<string, BiScalar>>;
  sort_order: number;
  published_at: string | null;
  deprecated_at: string | null;
  updated_at: string;
  visualizations: BiSavedVisualization[];
}

export interface BiDashboardSummary {
  id: string;
  key: string;
  title: string;
  title_ar: string | null;
  description: string | null;
  status: BiStatus;
  version: number;
  is_default: boolean;
  sort_order: number;
  published_at: string | null;
  deprecated_at: string | null;
  updated_at: string;
  tile_count: number;
  /** Every dataset behind every tile is readable by the caller. A grid where four
   *  tiles render and two say "denied" reads as a broken page, so the list says so
   *  before the dashboard is opened. */
  fully_readable_by_me: boolean;
}

export interface BiTileGrid {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BiDashboardTile {
  id: string;
  /** The tile's override, or the analysis's own title. Resolved server-side so the
   *  grid does not have to know which one it got. */
  title: string;
  title_ar: string | null;
  grid: BiTileGrid;
  /** The analysis's options with the tile's on top: one chart, drawn two ways on two
   *  dashboards, without copying the definition. */
  options: Readonly<Record<string, BiScalar>>;
  sort_order: number;
  visualization: BiVisualizationDefinition;
  readable_by_me: boolean;
}

/** The grid, and no tile data: each tile fetches its own numbers through
 *  run_bi_visualization_command, because every tile is separately authorized and
 *  separately logged, and a dashboard whose tiles arrive one at a time is usable
 *  while it loads instead of blank until its slowest query finishes. */
export interface BiDashboardDetail {
  dashboard: {
    id: string;
    key: string;
    title: string;
    title_ar: string | null;
    description: string | null;
    status: BiStatus;
    version: number;
    layout: Readonly<Record<string, BiScalar>>;
    is_default: boolean;
    sort_order: number;
    published_at: string | null;
    deprecated_at: string | null;
    created_at: string;
    updated_at: string;
  };
  tiles: BiDashboardTile[];
  tile_count: number;
  can_edit: boolean;
  can_publish: boolean;
  generated_at: string;
}

/* -------------------------------------------------------------------------- */
/* The studio landing screen: what get_bi_studio_overview returns.             */
/* -------------------------------------------------------------------------- */

export interface BiStudioCounts {
  sources: number;
  datasets: number;
  datasets_published: number;
  datasets_draft: number;
  datasets_deprecated: number;
  dimensions: number;
  metrics: number;
  metrics_published: number;
  reports: number;
  visualizations: number;
  dashboards: number;
  dashboards_published: number;
}

/** Not vanity numbers. A dataset nobody queries is a dataset nobody maintains, and
 *  it will be wrong before anyone notices; `published_on_deprecated` is the one bad
 *  state bi_set_status cannot prevent, since a dashboard can be published after the
 *  definition under it was deprecated. */
export interface BiStudioHealth {
  datasets_without_source: number;
  datasets_without_metric: number;
  datasets_never_queried: number;
  datasets_stale_30d: number;
  orphan_visualizations: number;
  published_on_deprecated: number;
}

/**
 * The ledger half of the overview, gated on bi_query_log.read separately from the
 * rest: a role that may read a dashboard is not thereby entitled to see who else
 * was refused one. `visible: false` is the whole payload when it is not granted --
 * an absent section, not a zeroed one, because zero denials and "you may not know"
 * are different facts.
 */
export type BiStudioUsage =
  | { visible: false }
  | {
      visible: true;
      queries_7d: number;
      denied_7d: number;
      errors_7d: number;
      p95_duration_ms: number;
      slowest_ms: number;
      truncated_7d: number;
    };

export interface BiMostQueriedDataset {
  dataset_id: string;
  dataset_key: string;
  name: string;
  status: BiStatus;
  query_count: number;
  last_queried_at: string | null;
}

/** What this caller may do, answered once by the server rather than guessed from a
 *  role name on the client. `can_sync_sources` is ADMIN-only: re-measuring the
 *  allowlist against information_schema is a schema-wide act. */
export interface BiStudioCapabilities {
  can_define: boolean;
  can_publish_definitions: boolean;
  /** `bi_visualizations create`. Distinct from `can_build_dashboards` even though the
   *  seed grants both to the same three roles: one saves an analysis, the other arranges
   *  saved analyses on a grid. */
  can_save_analysis: boolean;
  can_build_dashboards: boolean;
  can_publish_dashboards: boolean;
  can_read_query_log: boolean;
  can_sync_sources: boolean;
}

export interface BiStudioOverview {
  counts: BiStudioCounts;
  health: BiStudioHealth;
  usage_7d: BiStudioUsage;
  most_queried: BiMostQueriedDataset[];
  capabilities: BiStudioCapabilities;
  generated_at: string;
}

/* -------------------------------------------------------------------------- */
/* The two ledgers.                                                            */
/* -------------------------------------------------------------------------- */

export type BiQueryOutcome = 'OK' | 'DENIED' | 'ERROR';

export const BI_QUERY_OUTCOMES: readonly BiQueryOutcome[] = ['OK', 'DENIED', 'ERROR'];

/** The request as the ledger stored it: what was asked for, before the compiler
 *  clamped anything. `limit` is the caller's number and may be null -- the clamp to
 *  1..5000 happened after this was written, which is why a screen reporting
 *  truncation has to re-apply it rather than read a row_limit that was never here. */
export interface BiLoggedRequest {
  dataset_id: string;
  dimensions: string[];
  metrics: string[];
  filters: BiFilter[];
  time_grain: BiTimeGrain | null;
  order_by: string | null;
  order_desc: boolean;
  limit: number | null;
  visualization_id: string | null;
}

/**
 * One row of the query ledger.
 *
 * `compiled_sql` is returned, and that is the point of keeping it: "why did this
 * chart show that number" is answerable only by the text that ran. An actor is its
 * uuid and current role -- staff_profiles carries no name column in this schema.
 */
export interface BiQueryLogRow {
  id: string;
  created_at: string;
  dataset_id: string | null;
  dataset_key: string | null;
  dataset_name: string | null;
  visualization_id: string | null;
  visualization_title: string | null;
  actor_id: string | null;
  /** staff_profiles.role, as text: the role vocabulary lives in staff_permissions
   *  rows rather than in a check constraint, so narrowing it here would be a claim
   *  the database does not make. Same choice as src/types/dms.ts. */
  actor_role: string | null;
  is_mine: boolean;
  request: BiLoggedRequest;
  compiled_sql: string;
  column_count: number;
  row_count: number;
  duration_ms: number;
  outcome: BiQueryOutcome;
  error_code: string | null;
  error_message: string | null;
}

/** The event types written today. bi_events.event_type has no check constraint, so a
 *  reader must tolerate a value this union does not name -- an unknown event should
 *  render as itself, not disappear from a history. */
export type BiStatusEventType = `STATUS_${BiStatus}`;

/** One row of the definition ledger: every status transition, with who and when.
 *  This is where the published_at that a deprecation cleared still lives. */
export interface BiEventRow {
  id: string;
  created_at: string;
  entity_kind: BiEntityKind;
  entity_id: string;
  event_type: BiStatusEventType | string;
  actor_id: string | null;
  actor_role: string | null;
  payload: Readonly<Record<string, BiScalar>> & {
    from?: BiStatus;
    to?: BiStatus;
    note?: string | null;
  };
}

/* -------------------------------------------------------------------------- */
/* Command arguments.                                                          */
/* -------------------------------------------------------------------------- */

/**
 * set_bi_status_command's arguments. One command governs all four kinds, because
 * the transition rules are the same rules: a DRAFT may publish, a PUBLISHED may
 * deprecate, and a deprecation that would blank a published dashboard is refused
 * with 22023 rather than performed and reported.
 */
export interface BiSetStatusArgs {
  kind: BiGovernedKind;
  id: string;
  status: BiStatus;
  /** Written into the ledger row. The reason a number changed is worth more later
   *  than the fact that it did. */
  note?: string | null;
}

/**
 * Definition writes.
 *
 * These are row shapes, not RPC arguments: the definition CRUD in
 * src/services/domainCommands.ts writes through PostgREST, and the BEFORE triggers
 * are what validate every expression -- which is exactly why they are triggers and
 * not command bodies. So the field names below are column names, and the one place
 * they disagree with the read models is deliberate: a dataset's Arabic name is the
 * column `display_name_ar`, which get_bi_* returns as `name_ar`.
 *
 * `agency_id` and `branch_id` are never sent. The column defaults resolve the
 * caller's tenancy server-side; accepting them from a client would make tenancy a
 * request parameter.
 */
export interface BiDatasetInput {
  key: string;
  name: string;
  display_name_ar?: string | null;
  description?: string | null;
  /** Required before the dataset can be published: bi_datasets_published_needs_source. */
  source_id?: string | null;
  /** Applied to every query on this dataset, ANDed with the caller's own filters. */
  row_filter_json?: readonly BiFilter[];
  /** Overrides the source's default_time_column for time-grain queries. */
  default_time_column?: string | null;
}

export interface BiDimensionInput {
  dataset_id: string;
  key: string;
  display_name: string;
  display_name_ar?: string | null;
  description?: string | null;
  /** Row-level SQL over the source's columns. Rejected at the write by
   *  private.bi_assert_safe_expression if it names anything not in the allowlist. */
  expression: string;
  data_type?: BiDimensionDataType;
  sort_order?: number;
  is_default?: boolean;
  drill_to_key?: string | null;
  /** Both drill-through fields or neither: bi_dimensions_drill_pair. */
  drill_through_kind?: BiDrillThroughKind | null;
  drill_through_expression?: string | null;
}

export interface BiMetricInput {
  dataset_id: string;
  key: string;
  display_name: string;
  display_name_ar?: string | null;
  description?: string | null;
  /** The row-level expression the aggregate folds. Send '' for a RATIO -- the
   *  trigger blanks it anyway, and bi_metrics_ratio_shape refuses one that carries
   *  both a formula and two operands. */
  formula: string;
  aggregate?: BiAggregate;
  filter_json?: readonly BiFilter[];
  /** RATIO only, and both required. Any other aggregate must send neither. */
  numerator_metric_key?: string | null;
  denominator_metric_key?: string | null;
  format?: BiMetricFormat;
  unit?: string | null;
  /** 0..6. */
  decimals?: number;
  is_additive?: boolean;
  sort_order?: number;
}

export interface BiReportInput {
  key: string;
  title: string;
  title_ar?: string | null;
  description?: string | null;
  layout?: Readonly<Record<string, BiScalar>>;
  sort_order?: number;
}

/**
 * A saved analysis. Validated by being compiled: the trigger hands this row to the
 * compiler and refuses the write if it will not build, rather than re-checking each
 * field -- a second implementation of the compiler's rules would drift from it.
 *
 * So a dimension key that does not exist, a metric from another dataset, or a
 * BETWEEN with one bound is refused here, at save time, and not on the dashboard.
 */
export interface BiVisualizationInput {
  key: string;
  title: string;
  title_ar?: string | null;
  description?: string | null;
  /** Null for an analysis that lives on a dashboard but in no report. */
  report_id?: string | null;
  dataset_id: string;
  chart_type: BiChartType;
  dimensions?: readonly string[];
  measures?: readonly string[];
  filters?: readonly BiFilter[];
  time_grain?: BiTimeGrain | null;
  order_by?: string | null;
  order_desc?: boolean;
  /** 1..5000. */
  row_limit?: number;
  options?: Readonly<Record<string, BiScalar>>;
  sort_order?: number;
}

export interface BiDashboardInput {
  key: string;
  title: string;
  title_ar?: string | null;
  description?: string | null;
  layout?: Readonly<Record<string, BiScalar>>;
  is_default?: boolean;
  sort_order?: number;
}

/** One tile. The grid is twelve columns wide and `grid_x + grid_w <= 12` is a
 *  constraint, so a drag that would push a tile off the right edge is refused by the
 *  database rather than clamped by whichever screen happened to send it. */
export interface BiDashboardTileInput {
  dashboard_id: string;
  visualization_id: string;
  title_override?: string | null;
  /** 0..11. */
  grid_x?: number;
  grid_y?: number;
  /** 1..12, and grid_x + grid_w must not exceed 12. */
  grid_w?: number;
  /** 1..24. */
  grid_h?: number;
  options?: Readonly<Record<string, BiScalar>>;
  sort_order?: number;
}

/** Moving tiles is the one dashboard edit that is a batch: a drag re-lays out several
 *  tiles at once, and applying it one row at a time would leave the grid overlapping
 *  between requests. */
export interface BiTileLayoutChange {
  id: string;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  sort_order?: number;
}

/**
 * A drill-through: one cell of one chart, opened.
 *
 * `value` is the cell's value, echoed back in the response so a reply that arrives
 * after the user re-filtered the chart can be discarded rather than applied to a
 * different cell. `filters` is the rest of the chart's filter state, because a cell
 * means "this dimension value, under everything else that was already in force".
 */
export interface BiDrillThroughRequest {
  datasetId: string;
  dimensionKey: string;
  value: BiScalar;
  filters?: readonly BiFilter[];
  /** Clamped server-side; 200 when omitted. */
  limit?: number;
}

/** What sync_bi_sources_command reports: the allowlist, re-measured against
 *  information_schema. ADMIN only, and the only write path to bi_sources there is --
 *  a relation that has disappeared is deactivated rather than deleted, so the
 *  datasets bound to it keep their definitions and get a sentence instead of a
 *  missing-table error. */
export interface BiSourceSyncResult {
  ok: true;
  columns_registered: number;
  sources_deactivated: number;
}

/** What set_bi_status_command returns. `from` is the status that was in force, which
 *  is worth having: a publish that raced another publish reports `from: 'PUBLISHED'`
 *  rather than looking like the one that took effect. */
export interface BiSetStatusResult {
  ok: true;
  kind: BiGovernedKind;
  id: string;
  from: BiStatus;
  to: BiStatus;
}

