/**
 * Documents — the contract, transcribed.
 *
 * Every union here is a CHECK constraint in
 * `supabase/migrations/20260831120000_dms_vertical_slice.sql`, and every
 * nullable field is a column that migration leaves nullable. A wider type would
 * let a screen send a value the database rejects at runtime.
 *
 * Transcribed rather than imported on purpose. `verify-os-boundary` allows an
 * app exactly two outside imports — `@/platform/sdk` and
 * `@/platform/kernel/abi` — so `@/types/dms` is out of reach from here even
 * though it says the same thing. That is the point of the wall: an app depends
 * on the ABI and on the migration, never on the admin code it replaced. The
 * cost is this file; the benefit was proved when `src/components/admin/dms/`
 * was deleted and nothing here moved.
 *
 * The two halves read differently and should. The unions and constants below
 * are snake-and-shout because that is how the database spells them and they
 * travel over the wire unchanged. The record interfaces further down are
 * camelCase because they are what the app holds after {@link SourceRow} has
 * been narrowed — a document has a review status, not a `review_status`.
 */

/* ------------------------------------------------------------------ *
 * Wire vocabulary
 * ------------------------------------------------------------------ */

export type DmsReviewStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED'
  | 'EXPIRED'
  | 'SUPERSEDED';

export type DmsConfidentiality = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

/** Where a version's bytes are. `LEGACY` is a row that predates the protocol. */
export type DmsUploadState = 'RESERVED' | 'UPLOADED' | 'LEGACY' | 'FAILED';

/** The seventeen things a document can be filed against. */
export type DmsLinkEntityType =
  | 'pilgrim'
  | 'booking'
  | 'group'
  | 'package'
  | 'payment'
  | 'invoice'
  | 'supplier'
  | 'supplier_bill'
  | 'contract'
  | 'hotel_contract'
  | 'journal_entry'
  | 'crm_customer'
  | 'crm_quote'
  | 'crm_opportunity'
  | 'staff_profile'
  | 'visa'
  | 'external_operation';

export type DmsLinkRelation =
  | 'ABOUT'
  | 'EVIDENCE_FOR'
  | 'SIGNED_BY'
  | 'ISSUED_BY'
  | 'INVOICE_FOR'
  | 'CONTRACT_FOR';

export type DmsDocumentRelation =
  | 'SUPERSEDES'
  | 'SUPPORTS'
  | 'TRANSLATION_OF'
  | 'SIGNED_COPY_OF'
  | 'ATTACHMENT_OF'
  | 'AMENDS'
  | 'RELATED';

/** Lowercase because the extraction queue's CHECK is lowercase. Not a slip. */
export type DmsExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type DmsJobReviewState = 'NOT_REVIEWED' | 'PARTIALLY_REVIEWED' | 'REVIEWED';

export type DmsFieldReviewState = 'PENDING' | 'ACCEPTED' | 'CORRECTED' | 'REJECTED';

export type DmsPackageStatus = 'OPEN' | 'SEALED' | 'VOID';

export type DmsAccessAction = 'VIEWED' | 'DOWNLOADED' | 'SIGNED_URL_ISSUED';

/* ------------------------------------------------------------------ *
 * Constants the screens reason about before the server does
 * ------------------------------------------------------------------ */

/**
 * Every legal move in `private.dms_review_transition`, copied from its VALUES
 * list so a button can be greyed out instead of round-tripping to a raised
 * exception. The server still decides; this only decides what to offer.
 *
 * EXPIRED and SUPERSEDED have no targets on purpose. EXPIRED is written only by
 * the expiry sweep — a fact about the calendar — and SUPERSEDED only by a new
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

/**
 * The mime types `storage.buckets` accepts for the `dms` bucket, verbatim.
 *
 * Used to set the file picker's `accept` and to say *why* before a doomed
 * upload, not to refuse one: the kernel's `docs.upload` deliberately carries no
 * allow-list because the bucket owns that decision, and a list that drifts here
 * would block a file the server would have taken.
 */
