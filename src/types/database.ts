export type JsonValue = string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
import type {
  CrmActivityRow, CrmCampaignRoi, CrmCampaignRow, CrmCustomer360, CrmCustomerProfitability,
  CrmCustomerRow, CrmDashboard, CrmFollowupRow, CrmForecastMonth, CrmFunnel, CrmLeadRow,
  CrmOpportunityRow, CrmPipelineStage, CrmQuoteLineRow, CrmQuoteRow, CrmStageHistoryRow,
  CrmConvertLeadResult, CrmStageMoveResult, CrmQuoteSentResult, CrmQuoteDeclinedResult,
  CrmQuoteAcceptedResult, CrmFollowupCompletedResult,
} from '@/types/crm';
/** Central TypeScript contract for Supabase tables.
 * Keep this file generated/updated from the canonical migrations and never pass
 * untyped string table names into the domain layer.
 */

export interface FiscalPeriodRow extends BaseRow { label: string; start_date: string; end_date: string; status: string; }
export interface BankStatementRow extends BaseRow { statement_date: string; start_balance: number; end_balance: number; status: string; }
export interface BankTransactionRow extends BaseRow { statement_id: string; transaction_date: string; amount: number; description?: string; reference?: string; status: string; matched_journal_line_id?: string; }
export interface JournalLineRow extends BaseRow { journal_entry_id: string; account_id: string; debit: number; credit: number; }

export type TableName = 'import_batch_rows' | 'financial_models' | 'model_scenarios' | 'model_assumptions' | 'model_projections' | 'fiscal_budgets' | 'budget_lines' | 'pilgrims' | 'bookings' | 'payments' | 'reservations' | 'invoices'
  | 'documents' | 'audit_logs' | 'crm_leads' | 'payment_reversals' | 'groups' | 'visas'
  | 'flights' | 'hotels' | 'room_allocations' | 'incidents' | 'sos_events'
  | 'transport_vehicles' | 'transport_assignments' | 'packages' | 'guides'
  | 'holy_site_camps' | 'suppliers' | 'supplier_bills' | 'journal_entries'
  | 'journal_lines' | 'actions' | 'alerts' | 'contracts' | 'mutawwif_guides'
  | 'staff_profiles' | 'observability_events' | 'settings'
  | 'external_operations' | 'external_operation_evidence' | 'external_references' | 'chart_of_accounts' | 'fiscal_periods' | 'bank_statements' | 'bank_transactions'
  | 'crm_campaigns' | 'crm_customers' | 'crm_opportunities' | 'crm_stage_history'
  | 'crm_quotes' | 'crm_quote_lines' | 'crm_activities' | 'crm_followups';

export type BaseRow = { id: string; [key: string]: unknown };

