/**
 * Documents — the read model.
 *
 * Seven queries. Six of them stay live whatever tab is open, because the rail carries a count
 * against every surface and a count that only exists while you are looking at it is not a
 * count. The seventh — the 360 payload behind one document — follows the selection, and is the
 * only query in the app that is ever disabled.
 *
 * Four of the seven return ONE OBJECT rather than a page: the dashboard, the 360 view, the
 * expiry report and the extraction-quality report are each a single jsonb value the server
 * assembles in one pass. The broker marks those `asDocumentRows`, so they arrive here as a
 * one-row page and the reader takes `rows[0] ?? null`. That is not a workaround; a caller
 * wants all of a report's buckets or none of them, and a bucket read separately from its own
 * total is how a dashboard comes to disagree with itself.
 *
 * This file is the only place the database's spelling appears. Everything above it in the app
 * reads camelCase records off `./types`; everything below it is `snake_case` transcribed from
 * the migration. Five of those names do not match what a reader would guess, and each cost a
 * silent all-zero render to discover:
 *
 *     by_status[].review_status / .document_count   (NOT status / count)
 *     by_type[].document_count / .approved_count    (NOT count / approved)
 *     by_confidentiality[].document_count
 *     the 360 payload's `extraction_jobs`           (NOT jobs)
 *     the 360 payload's `evidence_packages`         (NOT packages)
 *
 * None of those would fail a typecheck or throw: `num(undefined)` is 0 and `mapList` of a
 * missing key is `[]`, so a wrong name renders a quiet week rather than a broken read. They are
 * checked against `20260831120000_dms_vertical_slice.sql` by eye and by nothing else.
 *
 * Pages are windows. `dmsDocuments` is a table read with an equality-only `where`, so the text
 * search happens here, over the page, exactly as CRM's lists filter — and `truncated` says
 * when the window is full so that "not on this page" is never read as "not in the database".
 */
import { useCallback, useMemo, useRef } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import { asBoolean, asNumber, asString, num, str } from '../shared/guards';
import { daysUntil } from './format';
import {
  CONFIDENTIALITY_LABEL,
  DOC_RELATION_LABEL,
  EXTRACTION_LABEL,
  FIELD_REVIEW_LABEL,
  JOB_REVIEW_LABEL,
  LINK_ENTITY_LABEL,
  LINK_RELATION_LABEL,
  PACKAGE_LABEL,
  REVIEW_LABEL,
  UPLOAD_STATE_LABEL,
} from './labels';
import type {
  DmsDashboard,
  DmsDocument,
  DmsDocument360,
  DmsDrift,
  DmsEvent,
  DmsExpiryDocument,
  DmsExpiryReport,
  DmsExtractionQuality,
  DmsField,
  DmsJob,
  DmsLink,
  DmsLinkEntityType,
  DmsMembership,
  DmsPackage,
  DmsPackageDocument,
  DmsQualityEngine,
  DmsQualityField,
  DmsQueueRow,
  DmsRelation,
  DmsVerification,
  DmsVersion,
  SourceRow,
} from './types';

/* ------------------------------------------------------------------ *
 * Windows
 *
 * Every number here is inside the clamp the server would apply anyway, so a page is short
 * because this app asked for a short page and never because a function silently trimmed it.
 * ------------------------------------------------------------------ */

/** Documents per read. The table has no server clamp, so this one is the only bound. */
const PAGE = 400;

/** Queue rows per read. `get_dms_review_queue` clamps to 1–500. */
const QUEUE = 200;

/** Packages per read. `get_dms_evidence_packages` clamps to 1–500. */
const PACKAGES = 120;

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** A timestamp or date column. Empty string is a missing value, not an epoch. */
const iso = (value: unknown): string | null => {
  const text = asString(value);
  return text === null || text === '' ? null : text;
};

/** A `text[]` column as the grid holds it. Non-strings are dropped rather than stringified. */
function tagList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = asString(entry);
    if (text !== null && text !== '') out.push(text);
  }
  return out;
}

/**
 * One jsonb object, or nothing.
 *
 * Arrays are rejected as well as nulls: `typeof [] === 'object'` is true, and a mapper handed
 * an array would read every key as undefined and return a record of zeroes and empty strings.
 */
function objOf(value: unknown): SourceRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as SourceRow;
}

/**
 * A jsonb array through a mapper, nulls dropped.
 *
 * Takes `unknown` rather than an array because most of what it is handed is a key off a jsonb
 * payload that may be absent. A missing key is an empty list — the same reading the server
 * gives it, since every `jsonb_agg` in the DMS functions is wrapped in a `coalesce(…, '[]')`.
 */
function mapList<T>(value: unknown, map: (row: SourceRow) => T | null): readonly T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const row = objOf(entry);
    if (row === null) continue;
    const mapped = map(row);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Narrowing
 *
 * Eleven of the columns this file reads are CHECK constraints in the migration and unions in
 * `./types`. The database guarantees the value; `unknown` does not. Narrowing therefore happens
 * exactly once, here, against a table that has a key for every member of the union — and the
 * tables in `./labels` are the right witness because that file is the only one carrying a table
 * for all eleven, tones being defined for eight.
 *
 * The fallback is always the member that claims the least. A value this app cannot read is a
 * value the server changed underneath it, and the safe reading of an unreadable state is the
 * one that grants nothing: RESTRICTED rather than PUBLIC, RESERVED rather than UPLOADED,
 * NOT_REVIEWED rather than REVIEWED, DRAFT rather than APPROVED. A cast would have been
 * shorter and would have rendered `Approved` for a token no version of this schema emits.
 * ------------------------------------------------------------------ */

