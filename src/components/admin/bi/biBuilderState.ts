/**
 * The analysis builder's state, and every rule about it that is not a rendering
 * decision.
 *
 * Three things live here rather than in the panel, and each is here for the same
 * reason: the compiler in 20260901120000_bi_studio_vertical_slice.sql will refuse a
 * malformed request with 22023, and a builder that lets the user assemble one and
 * then shows them a database error is a builder that made them guess.
 *
 * 1. `readiness` states, before the run, exactly what the compiler would refuse: an
 *    empty request, a BETWEEN with one bound, an order-by that is not one of the
 *    selected columns, a deprecated metric. Each of those is a raise in that file.
 * 2. The reducer keeps the invariants that make those states unreachable by ordinary
 *    editing -- removing a field that was the sort column clears the sort, dropping
 *    the time grain clears a sort on the period column.
 * 3. `drillStepFor` decides what a clicked mark means, and refuses the two cases that
 *    look like drills and are not: a metric cell, and a period cell -- `bi_period` is
 *    the compiler's own column rather than a dimension of the dataset, so a filter on
 *    it would be refused as an unknown field.
 *
 * The trail is the undo history of drill-downs, and it is exact rather than
 * approximate: each step records where the dimension it replaced sat on the shelf, so
 * stepping back up puts it where it was. Every manual edit clears the trail, which is
 * what lets a step be undone by dropping the last filter -- the drill filters are
 * always the tail of the list, because nothing else can be appended without resetting
 * it.
 */
import { BI_OPERATOR_ARITY, BI_PERIOD_KEY } from '@/types/bi';
import type {
  BiChartType, BiDataType, BiFilter, BiFilterOperator, BiMetric, BiQueryRequest,
  BiResultColumn, BiScalar, BiTimeGrain,
} from '@/types/bi';
import { CHART_FAMILY, CHART_SHAPE } from './biFormat';

/** Which shelf a field belongs on. A dimension groups; a metric folds. */
export type ShelfKind = 'DIMENSION' | 'METRIC';

/* -------------------------------------------------------------------------- */
/* Drag and drop                                                              */
/* -------------------------------------------------------------------------- */

/** A private MIME type, so a field dragged out of the palette cannot be dropped into
 *  a text input as a stray word, and a file dragged in from the desktop is ignored. */
export const BUILDER_DRAG_MIME = 'application/x-bi-field';

export interface BuilderDrag {
  shelf: ShelfKind;
  key: string;
  /** Where it sat when the drag began, or null when it came from the palette. That
   *  difference is what separates a reorder from an add. */
  from: number | null;
}

export function encodeDrag(drag: BuilderDrag): string {
  return JSON.stringify(drag);
}

/** Shape-checked rather than cast: `dataTransfer` carries whatever the page put
 *  there, and a malformed payload should end the drop, not the render. */
export function decodeDrag(text: string): BuilderDrag | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return null;
    const { shelf, key, from } = raw as Record<string, unknown>;
    if (shelf !== 'DIMENSION' && shelf !== 'METRIC') return null;
    if (typeof key !== 'string' || key === '') return null;
    return { shelf, key, from: typeof from === 'number' ? from : null };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

/** One drill-down, with everything needed to walk back out of it. */
export interface BiDrillStep {
  /** The dimension whose cell was clicked. */
  fromKey: string;
  /** The dimension that replaced it, or null when the click only filtered. */
  toKey: string | null;
  /** The clicked cell as it was printed, so the breadcrumb reads as the reader saw
   *  it rather than as the raw value. */
  label: string;
  /** The equality that was added. Appended, never inserted. */
  filter: BiFilter;
  /** Where `fromKey` sat on the dimension shelf. */
  at: number;
}

export interface BuilderState {
  datasetId: string | null;
  chartType: BiChartType;
  /** Dimension keys, in the order they group. Never contains BI_PERIOD_KEY: the
   *  compiler adds the period column itself when a grain is set. */
  dimensions: readonly string[];
  metrics: readonly string[];
  filters: readonly BiFilter[];
  timeGrain: BiTimeGrain | null;
  /** A selected dimension or metric key, or BI_PERIOD_KEY. Null means the compiler's
   *  own default: the first metric descending, or the first dimension. */
  orderBy: string | null;
  orderDesc: boolean;
  limit: number;
  trail: readonly BiDrillStep[];
}

/** Clamped server-side to the same range; stated here so the input can refuse a
 *  typo before the round trip. */
export const BUILDER_LIMITS = { min: 1, max: 5000, fallback: 500 } as const;

