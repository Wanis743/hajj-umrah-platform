/**
 * DMS contract. Mirrors supabase/migrations/20260831120000_dms_vertical_slice.sql
 * exactly: every union below is a CHECK constraint in that file, and every
 * nullable field is a column the migration leaves nullable. A wider type here
 * would let the UI send a value the database rejects at runtime.
 */

export type DmsReviewStatus =
  | 'DRAFT' | 'PENDING_REVIEW' | 'UNDER_REVIEW' | 'APPROVED'
  | 'REJECTED' | 'CHANGES_REQUESTED' | 'EXPIRED' | 'SUPERSEDED';

export type DmsConfidentiality = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

export type DmsUploadState = 'RESERVED' | 'UPLOADED' | 'LEGACY' | 'FAILED';

export type DmsLinkEntityType =
  | 'pilgrim' | 'booking' | 'group' | 'package' | 'payment' | 'invoice'
  | 'supplier' | 'supplier_bill' | 'contract' | 'hotel_contract'
  | 'journal_entry' | 'crm_customer' | 'crm_quote' | 'crm_opportunity'
  | 'staff_profile' | 'visa' | 'external_operation';

export type DmsLinkRelation =
  | 'ABOUT' | 'EVIDENCE_FOR' | 'SIGNED_BY' | 'ISSUED_BY' | 'INVOICE_FOR' | 'CONTRACT_FOR';

export type DmsDocumentRelation =
  | 'SUPERSEDES' | 'SUPPORTS' | 'TRANSLATION_OF' | 'SIGNED_COPY_OF'
  | 'ATTACHMENT_OF' | 'AMENDS' | 'RELATED';

export type DmsExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DmsJobReviewState = 'NOT_REVIEWED' | 'PARTIALLY_REVIEWED' | 'REVIEWED';
export type DmsFieldReviewState = 'PENDING' | 'ACCEPTED' | 'CORRECTED' | 'REJECTED';
export type DmsPackageStatus = 'OPEN' | 'SEALED' | 'VOID';
export type DmsAccessAction = 'VIEWED' | 'DOWNLOADED' | 'SIGNED_URL_ISSUED';

/**
 * Every legal move in private.dms_review_transition, copied from its VALUES
 * list. Mirrored so a screen can grey out an illegal move instead of
 * round-tripping to a raised exception -- the server still decides.
 *
 * EXPIRED and SUPERSEDED appear as no target on purpose. EXPIRED is written only
 * by the expiry sweep (a fact about the calendar), and SUPERSEDED only by a new
 * version or a SUPERSEDES relation. Neither is a button.
 */
export const DMS_REVIEW_TRANSITIONS: Readonly<Record<DmsReviewStatus, readonly DmsReviewStatus[]>> = {
  DRAFT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
  CHANGES_REQUESTED: ['PENDING_REVIEW', 'DRAFT'],
  REJECTED: ['DRAFT'],
  APPROVED: [],
  EXPIRED: [],
  SUPERSEDED: [],
};

/** The mime types storage.buckets accepts for the `dms` bucket, verbatim. */
export const DMS_ALLOWED_MIME: readonly string[] = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
];

/** 25 MiB, matching the bucket's file_size_limit and the size_bytes CHECK. */
export const DMS_MAX_BYTES = 26_214_400;

export const DMS_BUCKET = 'dms';

