/**
 * CRM read layer. Every function here is a single call to a SECURITY DEFINER
 * analytics RPC in 20260830120000_crm_vertical_slice.sql. None of them computes
 * a business number in the browser: the funnel rates, the weighted forecast, the
 * per-customer margin and the campaign ROI are all derived in SQL from rows the
 * caller can re-count, so a screen and a report can never disagree.
 *
 * Reads that are plain row lists (leads, customers, activities, stage history)
 * go through useSupabaseData against the RLS-protected tables instead. This file
 * exists for the composed payloads only.
 */
import { supabase } from '@/lib/supabase';
import { normalizeError } from '@/lib/errors';
import type {
  CrmCampaignRoi, CrmCustomer360, CrmCustomerProfitability, CrmDashboard,
  CrmForecastMonth, CrmFunnel, CrmPipelineStage,
} from '@/types/crm';

export interface CrmReadResult<T> {
  data: T | null;
  /** Already user-safe: the analytics RPCs raise 42501 for scope and permission,
   *  and nothing else in them is a business rule. */
  error: string | null;
}

const SCOPE_DENIED = 'لا تملك صلاحية الاطلاع على بيانات إدارة العلاقات';

function readError(code: string | undefined, message: string): string {
  if (code === '42501') return SCOPE_DENIED;
  return message;
}

/** The rpc contract types Returns as unknown, so every payload is shape-checked
 *  before it is handed to a component. A malformed payload becomes an error, not
 *  a crash inside a chart. */
async function rpcRead<T>(
  fn: string,
  args: Record<string, unknown>,
  isValid: (value: unknown) => boolean,
): Promise<CrmReadResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: readError(error.code, error.message) };
  if (!isValid(data)) return { data: null, error: `استجابة غير متوقعة من ${fn}` };
  return { data: data as T, error: null };
}

const isArray = (v: unknown): boolean => Array.isArray(v);
const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);

export const crmAnalytics = {
  /** One round trip for the CRM home screen: pipeline, funnel, forecast, counters,
   *  due follow-ups, recent activity and the largest open opportunities. */
  dashboard: (days = 90) =>
    rpcRead<CrmDashboard>('get_crm_dashboard', { p_days: days }, isObject),

  pipeline: (from?: string | null, to?: string | null) =>
    rpcRead<CrmPipelineStage[]>('get_crm_pipeline_summary', { p_from: from ?? null, p_to: to ?? null }, isArray),

  forecast: (months = 6) =>
    rpcRead<CrmForecastMonth[]>('get_crm_forecast', { p_months: months }, isArray),

  funnel: (from?: string | null, to?: string | null) =>
    rpcRead<CrmFunnel>('get_crm_funnel', { p_from: from ?? null, p_to: to ?? null }, isObject),

  customer360: (customerId: string) =>
    rpcRead<CrmCustomer360>('get_crm_customer_360', { p_customer_id: customerId }, isObject),

  /** Cost is the customer's share of their group's POSTED EXPENSE lines. Rows
   *  whose groups carry no expense lines come back with a null margin, never a
   *  zero one -- see cost_coverage_pct on each row. */
  customerProfitability: (from?: string | null, to?: string | null, limit = 50) =>
    rpcRead<CrmCustomerProfitability>(
      'get_crm_customer_profitability',
      { p_from: from ?? null, p_to: to ?? null, p_limit: limit },
      isObject,
    ),

  campaignRoi: (from?: string | null, to?: string | null) =>
    rpcRead<CrmCampaignRoi>('get_crm_campaign_roi', { p_from: from ?? null, p_to: to ?? null }, isObject),
};

/** Wraps a read in the shape the hooks below expect, turning a thrown transport
 *  failure into the same `{data, error}` the RPC path returns. */
export async function safeCrmRead<T>(run: () => Promise<CrmReadResult<T>>): Promise<CrmReadResult<T>> {
  try {
    return await run();
  } catch (e) {
    return { data: null, error: normalizeError(e).message };
  }
}