export function initialBuilderState(datasetId: string | null = null): BuilderState {
  return {
    datasetId,
    chartType: 'TABLE',
    dimensions: [],
    metrics: [],
    filters: [],
    timeGrain: null,
    orderBy: null,
    orderDesc: true,
    limit: BUILDER_LIMITS.fallback,
    trail: [],
  };
}

export type BuilderAction =
  | { type: 'DATASET'; datasetId: string | null }
  | { type: 'CHART'; chartType: BiChartType }
  | { type: 'ADD_FIELD'; shelf: ShelfKind; key: string; at?: number }
  | { type: 'MOVE_FIELD'; shelf: ShelfKind; from: number; to: number }
  | { type: 'REMOVE_FIELD'; shelf: ShelfKind; key: string }
  | { type: 'GRAIN'; timeGrain: BiTimeGrain | null }
  | { type: 'ORDER'; orderBy: string | null; orderDesc: boolean }
  | { type: 'LIMIT'; limit: number }
  | { type: 'ADD_FILTER'; filter: BiFilter }
  | { type: 'SET_FILTER'; index: number; filter: BiFilter }
  | { type: 'REMOVE_FILTER'; index: number }
  | { type: 'DRILL_DOWN'; step: BiDrillStep }
  | { type: 'TRAIL_TO'; depth: number }
  | { type: 'LOAD'; state: BuilderState };

/* -------------------------------------------------------------------------- */
/* Array helpers. Immutable, because the reducer's output is compared by identity.  */
/* -------------------------------------------------------------------------- */

function insertAt(list: readonly string[], index: number, key: string): readonly string[] {
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, key);
  return next;
}

function moveWithin(list: readonly string[], from: number, to: number): readonly string[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved);
  return next;
}

const shelfOf = (state: BuilderState, shelf: ShelfKind): readonly string[] =>
  (shelf === 'DIMENSION' ? state.dimensions : state.metrics);

const withShelf = (
  state: BuilderState, shelf: ShelfKind, next: readonly string[],
): BuilderState => (shelf === 'DIMENSION'
  ? { ...state, dimensions: next }
  : { ...state, metrics: next });

/**
 * Clears a sort that no longer names a selected column.
 *
 * Run after every change to the selection, because `bi_compile_query` raises 22023
 * for an order-by that is not one of the columns it built -- so a metric removed
 * while it was the sort column would break the next run rather than the current one.
 */
function sanitizeOrder(state: BuilderState): BuilderState {
  if (state.orderBy === null) return state;
  const available = orderOptions(state);
  return available.includes(state.orderBy) ? state : { ...state, orderBy: null };
}

/** Any manual edit invalidates the drill trail: the breadcrumb described a path
 *  through a selection that no longer exists, and a stale one would offer to walk
 *  back to a state it cannot reconstruct. */
const untrail = (state: BuilderState): BuilderState =>
  (state.trail.length === 0 ? state : { ...state, trail: [] });

/* -------------------------------------------------------------------------- */
/* The reducer, in three parts. Split by what each group of actions touches, so   */
/* no one function carries every branch (eslint complexity, max 20).             */
/*                                                                               */
/* Each part is typed to exactly the actions it handles rather than to the whole  */
/* union: the dispatcher below already routes by `type`, and a part that accepted */
/* every action would be a part whose fall-through branch could be reached by an  */
/* action it has no field for.                                                   */
/* -------------------------------------------------------------------------- */

type ShelfAction = Extract<BuilderAction, { type: 'ADD_FIELD' | 'MOVE_FIELD' | 'REMOVE_FIELD' }>;
type QueryAction = Extract<BuilderAction, {
  type: 'GRAIN' | 'ORDER' | 'LIMIT' | 'ADD_FILTER' | 'SET_FILTER' | 'REMOVE_FILTER';
}>;
type TrailAction = Extract<BuilderAction, { type: 'DRILL_DOWN' | 'TRAIL_TO' }>;

/** The shelves. A key is never added twice -- the compiler would emit the same column
 *  under two aliases and the reader would see one dimension grouped against itself. */
function reduceShelf(state: BuilderState, action: ShelfAction): BuilderState {
  if (action.type === 'ADD_FIELD') {
    const list = shelfOf(state, action.shelf);
    if (list.includes(action.key)) return state;
    const at = action.at ?? list.length;
    return untrail(withShelf(state, action.shelf, insertAt(list, at, action.key)));
  }
  if (action.type === 'MOVE_FIELD') {
    const list = shelfOf(state, action.shelf);
    const next = moveWithin(list, action.from, action.to);
    return next === list ? state : untrail(withShelf(state, action.shelf, next));
  }
  const list = shelfOf(state, action.shelf);
  if (!list.includes(action.key)) return state;
  return untrail(withShelf(state, action.shelf, list.filter((k) => k !== action.key)));
}

