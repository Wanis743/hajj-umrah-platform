/**
 * CRM contract. Mirrors supabase/migrations/20260830120000_crm_vertical_slice.sql
 * exactly: every union below is a CHECK constraint in that file, and every
 * nullable field is a column the migration leaves nullable. When the migration
 * changes, this file changes with it -- a wider type here would let the UI send
 * a value the database will reject at runtime.
 */

export type CrmLeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'CONVERTED' | 'LOST';
export type CrmLeadPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type CrmFollowupPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type CrmCustomerType = 'INDIVIDUAL' | 'FAMILY' | 'CORPORATE';
export type CrmCustomerStatus = 'ACTIVE' | 'DORMANT' | 'BLOCKED';
export type CrmStage = 'NEW' | 'QUALIFYING' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST';
export type CrmQuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
export type CrmCurrency = 'DZD' | 'SAR';
export type CrmCampaignStatus = 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type CrmCampaignChannel =
  | 'FACEBOOK' | 'INSTAGRAM' | 'GOOGLE' | 'WHATSAPP' | 'SMS' | 'EMAIL'
  | 'REFERRAL' | 'WALK_IN' | 'EVENT' | 'MOSQUE' | 'OTHER';
export type CrmActivityType = 'CALL' | 'EMAIL' | 'MEETING' | 'WHATSAPP' | 'SMS' | 'VISIT' | 'NOTE' | 'SYSTEM';
export type CrmActivityDirection = 'INBOUND' | 'OUTBOUND';
export type CrmActivityOutcome =
  | 'CONNECTED' | 'NO_ANSWER' | 'INTERESTED' | 'NOT_INTERESTED' | 'FOLLOW_UP' | 'CLOSED';
export type CrmFollowupStatus = 'OPEN' | 'DONE' | 'CANCELLED';

