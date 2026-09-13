/**
 * The dialogs' half of a draft: one `*Form` per definition kind, `EMPTY_*` for a
 * create, `*FormOf` to load a row into a form, and `to*Draft` to turn it back.
 *
 * Four declarations per kind, the same shape `../dms/shell.ts` uses for its five
 * upload, metadata, link, relation and package forms, and for the same reason: a
 * form holds what a text input can hold, so almost every field is a string, and
 * the converters are the one place a blank becomes `undefined` and a `<select>`
 * becomes a member of an enum. Nothing here imports React, so a form can be built
 * and converted in a test with no renderer.
 *
 * ## What a form owns, and what it is handed
 *
 * A form holds the fields a dialog shows: the key, the names, the enums, the sort
 * order. It does **not** hold the structured parts of a definition, and `to*Draft`
 * takes those as arguments — a dataset's `rowFilter`, a metric's `filters`, an
 * analysis's whole query, a tile's grid. Each is owned by something else on the
 * screen: the filter editor holds a `readonly BiFilter[]` in its own state, the
 * builder holds the query, the dashboard grid holds the placement. Folding them
 * in would mean serialising a tree of filters into a text field and parsing it
 * back on load. Instead they stay where they live and arrive at the commit, which
 * keeps every `to*Draft` a pure function of (form, the state that owns the rest).
 *
 * Context arrives the same way. A dimension and a metric cannot say which dataset
 * they belong to, because the screen editing them is already inside one; an
 * analysis takes its report the same way, since `get_bi_reports` nests analyses
 * under the report that holds them and the payload repeats no parent id.
 *
 * ## The three fields no form may carry
 *
 * `bi_metrics.grain`, `bi_dashboard_tiles.title_override` and
 * `bi_visualizations.description` are stored columns that no read path returns —
 * `get_bi_dataset_detail` does not select the first, `get_bi_dashboard` collapses
 * the second into the tile's resolved title, and neither the flat analysis inside
 * a report nor the nested `visualization` inside a tile carries the third. A field
 * that cannot be prefilled can only save a blank, and a blank saved over a value
 * nobody could see is silent data loss. So none of the three appears below, their
 * drafts leave the key off the wire, and `kept` in `./actions.ts` turns a missing
 * key into a column a partial update never mentions.
 */

import type {
  BiAnalysisDraft, BiDashboardDraft, BiDatasetDraft, BiDimensionDraft,
  BiMetricDraft, BiQueryRequest, BiReportDraft, BiTileDraft,
} from './actions';
import { clampLimit, initialBuilderState, type BuilderState } from './builder';
import type {
  BiAggregate, BiAnalysis, BiChartType, BiDashboard, BiDatasetRecord,
  BiDimension, BiDimensionDataType, BiDrillKind, BiFilter, BiMetric,
  BiMetricFormat, BiReport, BiTile, BiTileGrid,
} from './types';

/* ------------------------------------------------------------------ *
 *  Fields, both directions                                             *
 * ------------------------------------------------------------------ */

/**
 * A text input as an optional value: trimmed, and blank is absence.
 *
 * The same rule and the same name as `../dms/shell.ts`, so a reader who has met
 * one has met the other. Whitespace alone is blank, because a space typed into a
 * name is a mistake the server should refuse as missing rather than store.
 */
const said = (text: string): string | undefined => {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * A text input as an optional count: whole, and never negative.
 *
 * `undefined` for a blank *and* for text that is not a number, so a row limit
 * typed as `abc` falls back to the column map's own default instead of arriving
 * as `NaN` dressed as a deliberate value. A negative is raised to zero here
 * rather than at the server, because "minus five" is a typo and not a request.
 */
const counted = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed < 0 ? 0 : parsed;
};

/** A count a definition always has, so a blank or unreadable box falls back to a
 *  stated number rather than leaving the field out. */
const countedAs = (text: string, fallback: number): number => counted(text) ?? fallback;

/** A number as a form field. Null prints blank: a dialog shows an empty box for
 *  "no value" and never the word `null`. */
const numberText = (value: number | null): string => (value === null ? '' : String(value));

/** A nullable column as a text input. */
const textOf = (value: string | null): string => value ?? '';

/* ------------------------------------------------------------------ *
 *  Dataset                                                             *
 * ------------------------------------------------------------------ */

export interface DatasetForm {
  readonly key: string;
  readonly name: string;
  readonly nameAr: string;
  readonly description: string;
  readonly sourceId: string;
  readonly timeColumn: string;
}

export const EMPTY_DATASET: DatasetForm = {
  key: '', name: '', nameAr: '', description: '', sourceId: '', timeColumn: '',
};