/** Grain, order, limit and filters. Every one of them is a request field the compiler
 *  reads, and none of them changes which fields are selected -- except the grain,
 *  which adds the period column and therefore can invalidate a sort. */
function reduceQuery(state: BuilderState, action: QueryAction): BuilderState {
  switch (action.type) {
    case 'GRAIN':
      return sanitizeOrder(untrail({ ...state, timeGrain: action.timeGrain }));
    case 'ORDER':
      return { ...state, orderBy: action.orderBy, orderDesc: action.orderDesc };
    case 'LIMIT':
      return { ...state, limit: clampLimit(action.limit) };
    case 'ADD_FILTER':
      return untrail({ ...state, filters: [...state.filters, action.filter] });
    case 'SET_FILTER':
      return untrail({
        ...state,
        filters: state.filters.map((f, i) => (i === action.index ? action.filter : f)),
      });
    default:
      return untrail({
        ...state,
        filters: state.filters.filter((_, i) => i !== action.index),
      });
  }
}

/**
 * The dimension shelf after one drill-down.
 *
 * A filter-only step leaves the shelf alone. A regroup takes the clicked dimension off
 * and puts the level below it in that slot -- unless that level is already grouped, in
 * which case the click only narrows, because the same dimension twice would be one
 * column grouped against itself.
 */
function applyDrill(dimensions: readonly string[], step: BiDrillStep): readonly string[] {
  if (step.toKey === null) return dimensions;
  const without = dimensions.filter((k) => k !== step.fromKey);
  return without.includes(step.toKey) ? without : insertAt(without, step.at, step.toKey);
}

/**
 * A drill-down applied, and walked back out of.
 *
 * Stepping back drops the last N filters rather than searching for the ones the steps
 * added, which is exact because every manual filter edit clears the trail: while a
 * trail exists, its filters are the tail of the list in order.
 */
function reduceTrail(state: BuilderState, action: TrailAction): BuilderState {
  if (action.type === 'DRILL_DOWN') {
    const { step } = action;
    return sanitizeOrder({
      ...state,
      dimensions: applyDrill(state.dimensions, step),
      filters: [...state.filters, step.filter],
      trail: [...state.trail, step],
    });
  }
  const depth = Math.min(Math.max(action.depth, 0), state.trail.length);
  const undone = state.trail.slice(depth);
  if (undone.length === 0) return state;
  let dimensions = state.dimensions;
  // Reversed, so a two-level drill restores the outer dimension to the slot the
  // inner one was put into rather than to wherever it ended up.
  for (const step of [...undone].reverse()) {
    if (step.toKey !== null) dimensions = dimensions.filter((k) => k !== step.toKey);
    if (!dimensions.includes(step.fromKey)) dimensions = insertAt(dimensions, step.at, step.fromKey);
  }
  return sanitizeOrder({
    ...state,
    dimensions,
    filters: state.filters.slice(0, state.filters.length - undone.length),
    trail: state.trail.slice(0, depth),
  });
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'DATASET':
      // A whole reset, not a re-pointing: dimension and metric keys are scoped to
      // their dataset, so carrying a selection across would name fields that the new
      // dataset does not define and be refused field by field.
      return action.datasetId === state.datasetId
        ? state
        : initialBuilderState(action.datasetId);
    case 'CHART':
      return { ...state, chartType: action.chartType };
    case 'LOAD':
      return { ...action.state, trail: [] };
    case 'ADD_FIELD':
    case 'MOVE_FIELD':
    case 'REMOVE_FIELD':
      return sanitizeOrder(reduceShelf(state, action));
    case 'DRILL_DOWN':
    case 'TRAIL_TO':
      return reduceTrail(state, action);
    default:
      return reduceQuery(state, action);
  }
}

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return BUILDER_LIMITS.fallback;
  return Math.min(BUILDER_LIMITS.max, Math.max(BUILDER_LIMITS.min, Math.trunc(value)));
}

/* -------------------------------------------------------------------------- */
/* The request                                                                */
/* -------------------------------------------------------------------------- */

/** Which keys may be sorted on: the compiler resolves an order-by against the columns
 *  it built, and the period column is one of them whenever a grain is set. */
