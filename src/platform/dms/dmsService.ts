/**
 * DMS domain service (V12 §17.8 — platform migration of dms/v10, §7).
 *
 * Real storage-backed documents (§7): metadata rows reference actual
 * Supabase Storage objects (storage_bucket + storage_path); downloads go
 * through signed URLs, never fabricated file data.
 *
 * Verified server contracts:
 * - documents: id, agency_id, pilgrim_id, type, status, number, file_name,
 *   file_url, issue_date, expiry_date, mime_type, size_bytes,
 *   checksum_sha256, storage_bucket, storage_path
 * - extraction_jobs: id, document_id, status, extracted_data (jsonb)
 * - evidence_packages: id, name, status, polymorphic_id, polymorphic_type
 * - Storage bucket: 'documents'
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export interface DocumentDTO {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly fileName: string;
  readonly number: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string | null;
  readonly expiryDate: string | null;
}

export interface ExtractionJobDTO {
  readonly id: string;
  readonly documentId: string;
  /** Provisional until reviewed (§21). */
  readonly extractedData: unknown;
  readonly status: string;
}

export interface EvidencePackageDTO {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** Signed download URL for a document's real storage object. */
export async function getDocumentDownloadUrl(
  doc: DocumentDTO & { storageBucket: string; storagePath: string },
): Promise<Result<string, KernelError>> {
  if (doc.storageBucket === '' || doc.storagePath === '') {
    return err({ code: 'NOT_FOUND', message: 'Document has no storage object', details: { domain: 'DMS' } });
  }
  const { data, error } = await supabase.storage
    .from(doc.storageBucket)
    .createSignedUrl(doc.storagePath, 300);

  if (error !== null || data === null) {
    return err({ code: 'NOT_FOUND', message: error?.message ?? 'Signed URL failed', details: { domain: 'DMS' } });
  }
  return ok(data.signedUrl);
}

export async function getDocuments(): Promise<Result<readonly DocumentDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, type, status, file_name, number, mime_type, size_bytes, checksum_sha256, expiry_date')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'DMS' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    type: String(r.type ?? ''),
    status: String(r.status ?? ''),
    fileName: String(r.file_name ?? ''),
    number: String(r.number ?? ''),
    mimeType: String(r.mime_type ?? ''),
    sizeBytes: Number(r.size_bytes ?? 0),
    checksumSha256: r.checksum_sha256 === null || r.checksum_sha256 === undefined ? null : String(r.checksum_sha256),
    expiryDate: r.expiry_date === null || r.expiry_date === undefined ? null : String(r.expiry_date),
  })));
}

export async function getExtractionJobs(): Promise<Result<readonly ExtractionJobDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('extraction_jobs')
    .select('id, document_id, status, extracted_data')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'DMS' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    documentId: String(r.document_id ?? ''),
    status: String(r.status ?? 'PENDING'),
    extractedData: r.extracted_data ?? null,
  })));
}

export async function getEvidencePackages(): Promise<Result<readonly EvidencePackageDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('evidence_packages')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'DMS' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    name: String(r.name ?? ''),
    status: String(r.status ?? 'OPEN'),
  })));
}
