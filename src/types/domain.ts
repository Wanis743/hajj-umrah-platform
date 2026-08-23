export enum PilgrimStatus {
  REGISTERED = 'REGISTERED',
  DOCUMENTS_PENDING = 'DOCUMENTS_PENDING',
  DOCUMENTS_COMPLETE = 'DOCUMENTS_COMPLETE',
  VISA_READY = 'VISA_READY',
  GROUP_ASSIGNED = 'GROUP_ASSIGNED',
  TRAVELING = 'TRAVELING',
  RETURNED = 'RETURNED'
}

export enum BookingStatus {
  DRAFT = 'DRAFT',
  QUOTED = 'QUOTED',
  RESERVED = 'RESERVED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  CONFIRMED = 'CONFIRMED',
  TRAVELING = 'TRAVELING',
  COMPLETED = 'COMPLETED'
}

export enum CancellationStatus {
  CANCELLATION_REQUESTED = 'CANCELLATION_REQUESTED',
  CANCELLATION_REVIEW = 'CANCELLATION_REVIEW',
  CANCELLED = 'CANCELLED',
  REFUND_CALCULATION = 'REFUND_CALCULATION',
  REFUND_PENDING = 'REFUND_PENDING',
  REFUNDED = 'REFUNDED'
}

export enum PackageStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  SOLD_OUT = 'SOLD_OUT',
  ARCHIVED = 'ARCHIVED'
}

export enum GroupStatus {
  FORMING = 'FORMING',
  READY = 'READY',
  DEPARTED = 'DEPARTED',
  IN_SAUDI = 'IN_SAUDI',
  RETURNED = 'RETURNED',
  CLOSED = 'CLOSED'
}

export enum VisaStatus {
  NOT_STARTED = 'NOT_STARTED',
  DOCUMENTS_REQUIRED = 'DOCUMENTS_REQUIRED',
  DOCUMENTS_PARTIAL = 'DOCUMENTS_PARTIAL',
  DOCUMENTS_COMPLETE = 'DOCUMENTS_COMPLETE',
  UNDER_REVIEW = 'UNDER_REVIEW',
  READY_FOR_SUBMISSION = 'READY_FOR_SUBMISSION',
  SUBMITTED = 'SUBMITTED',
  PROCESSING = 'PROCESSING',
  ADDITIONAL_INFO_REQUIRED = 'ADDITIONAL_INFO_REQUIRED',
  APPROVED = 'APPROVED',
  ISSUED = 'ISSUED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED'
}

export enum DocumentStatus {
  REQUIRED = 'REQUIRED',
  UPLOADED = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  SUPERSEDED = 'SUPERSEDED'
}

export enum FlightStatus {
  SCHEDULED = 'SCHEDULED',
  BOARDING = 'BOARDING',
  DEPARTED = 'DEPARTED',
  LANDED = 'LANDED',
  DELAYED = 'DELAYED',
  CANCELLED = 'CANCELLED'
}

export enum TransportStatus {
  AVAILABLE = 'AVAILABLE',
  ASSIGNED = 'ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED = 'ARRIVED',
  MAINTENANCE = 'MAINTENANCE'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED'
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED'
}

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  INTERESTED = 'INTERESTED',
  QUOTE_SENT = 'QUOTE_SENT',
  NEGOTIATION = 'NEGOTIATION',
  CONVERTED = 'CONVERTED',
  LOST = 'LOST'
}

export enum TicketStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_CUSTOMER = 'WAITING_CUSTOMER',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export enum IncidentStatus {
  DETECTED = 'DETECTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  INVESTIGATING = 'INVESTIGATING',
  CONTAINED = 'CONTAINED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export enum IncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum RoomAllocStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED'
}

export enum HajjStage {
  MAKKAH_PREP = 'MAKKAH_PREP',
  MINA = 'MINA',
  ARAFAT = 'ARAFAT',
  MUZDALIFAH = 'MUZDALIFAH',
  JAMARAT = 'JAMARAT',
  RETURN = 'RETURN'
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL'
}

export enum AlertType {
  KPI_BREACH = 'KPI_BREACH',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  DATA_QUALITY = 'DATA_QUALITY',
  SLA_BREACH = 'SLA_BREACH',
  SECURITY = 'SECURITY'
}

