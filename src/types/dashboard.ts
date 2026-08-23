export interface DashboardFilters {
  dateFrom: string;
  dateTo: string;
  branchId: string;
  packageId: string;
}

export type DashboardRealtimeStatus = 'LIVE' | 'SYNCING' | 'DEGRADED' | 'OFFLINE' | 'CONNECTING';

export interface DashboardSnapshot {
  generated_at: string;
  scope: { agency_id: string; branch_id: string | null; package_id: string | null; date_from: string | null; date_to: string | null };
  executive: {
    pilgrims: number; new_pilgrims: number; bookings_total: number; bookings_confirmed: number; booking_confirmation_rate: number;
    collected_dzd: number; collected_sar: number; revenue_dzd: number; revenue_sar: number; expenses_dzd: number; expenses_sar: number;
    net_profit_dzd: number; net_profit_sar: number; outstanding_dzd: number; outstanding_sar: number; outstanding_period_dzd: number; outstanding_period_sar: number;
    at_risk_receivables_dzd: number; at_risk_receivables_sar: number; visa_clearance_rate: number; group_readiness: number;
    group_readiness_unweighted?: number; operational_risk_score?: number;
  };
  operations: { flights_delayed: number; incidents_active: number; incidents_critical: number; alerts_pending: number; actions_pending: number; groups_total: number; groups_active: number; groups_low_readiness?: number; visa_total: number; visa_cleared: number; documents_required: number; documents_validated: number; document_completion_rate: number };
  sales: { leads_total: number; leads_converted: number; conversion_rate: number };
  data_health: { duplicate_pilgrims: number; missing_passport: number; missing_phone: number; bookings_without_pilgrim: number; payments_without_booking: number; expired_documents: number; groups_without_guide: number; groups_without_transport: number; score: number };
  comparison: { period_available: boolean; previous_period_from: string | null; previous_period_to: string | null; revenue_dzd: number | null; collected_dzd: number | null; net_profit_dzd: number | null; new_pilgrims: number | null; bookings: number | null };
  targets: { revenue_dzd: number | null; collection_dzd: number | null; profit_dzd: number | null; pilgrims: number | null };
  projection?: { available: boolean; days_elapsed: number | null; days_total: number | null; projected_revenue_dzd: number | null; projected_collection_dzd: number | null; projected_profit_dzd: number | null };
  ar_aging: { current_dzd: number; current_sar: number; '1_7_dzd': number; '1_7_sar': number; '8_30_dzd': number; '8_30_sar': number; '31_60_dzd': number; '31_60_sar': number; '60_plus_dzd': number; '60_plus_sar': number };
  accounting_trust: { unattributed_revenue_dzd: number; unattributed_revenue_sar: number; unattributed_expenses_dzd: number; unattributed_expenses_sar: number };
  package_profitability: Array<{ id: string; code: string | null; name: string; revenue_dzd: number; expense_dzd: number; bookings: number; collected_dzd: number }>;
  branch_performance: Array<{ id: string; code: string; name: string; revenue_dzd: number; expense_dzd: number; bookings: number; pilgrims: number }>;
  groups_at_risk: Array<{ code: string; readiness_score: number; current_capacity: number; max_capacity: number; readiness_details: Record<string, unknown> }>;
  alerts: Array<{ id: string; severity: string; type: string; message: string; acknowledged: boolean; created_at: string }>;
  activity: Array<{ id: string; action: string; resource: string | null; resource_id: string | null; user_email: string | null; details: Record<string, unknown>; created_at: string }>;
  packages: Array<{ id: string; code: string | null; name: string; name_ar: string | null; start_date: string | null; end_date: string | null; status: string }>;
  branches: Array<{ id: string; name: string; code: string }>;
  upcoming: { flights: number; groups: number; payment_deadlines: number; overdue_payments: number };
  /** Optional agency health scores from healthScores engine — labeled LIVE */
  health_scores?: Array<{
    id: string;
    nameAr: string;
    nameFr: string;
    nameEn: string;
    score: number | null;
    level: 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';
  }>;
}

export interface DashboardAnalyticsSnapshot {
  generated_at: string;
  scope: DashboardSnapshot['scope'];
  core: { revenue_dzd: number; revenue_sar: number; collected_dzd: number; collected_sar: number; pilgrims: number; visa_clearance_rate: number; booking_confirmation_rate: number; group_readiness: number };
  series: {
    cash_collections: Array<{ date: string; amount: number }>;
    daily_registrations: Array<{ date: string; count: number }>;
    package_distribution: Array<{ package_id: string; name: string; count: number }>;
    payment_methods: Array<{ method: string; count: number }>;
    age_distribution: Array<{ range: string; count: number }>;
    visa_status: Array<{ status: string; count: number }>;
    booking_status: Array<{ status: string; count: number }>;
  };
}
