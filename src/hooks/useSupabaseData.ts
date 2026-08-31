import { useCallback, useEffect, useState, useRef } from 'react';
import { CompatibilityCommands } from '@/services/domainCommands';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { normalizeError } from '@/lib/errors';
import type { TableName } from '@/types/database';
import { realtimeManager, type RealtimeDomain } from '@/services/realtimeManager';

interface UseSupabaseDataOptions<T> {
  table: TableName;
  orderBy?: { column: string; ascending?: boolean };
  filter?: { column: string; value: unknown };
  dateRange?: { column: string; from?: string; to?: string };
  search?: { columns: string[]; term: string };
  fallbackData?: T[];
  columns?: string;
  limit?: number;
  offset?: number;
}

interface UseSupabaseDataReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  insert: (row: Partial<T>) => Promise<{ data: T | null; error: Error | null }>;
  update: (id: string, patch: Partial<T>) => Promise<{ data: T | null; error: Error | null }>;
  remove: (id: string) => Promise<{ error: Error | null }>;
  totalCount: number | null;
  hasMore: boolean;
  setData: React.Dispatch<React.SetStateAction<T[]>>;
}

const DEFAULT_COLUMNS: Record<string, string> = {
  pilgrims: 'id,reference,full_name,full_name_ar,phone,email,status,visa_status,payment_status,package_id,group_id,created_at,updated_at',
  bookings: 'id,reference,pilgrim_id,package_id,group_id,status,travelers,total_dzd,total_sar,paid_dzd,paid_sar,start_date,end_date,created_at,confirmed_at,version',
  payments: 'id,booking_id,pilgrim_id,amount_dzd,amount_sar,method,status,reference,receipt_number,received_at,created_at,currency,exchange_rate',
  reservations: 'id,reference,package_id,package_name,start_date,end_date,travelers,name,phone,email,status,created_at',
  invoices: 'id,booking_id,invoice_number,total_dzd,total_sar,status,issued_at,created_at,currency,exchange_rate',
  documents: 'id,pilgrim_id,type,status,number,file_name,issue_date,expiry_date,created_at,mime_type,size_bytes,checksum_sha256',
  audit_logs: 'id,action,resource,resource_id,user_email,details,timestamp,created_at,request_id',
  crm_leads: 'id,first_name,last_name,phone,email,source,status,priority,notes,score,next_action_at,assigned_to,customer_id,campaign_id,lost_reason,qualified_at,converted_at,created_at,updated_at',
  crm_customers: 'id,code,pilgrim_id,lead_id,campaign_id,full_name,full_name_ar,customer_type,status,phone,email,wilaya,address,source,owner_id,tags,notes,first_won_at,last_activity_at,created_at,updated_at',
  crm_opportunities: 'id,reference,customer_id,lead_id,package_id,campaign_id,booking_id,title,stage,probability,travelers,expected_value_dzd,expected_close_date,owner_id,won_at,lost_at,lost_reason,notes,created_at,updated_at',
  crm_quotes: 'id,quote_number,opportunity_id,customer_id,package_id,booking_id,status,currency_code,subtotal,discount_amount,total_amount,travelers,valid_until,terms,notes,sent_at,accepted_at,declined_at,declined_reason,created_at,updated_at',
  crm_quote_lines: 'id,quote_id,package_id,description,quantity,unit_price,line_total,sort_order,created_at,updated_at',
  crm_activities: 'id,customer_id,lead_id,opportunity_id,quote_id,activity_type,direction,subject,body,outcome,duration_minutes,occurred_at,created_by,created_at,updated_at',
  crm_followups: 'id,lead_id,customer_id,opportunity_id,title,due_at,priority,status,assigned_to,completed_at,notes,created_at,updated_at',
  crm_campaigns: 'id,code,name,channel,status,start_date,end_date,budget_dzd,spend_dzd,target_segment,notes,created_at,updated_at',
  crm_stage_history: 'id,opportunity_id,from_stage,to_stage,probability,note,changed_by,changed_at,created_at',
  groups: 'id,code,name,name_ar,package_id,departure_date,return_date,leader_name,leader_phone,guide_id,max_capacity,current_capacity,status,readiness_score,readiness_details,created_at,updated_at',
  visas: 'id,pilgrim_id,status,processing_time,expected_processing_time,sla,rejection_reason,missing_documents,application_age,issue_date,expiry_date,created_at,updated_at',
  flights: 'id,flight_number,carrier,departure_airport,arrival_airport,scheduled_departure,scheduled_arrival,actual_departure,actual_arrival,status,terminal,gate,created_at,updated_at',
  hotels: 'id,name,name_ar,city,star_rating,distance_to_haram_m,total_rooms,available_rooms,rate_sar,status,created_at,updated_at',
  room_allocations: 'id,hotel_id,group_id,pilgrim_id,room_number,room_type,check_in,check_out,status,created_at,updated_at',
};

const CRITICAL_TABLES = new Set([
  'bookings','payments','invoices','reservations','pilgrims','visas','documents','room_allocations','transport_assignments',
  'groups','flights','hotels','holy_site_camps','incidents','sos_events','audit_logs','journal_entries','journal_lines','bank_accounts',
  'supplier_bills','credit_notes',
  // CRM. Reads go straight to the RLS-protected tables; writes must not. A stage
  // is a transition with history and an activity behind it, a quote total is
  // derived from its lines, and accepting a quote creates a booking, a payment
  // and a journal entry -- none of which a `.update({stage:'WON'})` would do.
  'crm_leads','crm_customers','crm_opportunities','crm_stage_history',
  'crm_quotes','crm_quote_lines','crm_activities','crm_followups','crm_campaigns'
]);

