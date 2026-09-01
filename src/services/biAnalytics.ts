/**
 * BI read layer. Every function here is one call to a SECURITY DEFINER function in
 * 20260901120000_bi_studio_vertical_slice.sql. Nothing here builds SQL, filters a
 * result set, or folds a metric: the compiler in that migration does all three, and
 * a second implementation in the browser would be a second answer to "what does
 * revenue mean".
 *
 * This file carries one thing dmsAnalytics.ts did not need. The three query
 * functions return failure as data -- `{ok: false, error_code, error_message}` --
 * because a denied query is exactly the attempt worth auditing and `raise` would
 * roll back the bi_query_log row recording it. `unwrapQuery` is where that becomes
 * an ordinary error, so nothing above this layer has to remember to check `ok`.
 */
import { supabase } from '@/lib/supabase';
import { normalizeError } from '@/lib/errors';
import type {
  BiCatalog, BiDashboardDetail, BiDashboardSummary, BiDatasetDetail, BiDrillPath,
  BiDrillThroughRequest, BiDrillThroughResult, BiDrillThroughSuccess, BiEventRow,
  BiLineage, BiQueryLogRow, BiQueryOutcome, BiQueryRequest, BiQueryResult,
  BiQuerySuccess, BiReport, BiStudioOverview, BiVisualizationResult,
} from '@/types/bi';

export interface BiReadResult<T> {
  data: T | null;
  /** Already user-safe. The read functions raise 42501 for permission and scope and
   *  22023 for a request the compiler will not build; both are authored sentences. */
  error: string | null;
}

const SCOPE_DENIED = 'لا تملك صلاحية الاطلاع على بيانات ذكاء الأعمال';

function readError(code: string | undefined, message: string): string {
  if (code === '42501') return SCOPE_DENIED;
  return message;
}

/** rpc types Returns as unknown, so every payload is shape-checked before a chart
 *  is handed it. A malformed payload becomes an error, not a crash inside a render. */
async function rpcRead<T>(
  fn: string,
  args: Record<string, unknown>,
  isValid: (value: unknown) => boolean,
): Promise<BiReadResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: readError(error.code, error.message) };
  if (!isValid(data)) return { data: null, error: `استجابة غير متوقعة من ${fn}` };
  return { data: data as T, error: null };
}

const isArray = (v: unknown): boolean => Array.isArray(v);
const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The one translation this layer owes its callers: `ok: false` is an error.
 *
 * The payload is kept out of `data` entirely rather than passed through with a flag,
 * because a chart handed `rows: []` and an error string will draw an empty axis and
 * look like a dataset with no matching rows -- which is a different fact from "you
 * may not read this".
 */
function unwrapQuery<T extends { ok: boolean }>(
  result: BiReadResult<T>,
): BiReadResult<Extract<T, { ok: true }>> {
  const { data, error } = result;
  if (error !== null || data === null) return { data: null, error };
  if (!data.ok) {
    const failure = data as unknown as { error_code: string; error_message: string };
    return { data: null, error: readError(failure.error_code, failure.error_message) };
  }
  return { data: data as Extract<T, { ok: true }>, error: null };
}

/** Every ad-hoc query the analysis builder runs. `run_bi_query_command` is a command
 *  rather than a read because it writes a bi_query_log row on every call, including
 *  the ones it refuses. */
async function runQuery(request: BiQueryRequest): Promise<BiReadResult<BiQuerySuccess>> {
  return unwrapQuery<BiQueryResult>(await rpcRead<BiQueryResult>('run_bi_query_command', {
    p_dataset_id: request.datasetId,
    p_dimensions: request.dimensions ?? [],
    p_metrics: request.metrics ?? [],
    p_filters: request.filters ?? [],
    p_time_grain: request.timeGrain ?? null,
    p_order_by: request.orderBy ?? null,
    p_order_desc: request.orderDesc ?? true,
    p_limit: request.limit ?? 500,
    p_visualization_id: request.visualizationId ?? null,
  }, isObject));
}

