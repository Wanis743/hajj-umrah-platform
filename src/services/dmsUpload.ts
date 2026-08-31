/**
 * DMS upload orchestration: the three-step handshake the database insists on.
 *
 *   1. reserve   -- creates the document/version row and returns the one path the
 *                   storage policies will accept bytes at. Every policy on the
 *                   `dms` bucket keys on a version row already existing with
 *                   storage_path = name, so uploading first is not possible.
 *   2. PUT       -- the bytes, to exactly that path, with upsert off.
 *   3. finalize  -- size, mime, SHA-256 and page count. Until this runs the
 *                   version stays RESERVED and no reader treats it as real.
 *
 * The digest is computed here, over the same ArrayBuffer that is sent, so the
 * value recorded is one the server can later re-derive from the object rather
 * than a number the client made up. A failed PUT calls discard, which files the
 * reserved path in the orphan queue before dropping the row -- after the row is
 * gone, no policy can authorize deleting the object it pointed at.
 */
import { supabase } from '@/lib/supabase';
import { normalizeError } from '@/lib/errors';
import { dmsCommands } from '@/services/domainCommands';
import {
  DMS_ALLOWED_MIME, DMS_BUCKET, DMS_MAX_BYTES,
  type DmsConfidentiality, type DmsFinalizeResult,
} from '@/types/dms';

export interface DmsUploadInput {
  file: File;
  title: string;
  documentType: string;
  /** Set to add a version to an existing document instead of creating one. */
  documentId?: string | null;
  description?: string | null;
  confidentiality?: DmsConfidentiality;
  issuedOn?: string | null;
  expiresOn?: string | null;
  expiryNoticeDays?: number;
  tags?: string[];
  workspaceId?: string;
  queueExtraction?: boolean;
}

export type DmsUploadStage = 'validating' | 'hashing' | 'reserving' | 'uploading' | 'finalizing' | 'done';

export interface DmsUploadOutcome {
  ok: boolean;
  /** Present only on success. */
  result: DmsFinalizeResult | null;
  documentId: string | null;
  documentNumber: string | null;
  versionId: string | null;
  /** Already user-safe. */
  error: string | null;
  /** How far it got, for a progress line that stays honest about where it died. */
  stage: DmsUploadStage;
}

/** Local checks that mirror the bucket's own limits, so an oversized or wrong-type
 *  file is refused before a row is created and abandoned. */
export function validateDmsFile(file: File): string | null {
  if (file.size === 0) return 'الملف فارغ';
  if (file.size > DMS_MAX_BYTES) {
    return `حجم الملف ${formatBytes(file.size)} يتجاوز الحد المسموح ${formatBytes(DMS_MAX_BYTES)}`;
  }
  // An empty type means the browser could not tell; let the bucket decide rather
  // than blocking a file the server would have taken.
  if (file.type && !DMS_ALLOWED_MIME.includes(file.type)) {
    return `نوع الملف ${file.type} غير مدعوم`;
  }
  return null;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Lowercase hex SHA-256, matching the `^[0-9a-f]{64}$` CHECK on the column. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fail(stage: DmsUploadStage, error: string, partial: Partial<DmsUploadOutcome> = {}): DmsUploadOutcome {
  return {
    ok: false, result: null, documentId: null, documentNumber: null, versionId: null,
    ...partial, error, stage,
  };
}

export async function uploadDmsDocument(
  input: DmsUploadInput,
  onStage?: (stage: DmsUploadStage) => void,
): Promise<DmsUploadOutcome> {
  const step = (s: DmsUploadStage) => { onStage?.(s); return s; };

  step('validating');
  const invalid = validateDmsFile(input.file);
  if (invalid) return fail('validating', invalid);

  let checksum: string;
  try {
    step('hashing');
    checksum = await sha256Hex(await input.file.arrayBuffer());
  } catch (e) {
    return fail('hashing', normalizeError(e).message);
  }

  step('reserving');
  const reserved = await dmsCommands.reserveUpload({
    title: input.title,
    documentType: input.documentType,
    originalFilename: input.file.name,
    documentId: input.documentId ?? null,
    description: input.description ?? null,
    confidentiality: input.confidentiality ?? 'INTERNAL',
    issuedOn: input.issuedOn ?? null,
    expiresOn: input.expiresOn ?? null,
    expiryNoticeDays: input.expiryNoticeDays ?? 30,
    tags: input.tags ?? [],
    workspaceId: input.workspaceId ?? 'DEFAULT',
  });
  if (!reserved.success || !reserved.data) {
    return fail('reserving', reserved.error?.user_safe_message ?? 'تعذر تجهيز الرفع');
  }
  const slot = reserved.data;
  const ids = {
    documentId: slot.document_id,
    documentNumber: slot.document_number,
    versionId: slot.version_id,
  };

  step('uploading');
  const { error: putError } = await supabase.storage
    .from(slot.storage_bucket || DMS_BUCKET)
    .upload(slot.storage_path, input.file, {
      contentType: input.file.type || 'application/octet-stream',
      upsert: false,
    });

  if (putError) {
    // Give the path back before the row disappears, then report the PUT failure
    // rather than the cleanup's -- the PUT is what the user needs to know about.
    await dmsCommands.discardUpload(slot.version_id, `upload failed: ${putError.message}`);
    return fail('uploading', normalizeError(putError).message, ids);
  }

  step('finalizing');
  const finalized = await dmsCommands.finalizeUpload(
    slot.version_id, input.file.size, input.file.type || 'application/octet-stream', checksum,
    { queueExtraction: input.queueExtraction ?? true },
  );
  if (!finalized.success || !finalized.data) {
    // The bytes are there and the row is RESERVED. Leave both: the object is still
    // reachable at a path whose row exists, so a retry of finalize can succeed
    // without re-sending the file.
    return fail('finalizing', finalized.error?.user_safe_message ?? 'تعذر إتمام الرفع', ids);
  }

  step('done');
  return { ok: true, result: finalized.data, ...ids, error: null, stage: 'done' };
}

/** A time-limited URL for a private object. The read is recorded first, so a
 *  download that happens outside the app still has a ledger entry behind it. */
export async function dmsSignedUrl(
  documentId: string, storagePath: string, expiresInSeconds = 60,
): Promise<{ url: string | null; error: string | null }> {
  const logged = await dmsCommands.recordAccess(documentId, 'SIGNED_URL_ISSUED');
  if (!logged.success) {
    return { url: null, error: logged.error?.user_safe_message ?? 'تعذر تسجيل الوصول' };
  }
  const { data, error } = await supabase.storage
    .from(DMS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return { url: null, error: normalizeError(error).message };
  return { url: data?.signedUrl ?? null, error: null };
}