export const DMS_ALLOWED_MIME: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

/** 25 MiB, matching the bucket's `file_size_limit` and the `size_bytes` CHECK. */
export const DMS_MAX_BYTES = 26_214_400;

/** The six tabs, in the order a document is lived through rather than a menu. */
export const DMS_VIEWS = ['dashboard', 'library', 'review', 'expiry', 'extraction', 'packages'] as const;

export type DmsView = (typeof DMS_VIEWS)[number];

/* ------------------------------------------------------------------ *
 * Rows as they arrive
 * ------------------------------------------------------------------ */

/** One untyped row from the broker, before {@link module:model} narrows it. */
export type SourceRow = Readonly<Record<string, unknown>>;

/* ------------------------------------------------------------------ *
 * The records. One interface per thing a person points at, named for the
 * business rather than the table: a clerk has documents and versions, not
 * `dms_documents` rows.
 * ------------------------------------------------------------------ */

/**
 * A document as the library grid and the detail pane hold it.
 *
 * `status` and `reviewStatus` are both here and are not duplicates: `status` is
 * the row's lifecycle (`ACTIVE` / `ARCHIVED`), `reviewStatus` is where it sits
 * in the approval chain. A document can be APPROVED and archived at once.
 */
export interface DmsDocument {
  readonly id: string;
  /** Server-assigned, and null until the first version is finalized. */
  readonly documentNumber: string | null;
  readonly title: string;
  readonly description: string;
  readonly documentType: string;
  readonly status: string;
  readonly reviewStatus: DmsReviewStatus;
  readonly confidentiality: DmsConfidentiality;
  readonly tags: readonly string[];
  readonly currentVersionId: string | null;
  readonly versionCount: number;
  readonly submittedAt: string | null;
  readonly reviewerId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNotes: string;
  readonly approvedAt: string | null;
  readonly rejectionReason: string;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  readonly expiryNoticeDays: number;
  readonly archivedAt: string | null;
  readonly workspaceId: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /**
   * Whole days from today to `expiresOn`, negative once past, null when the
   * document never expires. Derived on read so every grid, tile and tone in the
   * app agrees on the number rather than each recomputing midnight.
   */
  readonly daysRemaining: number | null;
  /** Carried so the metadata editor can prefill by column name. */
  readonly row: SourceRow;
}

/** One entry in a document's version chain. */
export interface DmsVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly uploadState: DmsUploadState;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly checksumSha256: string | null;
  readonly pageCount: number | null;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly uploadedAt: string | null;
  readonly supersededAt: string | null;
  readonly notes: string;
  readonly isCurrent: boolean;
}

/** A document filed against a business entity. */
export interface DmsLink {
  readonly id: string;
  readonly entityType: DmsLinkEntityType;
  readonly entityId: string;
  readonly relation: DmsLinkRelation;
  readonly note: string;
  readonly createdAt: string | null;
}

/** A document filed against another document, in either direction. */
export interface DmsRelation {
  readonly id: string;
  readonly direction: 'OUTGOING' | 'INCOMING';
  readonly relation: DmsDocumentRelation;
  readonly documentId: string;
  readonly documentNumber: string | null;
  readonly title: string;
  readonly reviewStatus: DmsReviewStatus;
}

/**
 * One line of a document's history.
 *
 * A business record, not an audit record: this is `dms_document_events`, which
 * is why the app reads it through `dmsDocument360` and does not request
 * `eventlog.read`. Who returned a passport scan and why is the clerk's
 * business; the kernel's Security channel is the auditor's.
 */
export interface DmsEvent {
  readonly id: number;
  readonly eventType: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly detail: string;
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly versionId: string | null;
  readonly createdAt: string | null;
}