export const biAnalytics = {
  /** The studio landing screen: counts, the three health signals, seven-day usage
   *  from the ledger, and what this caller may do. */
  overview: () =>
    rpcRead<BiStudioOverview>('get_bi_studio_overview', {}, isObject),

  /** Registered sources and every dataset, each carrying `readable_by_me` so the
   *  catalog never advertises a dataset the viewer will be refused. */
  catalog: () =>
    rpcRead<BiCatalog>('get_bi_catalog', {}, isObject),

  /** One dataset with its dimensions, metrics, and the source columns an expression
   *  may name -- which is also the allowlist the write-time validator enforces, so
   *  the builder can only offer what will be accepted. */
  datasetDetail: (datasetId: string) =>
    rpcRead<BiDatasetDetail>('get_bi_dataset_detail', { p_dataset_id: datasetId }, isObject),

  /** The ordered hierarchy under one dimension. Walked in SQL: the cycle guard has to
   *  be somewhere a UI cannot skip. */
  drillPath: (datasetId: string, dimensionKey: string) =>
    rpcRead<BiDrillPath>('get_bi_drill_path',
      { p_dataset_id: datasetId, p_dimension_key: dimensionKey }, isObject),

  /** Upstream to physical columns, downstream to analyses and dashboards, plus the
   *  impact counts an editor should see before saving rather than after. */
  lineage: (kind: 'DATASET' | 'DIMENSION' | 'METRIC', id: string) =>
    rpcRead<BiLineage>('get_bi_lineage', { p_kind: kind, p_id: id }, isObject),

  /** Names and tile counts only. `fully_readable_by_me` is on each row because a
   *  dashboard is all-or-nothing to a viewer. */
  dashboards: () =>
    rpcRead<BiDashboardSummary[]>('get_bi_dashboards', {}, isArray),

  /** The grid and each tile's definition, with no tile data: the tiles fetch their
   *  own numbers so each one is separately authorized and separately logged. */
  dashboard: (dashboardId: string) =>
    rpcRead<BiDashboardDetail>('get_bi_dashboard', { p_dashboard_id: dashboardId }, isObject),

  /** Reports with their analyses nested. A report is a document; a dashboard is a
   *  grid; they are separate on purpose. */
  reports: () =>
    rpcRead<BiReport[]>('get_bi_reports', {}, isArray),

  /** The query ledger, with the compiled SQL of each attempt. Gated on
   *  bi_query_log.read separately from everything else here. */
  queryLog: (limit = 100, outcome: BiQueryOutcome | null = null) =>
    rpcRead<BiQueryLogRow[]>('get_bi_query_log',
      { p_limit: limit, p_outcome: outcome }, isArray),

  /** Every status transition of every definition, with who and when. */
  events: (entityKind: string | null = null, entityId: string | null = null, limit = 100) =>
    rpcRead<BiEventRow[]>('get_bi_events',
      { p_entity_kind: entityKind, p_entity_id: entityId, p_limit: limit }, isArray),

  /** An ad-hoc query from the analysis builder. */
  runQuery,

  /** A saved analysis, run: the same result plus the chart metadata, so a tile gets
   *  its numbers and how to draw them in one round trip. */
  runVisualization: async (visualizationId: string) =>
    unwrapQuery<BiVisualizationResult>(
      await rpcRead<BiVisualizationResult>('run_bi_visualization_command',
        { p_visualization_id: visualizationId }, isObject)),

  /**
   * One cell, opened. Returns entity ids rather than records: the screen that opens a
   * booking already exists and is already authorized, and returning whole rows here
   * would be a second read path around the one that guards them.
   */
  drillThrough: async (request: BiDrillThroughRequest) =>
    unwrapQuery<BiDrillThroughResult>(
      await rpcRead<BiDrillThroughResult>('run_bi_drill_through_command', {
        p_dataset_id: request.datasetId,
        p_dimension_key: request.dimensionKey,
        p_value: request.value,
        p_filters: request.filters ?? [],
        p_limit: request.limit ?? 200,
      }, isObject)),
};

/** Wraps a read in the shape the hooks expect, turning a thrown transport failure
 *  into the same `{data, error}` the RPC path returns. */
export async function safeBiRead<T>(run: () => Promise<BiReadResult<T>>): Promise<BiReadResult<T>> {
  try {
    return await run();
  } catch (e) {
    return { data: null, error: normalizeError(e).message };
  }
}

export type { BiDrillThroughSuccess, BiQuerySuccess };

