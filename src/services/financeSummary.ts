import { supabase } from '@/lib/supabase';

export interface FinanceSummary {
  agency_id: string;
  branch_id: string | null;
  package_id: string | null;
  date_from: string | null;
  date_to: string | null;
  counts: { confirmed: number; pending: number; failed: number; refunded: number; total: number };
  currency: {
    DZD: { confirmed: number; pending: number; failed: number; refunded: number; total: number; count: number };
    SAR: { confirmed: number; pending: number; failed: number; refunded: number; total: number; count: number };
  };
}

export async function getFinanceSummary(filters: {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  packageId?: string;
}): Promise<FinanceSummary> {
  const { data, error } = await supabase.rpc('get_finance_summary', {
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_branch_id: filters.branchId ?? null,
    p_package_id: filters.packageId ?? null,
  });
  if (error) throw error;
  return data as FinanceSummary;
}
