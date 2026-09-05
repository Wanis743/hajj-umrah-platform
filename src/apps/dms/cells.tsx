/**
 * The shapes a document cell comes in.
 *
 * Six grids, seventy-odd columns, and eleven recurring shapes between them: a strong line
 * with a quieter one beneath it, an em dash where a nullable column is null, a coloured badge
 * for one of the migration's unions, a day count tinted because a passport is about to lapse,
 * a checksum shortened at both ends. Written once here so the column tables in `list.tsx`
 * read as one line per column rather than six lines of inline `<span>`s each.
 *
 * Everything exported is a component, including the one-liners.
 * `react-refresh/only-export-components` is error-level in this repository, so the lookup
 * tables these components read from live next door in `tones.ts` and `labels.ts` — `.ts`
 * files, free to export data — and this file holds only what renders.
 *
 * {@link StateChip} is where that split earns its keep. Customers pairs a loose `toneOf` with
 * a loose `wordFor` because its enums are open strings; DMS transcribed its CHECK constraints
 * into unions, so a chip can take the value *and both tables* and let the compiler check that
 * the three agree. `<StateChip value={row.reviewStatus} tones={REVIEW_TONE}
 * labels={REVIEW_LABEL} />` compiles, and the same call with `PACKAGE_LABEL` does not,
 * because a `Record<DmsPackageStatus, …>` is not a `Record<DmsReviewStatus, …>`. That is what
 * the transcription in `types.ts` was for.
 *
 * Colour comes from the SDK's `toneColor` rather than from an interpolated
 * `var(--fx-${tone})`. The two agree on danger and warning and diverge on neutral, which
 * `toneColor` renders as ordinary secondary text — and a token this app invented would fail
 * `css-audit` as readily as a class with no rule.
 */
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge, fmt, toneColor, useLocale, type Localized } from '@/platform/sdk';
import { confidence as confidenceText, DASH, shortHash } from './format';
import { humanize } from './labels';
import { confidenceTone, expiryTone, sealTone, type BadgeTone } from './tones';

export interface StackProps {
  /** The line that identifies the record — a document number, a title, a package name. */
  readonly title: string;
  /**
   * The line that qualifies it — the document type, a reference, a filename.
   *
   * `null` is accepted as well as absent because most of the columns feeding this line are
   * nullable in the projection (`documentNumber`, `reference`, an engine that named itself),
   * and a `?? ''` at every one of the six grids' call sites would be noise for no gain.
   */
  readonly caption?: string | null;
  /** Tooltip for the whole cell, since both lines truncate. */
  readonly hint?: string;
}

/**
 * Two lines in the height of one row.
 *
 * `minWidth: 0` on the grid container is what lets `fx-title-ellipsis` actually clip inside a
 * table cell; without it the cell grows to fit the longest document title and the columns to
 * its right walk off the edge. Both lines clip, because both are data.
 */
export function Stack({ title, caption, hint }: StackProps) {
  const second = caption ?? '';
  return (
    <div style={{ display: 'grid', gap: 1, minWidth: 0 }} title={hint}>
      <span className="fx-title-ellipsis" style={{ fontWeight: 600 }}>
        {title}
      </span>
      {second === '' ? null : (
        <span
          className="fx-title-ellipsis"
          style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}
        >
          {second}
        </span>
      )}
    </div>
  );
}

/**
 * Nothing, said clearly.
 *
 * A document that has never been submitted has no `submittedAt`, a package that has never
 * been sealed has no checksum, a version that predates the protocol has no page count. A
 * blank cell in a dense grid reads as a rendering fault rather than as an absent value.
 */
export function Dash() {
  return <span style={{ color: 'var(--fx-text-disabled)' }}>{DASH}</span>;
}

export interface ChipProps {
  readonly text: string;
  readonly tone?: BadgeTone;
  readonly title?: string;
}

/**
 * A word as a badge, for the two columns with no union behind them: `documentType`, which
 * each workspace defines for itself, and `eventType`, which the migration adds to without a
 * CHECK constraint. Neither can be looked up, so both arrive here already humanized.
 *
 * `.fx-badge[data-tone]` is styled for all six tones, so this is a rename of `Badge` rather
 * than a new control — it exists so a grid cell is one call and so the empty string, which
 * `humanize` returns for a blank token, renders as a dash instead of an empty pill.
 */