export enum KPIDirection {
  MAXIMIZE = 'MAXIMIZE',
  MINIMIZE = 'MINIMIZE',
  TARGET = 'TARGET'
}

export enum DataFreshness {
  LIVE = 'LIVE',
  FRESH = 'FRESH',
  AGING = 'AGING',
  STALE = 'STALE',
  UNAVAILABLE = 'UNAVAILABLE'
}

export enum Role {
  ADMIN = 'ADMIN',
  SYSTEM_ADMIN = 'SYSTEM_ADMIN',
  OPERATIONS_MANAGER = 'OPERATIONS_MANAGER',
  FINANCE = 'FINANCE',
  VISA_AGENT = 'VISA_AGENT',
  GUIDE = 'GUIDE',
  CRM = 'CRM',
  AGENT = 'AGENT',
  CUSTOMER = 'CUSTOMER'
}

// ---------------------------------------------------------
// 2. INTERFACES FOR EVERY ENTITY
// ---------------------------------------------------------

export interface Pilgrim {
  pilgrim_id: string;
  org_id: string;
  branch_id: string;
  full_name: string;
  full_name_ar: string;
  dob: string; // ISO date
  nationality: string;
  gender: 'MALE' | 'FEMALE';
  contact_info: {
    phone: string;
    email?: string;
    address?: string;
  };
  emergency_contact: {
    name: string;
    relation: string;
    phone: string;
  };
  family_id?: string;
  status: PilgrimStatus;
  created_at: string; // ISO date
  updated_at: string; // ISO date
  created_by: string;
}

export interface Family {
  family_id: string;
  members: Array<{
    pilgrim_id: string;
    relationship: 'SPOUSE' | 'PARENT' | 'CHILD' | 'GUARDIAN' | 'RELATIVE';
  }>;
}

export interface Document {
  document_id: string;
  pilgrim_id: string;
  type: 'PASSPORT' | 'ID_CARD' | 'PHOTO' | 'MEDICAL_CERT' | 'VACCINATION' | 'VISA' | 'OTHER';
  number: string;
  issue_date: string;
  expiry_date: string;
  status: DocumentStatus;
  verification_status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  storage_ref: string;
  version: number;
  checksum: string;
}

export interface Booking {
  booking_id: string;
  pilgrim_id: string;
  family_id?: string;
  package_id: string;
  group_id?: string;
  status: BookingStatus;
  travel_period: {
    start_date: string;
    end_date: string;
  };
  price_dzd: number;
  price_sar: number;
  discount: number;
  payment_status: PaymentStatus;
  cancellation_status?: CancellationStatus;
  sales_agent: string;
  source_channel: string;
  booking_items: BookingItem[];
}

export interface BookingItem {
  type: 'PACKAGE' | 'FLIGHT' | 'HOTEL' | 'TRANSPORT' | 'VISA' | 'ADDON';
  reference_id: string;
  description: string;
  amount_dzd: number;
  amount_sar: number;
}

export interface Package {
  package_id: string;
  name: string;
  nameAr: string;
  nameFr: string;
  version: number;
  validity_period: {
    start_date: string;
    end_date: string;
  };
  capacity: number;
  pricing_rules: {
    base_price_dzd: number;
    base_price_sar: number;
    currency_exchange_rate?: number;
  };
  included_services: string[];
  optional_services: string[];
  hotels: string[];
  flights: string[];
  transport: string[];
  visa: string[];
  meals: string[];
  guide: string[];
  cancellation_rules: string;
  supplier_contracts: string[];
}

export interface PricingSnapshot {
  base_package: number;
  room_upgrade: number;
  additional_services: number;
  discount: number;
  fees: number;
  total_dzd: number;
  total_sar: number;
}

export interface Group {
  group_id: string;
  code: string;
  package_id: string;
  departure: string;
  return_date: string;
  leader: string;
  guide_id: string;
  capacity: number;
  status: GroupStatus;
  readiness_score: number;
  readiness_details: GroupReadiness;
}