/**
 * `sourceId` comes from the detail's `source` object rather than from the record.
 *
 * `get_bi_dataset_detail` reports the source as a nested object — id, key, name,
 * permission, whether this reader may see it — and the dataset half it sits
 * beside carries no `source_id`. The caller passes `detail.source?.id ?? ''`,
 * which is also the honest value for a dataset that has not been pointed at one.
 *
 * `timeColumn` is the one field here that may not round-trip: the payload sends
 * `coalesce(d.default_time_column, v_src.default_time_column)`, so a dataset that
 * stores nothing shows the source's column. Saving then writes that inherited
 * value as the dataset's own, which changes nothing about what it queries and is
 * the reading the box already gave.
 */
export function datasetFormOf(record: BiDatasetRecord, sourceId: string): DatasetForm {
  return {
    key: record.key,
    name: record.name,
    nameAr: textOf(record.nameAr),
    description: textOf(record.description),
    sourceId,
    timeColumn: textOf(record.timeColumn),
  };
}

export function toDatasetDraft(form: DatasetForm, rowFilter: readonly BiFilter[]): BiDatasetDraft {
  return {
    key: form.key.trim(),
    name: form.name.trim(),
    nameAr: said(form.nameAr),
    description: said(form.description),
    // Blank is a real answer and not an omission: a dataset may be drafted before
    // anyone decides what it reads, and only publishing requires a source.
    sourceId: said(form.sourceId) ?? null,
    timeColumn: said(form.timeColumn) ?? null,
    rowFilter,
  };
}

/* ------------------------------------------------------------------ *
 *  Dimension                                                           *
 * ------------------------------------------------------------------ */

export interface DimensionForm {
  readonly key: string;
  readonly displayName: string;
  readonly displayNameAr: string;
  readonly description: string;
  readonly expression: string;
  readonly dataType: BiDimensionDataType;
  readonly sortOrder: string;
  readonly isDefault: boolean;
  readonly drillToKey: string;
  /** `''` is "no drill", which is why this is not simply {@link BiDrillKind}: the
   *  select needs an empty option, and the pair below is a CHECK. */
  readonly drillKind: BiDrillKind | '';
  readonly drillExpression: string;
}

export const EMPTY_DIMENSION: DimensionForm = {
  key: '', displayName: '', displayNameAr: '', description: '', expression: '',
  dataType: 'text', sortOrder: '0', isDefault: false,
  drillToKey: '', drillKind: '', drillExpression: '',
};

export function dimensionFormOf(record: BiDimension): DimensionForm {
  return {
    key: record.key,
    displayName: record.name,
    displayNameAr: textOf(record.nameAr),
    description: textOf(record.description),
    expression: record.expression,
    dataType: record.dataType,
    sortOrder: numberText(record.sortOrder),
    isDefault: record.isDefault,
    drillToKey: textOf(record.drillToKey),
    drillKind: record.drillKind ?? '',
    drillExpression: textOf(record.drillExpression),
  };
}

export function toDimensionDraft(form: DimensionForm, datasetId: string): BiDimensionDraft {
  return {
    datasetId,
    key: form.key.trim(),
    displayName: form.displayName.trim(),
    displayNameAr: said(form.displayNameAr),
    description: said(form.description),
    expression: form.expression.trim(),
    dataType: form.dataType,
    sortOrder: counted(form.sortOrder),
    isDefault: form.isDefault,
    drillToKey: said(form.drillToKey) ?? null,
    // Half of the drill pair is sent as it stands; `dimensionValues` drops both
    // unless both are present, because the CHECK reads them together.
    drillKind: form.drillKind === '' ? null : form.drillKind,
    drillExpression: said(form.drillExpression) ?? null,
  };
}

/* ------------------------------------------------------------------ *
 *  Metric                                                              *
 * ------------------------------------------------------------------ */

export interface MetricForm {
  readonly key: string;
  readonly displayName: string;
  readonly displayNameAr: string;
  readonly description: string;
  readonly aggregate: BiAggregate;
  readonly formula: string;
  readonly numeratorKey: string;
  readonly denominatorKey: string;
  readonly format: BiMetricFormat;
  readonly unit: string;
  readonly decimals: string;
  readonly sortOrder: string;
}

export const EMPTY_METRIC: MetricForm = {
  key: '', displayName: '', displayNameAr: '', description: '',
  aggregate: 'SUM', formula: '', numeratorKey: '', denominatorKey: '',
  format: 'NUMBER', unit: '', decimals: '2', sortOrder: '0',
};