/** One value the extraction engine read off a page, and its review state. */
export interface DmsField {
  readonly id: string;
  readonly fieldKey: string;
  readonly fieldLabel: string;
  /** What the engine saw. Kept beside {@link value} so a correction is visible. */
  readonly rawValue: string;
  readonly value: string;
  /** 0–1 from the engine, null when it did not say. */
  readonly confidence: number | null;
  readonly pageNumber: number | null;
  readonly reviewState: DmsFieldReviewState;
}

/** One extraction run over one version. */
export interface DmsJob {
  readonly id: string;
  readonly versionId: string | null;
  readonly status: DmsExtractionStatus;
  readonly engine: string;
  readonly attempts: number;
  readonly confidence: number | null;
  readonly reviewState: DmsJobReviewState;
  readonly errorMessage: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string | null;
  readonly fields: readonly DmsField[];
}

/** An evidence package this document is a member of. */
export interface DmsMembership {
  readonly id: string;
  readonly name: string;
  readonly status: DmsPackageStatus;
  readonly reference: string;
  readonly sealedAt: string | null;
  readonly sequenceNo: number | null;
  /**
   * The version that was current when the package was sealed. Compared against
   * the document's `currentVersionId` to show drift: same id means the sealed
   * claim still describes what is on screen.
   */
  readonly sealedVersionId: string | null;
}

/** Everything about one document, from a single RPC. */
export interface DmsDocument360 {
  readonly document: DmsDocument;
  readonly versions: readonly DmsVersion[];
  readonly links: readonly DmsLink[];
  readonly relations: readonly DmsRelation[];
  readonly events: readonly DmsEvent[];
  readonly jobs: readonly DmsJob[];
  readonly packages: readonly DmsMembership[];
}

/* ------------------------------------------------------------------ *
 * The five reports. Each is one object from one RPC, so each is held whole:
 * a caller wants all of a report's buckets at once or none of them.
 * ------------------------------------------------------------------ */

export interface DmsDashboardTotals {
  readonly documents: number;
  readonly approved: number;
  readonly awaitingReview: number;
  readonly expiringSoon: number;
  readonly expired: number;
  readonly archived: number;
  readonly versions: number;
  readonly createdInWindow: number;
}

export interface DmsDashboard {
  readonly windowDays: number;
  readonly totals: DmsDashboardTotals;
  readonly byStatus: readonly { readonly status: DmsReviewStatus; readonly count: number }[];
  readonly byType: readonly {
    readonly documentType: string;
    readonly count: number;
    readonly approved: number;
  }[];
  readonly byConfidentiality: readonly {
    readonly confidentiality: DmsConfidentiality;
    readonly count: number;
  }[];
  readonly activity: readonly {
    readonly day: string;
    readonly uploads: number;
    readonly approvals: number;
    readonly returns: number;
  }[];
}

/**
 * One document waiting on somebody. Not a {@link DmsDocument}: the queue's RPC
 * carries the wait itself (`waitingHours`) and whether the bytes are actually
 * there (`hasVerifiedBytes`), neither of which is a column on the table.
 */
export interface DmsQueueRow {
  readonly id: string;
  readonly documentNumber: string | null;
  readonly title: string;
  readonly documentType: string;
  readonly reviewStatus: DmsReviewStatus;
  readonly confidentiality: DmsConfidentiality;
  readonly submittedAt: string | null;
  readonly submittedBy: string | null;
  readonly reviewerId: string | null;
  readonly reviewStartedAt: string | null;
  readonly versionCount: number;
  readonly expiresOn: string | null;
  readonly waitingHours: number | null;
  /**
   * False means a version row exists but its upload never finalized. Shown in
   * the queue because approving a document whose bytes are missing approves
   * nothing — the reviewer needs to know before they open it, not after.
   */
  readonly hasVerifiedBytes: boolean;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
}