export interface GroupReadiness {
  score: number;
  status: 'NOT_READY' | 'AT_RISK' | 'READY';
  blocking_reasons: string[];
  warnings: string[];
  missing_requirements: string[];
  last_calculated_at: string;
  component_scores: Record<string, number>;
}

export interface Visa {
  visa_id: string;
  pilgrim_id: string;
  status: VisaStatus;
  processing_time: number;
  expected_processing_time: number;
  sla: number;
  rejection_reason?: string;
  missing_documents: string[];
  application_age: number;
  group_impact: boolean;
}

export interface Flight {
  flight_id: string;
  carrier: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  scheduled_departure: string;
  scheduled_arrival: string;
  actual_departure?: string;
  actual_arrival?: string;
  status: FlightStatus;
}

export interface PassengerAssignment {
  flight_id: string;
  pilgrim_id: string;
  booking_id: string;
  seat: string;
  baggage_info: string;
  status: 'ASSIGNED' | 'CHECKED_IN' | 'BOARDED' | 'NO_SHOW';
}

export interface Hotel {
  hotel_id: string;
  city: 'MAKKAH' | 'MADINAH';
  name: string;
  name_ar: string;
  star_rating: number;
  distance_to_haram_m: number;
  manager_contact: string;
}

export interface HotelContract {
  contract_id: string;
  hotel_id: string;
  room_types: string[];
  validity: {
    start_date: string;
    end_date: string;
  };
  rates: Record<string, number>;
}

export interface RoomInventory {
  room_type: string;
  total: number;
  occupied: number;
  available: number;
  rate_sar: number;
}

export interface RoomAllocation {
  allocation_id: string;
  hotel_id: string;
  group_id: string;
  pilgrim_id: string;
  room_type: string;
  check_in: string;
  check_out: string;
  status: RoomAllocStatus;
}

export interface Vehicle {
  vehicle_id: string;
  bus_number: string;
  company: string;
  driver_name: string;
  driver_phone: string;
  capacity: number;
  status: 'ACTIVE' | 'INACTIVE';
  maintenance_status: 'OK' | 'NEEDS_REPAIR' | 'IN_REPAIR';
}

export interface TransferAssignment {
  vehicle_id: string;
  group_id: string;
  route: string;
  scheduled_time: string;
  actual_time?: string;
  status: TransportStatus;
}

export interface Payment {
  payment_id: string;
  booking_id: string;
  amount_dzd: number;
  amount_sar: number;
  currency: 'DZD' | 'SAR';
  method: 'CASH' | 'BANK_TRANSFER' | 'CREDIT_CARD' | 'CHEQUE';
  status: PaymentStatus;
  idempotency_key: string;
  created_at: string;
}