export interface DmsDocumentRow {
  id: string;
  agency_id: string;
  branch_id: string | null;
  document_number: string | null;
  title: string;
  description: string | null;
  document_type: string;
  status: string;
  review_status: DmsReviewStatus;
  confidentiality: DmsConfidentiality;
  tags: string[];
  current_version_id: string | null;
  version_count: number;
  submitted_at: string | null;
  submitted_by: string | null;
  review_started_at: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  issued_on: string | null;
  expires_on: string | null;
  expiry_notice_days: number;
  expiry_notified_at: string | null;
  retention_until: string | null;
  archived_at: string | null;
  workspace_id: string;
  polymorphic_id: string | null;
  polymorphic_type: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DmsVersion {
  id: string;
  version_number: number;
  upload_state: DmsUploadState;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  checksum_sha256: string | null;
  page_count: number | null;
  storage_bucket: string;
  storage_path: string;
  uploaded_at: string | null;
  superseded_at: string | null;
  notes: string | null;
  is_current: boolean;
}

export interface DmsLink {
  id: string;
  entity_type: DmsLinkEntityType;
  entity_id: string;
  relation: DmsLinkRelation;
  note: string | null;
  created_at: string;
}

export interface DmsRelation {
  id: string;
  direction: 'OUTGOING' | 'INCOMING';
  relation: DmsDocumentRelation;
  document_id: string;
  document_number: string | null;
  title: string;
  review_status: DmsReviewStatus;
}

export interface DmsEvent {
  id: number;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  actor_id: string | null;
  actor_role: string | null;
  version_id: string | null;
  created_at: string;
}

export interface DmsExtractedField {
  id: string;
  field_key: string;
  field_label: string | null;
  raw_value: string | null;
  value: string | null;
  confidence: number | null;
  page_number: number | null;
  review_state: DmsFieldReviewState;
}

export interface DmsExtractionJob {
  id: string;
  version_id: string | null;
  status: DmsExtractionStatus;
  engine: string;
  attempts: number;
  confidence: number | null;
  review_state: DmsJobReviewState;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  fields: DmsExtractedField[];
}

export interface DmsPackageMembership {
  id: string;
  name: string;
  status: DmsPackageStatus;
  reference: string | null;
  sealed_at: string | null;
  sequence_no: number | null;
  sealed_version_id: string | null;
}

export interface DmsDocument360 {
  document: DmsDocumentRow;
  versions: DmsVersion[];
  links: DmsLink[];
  relations: DmsRelation[];
  events: DmsEvent[];
  extraction_jobs: DmsExtractionJob[];
  evidence_packages: DmsPackageMembership[];
}

export interface DmsDashboardTotals {
  documents: number;
  approved: number;
  awaiting_review: number;
  expiring_soon: number;
  expired: number;
  archived: number;
  versions: number;
  created_in_window: number;
}

export interface DmsDashboard {
  window_days: number;
  totals: DmsDashboardTotals;
  by_status: Array<{ review_status: DmsReviewStatus; sort_order: number; document_count: number }>;
  by_type: Array<{ document_type: string; document_count: number; approved_count: number }>;
  by_confidentiality: Array<{ confidentiality: DmsConfidentiality; sort_order: number; document_count: number }>;
  activity: Array<{ day: string; uploads: number; approvals: number; returns: number }>;
}

export interface DmsReviewQueueRow {
  id: string;
  document_number: string | null;
  title: string;
  document_type: string;
  review_status: DmsReviewStatus;
  confidentiality: DmsConfidentiality;
  submitted_at: string | null;
  submitted_by: string | null;
  reviewer_id: string | null;
  review_started_at: string | null;
  version_count: number;
  expires_on: string | null;
  waiting_hours: number | null;
  has_verified_bytes: boolean;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface DmsExpiryReport {
  horizon_days: number;
  buckets: {
    expired: number; within_7: number; within_30: number;
    within_90: number; beyond: number; no_expiry: number;
  };
  documents: Array<{
    id: string;
    document_number: string | null;
    title: string;
    document_type: string;
    review_status: DmsReviewStatus;
    issued_on: string | null;
    expires_on: string;
    expiry_notice_days: number;
    expiry_notified_at: string | null;
    days_remaining: number;
    linked_entity_types: DmsLinkEntityType[];
  }>;
}

export interface DmsExtractionQuality {
  window_days: number;
  jobs: {
    total: number; pending: number; processing: number; completed: number;
    failed: number; reviewed: number;
    avg_confidence: number | null; avg_seconds: number | null;
  };
  by_field: Array<{
    field_key: string; extracted: number; accepted: number; corrected: number;
    rejected: number; pending: number;
    avg_confidence: number | null; accuracy_pct: number | null;
  }>;
  by_engine: Array<{ engine: string; jobs: number; failed: number; avg_confidence: number | null }>;
}

export interface DmsPackageDocument {
  document_id: string;
  sequence_no: number | null;
  document_number: string | null;
  title: string;
  review_status: DmsReviewStatus;
  version_id: string | null;
  checksum_sha256: string | null;
}

export interface DmsEvidencePackage {
  id: string;
  name: string;
  status: DmsPackageStatus;
  reference: string | null;
  purpose: string | null;
  notes: string | null;
  document_count: number;
  sealed_at: string | null;
  sealed_by: string | null;
  seal_checksum: string | null;
  created_at: string;
  created_by: string | null;
  /** null while the package is not SEALED -- there is nothing to match yet. */
  seal_matches: boolean | null;
  drifted_documents: number;
  documents: DmsPackageDocument[];
}

export interface DmsPackageVerification {
  evidence_package_id: string;
  status: DmsPackageStatus;
  sealed_at: string | null;
  seal_checksum: string | null;
  recomputed_checksum: string;
  matches: boolean;
  drift: Array<{
    document_id: string;
    document_number: string | null;
    title: string;
    sealed_version_id: string | null;
    current_version_id: string | null;
    sealed_checksum: string | null;
    current_checksum: string | null;
    review_status: DmsReviewStatus;
  }>;
}

/* -------------------------------------------------------------------------- */
/* Command results                                                            */
/* -------------------------------------------------------------------------- */

export interface DmsReservation {
  document_id: string;
  document_number: string | null;
  version_id: string;
  version_number: number;
  storage_bucket: string;
  storage_path: string;
  is_new_document: boolean;
}

export interface DmsFinalizeResult {
  document_id: string;
  version_id: string;
  version_number: number;
  version_count: number;
  /** Where the document landed. Verifying bytes over an already-decided document
   *  resets it to DRAFT, because the thing that was approved is not this thing. */
  review_status: DmsReviewStatus;
  extraction_job_id: string | null;
}

export interface DmsTransitionResult {
  document_id: string;
  from: DmsReviewStatus;
  to: DmsReviewStatus;
}

export interface DmsSweepResult {
  expired: number;
  notified: number;
  as_of: string;
}

export interface DmsDiscardResult { version_id: string; discarded: true }
export interface DmsArchiveResult { document_id: string; archived: boolean }
export interface DmsLinkResult { link_id: string; created?: boolean; removed?: boolean }
export interface DmsRelationResult { relation_id: string; created?: boolean; removed?: boolean }
export interface DmsQueueResult { job_id: string; status: DmsExtractionStatus }
export interface DmsExtractionRecorded { job_id: string; status: DmsExtractionStatus; fields: number }

export interface DmsFieldReviewResult {
  field_id: string;
  review_state: DmsFieldReviewState;
  job_review_state: DmsJobReviewState;
  pending: number;
}

export interface DmsPackageCreated { evidence_package_id: string; status: DmsPackageStatus }

export interface DmsPackageMemberResult {
  evidence_package_id: string;
  document_id: string;
  included: boolean;
  document_count: number;
}

export interface DmsPackageSealed {
  evidence_package_id: string;
  status: 'SEALED';
  document_count: number;
  seal_checksum: string;
}

export interface DmsMetadataResult { id: string; updated: true }
export interface DmsTagsResult { id: string; tags: string[] }
export interface DmsDeleteResult { id: string; deleted: true; orphaned_objects: number }
export interface DmsPackageVoided { id: string; status: 'VOID' }
export interface DmsPackageDeleted { id: string; deleted: true }
export interface DmsAccessRecorded { event_id: number; action: DmsAccessAction }
