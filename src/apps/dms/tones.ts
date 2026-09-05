/**
 * What colour a document's state is.
 *
 * Every table here is an exhaustive `Record` over a union from `./types`, not a loose
 * string map. That difference from Customers is deliberate and it is the whole value of
 * this file: Customers keeps its enums as bare strings because its columns carry values
 * `model.ts` refuses to narrow, so its tables must tolerate a seventh code arriving. The
 * document schema is narrower — eight review states, four confidentiality levels, four
 * upload states — and each is a CHECK constraint transcribed into `types.ts`. Keying the
 * tables on those unions means a state added to the migration and not added here fails
 * `npm run typecheck` instead of rendering a raw SQL token to a clerk.
 *
 * The tones themselves are carried over from `dmsFormat.ts`, which spelled them in the
 * admin shell's vocabulary (`good`, `warn`, `bad`, `progress`). The judgements are
 * unchanged and the spelling is not: this app renders through the SDK's `Badge`, whose
 * vocabulary is the six below. `good` became `success`, `warn` `warning`, `bad` `danger`,
 * and `progress` splits — `accent` where something is actively being worked, `info` where
 * it is merely waiting.
 *
 * These live in a `.ts` rather than beside the grids that use them because a `.tsx` file
 * may only export components — `react-refresh` is error-level here — and because a lookup
 * over a string has no business being re-declared per view. The grids import from here;
 * nothing here imports a grid.
 */
import type {
  DmsConfidentiality,
  DmsExtractionStatus,
  DmsFieldReviewState,
  DmsJobReviewState,
  DmsPackageStatus,
  DmsReviewStatus,
  DmsUploadState,
} from './types';

/**
 * The six tones `.fx-badge[data-tone]` is already styled for. Written out rather than
 * imported from the SDK's `Tone` because this is a closed local vocabulary, and because a
 * table typed on the SDK union would silently accept a tone this app never uses.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/**
 * The approval chain as colour.
 *
 * `UNDER_REVIEW` is `accent` because somebody is holding it right now, while
 * `PENDING_REVIEW` is `info` because nobody has picked it up yet — the two states the
 * admin shell drew identically as `progress` and `info`, and the distinction the review
 * queue exists to make. `SUPERSEDED` is grey rather than red: being replaced by a newer
 * version is the normal end of a document's life, not a failure.
 */
export const REVIEW_TONE: Readonly<Record<DmsReviewStatus, BadgeTone>> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'info',
  UNDER_REVIEW: 'accent',
  APPROVED: 'success',
  REJECTED: 'danger',
  CHANGES_REQUESTED: 'warning',
  EXPIRED: 'danger',
  SUPERSEDED: 'neutral',
};

/**
 * RESTRICTED is red on purpose: it is the one level where showing the document to the
 * wrong person is the incident.
 */
export const CONFIDENTIALITY_TONE: Readonly<Record<DmsConfidentiality, BadgeTone>> = {
  PUBLIC: 'neutral',
  INTERNAL: 'info',
  CONFIDENTIAL: 'warning',
  RESTRICTED: 'danger',
};

/**
 * Where a version's bytes are.
 *
 * `RESERVED` is amber and that is the most load-bearing colour in the app. It means a row
 * exists, a storage path was allocated, and the upload never finalized — so the document
 * looks complete in every list and opens to nothing. `LEGACY` is grey because it is a row
 * that predates the reserve/finalize protocol: the bytes are there, they were simply never
 * checksummed, and nobody needs to act on that.
 */
export const UPLOAD_STATE_TONE: Readonly<Record<DmsUploadState, BadgeTone>> = {
  RESERVED: 'warning',
  UPLOADED: 'success',
  LEGACY: 'neutral',
  FAILED: 'danger',
};

/** Lowercase keys because the extraction queue's CHECK is lowercase. Not a slip. */
export const EXTRACTION_TONE: Readonly<Record<DmsExtractionStatus, BadgeTone>> = {
  pending: 'info',
  processing: 'accent',
  completed: 'success',
  failed: 'danger',
};

/**
 * How far a human has got through one job's fields. `REVIEWED` is green because the
 * engine's output has been signed off, not because the engine was right — a job of four
 * corrected fields is `REVIEWED` too, and the accuracy column is where that shows.
 */