export function Chip({ text, tone = 'neutral', title }: ChipProps) {
  if (text === '') return <Dash />;
  return (
    <Badge tone={tone} title={title}>
      {text}
    </Badge>
  );
}

export interface StateChipProps<K extends string> {
  readonly value: K;
  /** The tone table from `./tones`, exhaustive over `K`. */
  readonly tones: Readonly<Record<K, BadgeTone>>;
  /** The label table from `./labels`, exhaustive over the same `K`. */
  readonly labels: Readonly<Record<K, Localized>>;
  readonly title?: string;
}

/**
 * One of the migration's unions, coloured and translated in a single call.
 *
 * Both tables are keyed on the same `K` as the value, which the compiler infers from `value`
 * — so the tone table and the label table cannot be mismatched, and a state added to a CHECK
 * constraint but not to both tables fails typecheck rather than rendering a raw SQL token to a
 * clerk. Nine columns across five grids resolve through this one component.
 *
 * The lookups are nevertheless written to survive a miss. `types.ts` transcribes the
 * constraints as they stand today, and if a nineteenth review state ships in a migration
 * before it ships here, the honest reading is `Under appeal` — humanized from the token, the
 * same fallback `labelFor` makes — and not a crash inside `t`.
 */
export function StateChip<K extends string>({ value, tones, labels, title }: StateChipProps<K>) {
  const { t } = useLocale();
  const word: Localized | undefined = labels[value];
  const tone: BadgeTone | undefined = tones[value];
  return (
    <Chip
      text={word === undefined ? humanize(value) : t(word)}
      tone={tone ?? 'neutral'}
      title={title}
    />
  );
}

export interface TintedProps {
  readonly text: string;
  /** Neutral renders as ordinary secondary text, which is the common case. */
  readonly tone?: BadgeTone;
}

/**
 * A value coloured because of what it is, not because of what kind of thing it is: a size
 * beside a failed upload, an attempt count on a job that keeps dying, an accuracy the
 * extraction report is unhappy about. The colour is the whole message, so there is no icon and
 * no second line — the column header already says what the number is.
 */
export function Tinted({ text, tone = 'neutral' }: TintedProps) {
  return <span style={{ color: toneColor(tone) }}>{text}</span>;
}

export interface DaysProps {
  /** Whole days to expiry, negative once past, null when the document never expires. */
  readonly days: number | null;
  /** The expiry date itself, which becomes the tooltip. */
  readonly on?: string | null;
}

/**
 * Days to expiry as a signed number.
 *
 * A signed integer and not a sentence. "In 12 days" needs a plural rule in three languages
 * for a cell whose column header already supplies the noun, and `-3` in red is the reading
 * every spreadsheet in the building already uses for a date that has passed. The tone comes
 * from `expiryTone`, which is deliberately banded on fixed thresholds rather than on each
 * document's own `expiryNoticeDays`, so this column is comparable down its own length.
 *
 * The tooltip carries the expiry date rather than a wordier version of the number — a hover
 * should add a fact, and the date is the one the clerk will type into a renewal.
 */
export function Days({ days, on }: DaysProps) {
  const { lang } = useLocale();
  if (days === null) return <Dash />;
  const hint = on === null || on === undefined || on === '' ? undefined : fmt.date(on, lang);
  return (
    <span style={{ color: toneColor(expiryTone(days)) }} title={hint}>
      {fmt.integer(days, lang)}
    </span>
  );
}

export interface VerifiedProps {
  readonly ok: boolean;
}

/**
 * Whether a queued document's bytes are actually there.
 *
 * The one boolean in the app whose false is load-bearing: a version row exists, a storage path
 * was allocated, the upload never finalized — so the document looks complete in every list and
 * opens to nothing. Approving it approves nothing, which the reviewer needs to know before
 * they open it rather than after.
 *
 * The tick is deliberately quiet and the triangle is not. A column of grey ticks with one
 * amber triangle in it is how a queue gets scanned; two colours competing would make the
 * ordinary case shout as loudly as the exception. The tooltip lives on a wrapping span because
 * `title` on an `<svg>` is not a tooltip in every browser.
 */