/**
 * Whether a label table has this key as its own.
 *
 * `hasOwnProperty` rather than `in`, which walks the prototype chain and would answer true for
 * `'constructor'`, `'toString'` and eleven others. Postgres will never send those, so this is
 * not a bug being fixed; it is a free way to make the membership test mean what it says.
 */
const has = (table: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

/** A wire token narrowed to its union, or the fallback. */
function oneOf<T extends string>(
  value: unknown,
  table: Readonly<Record<T, unknown>>,
  fallback: T,
): T {
  const text = asString(value);
  if (text === null) return fallback;
  return has(table, text) ? (text as T) : fallback;
}

/**
 * The distinct entity types one expiring document is filed against.
 *
 * Unknown members are dropped rather than folded into `external_operation`, because this list
 * renders as a row of chips and three unreadable types would otherwise read as the same
 * "External operation" three times over. A dropped chip is a gap; a duplicated one is a lie.
 */
function entityList(value: unknown): readonly DmsLinkEntityType[] {
  if (!Array.isArray(value)) return [];
  const out: DmsLinkEntityType[] = [];
  for (const entry of value) {
    const text = asString(entry);
    if (text !== null && has(LINK_ENTITY_LABEL, text)) out.push(text as DmsLinkEntityType);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Searching and indexing the page
 * ------------------------------------------------------------------ */

/** Case-insensitive substring across a record's searchable fields. Nulls simply do not match. */
function hit(needle: string, ...fields: readonly (string | null)[]): boolean {
  for (const field of fields) {
    if (field !== null && field.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * A list filtered by a needle, or the same list back.
 *
 * Returning `all` itself on an empty needle matters: it keeps the array identity stable, so a
 * grid memoized on its rows does not re-render every time a keystroke is deleted.
 */
function filterAll<T>(all: readonly T[], needle: string, match: (item: T) => boolean): readonly T[] {
  return needle === '' ? all : all.filter(match);
}

/** Documents by id, so a selection resolves without walking the page. */
function index(documents: readonly DmsDocument[]): ReadonlyMap<string, DmsDocument> {
  const map = new Map<string, DmsDocument>();
  for (const document of documents) map.set(document.id, document);
  return map;
}

/**
 * Whether any window came back full.
 *
 * A full page is indistinguishable from a complete one, and the difference matters most to the
 * person who searched for a document, found nothing, and would otherwise conclude it is not in
 * the system. The chrome renders this as a line saying which window was hit.
 */
function windowed(pairs: readonly (readonly [number, number])[]): boolean {
  for (const [count, limit] of pairs) {
    if (count >= limit) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * The mappers. One per record interface, module-level and pure, because
 * `useMappedDataset` memoizes on the function's identity and a mapper declared inside a
 * component would remap every row on every render.
 *
 * Each returns `null` for a row it cannot identify, and `mapList` drops those. A row with no
 * id is a row nothing can be done to — it cannot be selected, opened or commanded — so
 * carrying it into the grid would put a line on screen that ignores every click.
 * ------------------------------------------------------------------ */

/**
 * One row of `dms_documents`.
 *
 * `daysRemaining` is derived here rather than read, because the table carries `expires_on` and
 * no day count. Deriving it once per document, through `format.ts`'s `daysUntil`, is what makes
 * a grid cell, a KPI tile and a badge tone agree on the number instead of each of them crossing
 * midnight independently. The raw row is carried on `row` so the metadata editor can prefill by
 * column name without a second read.
 */
function toDocument(row: SourceRow): DmsDocument | null {
  const id = asString(row.id);
  if (id === null) return null;
  const expiresOn = iso(row.expires_on);
  return {
    id,
    documentNumber: asString(row.document_number),
    title: str(row.title),
    description: str(row.description),
    documentType: str(row.document_type),
    status: str(row.status),
    reviewStatus: oneOf(row.review_status, REVIEW_LABEL, 'DRAFT'),
    confidentiality: oneOf(row.confidentiality, CONFIDENTIALITY_LABEL, 'RESTRICTED'),
    tags: tagList(row.tags),
    currentVersionId: asString(row.current_version_id),
    versionCount: num(row.version_count),
    submittedAt: iso(row.submitted_at),
    reviewerId: asString(row.reviewer_id),
    reviewedAt: iso(row.reviewed_at),
    reviewNotes: str(row.review_notes),
    approvedAt: iso(row.approved_at),
    rejectionReason: str(row.rejection_reason),
    issuedOn: iso(row.issued_on),
    expiresOn,
    expiryNoticeDays: num(row.expiry_notice_days),
    archivedAt: iso(row.archived_at),
    workspaceId: str(row.workspace_id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    daysRemaining: daysUntil(expiresOn),
    row,
  };
}

/**
 * One entry in a version chain.
 *
 * `isCurrent` is not a column — the server computes `v.id = d.current_version_id` inside the
 * 360 payload — so it is read as a boolean and defaults to false. Defaulting the other way
 * would mark every version current in a payload that stopped emitting the flag, and "current"
 * is the version every download and every seal resolves to.
 */
function toVersion(row: SourceRow): DmsVersion | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    versionNumber: num(row.version_number),
    uploadState: oneOf(row.upload_state, UPLOAD_STATE_LABEL, 'RESERVED'),
    originalFilename: str(row.original_filename),
    mimeType: str(row.mime_type),
    sizeBytes: asNumber(row.size_bytes),
    checksumSha256: asString(row.checksum_sha256),
    pageCount: asNumber(row.page_count),
    storageBucket: str(row.storage_bucket),
    storagePath: str(row.storage_path),
    uploadedAt: iso(row.uploaded_at),
    supersededAt: iso(row.superseded_at),
    notes: str(row.notes),
    isCurrent: asBoolean(row.is_current) ?? false,
  };
}

/** A document filed against a business entity. Dropped without an `entity_id`: an unresolvable link. */
function toLink(row: SourceRow): DmsLink | null {
  const id = asString(row.id);
  const entityId = asString(row.entity_id);
  if (id === null || entityId === null) return null;
  return {
    id,
    entityType: oneOf(row.entity_type, LINK_ENTITY_LABEL, 'external_operation'),
    entityId,
    relation: oneOf(row.relation, LINK_RELATION_LABEL, 'ABOUT'),
    note: str(row.note),
    createdAt: iso(row.created_at),
  };
}

/**
 * A document filed against another document.
 *
 * `documentId` is the OTHER document, not the one on screen: the server's UNION ALL selects
 * `r.other_id` in both halves and stamps a literal `'OUTGOING'` or `'INCOMING'` so one row can
 * be read from either end. `direction` is narrowed against the literal rather than through a
 * label table because it is not a CHECK constraint — it exists only in the query.
 *
 * A caller keying a list off `id` alone should key off `direction` too: the same relation row
 * appears once per direction, and nothing in the payload guarantees the two ids differ.
 */
function toRelation(row: SourceRow): DmsRelation | null {
  const id = asString(row.id);
  const documentId = asString(row.document_id);
  if (id === null || documentId === null) return null;
  return {
    id,
    direction: asString(row.direction) === 'INCOMING' ? 'INCOMING' : 'OUTGOING',
    relation: oneOf(row.relation, DOC_RELATION_LABEL, 'RELATED'),
    documentId,
    documentNumber: asString(row.document_number),
    title: str(row.title),
    reviewStatus: oneOf(row.review_status, REVIEW_LABEL, 'DRAFT'),
  };
}

/**
 * One line of history.
 *
 * The id is a bigint identity, so it is read as a number and a row without one is dropped —
 * history is rendered as a keyed list and two lines sharing a key is a React warning at best.
 * `event_type`, `from_state` and `to_state` stay strings: `dms_document_events` has no CHECK on
 * any of the three, so there is no union to narrow to and `./tones`' `eventTone` reads them raw.
 * The payload also carries `metadata`, which nothing renders and which is therefore not read.
 */
function toEvent(row: SourceRow): DmsEvent | null {
  const id = asNumber(row.id);
  if (id === null) return null;
  return {
    id,
    eventType: str(row.event_type),
    fromState: asString(row.from_state),
    toState: asString(row.to_state),
    detail: str(row.detail),
    actorId: asString(row.actor_id),
    actorRole: asString(row.actor_role),
    versionId: asString(row.version_id),
    createdAt: iso(row.created_at),
  };
}

/**
 * One value the engine read off a page.
 *
 * `rawValue` and `value` are both kept and are not redundant: they are equal until a reviewer
 * corrects the field, and the pair is the only place the correction is visible. `confidence`
 * stays nullable — some engines return no score, and 0 would read as a verdict.
 */
function toField(row: SourceRow): DmsField | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    fieldKey: str(row.field_key),
    fieldLabel: str(row.field_label),
    rawValue: str(row.raw_value),
    value: str(row.value),
    confidence: asNumber(row.confidence),
    pageNumber: asNumber(row.page_number),
    reviewState: oneOf(row.review_state, FIELD_REVIEW_LABEL, 'PENDING'),
  };
}

/** One extraction run, with its fields nested inside the same payload. */
function toJob(row: SourceRow): DmsJob | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    versionId: asString(row.version_id),
    status: oneOf(row.status, EXTRACTION_LABEL, 'pending'),
    engine: str(row.engine),
    attempts: num(row.attempts),
    confidence: asNumber(row.confidence),
    reviewState: oneOf(row.review_state, JOB_REVIEW_LABEL, 'NOT_REVIEWED'),
    errorMessage: str(row.error_message),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at),
    fields: mapList(row.fields, toField),
  };
}

/**
 * A package this document belongs to.
 *
 * `id` is the PACKAGE's id, not the membership row's — the server selects `ep.id` — which is
 * what a click on the line needs in order to open the package. `sealedVersionId` comes from the
 * join row and is compared against the document's `currentVersionId` to show drift.
 */
function toMembership(row: SourceRow): DmsMembership | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    name: str(row.name),
    status: oneOf(row.status, PACKAGE_LABEL, 'OPEN'),
    reference: str(row.reference),
    sealedAt: iso(row.sealed_at),
    sequenceNo: asNumber(row.sequence_no),
    sealedVersionId: asString(row.sealed_version_id),
  };
}