export function orderOptions(state: BuilderState): readonly string[] {
  const period = state.timeGrain ? [BI_PERIOD_KEY] : [];
  return [...period, ...state.dimensions, ...state.metrics];
}

export function toQueryRequest(
  state: BuilderState, visualizationId: string | null = null,
): BiQueryRequest | null {
  if (!state.datasetId) return null;
  return {
    datasetId: state.datasetId,
    dimensions: state.dimensions,
    metrics: state.metrics,
    filters: state.filters,
    timeGrain: state.timeGrain,
    orderBy: state.orderBy,
    orderDesc: state.orderDesc,
    limit: state.limit,
    visualizationId,
  };
}

/**
 * A request as one string, so a result can say which request produced it.
 *
 * The chart type is deliberately absent: redrawing the same numbers as a bar instead of
 * a line does not make the result stale, and a "run again" prompt after a cosmetic
 * change would train the reader to ignore the one that matters.
 */
export function requestSignature(request: BiQueryRequest | null): string {
  return request === null ? '' : JSON.stringify(request);
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/** A new filter on a field. EQ regardless of type, because it is the one operator every
 *  data type accepts -- the picker offers the rest immediately. */
export function blankFilter(field: string): BiFilter {
  return { field, op: 'EQ', value: '' };
}

/**
 * A value as it will travel through jsonb.
 *
 * Typed by the column rather than by the text: `'2'` compared against a numeric column
 * is a comparison Postgres will make, but `'02'` and `2` are not the same text, and a
 * filter that reads `= '02'` after the user typed 02 is a filter that will silently
 * match nothing.
 */
export function parseScalar(text: string, dataType: BiDataType | undefined): BiScalar {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (dataType === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (dataType === 'boolean') {
    const lower = trimmed.toLowerCase();
    if (lower === 'true' || lower === 'false') return lower === 'true';
    return trimmed;
  }
  return trimmed;
}

/** IN and NOT_IN, from one comma-separated box. Empty entries are dropped rather than
 *  sent as empty strings, which would compile into a comparison against ''. */
export function parseScalarList(text: string, dataType: BiDataType | undefined): BiScalar[] {
  return text.split(',')
    .map((part) => parseScalar(part, dataType))
    .filter((value) => value !== '');
}

/** Whether a filter carries the payload its operator needs. The same pairing
 *  `private.bi_compile_filters` enforces, checked here so the refusal is visible on the
 *  row being edited instead of arriving as a failed run. */
export function filterComplete(filter: BiFilter): boolean {
  switch (BI_OPERATOR_ARITY[filter.op]) {
    case 'none':
      return true;
    case 'two':
      return isFilled(filter.value) && isFilled(filter.value2);
    case 'many':
      return (filter.values?.length ?? 0) > 0;
    default:
      return isFilled(filter.value);
  }
}

const isFilled = (value: BiScalar | undefined): boolean =>
  value !== undefined && value !== null && value !== '';

/**
 * A filter rewritten for a new operator, keeping what the new arity can use.
 *
 * Switching EQ to IN moves the single value into the list rather than dropping it, and
 * switching to IS_NULL drops both -- a filter that kept an invisible value would send
 * one the compiler ignores today and might not ignore later.
 */
export function retypeFilter(filter: BiFilter, op: BiFilterOperator): BiFilter {
  const arity = BI_OPERATOR_ARITY[op];
  if (arity === 'none') return { field: filter.field, op };
  if (arity === 'many') {
    const values = filter.values ?? (isFilled(filter.value) ? [filter.value as BiScalar] : []);
    return { field: filter.field, op, values };
  }
  const value = filter.value ?? filter.values?.[0] ?? '';
  if (arity === 'two') return { field: filter.field, op, value, value2: filter.value2 ?? '' };
  return { field: filter.field, op, value };
}

/* -------------------------------------------------------------------------- */
/* Readiness: what the compiler would refuse, said before the run              */
/* -------------------------------------------------------------------------- */

export type BuilderIssue =
  | { kind: 'NO_DATASET' }
  | { kind: 'EMPTY' }
  | { kind: 'NEEDS_DIMENSION'; need: number; have: number }
  | { kind: 'NEEDS_MEASURE'; need: number; have: number }
  | { kind: 'NOT_DRAWN'; chartType: BiChartType }
  | { kind: 'FILTER_INCOMPLETE'; index: number; field: string; op: BiFilterOperator }
  | { kind: 'DEPRECATED_METRIC'; key: string }
  | { kind: 'ORDER_UNSELECTED'; key: string };

/**
 * Which issues stop the run.
 *
 * The two shape issues do not: a chart short of a dimension still produced a valid
 * result, and `BiChart` names what is missing under the frame it could not draw. A
 * request the compiler will refuse is a different matter -- running it spends a ledger
 * row on a failure the screen already knew about.
 */
export const blocksRun = (issue: BuilderIssue): boolean =>
  issue.kind === 'NO_DATASET' || issue.kind === 'EMPTY'
  || issue.kind === 'FILTER_INCOMPLETE' || issue.kind === 'DEPRECATED_METRIC'
  || issue.kind === 'ORDER_UNSELECTED';

/** Grouping columns, as the compiler will count them: the period column is one. */
export const groupingCount = (state: BuilderState): number =>
  state.dimensions.length + (state.timeGrain ? 1 : 0);

function filterIssues(state: BuilderState): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  state.filters.forEach((filter, index) => {
    if (!filterComplete(filter)) {
      issues.push({ kind: 'FILTER_INCOMPLETE', index, field: filter.field, op: filter.op });
    }
  });
  return issues;
}

/**
 * Everything wrong with the current request, in the order a reader should fix it.
 *
 * `metrics` is the dataset's metric list, needed for one check the state cannot make
 * alone: `bi_compile_query` refuses a DEPRECATED metric outright, and a saved analysis
 * loaded into the builder can carry one that was published when it was saved.
 */
export function readiness(
  state: BuilderState, metrics: readonly BiMetric[],
): readonly BuilderIssue[] {
  if (!state.datasetId) return [{ kind: 'NO_DATASET' }];

  const issues: BuilderIssue[] = [];
  const dims = groupingCount(state);
  const measures = state.metrics.length;
  if (dims === 0 && measures === 0) issues.push({ kind: 'EMPTY' });

  for (const key of state.metrics) {
    if (metrics.find((m) => m.key === key)?.status === 'DEPRECATED') {
      issues.push({ kind: 'DEPRECATED_METRIC', key });
    }
  }
  if (state.orderBy !== null && !orderOptions(state).includes(state.orderBy)) {
    issues.push({ kind: 'ORDER_UNSELECTED', key: state.orderBy });
  }
  issues.push(...filterIssues(state));

  const family = CHART_FAMILY[state.chartType];
  if (family === 'PENDING') {
    issues.push({ kind: 'NOT_DRAWN', chartType: state.chartType });
    return issues;
  }
  const shape = CHART_SHAPE[family];
  if (dims < shape.dims) issues.push({ kind: 'NEEDS_DIMENSION', need: shape.dims, have: dims });
  if (measures < shape.measures) {
    issues.push({ kind: 'NEEDS_MEASURE', need: shape.measures, have: measures });
  }
  return issues;
}

/* -------------------------------------------------------------------------- */
/* Drill-down                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a clicked mark means, or nothing.
 *
 * Three cells are not drills and must not be treated as one. A metric cell has no
 * dimension value to narrow by. A period cell is the compiler's own column -- its key
 * is not a dimension of the dataset, so a filter naming it would be refused as an
 * unknown field. And a null group is narrowed with IS_NULL rather than `= null`, which
 * matches nothing in SQL and would silently empty the chart.
 *
 * `datasetDimensions` is the guard on the level below: `drill_to_key` may name a
 * dimension that has not been authored yet -- a hierarchy is written top-down -- and
 * regrouping onto a key the dataset does not define would be refused at compile time.
 */
export function drillStepFor(
  state: BuilderState,
  column: BiResultColumn,
  value: BiScalar,
  label: string,
  datasetDimensions: readonly string[],
): BiDrillStep | null {
  if (column.kind !== 'DIMENSION' || column.key === BI_PERIOD_KEY) return null;
  const index = state.dimensions.indexOf(column.key);
  const at = index === -1 ? state.dimensions.length : index;
  const next = column.drill_to_key ?? null;
  const toKey = next !== null && datasetDimensions.includes(next) ? next : null;
  const filter: BiFilter = value === null
    ? { field: column.key, op: 'IS_NULL' }
    : { field: column.key, op: 'EQ', value };
  return { fromKey: column.key, toKey, label, filter, at };
}

/** Definitions in shelf order. The shelf is an ordered list of keys and the panel needs
 *  the rows behind them in that order, because the order is the group-by order. */
export function orderedByKeys<T extends { key: string }>(
  items: readonly T[], keys: readonly string[],
): T[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return keys.map((key) => byKey.get(key)).filter((item): item is T => item !== undefined);
}