export function metricFormOf(record: BiMetric): MetricForm {
  return {
    key: record.key,
    displayName: record.name,
    displayNameAr: textOf(record.nameAr),
    description: textOf(record.description),
    aggregate: record.aggregate,
    formula: record.formula,
    numeratorKey: textOf(record.numeratorKey),
    denominatorKey: textOf(record.denominatorKey),
    format: record.format,
    unit: textOf(record.unit),
    decimals: numberText(record.decimals),
    sortOrder: numberText(record.sortOrder),
  };
}

/** Whether an aggregate composes two sibling metrics instead of folding an
 *  expression. Read by the dialog to decide which half of the form to show, and
 *  by {@link toMetricDraft} to decide which half to send. */
export const isRatio = (aggregate: BiAggregate): boolean => aggregate === 'RATIO';

export function toMetricDraft(
  form: MetricForm, datasetId: string, filters: readonly BiFilter[],
): BiMetricDraft {
  const ratio = isRatio(form.aggregate);
  return {
    datasetId,
    key: form.key.trim(),
    displayName: form.displayName.trim(),
    displayNameAr: said(form.displayNameAr),
    description: said(form.description),
    aggregate: form.aggregate,
    // A ratio owns no expression of its own, and its two operand keys are a CHECK
    // with the aggregate. Sending the unused half of the form would save whatever
    // the reader typed before switching the select.
    formula: ratio ? '' : form.formula.trim(),
    filters,
    numeratorKey: ratio ? (said(form.numeratorKey) ?? null) : null,
    denominatorKey: ratio ? (said(form.denominatorKey) ?? null) : null,
    format: form.format,
    unit: said(form.unit) ?? null,
    decimals: counted(form.decimals),
    sortOrder: counted(form.sortOrder),
    // `grain` is deliberately absent. See the module note.
  };
}

/* ------------------------------------------------------------------ *
 *  Analysis                                                            *
 * ------------------------------------------------------------------ */

/**
 * A saved analysis is two things kept in two places: how it names itself, which is
 * this form, and the query it stands for, which is the builder's state.
 *
 * {@link toAnalysisDraft} folds them back together and takes the query as an
 * argument, so renaming an analysis from a list — where no builder is mounted —
 * sends back the query that was read rather than an empty one.
 */
export interface AnalysisForm {
  readonly key: string;
  readonly title: string;
  readonly titleAr: string;
  readonly sortOrder: string;
}

export const EMPTY_ANALYSIS: AnalysisForm = {
  key: '', title: '', titleAr: '', sortOrder: '0',
};

export function analysisFormOf(record: BiAnalysis): AnalysisForm {
  return {
    key: record.key,
    title: record.title,
    titleAr: textOf(record.titleAr),
    sortOrder: numberText(record.sortOrder),
  };
}

/**
 * The builder state a saved analysis describes, so `LOAD` can put it back on the
 * shelves.
 *
 * One asymmetry is worth naming: an analysis calls its numeric shelf `measures`
 * and the builder calls it `metrics`. Same keys, same meaning — the aggregates
 * this query folds — and the two names meet here and in `analysisValues`.
 *
 * The drill trail is not restored. `initialBuilderState` leaves it empty and this
 * keeps it that way, because a trail records a path somebody walked to reach a
 * number and not a property of the query: reloading an analysis starts at the top
 * of the hierarchy, which is where its saved dimensions actually are.
 */
export function builderStateOf(record: BiAnalysis): BuilderState {
  return {
    ...initialBuilderState(record.datasetId),
    chartType: record.chartType,
    dimensions: record.dimensions,
    metrics: record.measures,
    filters: record.filters,
    timeGrain: record.timeGrain,
    orderBy: record.orderBy,
    orderDesc: record.orderDesc,
    // Clamped on the way in as well as out: `row_limit` is an integer column with
    // a default and no CHECK, so a row written before the studio existed can hold
    // a number the builder's own slider could not produce.
    limit: clampLimit(record.rowLimit),
  };
}

/**
 * Metadata and query, recombined.
 *
 * `chartType` is separate from the request because {@link BiQueryRequest} has no
 * chart in it — `requestSignature` deliberately leaves it out, so that redrawing
 * the same numbers as a bar instead of a line does not mark the result stale. The
 * shell holds both halves of the builder state and passes each to the side that
 * wants it.
 *
 * `reportId` is context for the same reason a dimension's dataset is: an analysis
 * payload carries no parent id outside lineage, and the screen that opened the
 * dialog already knows which report it is looking at. `null` saves an analysis
 * that belongs to no report, which is what the builder's own save does.
 */