/**
 * One document waiting on somebody.
 *
 * Two of these fields are not columns anywhere. `waitingHours` is an `EXTRACT(EPOCH …)/3600`
 * over `coalesce(submitted_at, created_at)`, which is why it is a float and why it is nullable.
 * `hasVerifiedBytes` is `checksum_sha256 is not null` on the current version, and it defaults
 * to false because false is the reading that makes a reviewer look: a document whose upload
 * never finalized looks complete in every list and opens to nothing.
 */
function toQueueRow(row: SourceRow): DmsQueueRow | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    documentNumber: asString(row.document_number),
    title: str(row.title),
    documentType: str(row.document_type),
    reviewStatus: oneOf(row.review_status, REVIEW_LABEL, 'DRAFT'),
    confidentiality: oneOf(row.confidentiality, CONFIDENTIALITY_LABEL, 'RESTRICTED'),
    submittedAt: iso(row.submitted_at),
    submittedBy: asString(row.submitted_by),
    reviewerId: asString(row.reviewer_id),
    reviewStartedAt: iso(row.review_started_at),
    versionCount: num(row.version_count),
    expiresOn: iso(row.expires_on),
    waitingHours: asNumber(row.waiting_hours),
    hasVerifiedBytes: asBoolean(row.has_verified_bytes) ?? false,
    mimeType: str(row.mime_type),
    sizeBytes: asNumber(row.size_bytes),
  };
}