export interface PilgrimRow extends BaseRow {
  reference?: string | null; full_name?: string | null; full_name_ar?: string | null;
  passport_number?: string | null; phone?: string | null; email?: string | null; status?: string | null;
  visa_status?: string | null; payment_status?: string | null; package_id?: string | null;
  group_id?: string | null; created_at?: string | null; updated_at?: string | null;
}
export interface BookingRow extends BaseRow {
  reference?: string | null; pilgrim_id?: string | null; package_id?: string | null;
  group_id?: string | null; status?: string | null; travelers?: number | null;
  total_dzd?: number | null; total_sar?: number | null; paid_dzd?: number | null;
  paid_sar?: number | null; start_date?: string | null; end_date?: string | null;
  created_at?: string | null; confirmed_at?: string | null; version?: number | null;
}
export interface PaymentRow extends BaseRow {
  booking_id?: string | null; pilgrim_id?: string | null; amount_dzd?: number | null;
  amount_sar?: number | null; method?: string | null; status?: string | null;
  reference?: string | null; receipt_number?: string | null; received_at?: string | null;
  created_at?: string | null; currency?: string | null; exchange_rate?: number | null;
}
export interface InvoiceRow extends BaseRow {
  booking_id?: string | null; invoice_number?: string | null; total_dzd?: number | null;
  total_sar?: number | null; status?: string | null; issued_at?: string | null;
  due_date?: string | null; created_at?: string | null; currency?: string | null;
  exchange_rate?: number | null;
}
export interface DocumentRow extends BaseRow {
  pilgrim_id?: string | null; type?: string | null; status?: string | null;
  number?: string | null; file_name?: string | null; issue_date?: string | null;
  expiry_date?: string | null; created_at?: string | null; mime_type?: string | null;
  size_bytes?: number | null; checksum_sha256?: string | null;
}
export interface GroupRow extends BaseRow {
  code?: string | null; name?: string | null; name_ar?: string | null; package_id?: string | null;
  departure_date?: string | null; return_date?: string | null; guide_id?: string | null;
  max_capacity?: number | null; current_capacity?: number | null; status?: string | null;
  readiness_score?: number | null; readiness_details?: JsonObject; created_at?: string | null; updated_at?: string | null;
}
export interface VisaRow extends BaseRow {
  pilgrim_id?: string | null; status?: string | null; passport_number?: string | null; processing_time?: number | null;
  expected_processing_time?: number | null; sla?: number | null; rejection_reason?: string | null;
  missing_documents?: JsonValue; application_age?: number | null; issue_date?: string | null;
  expiry_date?: string | null; created_at?: string | null; updated_at?: string | null;
}
export interface FlightRow extends BaseRow {
  flight_number?: string | null; carrier?: string | null; departure_airport?: string | null;
  arrival_airport?: string | null; scheduled_departure?: string | null; scheduled_arrival?: string | null;
  actual_departure?: string | null; actual_arrival?: string | null; status?: string | null;
  terminal?: string | null; gate?: string | null; created_at?: string | null; updated_at?: string | null;
}
export interface TransportVehicleRow extends BaseRow {
  bus_number?: string | null; company?: string | null; driver_name?: string | null;
  driver_phone?: string | null; capacity?: number | null; route?: string | null;
  status?: string | null; created_at?: string | null; updated_at?: string | null;
}
export interface TransportAssignmentRow extends BaseRow {
  vehicle_id?: string | null; group_id?: string | null; route?: string | null;
  departure?: string | null; destination?: string | null; departure_time?: string | null;
  arrival_time?: string | null; status?: string | null; created_at?: string | null; updated_at?: string | null;
}
export type GenericRow = BaseRow;

export interface FiscalBudgetRow extends BaseRow { agency_id: string; period_id: string; name: string; status: string; created_at: string; updated_at: string; locked_at: string | null; }
export interface BudgetLineRow extends BaseRow { budget_id: string; account_id: string; amount_dzd: number; amount_sar: number; created_at: string; }


export interface FinancialModelRow extends BaseRow { agency_id: string; package_id: string | null; name: string; status: string; created_at: string; updated_at: string; }
export interface ModelScenarioRow extends BaseRow { model_id: string; name: string; description: string | null; is_baseline: boolean; created_at: string; }
export interface ModelAssumptionRow extends BaseRow { scenario_id: string; variable_key: string; variable_value: number; created_at: string; }
export interface ModelProjectionRow extends BaseRow { scenario_id: string; projected_revenue: number; projected_cost: number; projected_margin: number; projected_margin_percent: number; calculated_at: string; }


export interface AccountingPeriodRow extends BaseRow {
  period_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}


export interface ChartOfAccountRow extends BaseRow {
  code?: string | null;
  name?: string | null;
  account_type?: string | null;
  currency?: string | null;
  balance?: number | null;
  parent_id?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}


