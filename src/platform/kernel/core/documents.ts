/**
 * Document store — the kernel half of `docs.upload` and `docs.signedUrl`.
 *
 * An application cannot reach object storage. The broker exposes datasets and
 * named commands, and both of those move rows; a document also moves bytes, and
 * the bytes have to land at exactly one path the storage policies will accept.
 * That path does not exist until a row has been reserved, so an upload is three
 * server calls with a rollback in the middle — a protocol, not a write.
 *
 * A protocol cannot be handed to an app as three commands. If the PUT fails and
 * the app never calls discard, a reserved row keeps pointing at a path with
 * nothing behind it; if the app discards after the row is already gone, no
 * policy can authorize deleting the object it pointed at. So `DMS_COMMANDS`
 * omits reserve, finalize and discard, and the whole sequence lives here: hash,
 * reserve, PUT, and on a failed PUT discard *before* the row goes.
 *
 * Because those three are not `DataCommandName`s they cannot travel through
 * `broker.command`, which indexes its bindings by that union. They are called
 * directly, mirroring that method's error handling: `PGRST202` means the
 * migration is missing and reports as `NOT_SUPPORTED`, anything else is
 * `IO_ERROR`, and both land in the event log. The broker is still used for the
 * two things it owns — cache invalidation, and the one bound command
 * (`dms.document.recordAccess`) that issuing a link has to write first.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  fail,
  succeed,
  type AbiResult,
  type DatasetName,
  type DocumentUploadRequest,
  type DocumentUploadResult,
  type DocumentUrlRequest,
  type DocumentUrlResult,
  type Pid,
} from '../abi';
import type { DataBrokerSubsystem, DocumentSubsystem, KernelClock, KernelLogger } from '../contracts';
import { isoTimestamp } from '../types';
import { EVENT_IDS } from './eventlog';

/** Bucket the DMS storage policies are written against. */
const BUCKET = 'dms';
/** 25 MiB, the bucket's own ceiling. Refused here to save a doomed round trip. */
const MAX_BYTES = 26_214_400;
/** Seconds a signed link stays good when the caller does not say. */
const DEFAULT_TTL_SECONDS = 60;
/** One hour. A link that outlives the session it was opened from is a leak. */
const MAX_TTL_SECONDS = 3_600;

/**
 * Datasets a new version changes. Not `dmsPackages`: a document that has just
 * arrived is evidence for nothing yet, so no package's contents moved.
 */
const UPLOAD_INVALIDATES: readonly DatasetName[] = [
  'dmsDocuments',
  'dmsDocument360',
  'dmsDashboard',
  'dmsExpiry',
  'dmsReviewQueue',
  'dmsExtractionQuality',
];

/* ------------------------------------------------------------------ *
 * Value narrowing
 * ------------------------------------------------------------------ */

type Row = Readonly<Record<string, unknown>>;

const asObject = (value: unknown): Row | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : null;

/** Empty string is treated as absent: a blank id is not an id. */
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * SHA-256 of the exact buffer that will be uploaded, lowercase hex.
 *
 * The same `ArrayBuffer` is hashed and sent, so the checksum the server records
 * is provably over the bytes it received rather than over a second read of a
 * stream that might have differed.
 */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------ *
 * Argument and result shaping
 * ------------------------------------------------------------------ */

/**
 * The reservation's arguments, with every server-side default written out.
 *
 * Lifted out of `upload` for a reason beyond length: argument names are the one
 * part of an RPC call the compiler cannot check, and a name that is wrong but
 * still valid does not fail — it silently takes the column default. Keeping the
 * eleven names and the eleven defaults in one small function means they can be
 * read against the migration side by side, which is the only way this is ever
 * actually verified.
 */
function reserveArgs(request: DocumentUploadRequest): Readonly<Record<string, unknown>> {
  return {
    p_title: request.title.trim(),
    p_document_type: request.documentType.trim(),
    p_original_filename: request.file.fileName,
    p_document_id: request.documentId ?? null,
    p_description: request.description ?? null,
    p_confidentiality: request.confidentiality ?? 'INTERNAL',
    p_issued_on: request.issuedOn ?? null,
    p_expires_on: request.expiresOn ?? null,
    p_expiry_notice_days: request.expiryNoticeDays ?? 30,
    p_tags: [...(request.tags ?? [])],
    p_workspace_id: request.workspaceId ?? 'DEFAULT',
  };
}

/**
 * What the caller is told, read from the server's finalize row first.
 *
 * The reservation is only a fallback. Finalizing over a document that was
 * already reviewed resets it to DRAFT and bumps the version count, so assuming
 * either from the reservation would report the state before the write rather
 * than after it. The checksum and size are the exception: those describe the
 * bytes this process hashed and sent, not anything the row can tell us.
 */
