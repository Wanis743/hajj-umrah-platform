/**
 * The shapes a BI cell comes in.
 *
 * Five list grids, one result grid, and eleven recurring shapes between them: a key over the
 * name it stands for, an em dash where a nullable column is null, a coloured badge for one of
 * the migration's unions, a latency tinted because a query is slow, a uuid shortened to the
 * eight characters a person actually quotes. Written once here so the column tables in
 * `list.tsx` read as one line per column rather than six lines of inline `<span>`s each.
 *
 * Everything exported is a component, including the one-liners.
 * `react-refresh/only-export-components` is error-level in this repository, so the lookup
 * tables these components read from live next door in `tones.ts` and `labels.ts` — `.ts` files,
 * free to export data — and this file holds only what renders.
 *
 * {@link StateChip} is where that split earns its keep. `types.ts` transcribes this app's CHECK
 * constraints into unions, so a chip can take the value *and both tables* and let the compiler
 * check that the three agree. `<StateChip value={row.status} tones={STATUS_TONE}
 * labels={STATUS_LABEL} />` compiles, and the same call with `OUTCOME_LABEL` does not, because
 * a `Record<BiQueryOutcome, …>` is not a `Record<BiStatus, …>`. That is what the transcription
 * was for.
 *
 * Colour comes from the SDK's `toneColor` rather than from an interpolated `var(--fx-${tone})`.
 * The two agree on danger and warning and diverge on neutral, which `toneColor` renders as
 * ordinary secondary text — and a token this app invented would fail `css-audit` as readily as
 * a class with no rule.
 */
import { Badge, fmt, toneColor, useLocale, type Localized } from '@/platform/sdk';
import { actorLabel, cell, DASH, int, latency } from './format';
import { durationTone } from './tones';
import type { BadgeTone } from './tones';
import type { BiColumn, BiScalar } from './types';

/**
 * A SQL token nobody has translated, made readable.
 *
 * Two of this app's columns carry open strings rather than unions — `BiEvent.eventType`, which
 * the migration adds to without a CHECK constraint, and `BiEvent.entityKind`, which is typed
 * `BiEntityKind | string` for exactly that reason. Neither can be looked up, so both arrive
 * here as `dataset_published` and leave as `Dataset published`.
 *
 * Private, because it is a string function and this file may only export components.
 */
