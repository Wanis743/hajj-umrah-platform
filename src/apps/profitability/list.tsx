/**
 * Profitability — the treemap and the contribution ladder.
 *
 * Two drawings of one set of members, because the window asks two questions that a table
 * answers badly. "What is this business made of" is about proportion, and the treemap
 * answers it by area: the largest contributor is literally the biggest thing on the
 * screen. "Which members carry the result, and which lose money" is about sign and size
 * together, and the ladder answers it with bars from a centre line — losses left, profits
 * right, one scale across the set.
 *
 * The unallocated remainder is in both, as a member rather than as a blank. A sheet whose
 * members sum to less than the book and does not say why is a sheet that gets reconciled
 * by hand, badly — so the remainder is named, painted as a warning, and carries its own
 * figures like anything else.
 *
 * **Nothing here sorts.** The ranking is part of the question the rail asks: the ladder
 * prints members in the order the model ranked them and the remainder after them all, and
 * the treemap lays them out by area, which is its own order. A control that floated "no
 * package at all" to the top of the ranking would be reporting a competitor that does not
 * exist.
 *
 * Colour is spent on the margin rate and nowhere else. The area already says how big a
 * member is; spending the colour on size too would say one thing twice and leave the
 * interesting fact unsaid — a package carrying a fifth of the revenue at a two per cent
 * margin is what this window is for, and it is a large pale tile among large rich ones.
 */
import { type MouseEvent, useMemo } from 'react';
import { ChartPie, Filter } from 'lucide-react';
import {
  EmptyState,
  fmt,
  Spinner,
  type Tone,
  toneColor,
  Treemap,
  type TreemapCell,
  useLocale,
} from '@/platform/sdk';
import { type Dimension, isUntagged, type MemberFigure, variance } from './figures';
import { DIMENSION_LABEL } from './question';

/**
 * Nothing to rank, in the words of whichever reason there was nothing.
 *
 * A book with no tagged postings and a search box that matched nothing are the same empty
 * grid and two completely different problems, and only one of them is fixed by typing
 * less. So the filter says so, and the empty book says what it would take to fill it.
 */
function NothingHere({ dimension, filtered }: { readonly dimension: Dimension; readonly filtered: boolean }) {
  const { t, tr } = useLocale();
  if (filtered) {
    return (
      <EmptyState
        icon={Filter}
        title={tr('لا شيء يطابق', 'Aucune correspondance', 'Nothing matches')}
        description={tr(
          'كل الأعضاء مُخفيون بالبحث أو بمرشّح السكون. المجاميع في الشريط لا تزال تحتسبهم.',
          'Tous les membres sont masqués par la recherche ou le filtre d’inactivité. Les totaux du volet les comptent encore.',
          'Every member is hidden by the search box or the silence filter. The totals in the rail still count them.',
        )}
      />
    );
  }
  return (
    <EmptyState
      icon={ChartPie}
      title={tr('لا شيء يُنسب', 'Rien à attribuer', 'Nothing to attribute')}
      description={tr(
        `لا قيد مُرحَّل في هذه النافذة يحمل ${t(DIMENSION_LABEL[dimension])}.`,
        `Aucune écriture comptabilisée de cette fenêtre ne porte de ${t(DIMENSION_LABEL[dimension])}.`,
        `No posted entry in this window carries a ${t(DIMENSION_LABEL[dimension])}.`,
      )}
    />
  );
}

/**
 * A member's name over what it is made of.
 *
 * The detail line is where the naming problem is admitted: for a package it is the
 * departures booked against it, for a branch it is nothing at all, and for the remainder
 * it is an instruction. The remainder is set in italics so a reader scanning the column
 * can see that the last row is a different kind of thing before reading a word of it.
 */
function MemberCell({ row }: { readonly row: MemberFigure }) {
  const remainder = isUntagged(row);
  return (
    <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <span
        className="fx-title-ellipsis"
        style={{ fontStyle: remainder ? 'italic' : undefined, fontWeight: 600 }}
      >
        {row.label}
      </span>
      {row.detail === '' ? null : (
        <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>{row.detail}</span>
      )}
    </div>
  );
}
/** An amount. Weight marks the margin as the column that matters; red marks a loss. */
function Money({ value, strong = false }: { readonly value: number; readonly strong?: boolean }) {
  const { lang } = useLocale();
  return (
    <span
      style={{
        color: strong && value < 0 ? 'var(--fx-danger)' : undefined,
        fontWeight: strong ? 600 : 400,
      }}
    >
      {fmt.money(value, 'DZD', lang)}
    </span>
  );
}

