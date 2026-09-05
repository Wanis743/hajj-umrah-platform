/**
 * The few renderings the SDK does not already own.
 *
 * `dmsFormat.ts` carried fourteen formatters because the admin shell had no formatting
 * layer. The OS does: `@/platform/sdk`'s `fmt` is locale-aware, agrees across every window,
 * and already renders dates, date-times, integers, byte sizes, percentages and durations.
 * Nine of the fourteen are therefore deleted rather than moved — a second `fmtDate` that
 * says `12 Jan 2026` while the rest of the desktop says `12 janv. 2026` is a bug waiting for
 * a French user.
 *
 * What survives is what the SDK has no opinion about: null-tolerance where a DMS column is
 * genuinely nullable, the difference between a 0–1 confidence and a 0–100 accuracy, and four
 * document-specific readings (a checksum, a day count, an ISO window bound, an actor id).
 *
 * Deleted and their replacements, for anyone diffing the two files:
 *   fmtInt        → fmt.integer      fmtDate    → fmt.date
 *   fmtDateTime   → fmt.dateTime     fmtBytes   → fmt.bytes
 *   fmtConfidence → fmt.percent(v, lang, 0)     fmtHours → fmt.duration(h * 3_600_000)
 *
 * A null from the server means "undefined", and it renders as an em dash. Printing 0 for an
 * unknown count would invent a fact.
 */
import { fmt, type AppLang } from '@/platform/sdk';

/** The em dash every unknown renders as. Matches what `fmt` returns for a bad input. */
export const DASH = '—';

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ *
 * Null-tolerant wrappers
 * ------------------------------------------------------------------ */

/**
 * A count that may not exist.
 *
 * `versionCount` is always a number; `sizeBytes`, `pageCount` and every report average are
 * nullable, and `fmt.integer` takes a `number`. Rather than write the same ternary at forty
 * call sites, the nullability is absorbed once here.
 */
export const int = (value: number | null | undefined, lang: AppLang): string =>
  value === null || value === undefined ? DASH : fmt.integer(value, lang);

/** A nullable byte size. `0` is a real answer and prints as `0 B`, not as a dash. */
export const size = (value: number | null | undefined, lang: AppLang): string =>
  value === null || value === undefined ? DASH : fmt.bytes(value, lang);

/* ------------------------------------------------------------------ *
 * The two kinds of percentage
 * ------------------------------------------------------------------ */

/**
 * An extraction confidence, which the engine reports as 0–1.
 *
 * Rendered with no decimals: the engine's third digit is noise, and a reviewer is deciding
 * whether to read the field, not auditing the model. `null` is a dash rather than `0%`
 * because some engines return no score at all, and `0%` would read as a verdict.
 */
export const confidence = (value: number | null | undefined, lang: AppLang): string =>
  value === null || value === undefined ? DASH : fmt.percent(value, lang, 0);

/**
 * An accuracy the server already multiplied out, as 0–100.
 *
 * `accuracyPct` on the extraction-quality report is accepted-over-reviewed computed in SQL,
 * so it arrives as `84.2`, not `0.842`. Dividing before handing it to `fmt.percent` keeps one
 * `%` sign in the app and the locale's own spacing rules around it — `84 %` in French,
 * `84%` in English — rather than the string concatenation the admin shell used.
 */
export const pct = (value: number | null | undefined, lang: AppLang): string =>
  value === null || value === undefined ? DASH : fmt.percent(value / 100, lang, 0);

/**
 * A wait, in hours, as the review queue reports it.
 *
 * `waitingHours` comes from an `EXTRACT(EPOCH …)/3600` in the queue's RPC, so it is a float
 * of hours. `fmt.duration` speaks milliseconds and localizes its own units, which is why the
 * conversion happens here and the legacy `fmtHours` — with its hard-coded `h` and `d` — does
 * not survive. Null stays a dash: a document nobody has submitted has not been waiting for
 * zero hours, it has not been waiting at all.
 */
export const waited = (hours: number | null | undefined, lang: AppLang): string =>
  hours === null || hours === undefined ? DASH : fmt.duration(hours * 3_600_000, lang);

/* ------------------------------------------------------------------ *
 * Readings the SDK has no opinion about
 * ------------------------------------------------------------------ */

/**
 * A SHA-256 shortened at both ends.
 *
 * Both ends and not just the head, because the one thing anybody does with a checksum on
 * screen is compare it to another one — and two versions of the same file differ anywhere in
 * the digest, not conveniently in the first eight characters. Short hashes are returned
 * whole: a value that is not 64 hex characters is not a digest, and truncating it would hide
 * whatever it actually is.
 */
export function shortHash(hash: string | null | undefined): string {
  if (hash === null || hash === undefined || hash === '') return DASH;
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

/**
 * Whole days from today to an ISO date, negative once past.
 *
 * Rounded rather than floored so a document expiring later today reads as 0 rather than -1,
 * and computed against `Date.now()` at the moment of the call. `model.ts` derives every
 * document's `daysRemaining` through this one function so that a grid cell, a KPI tile and a
 * tone all agree on the number instead of each crossing midnight separately.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.round((then - Date.now()) / DAY_MS);
}

/** `YYYY-MM-DD`, `days` ago. The dataset windows are dates, not timestamps. */
export const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

/** `YYYY-MM-DD` for today, in UTC — the same calendar the server's `CURRENT_DATE` uses. */
export const isoToday = (): string => new Date().toISOString().slice(0, 10);

/**
 * A staff id as something a person can hold in their head.
 *
 * The first eight characters of the uuid, because `staff_profiles` carries no name column
 * the DMS datasets are allowed to join to. This is honest about being an id rather than
 * guessing at a name, and eight characters is enough to tell two reviewers apart in a
 * history. Replacing this with a real name is a server change, not an app change.
 */
export const actorLabel = (id: string | null | undefined): string =>
  id === null || id === undefined || id === '' ? DASH : id.slice(0, 8);
