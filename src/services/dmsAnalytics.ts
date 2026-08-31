/**
 * DMS read layer. Every function here is a single call to a SECURITY DEFINER
 * analytics RPC in 20260831120000_dms_vertical_slice.sql. Nothing here computes a
 * business number in the browser: the waiting hours, the expiry buckets, the
 * extraction accuracy and -- most importantly -- the evidence-seal comparison are
 * all derived in SQL, so the list view and the verify button can never disagree
 * about whether a sealed package still matches its members.
 *
 * The document library itself is a plain row list and goes through
 * useSupabaseData against the RLS-protected table. This file is for the composed
 * payloads only.
 */
import { supabase } from '@/lib/supabase';
import { normalizeError } from '@/lib/errors';
import type {
  DmsDashboard, DmsDocument360, DmsEvidencePackage, DmsExpiryReport,
  DmsExtractionQuality, DmsReviewQueueRow,
} from '@/types/dms';

export interface DmsReadResult<T> {
  data: T | null;
  /** Already user-safe: the analytics RPCs raise 42501 for scope and permission,
   *  and nothing else in them is a business rule. */
  error: string | null;
}

const SCOPE_DENIED = 'لا تملك صلاحية الاطلاع على بيانات إدارة الوثائق';

function readError(code: string | undefined, message: string): string {
  if (code === '42501') return SCOPE_DENIED;
  return message;
}

/** The rpc contract types Returns as unknown, so every payload is shape-checked
 *  before it is handed to a component. A malformed payload becomes an error, not
 *  a crash inside a table. */
async function rpcRead<T>(
  fn: string,
  args: Record<string, unknown>,
  isValid: (value: unknown) => boolean,
): Promise<DmsReadResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: readError(error.code, error.message) };
  if (!isValid(data)) return { data: null, error: `استجابة غير متوقعة من ${fn}` };
  return { data: data as T, error: null };
}

const isArray = (v: unknown): boolean => Array.isArray(v);
const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);

export const dmsAnalytics = {
  /** One round trip for the DMS home screen: counters, the status/type/
   *  confidentiality breakdowns and a day-by-day activity series. */
  dashboard: (days = 30) =>
    rpcRead<DmsDashboard>('get_dms_dashboard', { p_days: days }, isObject),

  /** The whole document: versions, links, cross-document relations, the event
   *  ledger, extraction jobs with their fields, and package memberships. */
  document360: (documentId: string) =>
    rpcRead<DmsDocument360>('get_dms_document_360', { p_document_id: documentId }, isObject),

  /** waiting_hours is measured from submitted_at, so a document that sat in DRAFT
   *  for a month is not reported as having waited on a reviewer. The argument is a
   *  row cap, not a window: the queue is everything still PENDING_REVIEW,
   *  UNDER_REVIEW or CHANGES_REQUESTED, however old. */
  reviewQueue: (limit = 50) =>
    rpcRead<DmsReviewQueueRow[]>('get_dms_review_queue', { p_limit: limit }, isArray),

  /** p_horizon_days, not p_days -- the report looks forward, and the server clamps
   *  it to 1..730. */
  expiry: (horizonDays = 90) =>
    rpcRead<DmsExpiryReport>('get_dms_expiry_report', { p_horizon_days: horizonDays }, isObject),

  /** accuracy_pct is ACCEPTED over (ACCEPTED + CORRECTED + REJECTED). It is null,
   *  not zero, for a field nobody has reviewed yet. */
  extractionQuality: (days = 30) =>
    rpcRead<DmsExtractionQuality>('get_dms_extraction_quality', { p_days: days }, isObject),

  /** Each row carries seal_matches and drifted_documents, recomputed from the
   *  members on read, so a broken seal shows up in the list without anyone
   *  choosing to verify it. */
  packages: (limit = 50) =>
    rpcRead<DmsEvidencePackage[]>('get_dms_evidence_packages', { p_limit: limit }, isArray),
};

/** Wraps a read in the shape the hooks expect, turning a thrown transport failure
 *  into the same `{data, error}` the RPC path returns. */
export async function safeDmsRead<T>(run: () => Promise<DmsReadResult<T>>): Promise<DmsReadResult<T>> {
  try {
    return await run();
  } catch (e) {
    return { data: null, error: normalizeError(e).message };
  }
}
