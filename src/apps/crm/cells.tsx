/**
 * The shapes a CRM cell comes in.
 *
 * Seven registers, sixty-odd columns, and four recurring shapes between them: a strong line
 * with a quieter one beneath it, an em-dash where a foreign key is null, a coloured badge for
 * an enum, and a number tinted because it has passed a limit. Written once here so the grids
 * in `list.tsx` read as one line per column instead of six lines of inline `<span>`s each.
 *
 * Everything exported from this file is a component, including the small ones. That is not
 * stylistic: `react-refresh/only-export-components` is error-level in this repository, so the
 * lookup tables these components read from live next door in `tones.ts` — a `.ts` file, free
 * to export data — and this file holds only what renders. The two halves meet at `Chip`,
 * which takes a tone `toneOf` computed and a word `wordFor` resolved.
 *
 * The styling is deliberately thin: `Stack` is the two-line cell from `close/list.tsx`
 * verbatim, down to the `gap: 1`, and every colour is one of the tokens already declared in
 * `fluent.css` — `--fx-text-secondary`, `--fx-text-tertiary`, `--fx-text-disabled`,
 * `--fx-caption`, `--fx-divider`, `--fx-card-secondary`, `--fx-danger`, `--fx-warning`. No
 * new class name is introduced anywhere in this app's grid layer, which is what keeps
 * `css-audit` quiet: it fails on an `.fx-` class with no rule as readily as on a rule with no
 * class.
 */
import { Badge, fmt, ProgressBar, useLocale } from '@/platform/sdk';
import { asStage, stageLabel } from './lifecycle';
import type { PipelineStage } from './model';
import { type BadgeTone, STAGE_TONE, toneOf } from './tones';

export interface StackProps {
  /** The line that identifies the record — a name, a title, a subject. */
  readonly title: string;
  /**
   * The line that qualifies it — a phone number, a customer, the body of a note.
   *
   * `null` is accepted as well as absent because most of the columns that feed this line are
   * nullable in the projection (`Followup.notes`, `Activity.body`, a lead's email), and a
   * `?? ''` at every one of the seven grids' call sites would be noise for no gain.
   */
  readonly caption?: string | null;
  /** Tooltip for the whole cell, since both lines truncate. */
  readonly hint?: string;
}

/**
 * Two lines in the height of one row.
 *
 * `minWidth: 0` on the grid container is what lets `fx-title-ellipsis` actually clip inside a
 * table cell; without it the cell grows to fit the longest customer name and the columns to
 * its right walk off the edge. The caption clips too — `close/list.tsx` leaves its own
 * captions unclipped because they are fixed hint strings, whereas these are data.
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
 * Every foreign key on a CRM projection is nullable — a lead with no campaign, an activity
 * against no opportunity, a quote with no expiry — and a blank cell in a dense grid reads as
 * a rendering fault rather than as an absent value.
 */
export function Dash() {
  return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
}

export interface ChipProps {
  readonly text: string;
  readonly tone?: BadgeTone;
  readonly title?: string;
}

/**
 * An enum as a badge. `.fx-badge[data-tone]` is already styled for all six tones, so this is
 * a rename of `Badge` rather than a new control — it exists so a grid cell is one call whose
 * two arguments come from `wordFor` and `toneOf` respectively.
 */
export function Chip({ text, tone = 'neutral', title }: ChipProps) {
  return (
    <Badge tone={tone} title={title}>
      {text}
    </Badge>
  );
}

export interface TintedProps {
  readonly text: string;
  /** Omitted when the value is unremarkable, which is the common case. */
  readonly tone?: 'danger' | 'warning';
}

/**
 * A value that has passed a limit: a follow-up past its due date, a quote past its validity,
 * a campaign spending more than it was given. The colour is the whole message, so there is no
 * icon and no second line — the column header already says what the number is.
 */
export function Tinted({ text, tone }: TintedProps) {
  const color = tone === undefined ? undefined : `var(--fx-${tone})`;
  return <span style={{ color }}>{text}</span>;
}

export interface TagListProps {
  readonly tags: readonly string[];
}

/**
 * A customer's tags, two of them.
 *
 * `crm.customer.tags` replaces the whole array and accepts as many as somebody pastes, so the
 * column has no natural width. Two badges and a count fit a compact row; the full list is on
 * the tooltip, joined exactly as `tagsText` joins it for the editor, so what you read here is
 * what you will see in the box.
 */
export function TagList({ tags }: TagListProps) {
  if (tags.length === 0) return <Dash />;
  const shown = tags.slice(0, 2);
  const rest = tags.length - shown.length;
  return (
    <div
      style={{ display: 'flex', gap: 4, minWidth: 0, alignItems: 'center' }}
      title={tags.join(', ')}
    >
      {shown.map((tag) => (
        <Badge key={tag} tone="neutral">
          {tag}
        </Badge>
      ))}
      {rest > 0 ? (
        <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
          +{rest}
        </span>
      ) : null}
    </div>
  );
}

export interface FunnelProps {
  readonly stages: readonly PipelineStage[];
}

/**
 * The pipeline as six columns above its own grid.
 *
 * `model.pipeline` comes from an RPC that emits all six stages whether or not any deal sits
 * in one, so this band has a fixed shape and reading across it is reading the funnel. LOST is
 * included rather than trimmed: the width of the loss beside the width of the win is the most
 * useful comparison on the surface, and a funnel that quietly dropped it would flatter.
 *
 * The bar is each stage's value against the largest of the six, not against the total — six
 * slices of a pie are unreadable at 40px, whereas six bars against a shared maximum answer
 * "where is the money sitting" at a glance. When every stage is empty the maximum is zero and
 * each bar is passed an explicit `0`: `ProgressBar` reads `undefined` as indeterminate and
 * would animate an empty pipeline as though it were still loading.
 *
 * A stage whose code this build does not recognise keeps its raw code as its label, the same
 * fallback `wordFor` makes for every other enum in the app.
 */
export function Funnel({ stages }: FunnelProps) {
  const { t, lang } = useLocale();
  if (stages.length === 0) return null;
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const max = ordered.reduce((top, stage) => Math.max(top, stage.valueDzd), 0);
  return (
    <div
      style={{
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))`,
        gap: 14,
        padding: '10px 14px',
        borderBlockEnd: '1px solid var(--fx-divider)',
        background: 'var(--fx-card-secondary)',
      }}
    >
      {ordered.map((stage) => {
        const known = asStage(stage.stage);
        return (
          <div key={stage.stage} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <span
              className="fx-title-ellipsis"
              style={{ color: 'var(--fx-text-secondary)', fontSize: 'var(--fx-caption)' }}
            >
              {known === null ? stage.stage.toUpperCase() : t(stageLabel(known))}
            </span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{fmt.integer(stage.count, lang)}</span>
            <ProgressBar
              value={max > 0 ? stage.valueDzd / max : 0}
              tone={toneOf(STAGE_TONE, stage.stage)}
            />
            <span
              className="fx-title-ellipsis"
              style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}
            >
              {fmt.money(stage.valueDzd, 'DZD', lang)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