/** Stage order as the pipeline board renders it; matches the sort_order in get_crm_pipeline_summary. */
export const CRM_STAGES: readonly CrmStage[] = ['NEW', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
/** Every transition private.move_crm_opportunity_stage accepts, copied from its
 *  CASE expression. Mirrored so the UI can grey out an illegal move instead of
 *  round-tripping to a raised exception -- the server still decides.
 *
 *  WON appears in no list on purpose. The stage RPC rejects it outright: an
 *  opportunity is won by accepting its quote, which is the path that creates the
 *  booking, the payment and the journal entry. A "mark as won" button would
 *  produce a won opportunity with no money behind it. */
export const CRM_STAGE_TRANSITIONS: Readonly<Record<CrmStage, readonly CrmStage[]>> = {
  NEW: ['QUALIFYING', 'PROPOSAL', 'LOST'],
  QUALIFYING: ['PROPOSAL', 'LOST'],
  PROPOSAL: ['NEGOTIATION', 'QUALIFYING', 'LOST'],
  NEGOTIATION: ['PROPOSAL', 'LOST'],
  WON: [],
  LOST: ['QUALIFYING'],
};
/** Probability the server writes for each stage; shown next to the pipeline so
 *  the weighted forecast is legible. Kept in step with the same CASE. */
export const CRM_STAGE_PROBABILITY: Readonly<Record<CrmStage, number | null>> = {
  NEW: 10, QUALIFYING: 25, PROPOSAL: 50, NEGOTIATION: 75, WON: null, LOST: 0,
};

/** Columns every CRM table carries: identity plus the scope the server stamps. */
interface CrmScopedRow {
  id: string;
  agency_id: string;
  branch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmLeadRow extends Omit<CrmScopedRow, 'agency_id'> {
  agency_id?: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: CrmLeadStatus;
  priority: CrmLeadPriority | null;
  notes: string | null;
  score: number | null;
  next_action_at: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  campaign_id: string | null;
  lost_reason: string | null;
  qualified_at: string | null;
  converted_at: string | null;
}

export interface CrmCampaignRow extends CrmScopedRow {
  code: string;
  name: string;
  channel: CrmCampaignChannel;
  status: CrmCampaignStatus;
  start_date: string | null;
  end_date: string | null;
  budget_dzd: number;
  spend_dzd: number;
  target_segment: string | null;
  notes: string | null;
}

export interface CrmCustomerRow extends CrmScopedRow {
  code: string;
  pilgrim_id: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  full_name: string;
  full_name_ar: string | null;
  customer_type: CrmCustomerType;
  status: CrmCustomerStatus;
  phone: string | null;
  email: string | null;
  wilaya: string | null;
  address: string | null;
  source: string | null;
  owner_id: string | null;
  tags: string[];
  notes: string | null;
  first_won_at: string | null;
  last_activity_at: string | null;
}

export interface CrmOpportunityRow extends CrmScopedRow {
  reference: string;
  customer_id: string;
  lead_id: string | null;
  package_id: string | null;
  campaign_id: string | null;
  booking_id: string | null;
  title: string;
  stage: CrmStage;
  probability: number;
  travelers: number;
  expected_value_dzd: number;
  expected_close_date: string | null;
  owner_id: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  notes: string | null;
}

export interface CrmStageHistoryRow {
  id: string;
  agency_id: string;
  branch_id: string | null;
  opportunity_id: string;
  from_stage: CrmStage | null;
  to_stage: CrmStage;
  probability: number | null;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
  created_at: string;
}

export interface CrmQuoteRow extends CrmScopedRow {
  quote_number: string;
  opportunity_id: string;
  customer_id: string;
  package_id: string | null;
  booking_id: string | null;
  status: CrmQuoteStatus;
  currency_code: CrmCurrency;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  travelers: number;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  declined_reason: string | null;
}

export interface CrmQuoteLineRow extends CrmScopedRow {
  quote_id: string;
  package_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  /** GENERATED ALWAYS in the database. Never send it. */
  line_total: number;
  sort_order: number;
}

export interface CrmActivityRow extends CrmScopedRow {
  customer_id: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  quote_id: string | null;
  activity_type: CrmActivityType;
  direction: CrmActivityDirection | null;
  subject: string;
  body: string | null;
  outcome: CrmActivityOutcome | null;
  duration_minutes: number | null;
  occurred_at: string;
  created_by: string | null;
}

export interface CrmFollowupRow extends CrmScopedRow {
  lead_id: string | null;
  customer_id: string | null;
  opportunity_id: string | null;
  title: string;
  due_at: string;
  priority: CrmFollowupPriority;
  status: CrmFollowupStatus;
  assigned_to: string | null;
  completed_at: string | null;
  notes: string | null;
}

/* ---------------------------------------------------------------------------
 * Lifecycle command payloads. Each one is the exact jsonb_build_object the
 * matching RPC returns.
 * ------------------------------------------------------------------------- */

export interface CrmConvertLeadResult {
  lead_id: string;
  customer_id: string;
  opportunity_id: string;
  expected_value_dzd: number;
}
export interface CrmStageMoveResult {
  id: string;
  from_stage: CrmStage;
  to_stage: CrmStage;
  probability: number;
}
export interface CrmQuoteSentResult {
  id: string;
  quote_number: string;
  status: 'SENT';
  valid_until: string;
  total_amount: number;
  currency_code: CrmCurrency;
}
export interface CrmQuoteDeclinedResult {
  id: string;
  status: 'DECLINED';
  declined_reason: string;
}
/** The money path: one call produces a pilgrim, a booking, a payment and a
 *  balanced journal entry. Every id it returns is a row that now exists. */
export interface CrmQuoteAcceptedResult {
  quote_id: string;
  quote_number: string;
  opportunity_id: string;
  customer_id: string;
  pilgrim_id: string;
  booking_id: string;
  booking_reference: string;
  payment_id: string | null;
  journal_entry_id: string | null;
  travelers: number;
  currency_code: CrmCurrency;
  total_amount: number;
}
export interface CrmFollowupCompletedResult { id: string; status: 'DONE' }

/* ---------------------------------------------------------------------------
 * Analytics payloads. Every ratio is `number | null`: the SQL returns null when
 * the denominator is zero, and rendering an undefined rate as 0% would be a
 * fabricated number.
 * ------------------------------------------------------------------------- */

export interface CrmPipelineStage {
  stage: CrmStage;
  sort_order: number;
  opportunity_count: number;
  value_dzd: number;
  weighted_dzd: number;
  travelers: number;
}
export interface CrmForecastMonth {
  month: string;
  opportunity_count: number;
  pipeline_dzd: number;
  weighted_dzd: number;
  won_dzd: number;
  lost_dzd: number;
}
export interface CrmFunnelStage { key: string; label: string; count: number }
export interface CrmFunnel {
  from: string;
  to: string;
  stages: CrmFunnelStage[];
  lost: { leads: number; opportunities: number };
  won_value_dzd: number;
  rates: {
    contact_rate: number | null;
    qualification_rate: number | null;
    lead_conversion_rate: number | null;
    quote_coverage_rate: number | null;
    win_rate: number | null;
  };
}
export interface CrmCustomer360Totals {
  bookings: number;
  travelers: number;
  booked_dzd: number;
  booked_sar: number;
  paid_dzd: number;
  paid_sar: number;
  outstanding_dzd: number;
  outstanding_sar: number;
}
export interface CrmCustomer360 {
  customer: CrmCustomerRow;
  lead: CrmLeadRow | null;
  campaign: { id: string; code: string; name: string; channel: CrmCampaignChannel } | null;
  opportunities: CrmOpportunityRow[];
  quotes: CrmQuoteRow[];
  activities: CrmActivityRow[];
  followups: CrmFollowupRow[];
  bookings: CrmLinkedBooking[];
  payments: CrmLinkedPayment[];
  totals: CrmCustomer360Totals;
  open_pipeline_dzd: number;
}
/** Only the booking columns Customer 360 renders. `to_jsonb(b)` returns the whole
 *  row; declaring the whole row here would duplicate BookingRow and let the two
 *  drift, so this is the read slice. */
export interface CrmLinkedBooking {
  id: string;
  reference: string | null;
  status: string | null;
  travelers: number | null;
  total_dzd: number | null;
  total_sar: number | null;
  paid_dzd: number | null;
  paid_sar: number | null;
  group_id: string | null;
  package_id: string | null;
  created_at: string | null;
}
export interface CrmLinkedPayment {
  id: string;
  booking_id: string | null;
  amount_dzd: number | null;
  amount_sar: number | null;
  method: string | null;
  status: string | null;
  reference: string | null;
  received_at: string | null;
}

export interface CrmCustomerProfitabilityRow {
  customer_id: string;
  code: string;
  full_name: string;
  customer_type: CrmCustomerType;
  status: CrmCustomerStatus;
  phone: string | null;
  first_won_at: string | null;
  bookings: number;
  travelers: number;
  booked_dzd: number;
  collected_dzd: number;
  outstanding_dzd: number;
  /** null when the customer's groups carry no POSTED expense lines. An unknown
   *  cost must not render as a 100% margin, so cost, margin and margin_pct go
   *  null together. */
  cost_dzd: number | null;
  margin_dzd: number | null;
  margin_pct: number | null;
  /** Share of booked value that had ledger cost behind it. Read the margin above
   *  as provisional whenever this is below 100. */
  cost_coverage_pct: number | null;
}
export interface CrmCustomerProfitability {
  from: string;
  to: string;
  limit: number;
  cost_basis: 'GROUP_EXPENSE_PER_TRAVELLER';
  cost_currency: 'DZD';
  customers: CrmCustomerProfitabilityRow[];
}

export interface CrmCampaignRoiRow {
  campaign_id: string;
  code: string;
  name: string;
  channel: CrmCampaignChannel;
  status: CrmCampaignStatus;
  start_date: string | null;
  end_date: string | null;
  budget_dzd: number;
  spend_dzd: number;
  leads: number;
  converted_leads: number;
  opportunities: number;
  won: number;
  won_pipeline_dzd: number;
  bookings: number;
  booked_dzd: number;
  collected_dzd: number;
  cost_per_lead_dzd: number | null;
  cost_per_won_dzd: number | null;
  conversion_rate: number | null;
  roi_pct: number | null;
  budget_used_pct: number | null;
}
export interface CrmCampaignRoi {
  from: string;
  to: string;
  revenue_basis: 'COLLECTED_BOOKING_PAYMENTS_DZD';
  campaigns: CrmCampaignRoiRow[];
}

export interface CrmDashboardCounters {
  open_leads: number;
  customers: number;
  open_opportunities: number;
  quotes_awaiting_reply: number;
  overdue_followups: number;
  due_today_followups: number;
  active_campaigns: number;
}
export interface CrmDashboard {
  window_days: number;
  from: string;
  to: string;
  pipeline: CrmPipelineStage[];
  funnel: CrmFunnel;
  forecast: CrmForecastMonth[];
  counters: CrmDashboardCounters;
  due_followups: CrmFollowupRow[];
  recent_activities: CrmActivityRow[];
  top_open_opportunities: CrmOpportunityRow[];
}