function humanize(token: string): string {
  if (token === '') return '';
  const words = token.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface StackProps {
  /** The line that identifies the record — a dataset name, a dashboard title. */
  readonly title: string;
  /**
   * The line that qualifies it — the key, the source, the dataset a query ran against.
   *
   * `null` is accepted as well as absent because most of the columns feeding this line are
   * nullable in the projection (`description`, `sourceName`, a dataset that has since been
   * deleted), and a `?? ''` at every one of the five grids' call sites would be noise.
   */
  readonly caption?: string | null;
  /** Tooltip for the whole cell, since both lines truncate. */
  readonly hint?: string;
  /** Whether the second line is a key rather than prose. Keys are typed, not written. */
  readonly mono?: boolean;
}

/**
 * Two lines in the height of one row.
 *
 * `minWidth: 0` on the grid container is what lets `fx-title-ellipsis` actually clip inside a
 * table cell; without it the cell grows to fit the longest dataset name and the columns to its
 * right walk off the edge. Both lines clip, because both are data.
 */
export function Stack({ title, caption, hint, mono }: StackProps) {
  const second = caption ?? '';
  return (
    <div style={{ display: 'grid', gap: 1, minWidth: 0 }} title={hint}>
      <span className="fx-title-ellipsis" style={{ fontWeight: 600 }}>
        {title}
      </span>
      {second === '' ? null : (
        <span
          className={mono === true ? 'fx-mono fx-title-ellipsis' : 'fx-title-ellipsis'}
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
 * A dataset that has never been queried has no `lastQueriedAt`, a draft has no `publishedAt`,
 * a query that succeeded has no `errorCode`. A blank cell in a dense grid reads as a rendering
 * fault rather than as an absent value.
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
 * A word as a badge.
 *
 * `.fx-badge[data-tone]` is styled for all six tones, so this is a rename of `Badge` rather
 * than a new control — it exists so a grid cell is one call, and so the empty string, which
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
 * constraint but not to both tables fails typecheck rather than rendering a raw SQL token to an
 * analyst. Six columns across four grids resolve through this one component.
 *
 * The lookups are nevertheless written to survive a miss. `types.ts` transcribes the
 * constraints as they stand today, and if a fourth status ships in a migration before it ships
 * here, the honest reading is the humanized token and not a crash inside `t`.
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

export interface OpenChipProps {
  /** A token from a column with no union behind it. */
  readonly token: string;
  readonly tone?: BadgeTone;
  readonly title?: string;
}

/**
 * An untranslated token as a badge — the two columns {@link StateChip} cannot serve.
 *
 * `BiEvent.eventType` has no CHECK constraint and `BiEvent.entityKind` is widened to
 * `BiEntityKind | string` because of it, so neither can be looked up in a `Record` the compiler
 * would check. Humanizing is the honest reading: it is the token, spelled the way a sentence
 * spells it, with nothing invented.
 */
export function OpenChip({ token, tone = 'neutral', title }: OpenChipProps) {
  return <Chip text={humanize(token)} tone={tone} title={title ?? token} />;
}

export interface TintedProps {
  readonly text: string;
  /** Neutral renders as ordinary secondary text, which is the common case. */
  readonly tone?: BadgeTone;
}

/**
 * A value coloured because of what it is, not because of what kind of thing it is: a count of
 * datasets that have never been queried, a metric count on a dataset that has none, a p95 the
 * usage panel is unhappy about. The colour is the whole message, so there is no icon and no
 * second line — the column header already says what the number is.
 */
export function Tinted({ text, tone = 'neutral' }: TintedProps) {
  return <span style={{ color: toneColor(tone) }}>{text}</span>;
}

export interface CountProps {
  readonly value: number | null;
  readonly tone?: BadgeTone;
  /** Whether zero is worth drawing. A dataset with no metric is news; a report with no
   *  analysis is the same news; a query that returned no rows is not. */
  readonly zero?: boolean;
}

/**
 * A whole number, localised, with an optional tone.
 *
 * Tabular figures, because the only thing anybody does with a column of counts is compare it
 * down its own length. `zero={false}` draws a dash instead of a nought, for the columns where
 * nought and nothing are the same statement.
 */
export function Count({ value, tone = 'neutral', zero = true }: CountProps) {
  const { lang } = useLocale();
  if (value === null || (value === 0 && !zero)) return <Dash />;
  return (
    <span style={{ color: toneColor(tone), fontVariantNumeric: 'tabular-nums' }}>
      {int(value, lang)}
    </span>
  );
}

export interface StampProps {
  /** A timestamptz off the projection, null where the event never happened. */
  readonly at: string | null;
  /** Whether the time matters. A publication is a day; a query is a moment. */
  readonly precise?: boolean;
}

/**
 * When something happened, or a dash because it has not.
 *
 * The tooltip always carries the full timestamp even when the cell shows only the day, because
 * two datasets published on the same afternoon are ordered by something this column does not
 * print.
 */
export function Stamp({ at, precise }: StampProps) {
  const { lang } = useLocale();
  if (at === null || at === '') return <Dash />;
  return (
    <span title={fmt.dateTime(at, lang)} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {precise === true ? fmt.dateTime(at, lang) : fmt.date(at, lang)}
    </span>
  );
}

export interface LatencyProps {
  readonly ms: number | null;
}

/**
 * How long a query took, banded.
 *
 * `durationTone` is the band and `latency` is the wording — a sub-second run reads in
 * milliseconds and anything longer reads in seconds, because "1,847 ms" is a number a machine
 * chose and "1.8 s" is the one a person repeats. Null is a dash: a run that was refused before
 * it reached the planner has no duration, and a green `0 ms` would be a claim nobody made.
 */
export function Latency({ ms }: LatencyProps) {
  const { lang } = useLocale();
  if (ms === null) return <Dash />;
  return <Tinted text={latency(ms, lang)} tone={durationTone(ms)} />;
}

export interface ActorProps {
  /** The `auth.uid()` the row was written under, null for a system write. */
  readonly id: string | null;
  /** The role claim beside it, which is the half a reader can actually act on. */
  readonly role?: string | null;
}

/**
 * Who did it: the role in words and the uuid's first eight characters beneath.
 *
 * The directory is not reachable from an app sandbox — `@/platform/sdk` offers `useDirectory`,
 * but a query log page is two hundred rows and two hundred lookups is not a grid, it is a
 * denial-of-service against the reader's own session. So the role answers *what kind of person*
 * and the short uuid answers *which one*, which together is what a reader chasing one run
 * needs, and the full id is on the tooltip for the ticket they are about to write.
 */
export function Actor({ id, role }: ActorProps) {
  const { tr } = useLocale();
  if (id === null) {
    return <span style={{ color: 'var(--fx-text-tertiary)' }}>{tr('النظام', 'Système', 'System')}</span>;
  }
  const kind = role ?? '';
  return (
    <Stack
      title={kind === '' ? actorLabel(id) : humanize(kind)}
      caption={kind === '' ? null : actorLabel(id)}
      hint={id}
      mono
    />
  );
}

export interface ResultCellProps {
  readonly value: BiScalar;
  readonly column: BiColumn;
}

/**
 * One cell of a result grid, formatted by the column that produced it.
 *
 * The whole of that decision lives in `format.ts`'s `cell`, which checks `kind === 'METRIC'`
 * before it checks anything else: a metric is displayed by its own format, decimals and unit
 * regardless of the SQL type underneath it, and a dimension is displayed by its data type and
 * its grain. This component is the alignment and the dash, and nothing more.
 *
 * Measures are end-aligned with tabular figures because a column of numbers is read down its
 * decimal point. Dimensions are start-aligned because a column of words is read down its first
 * letter.
 */
export function ResultCell({ value, column }: ResultCellProps) {
  const { lang } = useLocale();
  if (value === null) return <Dash />;
  const measure = column.kind === 'METRIC';
  return (
    <span
      style={{
        fontVariantNumeric: measure ? 'tabular-nums' : undefined,
        display: 'block',
        textAlign: measure ? 'end' : undefined,
      }}
    >
      {cell(value, column, lang)}
    </span>
  );
}