const TABLE_TO_DOMAIN: Partial<Record<TableName, RealtimeDomain>> = {
  payments: 'finance', invoices: 'invoices', journal_entries: 'accounting',
  bookings: 'bookings', pilgrims: 'pilgrims', groups: 'groups',
  hotels: 'hotels', flights: 'operations', visas: 'visas',
  incidents: 'incidents', sos_events: 'sos_events', reservations: 'reservations',
  alerts: 'alerts',
  crm_opportunities: 'crm', crm_quotes: 'crm', crm_customers: 'crm',
  crm_followups: 'crm', crm_activities: 'crm', crm_leads: 'crm',
};

function tableToDomain(table: TableName): RealtimeDomain | null {
  return TABLE_TO_DOMAIN[table] ?? null;
}

/** Generic typed fetch/mutation hook over a Supabase table, used across admin screens. */
export function useSupabaseData<T = unknown>(options: UseSupabaseDataOptions<T>): UseSupabaseDataReturn<T> {
  const {
    table,
    orderBy,
    filter,
    dateRange,
    search,
    fallbackData = [],
    columns = DEFAULT_COLUMNS[options.table] ?? '*',
    limit = 50,
    offset = 0,
  } = options;
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const requestId = useRef(0);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      if (import.meta.env.DEV && import.meta.env.VITE_FEATURE_DEMO_FIXTURES === 'true') setData(fallbackData);
      setTotalCount(null);
      setLoading(false);
      setError('Supabase is not configured');
      return;
    }
    const currentRequest = ++requestId.current;
    try {
      setLoading(data.length === 0);
      let query = supabase.from(table).select(columns);
      if (filter) query = query.eq(filter.column, filter.value as never);
        if (dateRange?.from) query = query.gte(dateRange.column, dateRange.from + 'T00:00:00');
        if (dateRange?.to) query = query.lte(dateRange.column, dateRange.to + 'T23:59:59');
      if (search?.term?.trim() && search.columns.length > 0) {
        const term = search.term.trim().replace(/[%(),]/g, ' ');
        query = query.or(search.columns.map(column => `${column}.ilike.%${term}%`).join(','));
      }
      if (orderBy) query = query.order(orderBy.column, { ascending: orderBy.ascending !== false });
      const safeLimit = Math.min(Math.max(limit, 1), table === 'audit_logs' ? 200 : 100);
      query = query.range(offset, offset + safeLimit - 1);
      const { data: fetchedData, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      if (currentRequest !== requestId.current) return;
      setData((fetchedData as T[]) || []);
      setTotalCount(null);
      setError(null);
    } catch (err) {
      const safe = normalizeError(err);
      setError(safe.message);
      // Preserve last-known-good data on transient failures; UI can render stale + error + retry.
    } finally {
      setLoading(false);
    }
  }, [table, columns, filter?.column, String(filter?.value ?? ''), dateRange?.column, dateRange?.from, dateRange?.to, search?.term, search?.columns.join('|'), orderBy?.column, orderBy?.ascending, limit, offset]);

  const insert = useCallback(async (row: Partial<T>) => {
    if (!isSupabaseConfigured) return { data: null, error: new Error('Supabase not configured') };
    if (CRITICAL_TABLES.has(table)) return { data: null, error: new Error('Direct insert is disabled for critical table: ' + table + '. Use its domain command/server-side workflow.') };
    const result = await CompatibilityCommands.executeInsert<T>(table, row as Record<string, unknown>, columns);
    if (!result.error) await fetchData();
    return result;
  }, [table, columns, fetchData]);
  
  const update = useCallback(async (id: string, patch: Partial<T>) => {
    if (!isSupabaseConfigured) return { data: null, error: new Error('Supabase not configured') };
    if (CRITICAL_TABLES.has(table)) return { data: null, error: new Error('Direct update is disabled for critical table: ' + table + '. Use its domain command/server-side workflow.') };
    const result = await CompatibilityCommands.executeUpdate<T>(table, id, patch as Record<string, unknown>, columns);
    if (!result.error) await fetchData();
    return result;
  }, [table, columns, fetchData]);
  
  const remove = useCallback(async (id: string) => {
    if (!isSupabaseConfigured) return { error: new Error('Supabase not configured') };
    if (CRITICAL_TABLES.has(table)) return { error: new Error('Direct delete is disabled for critical table: ' + table + '. Use its domain command/server-side workflow.') };
    const result = await CompatibilityCommands.executeDelete(table, id);
    if (!result.error) await fetchData();
    return result;
  }, [table, fetchData]);

  useEffect(() => {
    void fetchData();
    if (!isSupabaseConfigured) return;
    const domain = tableToDomain(table);
    if (!domain) return;
    return realtimeManager.subscribe(domain, () => void fetchData());
  }, [table, filter?.column, String(filter?.value ?? ''), dateRange?.column, dateRange?.from, dateRange?.to, search?.term, search?.columns.join('|'), orderBy?.column, orderBy?.ascending, fetchData]);

  const hasMore = totalCount !== null ? offset + data.length < totalCount : data.length >= Math.min(Math.max(limit, 1), table === 'audit_logs' ? 200 : 100);
  return { data, loading, error, refetch: fetchData, insert, update, remove, totalCount, hasMore, setData };
}