/** A rate, or a dash where dividing by no revenue would have produced a number. */
function Rate({ value }: { readonly value: number | null }) {
  const { lang } = useLocale();
  if (value === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  return <span>{fmt.percent(value, lang, 1)}</span>;
}
/**
 * A share of revenue, as a figure over a bar.
 *
 * The bar is there because the column's job is comparison and a column of percentages
 * makes the eye do arithmetic. It is clamped to the width of the cell and never inverted:
 * a negative share — revenue of the opposite sign to the book's — draws nothing rather
 * than drawing backwards, and the figure beside it still says what happened.
 */
function Share({ value }: { readonly value: number | null }) {
  const { lang } = useLocale();
  if (value === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  const width = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div style={{ display: 'grid', gap: 3, justifyItems: 'end', minWidth: 0 }}>
      <span>{fmt.percent(value, lang, 1)}</span>
      <span
        aria-hidden="true"
        style={{
          background: 'var(--fx-layer-alt)',
          borderRadius: 'var(--fx-radius-pill)',
          display: 'block',
          height: 3,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <span
          style={{
            background: 'var(--fx-accent)',
            display: 'block',
            height: '100%',
            width: `${width}%`,
          }}
        />
      </span>
    </div>
  );
}
interface ListProps {
  readonly rows: readonly MemberFigure[];
  readonly dimension: Dimension;
  /** The ladder is empty because the filter emptied it, not because the book is. */
  readonly filtered: boolean;
  readonly selectedKey: string | null;
  /** A comparison was asked for, so each rung can say how it moved. */
  readonly comparing: boolean;
  readonly loading: boolean;
  onSelect: (key: string | null) => void;
  onActivate: (row: MemberFigure) => void;
  onContext: (row: MemberFigure, event: MouseEvent) => void;
}

/**
 * What colour a member is worth, which is its rate and not its size.
 *
 * The treemap's area already says how big a member is. Spending the colour on the same
 * fact would say it twice and leave the interesting one unsaid: a package carrying a
 * fifth of the revenue at a two per cent margin is the finding this window exists for,
 * and it is a large pale tile among large rich ones.
 */
const THIN_RATE = 0.1;

function rateTone(row: MemberFigure): Tone {
  if (isUntagged(row)) return 'warning';
  if (row.margin < 0) return 'danger';
  if (row.rate === null) return 'neutral';
  return row.rate < THIN_RATE ? 'warning' : 'success';
}

/** The widest margin in the set. One scale, or the rungs compare nothing. */
const scaleOf = (rows: readonly MemberFigure[]): number =>
  rows.reduce((widest, row) => Math.max(widest, Math.abs(row.margin)), 0);

export interface MemberTreemapProps {
  readonly rows: readonly MemberFigure[];
  readonly selectedKey: string | null;
  readonly label: string;
  onSelect: (key: string | null) => void;
}

/**
 * The members by revenue, as area.
 *
 * This is the half of the window a ranking cannot do. "Which three things are the
 * business" is a question about proportion, and a sorted list answers it by asking the
 * reader to compare the first number with the sum of the rest. Here the biggest
 * contributor is the biggest thing on the screen and the long tail is visibly a tail.
 *
 * Sized by revenue rather than by margin, and for a reason: a treemap's areas have to
 * sum to something, and margins do not — a loss-making member would need negative area.
 * Revenue is what there is a hundred per cent of, so revenue is the geometry and the
 * margin rate is the colour.
 *
 * The remainder is in the map like anything else. A picture of "what the business is
 * made of" that silently omits the untagged third of it is the one chart in this
 * application that would be a lie.
 */
export function MemberTreemap({ rows, selectedKey, label, onSelect }: MemberTreemapProps) {
  const { lang, tr } = useLocale();
  const cells = useMemo<readonly TreemapCell[]>(
    () =>
      rows.map((row) => ({
        label: row.label,
        value: row.revenue,
        color: toneColor(rateTone(row)),
        secondary: row.rate === null ? tr('بلا إيراد', 'Sans produit', 'No revenue') : fmt.percent(row.rate, lang, 0),
      })),
    [rows, lang, tr],
  );
  // The treemap reports the label it drew, and the app thinks in keys. Built from the
  // same array in the same order, so the two cannot disagree about which tile is which.
  const keyOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const row of rows) if (!out.has(row.label)) out.set(row.label, row.key);
    return out;
  }, [rows]);
  const selectedLabel = useMemo(
    () => rows.find((row) => row.key === selectedKey)?.label ?? null,
    [rows, selectedKey],
  );

  return (
    <Treemap
      cells={cells}
      height={200}
      label={label}
      selected={selectedLabel}
      onSelect={(picked) => onSelect(keyOf.get(picked) ?? null)}
      format={(value) => fmt.compact(value, lang)}
    />
  );
}