export function Verified({ ok }: VerifiedProps) {
  const { tr } = useLocale();
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  const hint = ok
    ? tr('الملف موجود', 'Fichier présent', 'Bytes present')
    : tr('التحميل لم يكتمل', 'Téléversement inachevé', 'Upload never finalized');
  return (
    <span title={hint} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Icon size={14} style={{ color: toneColor(ok ? 'neutral' : 'warning') }} />
    </span>
  );
}

export interface SealProps {
  readonly matches: boolean | null;
  readonly drifted: number;
}

/**
 * Whether a package's seal still holds — the one reading this whole subsystem exists for.
 *
 * Three states and not two: `null` is a dash because an unsealed package has nothing to match,
 * and green there would be a claim nobody made. The count of drifted members goes on the
 * tooltip rather than into the badge, which keeps the column narrow and sidesteps a plural rule
 * in three languages for a number that is almost always one.
 */
export function Seal({ matches, drifted }: SealProps) {
  const { tr, lang } = useLocale();
  if (matches === null) return <Dash />;
  const count = fmt.integer(drifted, lang);
  return (
    <Chip
      text={matches ? tr('سليم', 'Intact', 'Intact') : tr('غير مطابق', 'Rompu', 'Broken')}
      tone={sealTone(matches)}
      title={matches ? undefined : tr(`انحرافات: ${count}`, `Écarts : ${count}`, `Drifted: ${count}`)}
    />
  );
}

export interface HashProps {
  /** `checksumSha256`, which is null on a `RESERVED` or `LEGACY` version. */
  readonly hash: string | null;
}

/**
 * A checksum, shortened at both ends, with the whole digest on the tooltip.
 *
 * Tabular figures because the only thing anybody does with two of these is hold them side by
 * side. `shortHash` keeps the last eight characters as well as the first eight for the same
 * reason: two versions of one file differ anywhere in the digest, not conveniently at the
 * front.
 */
export function Hash({ hash }: HashProps) {
  if (hash === null || hash === '') return <Dash />;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fx-caption)' }} title={hash}>
      {shortHash(hash)}
    </span>
  );
}

export interface ConfidenceProps {
  /** The engine's own 0–1 score, or null where it declined to give one. */
  readonly value: number | null;
}

/**
 * How sure the extraction engine was, as a tinted percentage.
 *
 * The number and the colour say the same thing twice on purpose: the percentage is what a
 * reviewer quotes when they correct a field, and the band is what they scan a column of forty
 * fields for. `null` is a dash rather than a grey `0%` — an engine that returns no score has
 * not scored badly, and `0%` would condemn every field it produced.
 */
export function Confidence({ value }: ConfidenceProps) {
  const { lang } = useLocale();
  if (value === null) return <Dash />;
  return <Tinted text={confidenceText(value, lang)} tone={confidenceTone(value)} />;
}

export interface TagListProps {
  /** Already-readable strings. Callers holding SQL tokens map them through `labelFor` first. */
  readonly tags: readonly string[];
  /** How many fit before the overflow count. Two is what the library grid's width allows. */
  readonly max?: number;
}

/**
 * A few labels and a count of the rest.
 *
 * Two badges and a `+3` rather than a wrapping cloud, because a row that grows to fit its tags
 * makes every other row in the grid taller. The whole list is on the tooltip, so nothing is
 * hidden — it is merely not competing for width with the document's title.
 *
 * Serves two columns with different contents: `DmsDocument.tags`, which are free text a filer
 * typed, and `DmsExpiryDocument.linkedEntityTypes`, which are `dms_document_links` entity
 * tokens the caller has already put through `labelFor(LINK_ENTITY_LABEL, …)`. Translating is
 * the caller's job precisely because only the caller knows which of the two it is holding.
 */
export function TagList({ tags, max = 2 }: TagListProps) {
  const { lang } = useLocale();
  if (tags.length === 0) return <Dash />;
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  return (
    <div
      style={{ display: 'flex', gap: 4, minWidth: 0, alignItems: 'center' }}
      title={tags.join(', ')}
    >
      {shown.map((tag, index) => (
        <Badge key={`${tag}:${index}`} tone="neutral">
          {tag}
        </Badge>
      ))}
      {extra === 0 ? null : (
        <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
          {`+${fmt.integer(extra, lang)}`}
        </span>
      )}
    </div>
  );
}