export interface DmsExpiryDocument {
  readonly id: string;
  readonly documentNumber: string | null;
  readonly title: string;
  readonly documentType: string;
  readonly reviewStatus: DmsReviewStatus;
  readonly issuedOn: string | null;
  readonly expiresOn: string;
  readonly expiryNoticeDays: number;
  readonly expiryNotifiedAt: string | null;
  readonly daysRemaining: number;
  /** What this document is evidence for — a passport with no pilgrim is noise. */
  readonly linkedEntityTypes: readonly DmsLinkEntityType[];
}

export interface DmsExpiryReport {
  readonly horizonDays: number;
  readonly buckets: {
    readonly expired: number;
    readonly within7: number;
    readonly within30: number;
    readonly within90: number;
    readonly beyond: number;
    readonly noExpiry: number;
  };
  readonly documents: readonly DmsExpiryDocument[];
}

export interface DmsQualityJobs {
  readonly total: number;
  readonly pending: number;
  readonly processing: number;
  readonly completed: number;
  readonly failed: number;
  readonly reviewed: number;
  readonly avgConfidence: number | null;
  readonly avgSeconds: number | null;
}

export interface DmsQualityField {
  readonly fieldKey: string;
  readonly extracted: number;
  readonly accepted: number;
  readonly corrected: number;
  readonly rejected: number;
  readonly pending: number;
  readonly avgConfidence: number | null;
  /**
   * Accepted over reviewed, as a percentage, from the server. Null while
   * nothing has been reviewed — zero would read as "the engine is always
   * wrong" when it means "nobody has checked yet".
   */
  readonly accuracyPct: number | null;
}

export interface DmsQualityEngine {
  readonly engine: string;
  readonly jobs: number;
  readonly failed: number;
  readonly avgConfidence: number | null;
}

export interface DmsExtractionQuality {
  readonly windowDays: number;
  readonly jobs: DmsQualityJobs;
  readonly byField: readonly DmsQualityField[];
  readonly byEngine: readonly DmsQualityEngine[];
}

/** One member of an evidence package, as the package list holds it. */
export interface DmsPackageDocument {
  readonly documentId: string;
  readonly sequenceNo: number | null;
  readonly documentNumber: string | null;
  readonly title: string;
  readonly reviewStatus: DmsReviewStatus;
  readonly versionId: string | null;
  readonly checksumSha256: string | null;
}

export interface DmsPackage {
  readonly id: string;
  readonly name: string;
  readonly status: DmsPackageStatus;
  readonly reference: string;
  readonly purpose: string;
  readonly notes: string;
  readonly documentCount: number;
  readonly sealedAt: string | null;
  readonly sealedBy: string | null;
  readonly sealChecksum: string | null;
  readonly createdAt: string | null;
  readonly createdBy: string | null;
  /**
   * Null while the package is not SEALED — there is nothing to match yet. False
   * on a sealed package means a member has changed underneath the seal, which
   * is the one thing this whole subsystem exists to be able to say.
   */
  readonly sealMatches: boolean | null;
  readonly driftedDocuments: number;
  readonly documents: readonly DmsPackageDocument[];
}

/** One member whose bytes no longer match what was sealed. */
export interface DmsDrift {
  readonly documentId: string;
  readonly documentNumber: string | null;
  readonly title: string;
  readonly sealedVersionId: string | null;
  readonly currentVersionId: string | null;
  readonly sealedChecksum: string | null;
  readonly currentChecksum: string | null;
  readonly reviewStatus: DmsReviewStatus;
}

/**
 * The answer to "does the seal still hold". Recomputed server-side by
 * `dms.package.verify`, which is a read wearing a command's clothes: it needs
 * SECURITY DEFINER over tables no app may select from, so it cannot be a
 * dataset even though it changes nothing.
 */
export interface DmsVerification {
  readonly packageId: string;
  readonly status: DmsPackageStatus;
  readonly sealedAt: string | null;
  readonly sealChecksum: string | null;
  readonly recomputedChecksum: string;
  readonly matches: boolean;
  readonly drift: readonly DmsDrift[];
}