/**
 * One row of the expiry report.
 *
 * This is the one place `daysRemaining` is READ rather than derived, and the divergence from
 * {@link toDocument} is deliberate. The server computes `expires_on - current_date` in the same
 * pass that counts the buckets, so taking its number keeps the list and the bucket totals
 * describing the same calendar. Recomputing it here against `Date.now()` would eventually put a
 * document in the `within7` bucket next to a cell reading `8 days` — the report contradicting
 * itself over a timezone.
 *
 * Dropped without an `expires_on` or a day count, because the report's own WHERE clause
 * guarantees both: a row missing either is not a row this report is about.
 */
function toExpiryDocument(row: SourceRow): DmsExpiryDocument | null {
  const id = asString(row.id);
  const expiresOn = iso(row.expires_on);
  const daysRemaining = asNumber(row.days_remaining);
  if (id === null || expiresOn === null || daysRemaining === null) return null;
  return {
    id,
    documentNumber: asString(row.document_number),
    title: str(row.title),
    documentType: str(row.document_type),
    reviewStatus: oneOf(row.review_status, REVIEW_LABEL, 'DRAFT'),
    issuedOn: iso(row.issued_on),
    expiresOn,
    expiryNoticeDays: num(row.expiry_notice_days),
    expiryNotifiedAt: iso(row.expiry_notified_at),
    daysRemaining,
    linkedEntityTypes: entityList(row.linked_entity_types),
  };
}

/** One member of a package. Keyed on `document_id`; there is no membership id in the payload. */
function toPackageDocument(row: SourceRow): DmsPackageDocument | null {
  const documentId = asString(row.document_id);
  if (documentId === null) return null;
  return {
    documentId,
    sequenceNo: asNumber(row.sequence_no),
    documentNumber: asString(row.document_number),
    title: str(row.title),
    reviewStatus: oneOf(row.review_status, REVIEW_LABEL, 'DRAFT'),
    versionId: asString(row.version_id),
    checksumSha256: asString(row.checksum_sha256),
  };
}

/**
 * One evidence package.
 *
 * `sealMatches` keeps its null and is the only boolean in this file without a `?? false`. The
 * server's CASE has no ELSE branch — `case when status = 'SEALED' then seal_checksum = digest(id) end`
 * — so NULL means "not sealed, nothing to compare", while false means a member has changed
 * underneath a seal. Collapsing null to false would accuse every open package of drift, which
 * is the one accusation this subsystem exists to be able to make accurately.
 */
function toPackage(row: SourceRow): DmsPackage | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    name: str(row.name),
    status: oneOf(row.status, PACKAGE_LABEL, 'OPEN'),
    reference: str(row.reference),
    purpose: str(row.purpose),
    notes: str(row.notes),
    documentCount: num(row.document_count),
    sealedAt: iso(row.sealed_at),
    sealedBy: asString(row.sealed_by),
    sealChecksum: asString(row.seal_checksum),
    createdAt: iso(row.created_at),
    createdBy: asString(row.created_by),
    sealMatches: asBoolean(row.seal_matches),
    driftedDocuments: num(row.drifted_documents),
    documents: mapList(row.documents, toPackageDocument),
  };
}

