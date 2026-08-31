/**
 * Row reads for the CRM screens.
 *
 * Every list a CRM screen shows is one query against an RLS-protected table: the
 * `<table>_select` policies in 20260830120000_crm_vertical_slice.sql restrict each
 * row to public.row_in_staff_scope(agency_id, branch_id), so a screen cannot see
 * another agency's pipeline even though the query is issued by the browser.
 *
 * Reads only. Every CRM write goes through a command RPC -- see
 * crmLifecycleCommands in @/services/domainCommands for why: a stage carries
 * history, a quote total is derived from its lines, and closing a sale posts a
 * booking, a payment and a journal entry.
 *
 * Composed analytics payloads (pipeline, funnel, forecast, Customer 360,
 * profitability, campaign ROI) come from @/services/crmAnalytics instead.
 */
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type {
  CrmActivityRow, CrmCampaignRow, CrmCustomerRow, CrmFollowupRow, CrmLeadRow,
  CrmOpportunityRow, CrmQuoteLineRow, CrmQuoteRow, CrmStageHistoryRow,
} from '@/types/crm';

export interface CrmRowsState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** A filter value that matches nothing. Used when a detail list has no parent
 *  selected yet: a query that returns zero rows is honest, where skipping the
 *  query would leave the previous parent's rows on screen. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Package fields the CRM needs: the picker on lead conversion and quote lines,
 *  and the seat count the money path checks before it books. */
export interface CrmPackageOption {
  id: string;
  code: string | null;
  name: string | null;
  name_ar: string | null;
  price_dzd: number | null;
  price_sar: number | null;
  seats_available: number | null;
  status: string | null;
}

export function useCrmLeadRows(
  opts: { status?: string; term?: string; limit?: number } = {},
): CrmRowsState<CrmLeadRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmLeadRow>({
    table: 'crm_leads',
    orderBy: { column: 'created_at', ascending: false },
    filter: opts.status && opts.status !== 'ALL' ? { column: 'status', value: opts.status } : undefined,
    search: opts.term?.trim() ? { columns: ['first_name', 'last_name', 'phone', 'email'], term: opts.term } : undefined,
    limit: opts.limit ?? 100,
  });
  return { data, loading, error, refetch };
}

export function useCrmCustomerRows(
  opts: { status?: string; term?: string; limit?: number } = {},
): CrmRowsState<CrmCustomerRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmCustomerRow>({
    table: 'crm_customers',
    orderBy: { column: 'last_activity_at', ascending: false },
    filter: opts.status && opts.status !== 'ALL' ? { column: 'status', value: opts.status } : undefined,
    search: opts.term?.trim() ? { columns: ['full_name', 'code', 'phone', 'email'], term: opts.term } : undefined,
    limit: opts.limit ?? 100,
  });
  return { data, loading, error, refetch };
}

export function useCrmOpportunityRows(
  opts: { stage?: string; term?: string; limit?: number } = {},
): CrmRowsState<CrmOpportunityRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmOpportunityRow>({
    table: 'crm_opportunities',
    orderBy: { column: 'expected_value_dzd', ascending: false },
    filter: opts.stage && opts.stage !== 'ALL' ? { column: 'stage', value: opts.stage } : undefined,
    search: opts.term?.trim() ? { columns: ['reference', 'title'], term: opts.term } : undefined,
    limit: opts.limit ?? 100,
  });
  return { data, loading, error, refetch };
}

export function useCrmQuoteRows(
  opts: { status?: string; term?: string; limit?: number } = {},
): CrmRowsState<CrmQuoteRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmQuoteRow>({
    table: 'crm_quotes',
    orderBy: { column: 'created_at', ascending: false },
    filter: opts.status && opts.status !== 'ALL' ? { column: 'status', value: opts.status } : undefined,
    search: opts.term?.trim() ? { columns: ['quote_number'], term: opts.term } : undefined,
    limit: opts.limit ?? 100,
  });
  return { data, loading, error, refetch };
}

export function useCrmQuoteLineRows(quoteId: string | null): CrmRowsState<CrmQuoteLineRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmQuoteLineRow>({
    table: 'crm_quote_lines',
    orderBy: { column: 'sort_order', ascending: true },
    filter: { column: 'quote_id', value: quoteId ?? NIL_UUID },
    limit: 100,
  });
  return { data, loading, error, refetch };
}

export function useCrmFollowupRows(
  opts: { status?: string; limit?: number } = {},
): CrmRowsState<CrmFollowupRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmFollowupRow>({
    table: 'crm_followups',
    orderBy: { column: 'due_at', ascending: true },
    filter: opts.status && opts.status !== 'ALL' ? { column: 'status', value: opts.status } : undefined,
    limit: opts.limit ?? 100,
  });
  return { data, loading, error, refetch };
}

export function useCrmActivityRows(
  opts: { activityType?: string; limit?: number } = {},
): CrmRowsState<CrmActivityRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmActivityRow>({
    table: 'crm_activities',
    orderBy: { column: 'occurred_at', ascending: false },
    filter: opts.activityType && opts.activityType !== 'ALL'
      ? { column: 'activity_type', value: opts.activityType }
      : undefined,
    limit: opts.limit ?? 100,
  });
  return { data, loading, error, refetch };
}

export function useCrmCampaignRows(): CrmRowsState<CrmCampaignRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmCampaignRow>({
    table: 'crm_campaigns',
    orderBy: { column: 'created_at', ascending: false },
    limit: 100,
  });
  return { data, loading, error, refetch };
}

/** Append-only ledger of stage moves. There is no analytics RPC for it: the
 *  crm_stage_history_select policy already scopes it, and every client write path
 *  on that table was revoked in section H of the migration. */
export function useCrmStageHistoryRows(opportunityId: string | null): CrmRowsState<CrmStageHistoryRow> {
  const { data, loading, error, refetch } = useSupabaseData<CrmStageHistoryRow>({
    table: 'crm_stage_history',
    orderBy: { column: 'changed_at', ascending: false },
    filter: { column: 'opportunity_id', value: opportunityId ?? NIL_UUID },
    limit: 50,
  });
  return { data, loading, error, refetch };
}

/** Packages, for the pickers. Read-only here; package maintenance lives in its
 *  own screen. */
export function useCrmPackageOptions(): CrmRowsState<CrmPackageOption> {
  const { data, loading, error, refetch } = useSupabaseData<CrmPackageOption>({
    table: 'packages',
    columns: 'id,code,name,name_ar,price_dzd,price_sar,seats_available,status',
    orderBy: { column: 'price_dzd', ascending: true },
    limit: 100,
  });
  return { data, loading, error, refetch };
}

/** Groups, for the optional group on the booking a quote acceptance creates.
 *  Optional on purpose: accept_crm_quote takes p_group_id as null, and a booking
 *  can be assigned to a departure later. */
export interface CrmGroupOption {
  id: string;
  code: string | null;
  name: string | null;
  departure_date: string | null;
  status: string | null;
  max_capacity: number | null;
  current_capacity: number | null;
}

export function useCrmGroupOptions(): CrmRowsState<CrmGroupOption> {
  const { data, loading, error, refetch } = useSupabaseData<CrmGroupOption>({
    table: 'groups',
    columns: 'id,code,name,departure_date,status,max_capacity,current_capacity',
    orderBy: { column: 'departure_date', ascending: true },
    limit: 100,
  });
  return { data, loading, error, refetch };
}
