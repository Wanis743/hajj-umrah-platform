/**
 * What colour an analytics state is.
 *
 * Every table here is an exhaustive `Record` over a union from `./types`, on the
 * same reasoning as `src/apps/dms/tones.ts`: the unions are CHECK constraints, so
 * a status added to the migration and not added here fails `npm run typecheck`
 * instead of rendering a raw SQL token to an analyst.
 *
 * The functions below the tables are the interesting half, and there are more of
 * them than Documents has. A document's colour is nearly always a lookup on its
 * review state. A number's colour is usually a judgement about a quantity — how
 * long a query took, how many published dashboards stand on deprecated
 * definitions, whether a metric can be stacked — and those judgements are this
 * app's, not the server's. Each one says which.
 *
 * These live in a `.ts` rather than beside the grids that use them because a
 * `.tsx` file may only export components — `react-refresh` is error-level here.
 */
import type { BiQueryOutcome, BiStatus } from './types';

/**
 * The six tones `.fx-badge[data-tone]` is already styled for. Written out rather
 * than imported from the SDK's `Tone` because this is a closed local vocabulary.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/**
 * A definition's standing.
 *
 * `DEPRECATED` is grey rather than red, for the reason `SUPERSEDED` is grey in
 * Documents: retiring a definition is the normal end of its life and a decision
 * somebody made deliberately. What *is* red is the combination — a published
 * dashboard still reading a deprecated metric — and that is counted, not
 * looked up: see {@link breachTone}.
 *
 * `DRAFT` is neutral rather than `info` because most of the catalog is draft most
 * of the time, and a colour that appears on nine rows in ten stops being a signal.
 */
export const STATUS_TONE: Readonly<Record<BiStatus, BadgeTone>> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  DEPRECATED: 'neutral',
};

/**
 * The same, tolerating the `'N/A'` a lineage read returns for a dimension.
 *
 * A dimension has no status of its own — its standing is its dataset's — and
 * `'N/A'` is how the server says so. Grey, because the absence of a status is
 * not a status.
 */
export function statusTone(status: BiStatus | 'N/A'): BadgeTone {
  if (status === 'N/A') return 'neutral';
  return STATUS_TONE[status];
}

/**
 * How a logged query ended.
 *
 * `DENIED` is amber and not red, and the distinction is the point of logging
 * refusals at all: a query stopped because the caller lacked the source's
 * permission is the semantic layer working exactly as designed. `ERROR` is red
 * because something the caller could not have predicted went wrong — a bad
 * expression, a filter arity the compiler refused, a timeout.
 */
export const OUTCOME_TONE: Readonly<Record<BiQueryOutcome, BadgeTone>> = {
  OK: 'success',
  DENIED: 'warning',
  ERROR: 'danger',
};

/* ------------------------------------------------------------------ *
 * Tones read off a number rather than looked up
 * ------------------------------------------------------------------ */

/**
 * Whether a metric may be added up.
 *
 * `false` is amber because it is a live hazard: stacking an average or
 * subtotalling a ratio produces a number that is wrong and looks fine. `true` is
 * grey rather than green — being additive is the ordinary case, not an
 * achievement, and green on every SUM would drown the amber on the one AVG.
 */
export function additiveTone(isAdditive: boolean | null): BadgeTone {
  if (isAdditive === null) return 'neutral';
  return isAdditive ? 'neutral' : 'warning';
}

/**
 * How long a query took.
 *
 * The bands are this app's, not the server's: under a second is what an
 * interactive chart needs and gets no colour, a second to five is worth noticing
 * on a dashboard that fires eight tiles at once, and past five seconds the
 * definition is the problem rather than the data. There is deliberately no green
 * band — a fast query is the expected case.
 */
export function durationTone(durationMs: number | null): BadgeTone {
  if (durationMs === null) return 'neutral';
  if (durationMs >= 5_000) return 'danger';
  if (durationMs >= 1_000) return 'warning';
  return 'neutral';
}

/**
 * A health count where zero is the goal and anything else wants attention.
 *
 * Green on zero is worth the ink here, unlike on a metric badge: the overview's
 * health block is six numbers a person reads once a week to confirm nothing has
 * rotted, and six greens is the answer they came for.
 */
export function healthTone(count: number): BadgeTone {
  return count === 0 ? 'success' : 'warning';
}

/**
 * A health count where anything but zero is somebody reading a wrong number
 * right now. Used for the published-on-deprecated count and nothing else.
 */
export function breachTone(count: number): BadgeTone {
  return count === 0 ? 'success' : 'danger';
}

/**
 * Whether this caller may read the thing being listed.
 *
 * Amber, not red: a refusal is the source's `required_permission` doing its job,
 * and the row is being drawn precisely so the person can see that the definition
 * exists and is not theirs to query. Red would read as a fault in the dataset.
 */
export function readableTone(readableByMe: boolean): BadgeTone {
  return readableByMe ? 'neutral' : 'warning';
}

/**
 * Whether a result is the whole answer.
 *
 * Amber whenever the row limit bit, because a truncated result is not wrong about
 * the rows it holds and is wrong about every total computed from them — and a
 * chart cannot tell the difference.
 */
export function truncationTone(truncated: boolean): BadgeTone {
  return truncated ? 'warning' : 'neutral';
}

/**
 * One governance-ledger line's colour, taken from where the entity landed.
 *
 * An event's tone comes from its `to` status when it moved a definition, so a
 * history reads with the same colours as the badge at the top of the pane.
 * Everything else in `bi_events` — a source sync, a definition created — is not a
 * status change and is deliberately uncoloured.
 *
 * Typed on strings rather than on {@link BiStatus} because
 * `bi_events.event_type` has no CHECK constraint: a reader has to tolerate a
 * value this app has never heard of.
 */
export function eventTone(to: string | null, eventType: string): BadgeTone {
  if (to !== null && to in STATUS_TONE) return STATUS_TONE[to as BiStatus];
  if (eventType.endsWith('_FAILED')) return 'danger';
  return 'neutral';
}