/** One member whose bytes no longer match the seal. Keyed on `document_id`. */
function toDrift(row: SourceRow): DmsDrift | null {
  const documentId = asString(row.document_id);
  if (documentId === null) return null;
  return {
    documentId,
    documentNumber: asString(row.document_number),
    title: str(row.title),
    sealedVersionId: asString(row.sealed_version_id),
    currentVersionId: asString(row.current_version_id),
    sealedChecksum: asString(row.sealed_checksum),
    currentChecksum: asString(row.current_checksum),
    reviewStatus: oneOf(row.review_status, REVIEW_LABEL, 'DRAFT'),
  };
}

/**
 * The answer `dms.package.verify` returns — a command's result, not a dataset row.
 *
 * Exported, and the only mapper here that is, because its input arrives through
 * `data.command` rather than through a dataset: verification needs SECURITY DEFINER over
 * tables no app may select from, so it is a read that had to be shaped as a command.
 * `actions.ts` performs the invoke and hands the payload here, which keeps the promise
 * this file's header makes — the database's spelling appears in this file and nowhere
 * above it.
 *
 * Two of the seven keys would not be guessed. The package's own id is
 * `evidence_package_id`, not `package_id`, and it is the table's name rather than the
 * command's; and `matches` is a plain boolean here where `dmsPackages` carries the same
 * judgement as a three-valued `seal_matches`. This function's `matches` is therefore
 * `?? false`: the RPC computes `status = 'SEALED' and seal_checksum = digest`, which is
 * false for an open package rather than null, so there is no third state to preserve.
 *
 * A missing `evidence_package_id` returns null. The alternative — a verification record
 * with an empty id — would render as a verdict about nothing.
 */
export function toVerification(row: SourceRow): DmsVerification | null {
  const packageId = asString(row.evidence_package_id);
  if (packageId === null) return null;
  return {
    packageId,
    status: oneOf(row.status, PACKAGE_LABEL, 'OPEN'),
    sealedAt: iso(row.sealed_at),
    sealChecksum: asString(row.seal_checksum),
    recomputedChecksum: str(row.recomputed_checksum),
    matches: asBoolean(row.matches) ?? false,
    drift: mapList(row.drift, toDrift),
  };
}

/* ------------------------------------------------------------------ *
 * The four object payloads
 *
 * Each is one jsonb value, so each is read as a whole and returns null only when its own
 * required part is missing. The bar mappers below drop an unreadable key rather than folding it
 * into a fallback: `by_status` and `by_confidentiality` are LEFT JOINs over a VALUES list, so
 * every member appears exactly once at zero, and folding an unknown token into DRAFT would put
 * two DRAFT bars on the chart.
 * ------------------------------------------------------------------ */

/** `{review_status, sort_order, document_count}` — not `status` and not `count`. */
function toStatusBar(row: SourceRow): DmsDashboard['byStatus'][number] | null {
  const text = asString(row.review_status);
  if (text === null || !has(REVIEW_LABEL, text)) return null;
  return { status: text as DmsDocument['reviewStatus'], count: num(row.document_count) };
}

/** `{document_type, document_count, approved_count}`. The type is open text, so it is not narrowed. */
function toTypeBar(row: SourceRow): DmsDashboard['byType'][number] | null {
  const documentType = asString(row.document_type);
  if (documentType === null) return null;
  return {
    documentType,
    count: num(row.document_count),
    approved: num(row.approved_count),
  };
}

/** `{confidentiality, sort_order, document_count}`. */
function toConfidentialityBar(row: SourceRow): DmsDashboard['byConfidentiality'][number] | null {
  const text = asString(row.confidentiality);
  if (text === null || !has(CONFIDENTIALITY_LABEL, text)) return null;
  return {
    confidentiality: text as DmsDocument['confidentiality'],
    count: num(row.document_count),
  };
}

/** One day of the activity series. `day` is already `to_char(…,'YYYY-MM-DD')` on the server. */
function toActivityDay(row: SourceRow): DmsDashboard['activity'][number] | null {
  const day = asString(row.day);
  if (day === null) return null;
  return {
    day,
    uploads: num(row.uploads),
    approvals: num(row.approvals),
    returns: num(row.returns),
  };
}

/**
 * The dashboard, from `get_dms_dashboard`'s single jsonb object.
 *
 * Returns null when `totals` is absent rather than a record of zeroes. That distinction is the
 * whole reason this function exists: a dashboard of zeroes reads as a quiet week, and the view
 * has an empty state for "no answer" that looks nothing like eight zeros. Every count inside
 * `totals` is a `count(*)` over a filtered scan, so a genuine zero is a real zero and is kept.
 */
function toDashboard(row: SourceRow): DmsDashboard | null {
  const totals = objOf(row.totals);
  if (totals === null) return null;
  return {
    windowDays: num(row.window_days),
    totals: {
      documents: num(totals.documents),
      approved: num(totals.approved),
      awaitingReview: num(totals.awaiting_review),
      expiringSoon: num(totals.expiring_soon),
      expired: num(totals.expired),
      archived: num(totals.archived),
      versions: num(totals.versions),
      createdInWindow: num(totals.created_in_window),
    },
    byStatus: mapList(row.by_status, toStatusBar),
    byType: mapList(row.by_type, toTypeBar),
    byConfidentiality: mapList(row.by_confidentiality, toConfidentialityBar),
    activity: mapList(row.activity, toActivityDay),
  };
}