export interface Invoice {
  invoice_id: string;
  booking_id: string;
  lines: InvoiceLine[];
  total_dzd: number;
  total_sar: number;
  status: InvoiceStatus;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Supplier {
  supplier_id: string;
  name: string;
  contacts: string[];
  contracts: string[];
  performance_score: number;
  categories: string[];
}

export interface SupplierContract {
  contract_id: string;
  supplier_id: string;
  version: number;
  validity: {
    start_date: string;
    end_date: string;
  };
  terms: string;
}

export interface Lead {
  lead_id: string;
  source: string;
  salesperson: string;
  status: LeadStatus;
  response_time: number;
  conversion_time: number;
  quote_value: number;
  package_interest: string;
  lost_reason?: string;
}

export interface SupportTicket {
  ticket_id: string;
  pilgrim_id: string;
  category: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  assigned_team: string;
  assigned_user: string;
  sla: number;
  status: TicketStatus;
  created_at: string;
  resolved_at?: string;
}

export interface Incident {
  incident_id: string;
  type: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  pilgrim_ids: string[];
  location: string;
  description: string;
  assigned_guide: string;
  escalation_level: number;
}

export interface MutawwifGuide {
  guide_id: string;
  name: string;
  name_ar: string;
  phone: string;
  languages: string[];
  assigned_group: string;
  pilgrim_count: number;
  duty_zone: string;
  rating: number;
  status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
}

export interface HolySiteCamp {
  site: HajjStage;
  camp_number: string;
  square_meters: number;
  allocated_pilgrims: number;
  capacity: number;
  ac_units_working: number;
  total_ac_units: number;
  catering_status: 'PENDING' | 'ARRIVED' | 'READY';
  shading_ready: boolean;
  jamarat_slot: string;
}

// ---------------------------------------------------------
// 3. KPI-RELATED TYPES
// ---------------------------------------------------------

export interface KPIIdentity {
  kpi_id: string;
  name: string;
  description: string;
  category: string;
}

export interface KPIDefinition {
  formula: string;
  unit: string;
  direction: KPIDirection;
  data_sources: string[];
}

export interface KPITargets {
  current_value: number;
  target_value: number;
  warning_threshold: number;
  critical_threshold: number;
}

export interface KPITime {
  calculation_frequency: string;
  last_calculated: string;
  next_calculation: string;
}

export interface KPIDimensions {
  allowed_dimensions: string[];
  default_dimension: string;
}

export interface KPIAnalytics {
  trend_value: number;
  trend_direction: 'UP' | 'DOWN' | 'FLAT';
  forecast?: ForecastResult;
  anomalies: AnomalyRecord[];
}

export interface KPIGovernance {
  owner: string;
  reviewer: string;
  status: 'ACTIVE' | 'DEPRECATED' | 'DRAFT';
}

export interface KPIAction {
  action_id: string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface FullKPIObject {
  identity: KPIIdentity;
  definition: KPIDefinition;
  targets: KPITargets;
  time: KPITime;
  dimensions: KPIDimensions;
  analytics: KPIAnalytics;
  governance: KPIGovernance;
  actions: KPIAction[];
}

export interface DriverTreeNode {
  name: string;
  value: number;
  impact: number;
  contributionPct: number;
  children: DriverTreeNode[];
}

export interface AnomalyRecord {
  type: string;
  description: string;
  detectedAt: string;
  severity: AlertSeverity;
  kpi_id: string;
  confidence: number;
}

export interface RootCauseCandidate {
  driver: string;
  contribution: number;
  confidence: number;
}

export interface ForecastResult {
  p10: number;
  p50: number;
  p90: number;
  baseline: number;
  generated_at: string;
}

export interface ScenarioInput {
  variables: Record<string, number>;
  assumptions: string[];
}

export interface ScenarioResult {
  expected_outcome: number;
  confidence_interval: [number, number];
  risk_factors: string[];
}

export interface OKRItem {
  vision: string;
  strategicPriority: string;
  objective: string;
  keyResult: string;
  kpiId: string;
  initiative: string;
  action: string;
  expectedImpact: string;
  owner: string;
  progressPct: number;
}

// ---------------------------------------------------------
// 4. EVENT TYPES
// ---------------------------------------------------------

export enum EventType {
  PILGRIM_REGISTERED = 'PILGRIM_REGISTERED',
  PILGRIM_UPDATED = 'PILGRIM_UPDATED',
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
  DOCUMENT_VERIFIED = 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED = 'DOCUMENT_REJECTED',
  BOOKING_CREATED = 'BOOKING_CREATED',
  BOOKING_STATUS_CHANGED = 'BOOKING_STATUS_CHANGED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  PAYMENT_INITIATED = 'PAYMENT_INITIATED',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  INVOICE_ISSUED = 'INVOICE_ISSUED',
  VISA_REQUESTED = 'VISA_REQUESTED',
  VISA_STATUS_CHANGED = 'VISA_STATUS_CHANGED',
  VISA_APPROVED = 'VISA_APPROVED',
  VISA_REJECTED = 'VISA_REJECTED',
  GROUP_CREATED = 'GROUP_CREATED',
  GROUP_STATUS_CHANGED = 'GROUP_STATUS_CHANGED',
  PILGRIM_ADDED_TO_GROUP = 'PILGRIM_ADDED_TO_GROUP',
  FLIGHT_SCHEDULED = 'FLIGHT_SCHEDULED',
  FLIGHT_DELAYED = 'FLIGHT_DELAYED',
  ROOM_ALLOCATED = 'ROOM_ALLOCATED',
  TRANSPORT_ASSIGNED = 'TRANSPORT_ASSIGNED',
  LEAD_CREATED = 'LEAD_CREATED',
  LEAD_CONVERTED = 'LEAD_CONVERTED',
  TICKET_CREATED = 'TICKET_CREATED',
  TICKET_RESOLVED = 'TICKET_RESOLVED',
  INCIDENT_REPORTED = 'INCIDENT_REPORTED',
  INCIDENT_RESOLVED = 'INCIDENT_RESOLVED',
  KPI_BREACHED = 'KPI_BREACHED'
}

export interface DomainEvent<T = unknown> {
  event_id: string;
  event_type: EventType;
  correlation_id: string;
  timestamp: string;
  actor: string;
  payload: T;
  affected_entities: string[];
}

// ---------------------------------------------------------
// 5. WORKFLOW / ALERT TYPES
// ---------------------------------------------------------

export interface AlertRule {
  rule_id: string;
  name: string;
  condition: string;
  severity: AlertSeverity;
  type: AlertType;
  kpi_id?: string;
  escalation_policy: string;
}

export interface Alert {
  alert_id: string;
  type: AlertType;
  severity: AlertSeverity;
  kpi_id?: string;
  message: string;
  detected_at: string;
  acknowledged: boolean;
  assigned_to?: string;
  escalation_path: string[];
}

export interface WorkflowStep {
  step_id: string;
  name: string;
  action_required: string;
  assigned_to: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  completed_at?: string;
}

export interface WorkflowInstance {
  workflow_id: string;
  name: string;
  context_id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED';
  steps: WorkflowStep[];
  started_at: string;
  updated_at: string;
}

export interface Action {
  action_id: string;
  insight: string;
  recommendation: string;
  owner: string;
  deadline: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  kpi_impact: string;
}

export interface Notification {
  notification_id: string;
  recipient: string;
  channel: 'EMAIL' | 'SMS' | 'IN_APP' | 'PUSH';
  message: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  sent_at: string;
}

// ---------------------------------------------------------
// 6. AUDIT TYPES
// ---------------------------------------------------------

export interface AuditEntry {
  audit_id: string;
  actor: string;
  action: string;
  resource: string;
  resource_id: string;
  timestamp: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  session: string;
}

// ---------------------------------------------------------
// 7. DATA QUALITY TYPES
// ---------------------------------------------------------

export interface DataQualityReport {
  report_id: string;
  generated_at: string;
  freshness: DataFreshness;
  completeness: number;
  accuracy: number;
  consistency: number;
  uniqueness: number;
  validity: number;
  overall_score: number;
}

// ---------------------------------------------------------
// 8. PERMISSION TYPES
// ---------------------------------------------------------

export interface Permission {
  resource: string;
  action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'EXECUTE';
}

export interface UserPermissions {
  user_id: string;
  role: Role;
  permissions: Permission[];
}

// ---------------------------------------------------------
// 9. REPORT TYPES
// ---------------------------------------------------------

export interface ReportConfig {
  report_id: string;
  name: string;
  type: 'FINANCIAL' | 'OPERATIONAL' | 'PERFORMANCE' | 'COMPLIANCE';
  parameters: Record<string, unknown>;
  schedule?: string; // Cron expression
}

export interface ReportOutput {
  output_id: string;
  report_id: string;
  generated_at: string;
  data_url: string;
  summary: string;
}

// ---------------------------------------------------------
// 10. FINANCIAL SUMMARY TYPES
// ---------------------------------------------------------

export interface FinancialSummary {
  summary_id: string;
  period_start: string;
  period_end: string;
  total_revenue_dzd: number;
  total_revenue_sar: number;
  collected_dzd: number;
  collected_sar: number;
  pending_dzd: number;
  pending_sar: number;
  expenses_dzd: number;
  expenses_sar: number;
  net_profit_dzd: number;
  net_profit_sar: number;
  expenses_by_category: Record<string, number>;
}

export interface ProfitabilityAnalysis {
  analysis_id: string;
  revenue_per_pilgrim: number;
  cost_per_pilgrim: number;
  profit_per_pilgrim: number;
  margin: number;
  by_package: Record<string, number>;
  by_group: Record<string, number>;
  by_branch: Record<string, number>;
}
