/**
 * Profitability — the table.
 *
 * One row per member, and the unallocated remainder as the last row rather than as a
 * blank. A sheet whose members sum to less than the book and does not say why is a sheet
 * that gets reconciled by hand, badly — so the remainder is named, painted as a warning,
 * and carries its own figures like anything else.
 *
 * **Nothing here sorts by column.** The ranking is part of the question the rail asks:
 * the grid prints members in the order the model ranked them, and the remainder after
 * them all. A click on the margin header that floated "no package at all" to the top of
 * the ranking would be reporting a competitor that does not exist.
 *
 * Colour is spent twice and no more: on a negative margin, and on the remainder row.
 * Not on a share, not on a variance — a cost that grew and a revenue that grew are both
 * positive numbers, and a grid that paints one of them red has picked a side the
 * arithmetic did not.
 */
import type { MouseEvent } from 'react';
import { ChartPie, Filter } from 'lucide-react';
import { type Column, DataGrid, EmptyState, fmt, useLocale } from '@/platform/sdk';
import { type Dimension, isUntagged, type MemberFigure, variance } from './figures';
import { DIMENSION_LABEL } from './question';

/** The remainder is the one row with a tone: it is a warning about the report, not a member of it. */
const rowTone = (row: MemberFigure) => (isUntagged(row) ? 'warning' : undefined);

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
  /** The grid is empty because the filter emptied it, not because the book is. */
  readonly filtered: boolean;
  readonly selectedKey: string | null;
  /** A comparison was asked for, so the last two columns mean something. */
  readonly comparing: boolean;
  readonly loading: boolean;
  onSelect: (key: string | null) => void;
  onActivate: (row: MemberFigure) => void;
  onContext: (row: MemberFigure, event: MouseEvent) => void;
}

export function ProfitabilityList(props: ListProps) {
  const { dimension, rows } = props;
  const { t, tr, lang } = useLocale();
  // The comparison pair is declared apart so one column order holds with a gap in it,
  // rather than two orders that drift the moment either is edited.
  const compared: readonly Column<MemberFigure>[] = props.comparing
    ? [
        {
          id: 'prior',
          header: tr('المقارنة', 'Comparaison', 'Prior'),
          width: 156,
          align: 'end',
          mono: true,
          render: (row) =>
            row.prior === null ? (
              <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
            ) : (
              <Money value={row.prior} />
            ),
        },
        {
          id: 'variance',
          header: tr('الفرق', 'Écart', 'Variance'),
          width: 156,
          align: 'end',
          mono: true,
          render: (row) => {
            const gap = variance(row);
            return gap === null ? (
              <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
            ) : (
              <Money value={gap} />
            );
          },
        },
      ]
    : [];
  const columns: readonly Column<MemberFigure>[] = [
    {
      id: 'member',
      header: t(DIMENSION_LABEL[dimension]),
      render: (row) => <MemberCell row={row} />,
    },
    {
      id: 'revenue',
      header: tr('الإيرادات', 'Produits', 'Revenue'),
      width: 158,
      align: 'end',
      mono: true,
      render: (row) => <Money value={row.revenue} />,
    },
    {
      id: 'cost',
      header: tr('التكاليف', 'Charges', 'Cost'),
      width: 158,
      align: 'end',
      mono: true,
      render: (row) => <Money value={row.cost} />,
    },
    {
      id: 'margin',
      header: tr('الهامش', 'Marge', 'Margin'),
      width: 168,
      align: 'end',
      mono: true,
      render: (row) => <Money value={row.margin} strong />,
    },
    {
      id: 'rate',
      header: tr('النسبة', 'Taux', 'Rate'),
      width: 96,
      align: 'end',
      mono: true,
      render: (row) => <Rate value={row.rate} />,
    },
    {
      id: 'share',
      header: tr('الحصة', 'Part', 'Share'),
      width: 108,
      align: 'end',
      mono: true,
      render: (row) => <Share value={row.share} />,
    },
    ...compared,
    {
      id: 'postings',
      header: tr('قيود', 'Écritures', 'Postings'),
      width: 100,
      align: 'end',
      mono: true,
      render: (row) => fmt.integer(row.postings, lang),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      loading={props.loading}
      density="compact"
      virtualized
      selectedKeys={props.selectedKey === null ? undefined : new Set([props.selectedKey])}
      onSelectionChange={(keys) => {
        const [key] = [...keys];
        props.onSelect(key ?? null);
      }}
      onActivate={props.onActivate}
      onRowContextMenu={props.onContext}
      rowTone={rowTone}
      empty={<NothingHere dimension={dimension} filtered={props.filtered} />}
    />
  );
}