/**
 * Everything about one document, from `get_dms_document_360`.
 *
 * The two key names that are not what the interface calls them: `extraction_jobs`, not `jobs`,
 * and `evidence_packages`, not `packages`. Reading `row.jobs` here would compile, would not
 * throw, and would render an empty Extraction tab on a document with four jobs in it.
 *
 * There is no `accesses` key. `dms_document_access_log` is written by the signed-URL syscall and
 * read by nobody in this app — which is why {@link DmsAccessAction} is a command-side union with
 * no reader, and why the history pane shows events rather than accesses.
 */
function toDocument360(row: SourceRow): DmsDocument360 | null {
  const documentRow = objOf(row.document);
  if (documentRow === null) return null;
  const document = toDocument(documentRow);
  if (document === null) return null;
  return {
    document,
    versions: mapList(row.versions, toVersion),
    links: mapList(row.links, toLink),
    relations: mapList(row.relations, toRelation),
    events: mapList(row.events, toEvent),
    jobs: mapList(row.extraction_jobs, toJob),
    packages: mapList(row.evidence_packages, toMembership),
  };
}

/**
 * The expiry report, from `get_dms_expiry_report`.
 *
 * The bucket keys are snake_case with digits — `within_7`, `within_30`, `within_90`, `no_expiry`
 * — and the buckets are **cumulative, not disjoint**: the server counts `within_30` as
 * `days_remaining between 0 and 30`, so it already contains everything in `within_7`, and
 * `within_90` contains both. Summing all six would count the same passport three times. The rail
 * count below therefore adds `expired` to `within30` and stops.
 *
 * Returns null when `buckets` is absent, for the same reason {@link toDashboard} does.
 */
function toExpiryReport(row: SourceRow): DmsExpiryReport | null {
  const buckets = objOf(row.buckets);
  if (buckets === null) return null;
  return {
    horizonDays: num(row.horizon_days),
    buckets: {
      expired: num(buckets.expired),
      within7: num(buckets.within_7),
      within30: num(buckets.within_30),
      within90: num(buckets.within_90),
      beyond: num(buckets.beyond),
      noExpiry: num(buckets.no_expiry),
    },
    documents: mapList(row.documents, toExpiryDocument),
  };
}

/**
 * One field's extraction record. `accuracy_pct` is accepted-over-reviewed computed in SQL and
 * arrives as 0–100, which is why {@link module:format}'s `pct` divides before formatting. It
 * keeps its null: nothing reviewed is not the same as nothing right.
 */
function toQualityField(row: SourceRow): DmsQualityField | null {
  const fieldKey = asString(row.field_key);
  if (fieldKey === null) return null;
  return {
    fieldKey,
    extracted: num(row.extracted),
    accepted: num(row.accepted),
    corrected: num(row.corrected),
    rejected: num(row.rejected),
    pending: num(row.pending),
    avgConfidence: asNumber(row.avg_confidence),
    accuracyPct: asNumber(row.accuracy_pct),
  };
}

/** One engine's record. `engine` is open text — whatever the worker wrote into the column. */
function toQualityEngine(row: SourceRow): DmsQualityEngine | null {
  const engine = asString(row.engine);
  if (engine === null) return null;
  return {
    engine,
    jobs: num(row.jobs),
    failed: num(row.failed),
    avgConfidence: asNumber(row.avg_confidence),
  };
}

/**
 * The extraction-quality report, from `get_dms_extraction_quality`.
 *
 * `avgConfidence` and `avgSeconds` are `avg()` over a filtered set and are null when the set is
 * empty — an engine nobody has run has no average duration, and rendering that as `0s` would
 * advertise an instant engine. Both stay null all the way to `format.ts`, which prints a dash.
 */
function toQuality(row: SourceRow): DmsExtractionQuality | null {
  const jobs = objOf(row.jobs);
  if (jobs === null) return null;
  return {
    windowDays: num(row.window_days),
    jobs: {
      total: num(jobs.total),
      pending: num(jobs.pending),
      processing: num(jobs.processing),
      completed: num(jobs.completed),
      failed: num(jobs.failed),
      reviewed: num(jobs.reviewed),
      avgConfidence: asNumber(jobs.avg_confidence),
      avgSeconds: asNumber(jobs.avg_seconds),
    },
    byField: mapList(row.by_field, toQualityField),
    byEngine: mapList(row.by_engine, toQualityEngine),
  };
}

/* ------------------------------------------------------------------ *
 * What the views receive
 * ------------------------------------------------------------------ */