export interface HotelRow extends BaseRow {
  hotelName?: string | null;
  city?: string | null;
  starRating?: number | null;
  distance_to_haram_m?: number | null;
  status?: string | null;
  manager_contact?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SupplierRow extends BaseRow {
  name?: string | null;
  category?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  address?: string | null;
  tax_id?: string | null;
  status?: string | null;
  rating?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface HolySiteCampRow extends BaseRow {
  site?: 'MINA' | 'ARAFAT' | 'MUZDALIFAH' | null;
  camp_number?: string | null;
  capacity?: number | null;
  occupied?: number | null;
  manager_name?: string | null;
  manager_phone?: string | null;
  status?: 'ACTIVE' | 'STAND_BY' | 'CLOSED' | null;
  created_at?: string | null;
  updated_at?: string | null;
}


export interface SettingsRow {
  id: string | number;
  next_departure_date?: string | null;
  [key: string]: JsonValue;
}

export interface ExternalOperationRow extends BaseRow {
  agency_id: string;
  branch_uuid?: string | null;
  /** Note: 'NUSUK' and other providers here are manual reference labels only. The system does not connect to these platforms automatically. */
  provider: 'NUSUK' | 'AIRLINE' | 'HOTEL' | 'TRANSPORT' | 'INSURANCE' | 'BANK' | 'GOVT' | 'OTHER';
  operation_type: string;
  pilgrim_id?: string | null;
  booking_id?: string | null;
  group_id?: string | null;
  internal_status: 'NOT_STARTED' | 'READY' | 'SUBMITTED' | 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
  external_reference?: string | null;
  external_status?: string | null;
  evidence_status: 'PENDING' | 'ATTACHED' | 'VERIFIED' | 'REJECTED';
  evidence_notes?: string | null;
  sla_hours?: number | null;
  submitted_at?: string | null;
  sla_deadline?: string | null;
  last_checked_at?: string | null;
  completed_at?: string | null;
  responsible_staff_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  // joined fields (optional)
  pilgrim?: { full_name?: string | null; full_name_ar?: string | null } | null;
}

export interface ImportBatchRowInsert {
  batch_id: string;
  row_index: number;
  raw_data: JsonObject;
  normalized_data: JsonObject;
  validation_status: 'VALID' | 'INVALID' | 'SKIPPED';
  validation_errors: string[];
  data_source: string;
  /** Matches BaseRow's index signature so Partial<Row> accepts this shape. */
  [key: string]: unknown;
}

export interface ImportBatchRowRow extends BaseRow {
  batch_id: string;
  row_index: number;
  raw_data: JsonObject;
  normalized_data: JsonObject;
  validation_status: 'VALID' | 'INVALID' | 'SKIPPED';
  validation_errors: string[];
  data_source: string;
}

export interface ExternalReferenceRow extends BaseRow {
  agency_id: string;
  pilgrim_id?: string | null;
  booking_id?: string | null;
  /** Note: 'NUSUK_ID' is an internal business field. No automated synchronization exists. */
  ref_type: 'NUSUK_ID' | 'VISA_NO' | 'AIRLINE_PNR' | 'HOTEL_CONF' | 'INSURANCE_POLICY' | 'TRANSPORT_CONF' | 'OTHER';
  ref_value: string;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface ExternalOperationEvidenceRow extends BaseRow {
  operation_id: string;
  storage_path: string;
  file_name: string;
  file_type?: string | null;
  description?: string | null;
  uploaded_by?: string | null;
  uploaded_at: string;
  verified_by?: string | null;
  verified_at?: string | null;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface BiReportRow {
  id: string;
  agency_id: string;
  title: string;
  description: string | null;
  layout: unknown;
  owner: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** supabase-js requires every Row/Insert/Update in the schema contract to satisfy
 *  Record<string, unknown>, and a TypeScript interface only satisfies that when it
 *  carries an index signature. Every row interface declared above extends BaseRow
 *  for exactly that reason. The CRM row types live in @/types/crm, where an index
 *  signature would defeat their purpose -- a misspelled column must not resolve to
 *  `unknown` -- so they are widened here and only here. Without this the whole
 *  Database type silently fails the client's GenericSchema constraint and every
 *  table in the app degrades to `never`. */
type Indexed<T> = T & BaseRow;

type RowMap = { import_batch_rows: ImportBatchRowRow; financial_models: FinancialModelRow; model_scenarios: ModelScenarioRow; model_assumptions: ModelAssumptionRow; model_projections: ModelProjectionRow; fiscal_budgets: FiscalBudgetRow; budget_lines: BudgetLineRow;
  pilgrims: PilgrimRow; bookings: BookingRow; payments: PaymentRow; invoices: InvoiceRow;
  documents: DocumentRow; groups: GroupRow; visas: VisaRow;
  reservations: GenericRow; audit_logs: GenericRow; crm_leads: Indexed<CrmLeadRow>;
  flights: FlightRow; hotels: HotelRow; room_allocations: GenericRow;
  incidents: GenericRow; sos_events: GenericRow; transport_vehicles: TransportVehicleRow;
  transport_assignments: TransportAssignmentRow; payment_reversals: GenericRow; packages: GenericRow; guides: GenericRow;

  holy_site_camps: HolySiteCampRow; suppliers: SupplierRow; supplier_bills: GenericRow;
  chart_of_accounts: ChartOfAccountRow;
  accounting_periods: AccountingPeriodRow;
  journal_entries: GenericRow; journal_lines: JournalLineRow;
  actions: GenericRow; alerts: GenericRow; contracts: GenericRow; mutawwif_guides: GenericRow;
  staff_profiles: GenericRow; observability_events: GenericRow; settings: SettingsRow;
  external_operations: ExternalOperationRow;
  external_operation_evidence: ExternalOperationEvidenceRow;
  external_references: ExternalReferenceRow;
  fiscal_periods: FiscalPeriodRow;
  bank_statements: BankStatementRow;
  bank_transactions: BankTransactionRow;
  crm_campaigns: Indexed<CrmCampaignRow>;
  crm_customers: Indexed<CrmCustomerRow>;
  crm_opportunities: Indexed<CrmOpportunityRow>;
  crm_stage_history: Indexed<CrmStageHistoryRow>;
  crm_quotes: Indexed<CrmQuoteRow>;
  crm_quote_lines: Indexed<CrmQuoteLineRow>;
  crm_activities: Indexed<CrmActivityRow>;
  crm_followups: Indexed<CrmFollowupRow>;
};

/** JSON returned by domain command RPCs. Loose types are forbidden in this protected layer. */
export type RpcJson = string | number | boolean | null | RpcJson[] | { [key: string]: RpcJson };

export interface CommandAck { id: string; [key: string]: RpcJson | undefined }

/** Explicitly typed contracts for the business-critical RPCs used by the UI. */
export interface KnownFunctions {
  advance_visa_stage_command: {
    Args: { p_visa_id: string; p_to_status: string };
    Returns: { id: string; status: string; pilgrim_id: string | null; from_status: string };
  };
  retire_visa_command: {
    Args: { p_visa_id: string };
    Returns: { id: string; pilgrim_id: string | null };
  };
  transition_visa_status: {
    Args: { p_pilgrim_id: string; p_to_status: string };
    Returns: { pilgrim_id: string; visa_status: string };
  };
  update_visa_status: {
    Args: { p_pilgrim_id: string; p_status: string };
    Returns: RpcJson;
  };
  create_transport_assignment_command: { Args: { p_payload: RpcJson }; Returns: CommandAck };
  update_transport_assignment_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CommandAck };
  delete_transport_assignment_command: { Args: { p_id: string }; Returns: CommandAck };
  create_flight_command: { Args: { p_payload: RpcJson }; Returns: CommandAck };
  update_flight_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CommandAck };
  delete_flight_command: { Args: { p_id: string }; Returns: CommandAck };
  get_recent_journal_entries: { Args: { limit_rows?: number }; Returns: unknown[] };
  approve_journal_entry: { Args: { p_journal_id: string; p_correlation_id?: string; p_reason?: string }; Returns: unknown };
  receive_invoice_payment: { Args: Record<string, unknown>; Returns: unknown };
  get_group_profitability: {
    Args: { p_group_id: string };
    Returns: {
      total_revenue_dzd: number; total_revenue_sar: number;
      total_cost_dzd: number; total_cost_sar: number;
      /** null when there is no POSTED revenue to divide by. Undefined, not zero. */
      margin_dzd: number; margin_sar: number; margin_percentage: number | null;
    }[];
  };
  auto_reconcile_bank_statement: { Args: { p_statement_id: string }; Returns: unknown };
  reconcile_bank_statement: { Args: { p_reconciliation_id: string }; Returns: unknown };
  close_fiscal_period: { Args: { p_period_id: string }; Returns: unknown };
  log_bi_audit: { Args: Record<string, unknown>; Returns: unknown };

  /* CRM -- 20260830120000_crm_vertical_slice.sql. Lifecycle first: these are the
   * only five calls that move a lead through to money. */
  convert_crm_lead_command: {
    Args: {
      p_lead_id: string; p_package_id?: string | null; p_travelers?: number;
      p_expected_value_dzd?: number | null; p_expected_close_date?: string | null;
      p_title?: string | null;
    };
    Returns: CrmConvertLeadResult;
  };
  transition_crm_opportunity_stage: {
    Args: { p_opportunity_id: string; p_to_stage: string; p_note?: string | null; p_lost_reason?: string | null };
    Returns: CrmStageMoveResult;
  };
  send_crm_quote_command: {
    Args: { p_quote_id: string; p_valid_days?: number };
    Returns: CrmQuoteSentResult;
  };
  decline_crm_quote_command: {
    Args: { p_quote_id: string; p_reason: string };
    Returns: CrmQuoteDeclinedResult;
  };
  accept_crm_quote_command: {
    Args: {
      p_quote_id: string; p_payment_amount_dzd?: number; p_payment_amount_sar?: number;
      p_payment_method?: string; p_group_id?: string | null; p_passport_number?: string | null;
      p_notes?: string | null;
    };
    Returns: CrmQuoteAcceptedResult;
  };
  set_crm_customer_tags_command: { Args: { p_id: string; p_tags: string[] }; Returns: CrmCustomerRow };
  complete_crm_followup_command: { Args: { p_id: string; p_note?: string | null }; Returns: CrmFollowupCompletedResult };

  create_crm_customer_command: { Args: { p_payload: RpcJson }; Returns: CrmCustomerRow };
  update_crm_customer_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmCustomerRow };
  delete_crm_customer_command: { Args: { p_id: string }; Returns: CommandAck };
  create_crm_opportunity_command: { Args: { p_payload: RpcJson }; Returns: CrmOpportunityRow };
  update_crm_opportunity_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmOpportunityRow };
  delete_crm_opportunity_command: { Args: { p_id: string }; Returns: CommandAck };
  create_crm_quote_command: { Args: { p_payload: RpcJson }; Returns: CrmQuoteRow };
  update_crm_quote_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmQuoteRow };
  delete_crm_quote_command: { Args: { p_id: string }; Returns: CommandAck };
  create_crm_quote_line_command: { Args: { p_payload: RpcJson }; Returns: CrmQuoteLineRow };
  update_crm_quote_line_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmQuoteLineRow };
  delete_crm_quote_line_command: { Args: { p_id: string }; Returns: CommandAck };
  create_crm_activity_command: { Args: { p_payload: RpcJson }; Returns: CrmActivityRow };
  update_crm_activity_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmActivityRow };
  delete_crm_activity_command: { Args: { p_id: string }; Returns: CommandAck };
  create_crm_followup_command: { Args: { p_payload: RpcJson }; Returns: CrmFollowupRow };
  update_crm_followup_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmFollowupRow };
  delete_crm_followup_command: { Args: { p_id: string }; Returns: CommandAck };
  create_crm_campaign_command: { Args: { p_payload: RpcJson }; Returns: CrmCampaignRow };
  update_crm_campaign_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmCampaignRow };
  delete_crm_campaign_command: { Args: { p_id: string }; Returns: CommandAck };
  create_crm_lead_command: { Args: { p_payload: RpcJson }; Returns: CrmLeadRow };
  update_crm_lead_command: { Args: { p_id: string; p_payload: RpcJson }; Returns: CrmLeadRow };
  delete_crm_lead_command: { Args: { p_id: string }; Returns: CommandAck };

  get_crm_pipeline_summary: { Args: { p_from?: string | null; p_to?: string | null }; Returns: CrmPipelineStage[] };
  get_crm_forecast: { Args: { p_months?: number }; Returns: CrmForecastMonth[] };
  get_crm_funnel: { Args: { p_from?: string | null; p_to?: string | null }; Returns: CrmFunnel };
  get_crm_customer_360: { Args: { p_customer_id: string }; Returns: CrmCustomer360 };
  get_crm_customer_profitability: {
    Args: { p_from?: string | null; p_to?: string | null; p_limit?: number };
    Returns: CrmCustomerProfitability;
  };
  get_crm_campaign_roi: { Args: { p_from?: string | null; p_to?: string | null }; Returns: CrmCampaignRoi };
  get_crm_dashboard: { Args: { p_days?: number }; Returns: CrmDashboard };
}

export interface Database {

  public: {
    Tables: {
      [K in TableName]: {
        Row: RowMap[K];
        Insert: Partial<RowMap[K]>;
        Update: Partial<Omit<RowMap[K], 'id'>>;
        Relationships: [];
      }
    };
    Views: { [key: string]: { Row: GenericRow; Relationships: [] } };
    Functions: {
      [key: string]: {
        Args: Record<string, unknown>;
        Returns: unknown;
      };
    };

    Enums: Record<string, string>;
    CompositeTypes: Record<string, unknown>;
  };
}

export type TableRow<T extends TableName> = Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends TableName> = Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends TableName> = Database['public']['Tables'][T]['Update'];