export const JOB_REVIEW_TONE: Readonly<Record<DmsJobReviewState, BadgeTone>> = {
  NOT_REVIEWED: 'neutral',
  PARTIALLY_REVIEWED: 'warning',
  REVIEWED: 'success',
};

/**
 * One extracted value's verdict. `CORRECTED` is amber rather than green: the field is now
 * right, but the engine was wrong, and the extraction-quality report is counting.
 */
export const FIELD_REVIEW_TONE: Readonly<Record<DmsFieldReviewState, BadgeTone>> = {
  PENDING: 'info',
  ACCEPTED: 'success',
  CORRECTED: 'warning',
  REJECTED: 'danger',
};

/** `VOID` is grey, not red: voiding a package is a decision, not a fault. */
export const PACKAGE_TONE: Readonly<Record<DmsPackageStatus, BadgeTone>> = {
  OPEN: 'info',
  SEALED: 'success',
  VOID: 'neutral',
};

/* ------------------------------------------------------------------ *
 * Tones that are read off a number rather than looked up
 * ------------------------------------------------------------------ */

/**
 * Days-to-expiry as a tone. Past due is danger, inside the notice window is warning.
 *
 * The thresholds are the admin shell's, unchanged: null when the document never expires,
 * danger once past due *and* inside a week, warning inside a month, green beyond. Seven
 * and thirty are deliberately hard-coded rather than read from each document's
 * `expiryNoticeDays`, because this colours a column that has to be comparable down its own
 * length — a passport with a 90-day notice and a visa with a 7-day one should not wear
 * different colours on the same number of days remaining. `expiryNoticeDays` is what the
 * server's sweep notifies on; this is what a reader scans.
 */
export function expiryTone(daysRemaining: number | null): BadgeTone {
  if (daysRemaining === null) return 'neutral';
  if (daysRemaining < 0) return 'danger';
  if (daysRemaining <= 7) return 'danger';
  if (daysRemaining <= 30) return 'warning';
  return 'success';
}

/**
 * Whether a seal still holds.
 *
 * Three states and not two. `null` is grey because the package is not sealed yet, so there
 * is nothing to match and green would be a claim nobody made. `false` is the one reading
 * this entire subsystem exists to be able to produce: a member has changed underneath a
 * seal, and the evidence no longer describes what was attested to.
 */
export function sealTone(sealMatches: boolean | null): BadgeTone {
  if (sealMatches === null) return 'neutral';
  return sealMatches ? 'success' : 'danger';
}

/**
 * An extraction confidence as a tone.
 *
 * The engine reports 0–1 and the bands are this app's judgement, not the server's: below
 * 0.6 the value is a guess a human must read, below 0.85 it is worth a glance, above that
 * it can be accepted in bulk. `null` is grey because the engine declining to score is not
 * the same as scoring badly — some engines return no confidence at all, and colouring that
 * red would condemn every field they produce.
 */
export function confidenceTone(confidence: number | null): BadgeTone {
  if (confidence === null) return 'neutral';
  if (confidence < 0.6) return 'danger';
  if (confidence < 0.85) return 'warning';
  return 'success';
}

/**
 * One history line's colour, taken from where the document landed.
 *
 * An event's tone comes from its `toState` when it moved the document through the review
 * machine, so a history reads with the same colours as the badge at the top of the pane.
 * The rest of the ledger — uploads, links, accesses, package membership — is not a state
 * change and is deliberately uncoloured, with one exception: anything ending `_FAILED`, and
 * `FIELD_REJECTED`, are the lines somebody is scanning for.
 *
 * Typed on strings rather than on `DmsEvent` so this file imports no record interfaces:
 * `eventType` and `fromState`/`toState` are open text in `dms_document_events`, which has
 * no CHECK constraint on either, so there is no union to be exhaustive over.
 */
export function eventTone(toState: string | null, eventType: string): BadgeTone {
  if (toState !== null && toState in REVIEW_TONE) {
    return REVIEW_TONE[toState as DmsReviewStatus];
  }
  if (eventType.endsWith('_FAILED') || eventType === 'FIELD_REJECTED') return 'danger';
  return 'neutral';
}