export function toAnalysisDraft(
  form: AnalysisForm,
  request: BiQueryRequest,
  chartType: BiChartType,
  reportId: string | null,
): BiAnalysisDraft {
  return {
    key: form.key.trim(),
    title: form.title.trim(),
    titleAr: said(form.titleAr),
    datasetId: request.datasetId,
    reportId,
    chartType,
    dimensions: request.dimensions,
    measures: request.metrics,
    filters: request.filters,
    timeGrain: request.timeGrain,
    orderBy: request.orderBy,
    orderDesc: request.orderDesc,
    rowLimit: request.limit,
    sortOrder: counted(form.sortOrder),
    // `description` is deliberately absent. See the module note.
  };
}

/* ------------------------------------------------------------------ *
 *  Report                                                              *
 * ------------------------------------------------------------------ */

export interface ReportForm {
  readonly key: string;
  readonly title: string;
  readonly titleAr: string;
  readonly description: string;
  readonly sortOrder: string;
}

export const EMPTY_REPORT: ReportForm = {
  key: '', title: '', titleAr: '', description: '', sortOrder: '0',
};

/** A report's description *is* returned by `get_bi_reports`, so unlike an
 *  analysis's it round-trips and the form carries it. */
export function reportFormOf(record: BiReport): ReportForm {
  return {
    key: record.key,
    title: record.title,
    titleAr: textOf(record.titleAr),
    description: textOf(record.description),
    sortOrder: numberText(record.sortOrder),
  };
}

export function toReportDraft(form: ReportForm): BiReportDraft {
  return {
    key: form.key.trim(),
    title: form.title.trim(),
    titleAr: said(form.titleAr),
    description: said(form.description),
    sortOrder: counted(form.sortOrder),
  };
}

/* ------------------------------------------------------------------ *
 *  Dashboard                                                           *
 * ------------------------------------------------------------------ */

export interface DashboardForm {
  readonly key: string;
  readonly title: string;
  readonly titleAr: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly sortOrder: string;
}

export const EMPTY_DASHBOARD: DashboardForm = {
  key: '', title: '', titleAr: '', description: '', isDefault: false, sortOrder: '0',
};

export function dashboardFormOf(record: BiDashboard): DashboardForm {
  return {
    key: record.key,
    title: record.title,
    titleAr: textOf(record.titleAr),
    description: textOf(record.description),
    isDefault: record.isDefault,
    sortOrder: numberText(record.sortOrder),
  };
}

export function toDashboardDraft(form: DashboardForm): BiDashboardDraft {
  return {
    key: form.key.trim(),
    title: form.title.trim(),
    titleAr: said(form.titleAr),
    description: said(form.description),
    isDefault: form.isDefault,
    sortOrder: counted(form.sortOrder),
  };
}

/* ------------------------------------------------------------------ *
 *  Tile                                                                *
 * ------------------------------------------------------------------ */

/** Where a tile sits, as four boxes. Strings for the same reason the counts are:
 *  a number input holds text until something parses it. A tile has no other
 *  editable field — its title is the analysis's, and the column that could
 *  override it is one of the three nothing can read. */
export interface TileForm {
  readonly gridX: string;
  readonly gridY: string;
  readonly gridW: string;
  readonly gridH: string;
  readonly sortOrder: string;
}

/** Six columns by four rows: half the grid's twelve, and tall enough for a chart
 *  with a legend. */
export const EMPTY_TILE: TileForm = {
  gridX: '0', gridY: '0', gridW: '6', gridH: '4', sortOrder: '0',
};

export function tileFormOf(record: BiTile): TileForm {
  return {
    gridX: numberText(record.grid.x),
    gridY: numberText(record.grid.y),
    gridW: numberText(record.grid.w),
    gridH: numberText(record.grid.h),
    sortOrder: numberText(record.sortOrder),
  };
}

/** A blank box falls back to the size a new tile starts at rather than to zero: a
 *  tile with no width draws nothing, and `x + w <= 12` is a constraint that would
 *  refuse the save anyway. `gridValues` clamps the rest. */
const gridOf = (form: TileForm): BiTileGrid => ({
  x: countedAs(form.gridX, 0),
  y: countedAs(form.gridY, 0),
  w: countedAs(form.gridW, 6),
  h: countedAs(form.gridH, 4),
});

export function toTileDraft(form: TileForm, dashboardId: string, analysisId: string): BiTileDraft {
  return {
    dashboardId,
    analysisId,
    grid: gridOf(form),
    sortOrder: counted(form.sortOrder),
    // `titleOverride` is deliberately absent. See the module note.
  };
}