interface RungProps {
  readonly row: MemberFigure;
  readonly scale: number;
  readonly comparing: boolean;
  readonly selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
  onContext: (event: MouseEvent) => void;
}

/**
 * One member's margin, drawn from a centre line.
 *
 * Losses go left and profits go right, which is what makes a loss-making member findable
 * in a list of two hundred without reading a single minus sign. The bar is `aria-hidden`:
 * it draws a number that is already in the rung as text, and announcing it twice is worse
 * than not announcing it at all.
 */
function Rung({ row, scale, comparing, selected, onSelect, onActivate, onContext }: RungProps) {
  const { lang, tr } = useLocale();
  const tone = rateTone(row);
  const tint = toneColor(tone);
  const extent = Math.min(1, Math.abs(row.margin) / (scale > 0 ? scale : 1)) * 50;
  const gap = variance(row);
  return (
    <div
      role="listitem"
      onDoubleClick={onActivate}
      onContextMenu={onContext}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(120px, 1.4fr) 150px 72px 96px',
        alignItems: 'center',
        gap: 12,
        padding: '4px 8px',
        borderRadius: 'var(--fx-radius-control)',
        background: selected ? 'var(--fx-control)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          minWidth: 0,
          padding: 0,
          border: 'none',
          background: 'none',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'start',
          cursor: 'pointer',
        }}
      >
        <MemberCell row={row} />
      </button>
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          minWidth: 0,
          height: 14,
          borderRadius: 3,
          background: 'var(--fx-control)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInlineStart: row.margin >= 0 ? '50%' : `${50 - extent}%`,
            width: `${extent}%`,
            background: tint,
            opacity: 0.85,
          }}
        />
        <span
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInlineStart: 'calc(50% - 0.5px)',
            width: 1,
            background: 'var(--fx-stroke-strong)',
          }}
        />
      </span>
      <span className="fx-mono" style={{ textAlign: 'end', minWidth: 0 }}>
        <Money value={row.margin} strong />
        {comparing ? (
          <span
            style={{
              display: 'block',
              fontSize: 'var(--fx-caption)',
              color: gap === null ? 'var(--fx-text-disabled)' : gap < 0 ? 'var(--fx-danger)' : 'var(--fx-success)',
            }}
          >
            {gap === null ? tr('لا مقارنة', 'Sans comparaison', 'No prior') : fmt.money(gap, 'DZD', lang)}
          </span>
        ) : null}
      </span>
      <span className="fx-mono" style={{ textAlign: 'end' }}>
        <Rate value={row.rate} />
      </span>
      <span className="fx-mono">
        <Share value={row.share} />
      </span>
    </div>
  );
}

/**
 * The contribution ladder: every member's margin against one scale.
 *
 * **Nothing here sorts.** The order is part of the question the rail asks — the model
 * ranked these, and the remainder comes after them all. Re-ranking by the rate would
 * float a member with nine dinars of revenue and a ninety per cent margin above the one
 * carrying the season, which is a true number and a false answer.
 */
export function ProfitabilityList(props: ListProps) {
  const { dimension, rows } = props;
  const { tr } = useLocale();

  if (props.loading && rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  if (rows.length === 0) return <NothingHere dimension={dimension} filtered={props.filtered} />;

  const scale = scaleOf(rows);

  return (
    <div
      className="fx-scroll"
      role="list"
      aria-label={tr('سلّم المساهمة', 'Échelle des contributions', 'Contribution ladder')}
      style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gap: 2, alignContent: 'start' }}
    >
      {rows.map((row) => (
        <Rung
          key={row.key}
          row={row}
          scale={scale}
          comparing={props.comparing}
          selected={row.key === props.selectedKey}
          onSelect={() => props.onSelect(row.key)}
          onActivate={() => props.onActivate(row)}
          onContext={(event) => props.onContext(row, event)}
        />
      ))}
    </div>
  );
}