function describeUpload(
  row: Row,
  slot: Row,
  reserved: { readonly documentId: string; readonly versionId: string },
  bytes: { readonly checksum: string; readonly sizeBytes: number },
): DocumentUploadResult {
  return {
    documentId: str(row.document_id) ?? reserved.documentId,
    versionId: str(row.version_id) ?? reserved.versionId,
    versionNumber: num(row.version_number) ?? num(slot.version_number) ?? 1,
    versionCount: num(row.version_count) ?? 1,
    reviewStatus: str(row.review_status) ?? 'DRAFT',
    extractionJobId: str(row.extraction_job_id),
    checksumSha256: bytes.checksum,
    sizeBytes: bytes.sizeBytes,
  };
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

class DocumentStore implements DocumentSubsystem {
  constructor(
    private readonly clock: KernelClock,
    private readonly log: KernelLogger,
    private readonly data: DataBrokerSubsystem,
  ) {}

  /**
   * One RPC, narrowed to the object every DMS command function returns.
   *
   * `asObject` and not a row-array narrowing: these three functions return a
   * single JSON object, and reading an object as a page yields an empty page
   * rather than an error — a reservation that looks like it never happened.
   */
  private async rpc(pid: Pid, fn: string, args: Readonly<Record<string, unknown>>): Promise<AbiResult<Row>> {
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (error !== null) {
        const code = error.code === 'PGRST202' ? 'NOT_SUPPORTED' : 'IO_ERROR';
        const message =
          code === 'NOT_SUPPORTED'
            ? `The server does not expose ${fn}. Apply the pending database migrations.`
            : error.message;
        this.log.write(
          'Application',
          'error',
          EVENT_IDS.documentUploadFailed,
          'DocumentStore',
          `${fn} failed: ${error.message}`,
          { rpc: fn, code: error.code ?? '' },
          pid,
        );
        return fail<Row>(code, message, { rpc: fn, dbCode: error.code ?? '' });
      }
      const row = asObject(data);
      if (row === null) return fail<Row>('IO_ERROR', `${fn} returned no record.`, { rpc: fn });
      return succeed(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.write(
        'Application',
        'error',
        EVENT_IDS.documentUploadFailed,
        'DocumentStore',
        `${fn} threw: ${message}`,
        { rpc: fn },
        pid,
      );
      return fail<Row>('IO_ERROR', message, { rpc: fn });
    }
  }

  /**
   * Refusals the server would also make, made here.
   *
   * A MIME allow-list is deliberately absent: the bucket decides that, and
   * duplicating the list in the kernel would block a file the server would have
   * taken the moment the two lists drifted.
   */
  private static check(request: DocumentUploadRequest): AbiResult<true> {
    const size = request.file.buffer.byteLength;
    if (size === 0) return fail<true>('INVALID_ARGUMENT', 'The file is empty.');
    if (size > MAX_BYTES) {
      return fail<true>('QUOTA_EXCEEDED', `The file is larger than the ${MAX_BYTES / 1_048_576} MB limit.`, {
        sizeBytes: size,
        maxBytes: MAX_BYTES,
      });
    }
    if (request.title.trim() === '') return fail<true>('INVALID_ARGUMENT', 'A document needs a title.');
    if (request.documentType.trim() === '') return fail<true>('INVALID_ARGUMENT', 'A document needs a type.');
    if (request.file.fileName.trim() === '') return fail<true>('INVALID_ARGUMENT', 'A document needs a filename.');
    if (!isSupabaseConfigured) return fail<true>('IO_ERROR', 'The document store is not configured');
    return succeed(true);
  }

  async upload(pid: Pid, request: DocumentUploadRequest): Promise<AbiResult<DocumentUploadResult>> {
    const checked = DocumentStore.check(request);
    if (!checked.ok) return checked;

    const sizeBytes = request.file.buffer.byteLength;
    const contentType = request.file.contentType === '' ? 'application/octet-stream' : request.file.contentType;
    const checksum = await sha256Hex(request.file.buffer);

    // Step 1 of 3. The storage policies refuse a PUT to a path with no row
    // behind it, so reserving first is enforced by the database, not by us.
    const reserved = await this.rpc(pid, 'reserve_dms_upload_command', reserveArgs(request));
    if (!reserved.ok) return reserved;

    const slot = reserved.value;
    const versionId = str(slot.version_id);
    const storagePath = str(slot.storage_path);
    const documentId = str(slot.document_id);
    if (versionId === null || storagePath === null || documentId === null) {
      // The row may exist; without its id there is nothing to discard it by.
      this.data.invalidate(UPLOAD_INVALIDATES);
      return fail('IO_ERROR', 'The document store returned an incomplete reservation.', {
        rpc: 'reserve_dms_upload_command',
      });
    }

    // Step 2 of 3. `upsert: false` so a replayed upload collides instead of
    // overwriting a version someone has already approved.
    const bucket = str(slot.storage_bucket) ?? BUCKET;
    const put = await supabase.storage
      .from(bucket)
      .upload(storagePath, new Blob([request.file.buffer], { type: contentType }), { contentType, upsert: false });

    if (put.error !== null) {
      // Discard *before* the row goes: once the version row is gone no policy
      // can authorize deleting the object it pointed at, so the path would be
      // orphaned bytes nobody is allowed to reach.
      const discarded = await this.rpc(pid, 'discard_dms_upload_command', {
        p_version_id: versionId,
        p_reason: `upload failed: ${put.error.message}`,
      });
      this.data.invalidate(UPLOAD_INVALIDATES);
      this.log.write(
        'Application',
        'error',
        EVENT_IDS.documentUploadFailed,
        'DocumentStore',
        `docs.upload could not store ${storagePath}: ${put.error.message}`,
        { documentId, versionId, storagePath, discarded: discarded.ok },
        pid,
      );
      return fail('IO_ERROR', put.error.message, { storagePath, discarded: discarded.ok });
    }

    // Step 3 of 3. Size and MIME are recorded from what was actually sent.
    const finalized = await this.rpc(pid, 'finalize_dms_upload_command', {
      p_version_id: versionId,
      p_size_bytes: sizeBytes,
      p_mime_type: contentType,
      p_checksum_sha256: checksum,
      p_page_count: null,
      p_queue_extraction: request.queueExtraction ?? true,
    });
    // Deliberately not rolled back. The bytes are there and the row is
    // RESERVED; leaving both means a retry of finalize alone can succeed
    // without re-sending the file, which discarding here would make impossible.
    this.data.invalidate(UPLOAD_INVALIDATES);
    if (!finalized.ok) return finalized;

    const row = finalized.value;
    const result = describeUpload(row, slot, { documentId, versionId }, { checksum, sizeBytes });

    this.log.write(
      'Application',
      'information',
      EVENT_IDS.documentUploaded,
      'DocumentStore',
      `${result.documentId} v${result.versionNumber} filed (${sizeBytes} bytes)`,
      {
        documentId: result.documentId,
        versionId: result.versionId,
        checksum,
        sizeBytes,
        reviewStatus: result.reviewStatus,
      },
      pid,
    );
    return succeed(result);
  }

  async signedUrl(pid: Pid, request: DocumentUrlRequest): Promise<AbiResult<DocumentUrlResult>> {
    const documentId = request.documentId.trim();
    const storagePath = request.storagePath.trim();
    if (documentId === '' || storagePath === '') {
      return fail('INVALID_ARGUMENT', 'A signed link needs a document and a storage path.');
    }
    if (!isSupabaseConfigured) return fail('IO_ERROR', 'The document store is not configured');
    const ttl = Math.min(Math.max(Math.trunc(request.expiresInSeconds ?? DEFAULT_TTL_SECONDS), 1), MAX_TTL_SECONDS);

    // Recorded before the link exists, and through the broker so it goes down
    // the same audited path as every other command. A download that happens
    // outside the app — the URL pasted elsewhere, opened tomorrow — still has a
    // ledger entry behind it, because the entry is written at issue time.
    const logged = await this.data.command(pid, {
      command: 'dms.document.recordAccess',
      payload: { documentId, action: 'SIGNED_URL_ISSUED' },
    });
    if (!logged.ok) return logged;

    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, ttl);
      if (error !== null) {
        this.log.write(
          'Application',
          'error',
          EVENT_IDS.documentUrlIssued,
          'DocumentStore',
          `docs.signedUrl failed for ${storagePath}: ${error.message}`,
          { documentId, storagePath },
          pid,
        );
        return fail('IO_ERROR', error.message, { storagePath });
      }
      const url = str(data?.signedUrl);
      if (url === null) return fail('IO_ERROR', 'The document store did not return a link.', { storagePath });
      return succeed({
        url,
        expiresAt: isoTimestamp(new Date(this.clock.now() + ttl * 1_000).toISOString()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail('IO_ERROR', message, { storagePath });
    }
  }
}

export function createDocumentStore(
  clock: KernelClock,
  log: KernelLogger,
  data: DataBrokerSubsystem,
): DocumentSubsystem {
  return new DocumentStore(clock, log, data);
}
