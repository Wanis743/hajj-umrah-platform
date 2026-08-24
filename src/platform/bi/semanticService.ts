/**
 * BI semantic-layer service (V12 §17.8 — platform migration of bi/v10, §8).
 *
 * §8 requirements honored:
 * - Datasets, dimensions/measures via certified metrics with owner + lineage
 *   + refresh status come from the server tables (bi_datasets/bi_metrics) —
 *   no client-side metric invention.
 * - Query layer: typed fetches only; aggregation stays server-side.
 *
 * Verified server contracts:
 * - bi_datasets: id, agency_id, name, description, schema_def (jsonb), owner, status
 * - bi_metrics:  id, agency_id, dataset_id, key, display_name, formula, grain,
 *                owner, status ('DRAFT'|'CERTIFIED'|...), lineage
 * - bi_reports:  id, agency_id, title, description, layout (jsonb), owner
 * - bi_visualizations: id, agency_id, report_id, dataset_id, chart_type,
 *                measures (jsonb), dimensions (jsonb), filters (jsonb)
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export type MetricStatus = 'DRAFT' | 'CERTIFIED' | 'DEPRECATED';

export interface BiDatasetDTO {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly owner: string | null;
  readonly status: string;
}

export interface BiMetricDTO {
  readonly id: string;
  readonly datasetId: string;
  readonly key: string;
  readonly displayName: string;
  readonly formula: string;
  readonly grain: string;
  /** Certified metrics are the only ones dashboards may consume. */
  readonly status: MetricStatus;
  readonly lineage: string | null;
}

export interface BiReportDTO {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly layout: unknown;
}

export interface BiVisualizationDTO {
  readonly id: string;
  readonly reportId: string | null;
  readonly datasetId: string;
  readonly chartType: string;
  readonly measures: readonly string[];
  readonly dimensions: readonly string[];
}

export async function getDatasets(): Promise<Result<readonly BiDatasetDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('bi_datasets')
    .select('id, name, description, owner, status')
    .order('name', { ascending: true });

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'BI' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    owner: r.owner === null || r.owner === undefined ? null : String(r.owner),
    status: String(r.status ?? 'DRAFT'),
  })));
}

export async function getMetrics(datasetId?: string): Promise<Result<readonly BiMetricDTO[], KernelError>> {
  let query = supabase
    .from('bi_metrics')
    .select('id, dataset_id, key, display_name, formula, grain, status, lineage')
    .order('key', { ascending: true });
  if (datasetId !== undefined) query = query.eq('dataset_id', datasetId);

  const { data, error } = await query;
  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'BI' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    datasetId: String(r.dataset_id),
    key: String(r.key ?? ''),
    displayName: String(r.display_name ?? ''),
    formula: String(r.formula ?? ''),
    grain: String(r.grain ?? ''),
    status: (String(r.status ?? 'DRAFT') as MetricStatus),
    lineage: r.lineage === null || r.lineage === undefined ? null : String(r.lineage),
  })));
}

export async function getReports(): Promise<Result<readonly BiReportDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('bi_reports')
    .select('id, title, description, layout')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'BI' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    title: String(r.title ?? ''),
    description: String(r.description ?? ''),
    layout: r.layout ?? null,
  })));
}

export async function getVisualizations(reportId?: string): Promise<Result<readonly BiVisualizationDTO[], KernelError>> {
  let query = supabase
    .from('bi_visualizations')
    .select('id, report_id, dataset_id, chart_type, measures, dimensions')
    .limit(200);
  if (reportId !== undefined) query = query.eq('report_id', reportId);

  const { data, error } = await query;
  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'BI' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    reportId: r.report_id === null || r.report_id === undefined ? null : String(r.report_id),
    datasetId: String(r.dataset_id ?? ''),
    chartType: String(r.chart_type ?? 'bar'),
    measures: Array.isArray(r.measures) ? (r.measures as unknown[]).map(String) : [],
    dimensions: Array.isArray(r.dimensions) ? (r.dimensions as unknown[]).map(String) : [],
  })));
}

export interface ReportLayoutItem {
  readonly visualizationId: string;
  readonly position: number;
}

/**
 * §8 report builder: persist a report's visual arrangement. The layout is
 * an ordered list of visualization references; the server RLS policy
 * (bi_reports_isolation) stamps scope — the client never supplies agency.
 */
export async function createReport(
  title: string,
  description: string,
  layout: readonly ReportLayoutItem[],
): Promise<Result<BiReportDTO, KernelError>> {
  const payload = {
    title,
    description,
    layout: layout.map((l) => ({ visualization_id: l.visualizationId, position: l.position })),
  };
  // bi_reports participates in the generated Database types; the jsonb layout
  // column needs an explicit boundary cast (unknown at the edge is sanctioned).
  type BiReportsClient = Parameters<typeof supabase.from>[0] extends never ? never : string;
  const client = supabase.from('bi_reports' as BiReportsClient);
  const { data, error } = await (client as unknown as {
    insert: (row: Record<string, unknown>) => ReturnType<typeof client.select>;
  })
    .insert(payload as unknown as Record<string, unknown>)
    .select('id, title, description, layout')
    .single();

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'BI' } });
  }
  const r = data as Record<string, unknown>;
  return ok(Object.freeze({
    id: String(r.id),
    title: String(r.title ?? ''),
    description: String(r.description ?? ''),
    layout: r.layout ?? null,
  }));
}

export async function saveReportLayout(
  reportId: string,
  layout: readonly ReportLayoutItem[],
): Promise<Result<true, KernelError>> {
  const payload = {
    layout: layout.map((l) => ({ visualization_id: l.visualizationId, position: l.position })),
  };
  const client = supabase.from('bi_reports' as Parameters<typeof supabase.from>[0]);
  const { error } = await (client as unknown as {
    update: (row: Record<string, unknown>) => ReturnType<typeof client.select>;
  })
    .update(payload as unknown as Record<string, unknown>)
    .eq('id', reportId);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'BI' } });
  }
  return ok(true);
}