/** A list-shaped read: rows, whether they are arriving, and how to ask again. */
export interface Feed<T> {
  readonly rows: readonly T[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * An object-shaped read. `value` is null both before the first answer and when the payload was
 * unreadable, which is why `loading` and `error` travel with it — a view cannot tell "not yet"
 * from "not there" without them, and the difference is a spinner versus an empty state.
 */
export interface Report<T> {
  readonly value: T | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * The badge on each rail entry. Every count answers one question — *is there work here?* — so
 * these are not row counts for their own sake: `review` is how many documents are waiting on a
 * human, `extraction` is how many jobs need attention, `expiry` is how many renewals are late or
 * nearly late. A zero means the tab can be ignored today.
 */
export interface DmsCounts {
  readonly library: number;
  readonly review: number;
  readonly expiry: number;
  readonly extraction: number;
  readonly packages: number;
}

/**
 * What `useDmsModel` is told. One object because four positional arguments invite transposition.
 *
 * There is deliberately no `view` here. Every read except the 360 stays live whatever tab is
 * open, because the rail carries a count against each surface, so the model has no use for the
 * tab and taking it would imply otherwise. The one gated read is gated on `selectedId`, which is
 * a selection rather than a tab.
 */
export interface DmsModelParams {
  readonly query: string;
  readonly selectedId: string | null;
  readonly windowDays: number;
  readonly horizonDays: number;
}

/** Everything the six views and the chrome read. One object, assembled once per render. */
export interface DmsModel {
  /** The library page, mapped. `rows` is the page, not the table. */
  readonly documents: Feed<DmsDocument>;
  /** The page narrowed by the search box, or the page itself when nothing is typed. */
  readonly visible: readonly DmsDocument[];
  readonly byId: ReadonlyMap<string, DmsDocument>;
  /** When the library page was read, and whether it came from the broker's cache. */
  readonly fetchedAt: string | null;
  readonly fromCache: boolean;
  /** True when any of the three windows came back full, so the chrome can say so. */
  readonly truncated: boolean;
  readonly dashboard: Report<DmsDashboard>;
  readonly queue: Feed<DmsQueueRow>;
  readonly visibleQueue: readonly DmsQueueRow[];
  readonly expiry: Report<DmsExpiryReport>;
  readonly visibleExpiry: readonly DmsExpiryDocument[];
  readonly quality: Report<DmsExtractionQuality>;
  readonly packages: Feed<DmsPackage>;
  readonly visiblePackages: readonly DmsPackage[];
  /** The selected document's whole 360, or null when nothing is selected. */
  readonly selected: Report<DmsDocument360>;
  readonly counts: DmsCounts;
  readonly refreshAll: () => void;
}

/**
 * The rail badges, derived rather than counted where the server already counted.
 *
 * `library` prefers the dashboard's `documents` total over the page length, because the page is
 * capped at {@link PAGE} and a badge reading `400` on a workspace holding twelve thousand
 * documents is worse than no badge. It falls back to the page when the dashboard has not
 * answered, so the badge appears with the grid rather than a beat later.
 *
 * `expiry` is `expired + within30` and deliberately does not add `within7`: the server's buckets
 * are cumulative, so `within30` already contains that week. `extraction` counts pending and
 * failed jobs and ignores `processing` — a job the engine is holding needs nobody.
 */
function countsOf(
  documents: readonly DmsDocument[],
  dashboard: DmsDashboard | null,
  queue: readonly DmsQueueRow[],
  expiry: DmsExpiryReport | null,
  quality: DmsExtractionQuality | null,
  packages: readonly DmsPackage[],
): DmsCounts {
  return {
    library: dashboard === null ? documents.length : dashboard.totals.documents,
    review: queue.length,
    expiry: expiry === null ? 0 : expiry.buckets.expired + expiry.buckets.within30,
    extraction: quality === null ? 0 : quality.jobs.pending + quality.jobs.failed,
    packages: packages.length,
  };
}

/* ------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------ */

/**
 * Every read the app makes, in one call.
 *
 * The library page goes through `useDataset` rather than `useMappedDataset` because it is the one
 * read whose freshness is shown on screen: `fetchedAt` and `fromCache` exist only on the raw
 * state, and the chrome prints them. The mapping it loses is done here by hand, memoized on
 * `state.rows`, which is exactly what `useMappedDataset` would have done.
 *
 * The four object payloads go through `useMappedDataset` with the mappers above, which return
 * null on an unreadable payload — so `rows[0] ?? null` is "no answer" and never a fabricated
 * zero. Fresh `where` literals on every render are safe: the hook's cache key is the JSON of the
 * query, not the identity of the object.
 */
export function useDmsModel(params: DmsModelParams): DmsModel {
  const { query, selectedId, windowDays, horizonDays } = params;
  const needle = useMemo(() => query.trim().toLowerCase(), [query]);

  const page = useDataset('dmsDocuments', { limit: PAGE });
  const dashboard = useMappedDataset('dmsDashboard', toDashboard, { where: { days: windowDays } });
  const queue = useMappedDataset('dmsReviewQueue', toQueueRow, { limit: QUEUE });
  const expiry = useMappedDataset('dmsExpiry', toExpiryReport, { where: { horizonDays } });
  const quality = useMappedDataset('dmsExtractionQuality', toQuality, {
    where: { days: windowDays },
  });
  const packages = useMappedDataset('dmsPackages', toPackage, { limit: PACKAGES });

  /**
   * The 360 is the one gated read: `enabled` keeps it from asking for document `''` while
   * nothing is selected, which the broker would refuse anyway — `requireWhereString` treats a
   * missing document id as a caller bug rather than a smaller query.
   */
  const detail = useMappedDataset('dmsDocument360', toDocument360, {
    where: { documentId: selectedId ?? '' },
    enabled: selectedId !== null,
  });

  const documents = useMemo(() => mapList(page.rows, toDocument), [page.rows]);
  const byId = useMemo(() => index(documents), [documents]);

  /**
   * The search box, applied to each list over the page the app already holds.
   *
   * Client-side because the broker's `where` speaks equality, `in` and `is null` and nothing
   * else — there is no `ilike` to send. Tags are searched as well as text: a workspace that files
   * by tag expects typing the tag to find the file.
   */
  const visible = useMemo(
    () =>
      filterAll(
        documents,
        needle,
        (document) =>
          hit(needle, document.title, document.documentNumber, document.documentType, document.description) ||
          document.tags.some((tag) => tag.toLowerCase().includes(needle)),
      ),
    [documents, needle],
  );

  const visibleQueue = useMemo(
    () =>
      filterAll(queue.rows, needle, (row) =>
        hit(needle, row.title, row.documentNumber, row.documentType),
      ),
    [queue.rows, needle],
  );

  const dashboardValue = dashboard.rows[0] ?? null;
  const expiryValue = expiry.rows[0] ?? null;
  const qualityValue = quality.rows[0] ?? null;

  const visibleExpiry = useMemo(
    () =>
      filterAll(expiryValue?.documents ?? [], needle, (document) =>
        hit(needle, document.title, document.documentNumber, document.documentType),
      ),
    [expiryValue, needle],
  );

  const visiblePackages = useMemo(
    () =>
      filterAll(packages.rows, needle, (pack) =>
        hit(needle, pack.name, pack.reference, pack.purpose),
      ),
    [packages.rows, needle],
  );

  /**
   * The last good 360 for the document that is still selected.
   *
   * Opening the detail pane fires `dms.document.recordAccess`, which invalidates
   * `dmsDocument360` and nothing else — so the pane's own first render causes its data to be
   * refetched, and without this the pane would blank a beat after opening. Holding the previous
   * answer keyed on the document id means a refetch of the *same* document keeps the pane on
   * screen, while selecting a *different* document clears it: showing document A's versions under
   * document B's title would be a worse lie than a spinner.
   */
  const held = useRef<DmsDocument360 | null>(null);
  const fresh = detail.rows[0] ?? null;
  if (fresh !== null) {
    held.current = fresh;
  } else if (selectedId === null || held.current?.document.id !== selectedId) {
    held.current = null;
  }
  const selectedValue = fresh ?? held.current;

  const counts = useMemo(
    () => countsOf(documents, dashboardValue, queue.rows, expiryValue, qualityValue, packages.rows),
    [documents, dashboardValue, queue.rows, expiryValue, qualityValue, packages.rows],
  );

  /**
   * Whether any list came back exactly full, and is therefore probably not all of it.
   *
   * The three windowed reads are the plain lists; the four report payloads are single objects the
   * server aggregated over everything, so they cannot be truncated.
   */
  const truncated = windowed([
    [documents.length, PAGE],
    [queue.rows.length, QUEUE],
    [packages.rows.length, PACKAGES],
  ]);

  /**
   * One refresh for the whole app, for the chrome's refresh button and for after a command whose
   * invalidation list the broker deliberately keeps narrow.
   *
   * The seven `refetch`es are pulled out as values first. Each is stable for the life of its
   * query, so a callback that closes over the seven functions holds one identity for the life of
   * the app — where a callback depending on the seven state objects would be rebuilt on every
   * render, since each object is freshly allocated by its hook.
   */
  const { refetch: refetchPage } = page;
  const { refetch: refetchDashboard } = dashboard;
  const { refetch: refetchQueue } = queue;
  const { refetch: refetchExpiry } = expiry;
  const { refetch: refetchQuality } = quality;
  const { refetch: refetchPackages } = packages;
  const { refetch: refetchDetail } = detail;

  const refreshAll = useCallback(() => {
    refetchPage();
    refetchDashboard();
    refetchQueue();
    refetchExpiry();
    refetchQuality();
    refetchPackages();
    if (selectedId !== null) refetchDetail();
  }, [
    refetchPage,
    refetchDashboard,
    refetchQueue,
    refetchExpiry,
    refetchQuality,
    refetchPackages,
    refetchDetail,
    selectedId,
  ]);

  return {
    documents: { rows: documents, loading: page.loading, error: page.error, refetch: page.refetch },
    visible,
    byId,
    fetchedAt: page.fetchedAt,
    fromCache: page.fromCache,
    truncated,
    dashboard: {
      value: dashboardValue,
      loading: dashboard.loading,
      error: dashboard.error,
      refetch: dashboard.refetch,
    },
    queue: { rows: queue.rows, loading: queue.loading, error: queue.error, refetch: queue.refetch },
    visibleQueue,
    expiry: {
      value: expiryValue,
      loading: expiry.loading,
      error: expiry.error,
      refetch: expiry.refetch,
    },
    visibleExpiry,
    quality: {
      value: qualityValue,
      loading: quality.loading,
      error: quality.error,
      refetch: quality.refetch,
    },
    packages: {
      rows: packages.rows,
      loading: packages.loading,
      error: packages.error,
      refetch: packages.refetch,
    },
    visiblePackages,
    selected: {
      value: selectedValue,
      loading: detail.loading,
      error: detail.error,
      refetch: detail.refetch,
    },
    counts,
    refreshAll,
  };
}
