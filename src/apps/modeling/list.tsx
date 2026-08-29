/**
 * Modeling — the three registers.
 *
 * The forecast grid puts the past beside the projection: a sparkline of the months the
 * driver read, then the window average, then what the model says the horizon will total. In
 * that order the row can be argued with — the number on the right is only as good as the
 * shape on the left, and a reader who sees a flat line next to a rising total knows to ask.
 *
 * The sparkline shows history only, never history joined to projection. A single line drawn
 * across the seam makes a forecast look like a measurement, and the whole point of this
 * window is that the two are different kinds of thing. The seam is drawn where it can be
 * labelled: the timeline view and the scenario pane.
 *
 * Colour is spent on one row only — a projection running the wrong side of the plan. Not on
 * losses, not on overrides: those are stated in words in their own columns, because a grid
 * where every row is coloured is a grid where none of them is.
 */
import type { MouseEvent } from 'react';
import { Activity, LineChart as LineChartIcon, Pencil, Scale } from 'lucide-react';
import { Badge, type Column, DataGrid, EmptyState, fmt, Sparkline, useLocale } from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL } from '../shared/ledger';
import { adverseGap, type CompareRow, type ForecastRow, type TimelineRow } from './forecast';

interface ForecastListProps {
  readonly rows: readonly ForecastRow[];
  readonly selectedId: string | null;
  readonly loading: boolean;
  readonly searching: boolean;
  /** Accounts the lookback never saw move are in the grid. */
  readonly showQuiet: boolean;
  /** A budget is on screen, so the plan and gap columns mean something. */
  readonly hasPlan: boolean;
  /** Months the driver read, for the evidence column's denominator. */
  readonly lookback: number;
  onSelect: (id: string | null) => void;
  onActivate: (row: ForecastRow) => void;
  onContext: (row: ForecastRow, event: MouseEvent) => void;
}

/** The one coloured row: a projection on the wrong side of the plan. */
const rowTone = (row: ForecastRow) =>
  row.gap !== null && adverseGap(row.account.type, row.gap) > 0.005 ? 'danger' : undefined;

export function ForecastList(props: ForecastListProps) {
  const { rows, selectedId, loading, searching, showQuiet, hasPlan, lookback } = props;
  const { t, tr, lang } = useLocale();
  // The plan pair is declared apart so the grid keeps one column order with a gap in it,
  // rather than two orders that drift once one of them is edited.
  const planned: readonly Column<ForecastRow>[] = hasPlan
    ? [
        {
          id: 'planned',
          header: tr('الموازنة', 'Budget', 'Planned'),
          width: 150,
          align: 'end',
          mono: true,
          sort: (a, b) => (a.planned ?? 0) - (b.planned ?? 0),
          render: (row) =>
            row.planned === null ? (
              <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
            ) : (
              fmt.money(row.planned, 'DZD', lang)
            ),
        },
        {
          id: 'gap',
          header: tr('الفرق', 'Écart', 'Gap'),
          width: 150,
          align: 'end',
          mono: true,
          sort: (a, b) => (a.gap ?? 0) - (b.gap ?? 0),
          render: (row) =>
            row.gap === null ? (
              <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
            ) : (
              <span
                style={{
                  color: adverseGap(row.account.type, row.gap) > 0.005 ? 'var(--fx-danger)' : undefined,
                }}
              >
                {fmt.money(row.gap, 'DZD', lang)}
              </span>
            ),
        },
      ]
    : [];
  const columns: readonly Column<ForecastRow>[] = [
    {
      id: 'account',
      header: tr('الحساب', 'Compte', 'Account'),
      sort: (a, b) => a.account.code.localeCompare(b.account.code),
      render: (row) => (
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          <span className="fx-title-ellipsis" style={{ fontWeight: 600 }}>
            {`${row.account.code} · ${row.account.name}`}
          </span>
          <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
            {t(ACCOUNT_TYPE_LABEL[row.account.type])}
          </span>
        </div>
      ),
    },
    {
      id: 'past',
      header: tr('السابق', 'Passé', 'Past'),
      width: 124,
      render: (row) =>
        row.lines === 0 ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          <Sparkline values={row.history} width={104} height={24} />
        ),
    },
    {
      id: 'average',
      header: tr('متوسّط النظر', 'Moyenne fenêtre', 'Window average'),
      width: 150,
      align: 'end',
      mono: true,
      sort: (a, b) => a.average - b.average,
      render: (row) => fmt.money(row.average, 'DZD', lang),
    },
    {
      id: 'total',
      header: tr('الإجمالي المتوقّع', 'Total projeté', 'Projected'),
      width: 158,
      align: 'end',
      mono: true,
      sort: (a, b) => a.total - b.total,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          {row.overridden ? (
            <Badge
              tone="warning"
              icon={Pencil}
              title={tr('رقم مُدخل يدويًا', 'Nombre saisi à la main', 'Hand-entered number')}
            >
              {tr('يدوي', 'Manuel', 'Typed')}
            </Badge>
          ) : null}
          <span style={{ fontWeight: 600 }}>{fmt.money(row.total, 'DZD', lang)}</span>
        </span>
      ),
    },
    {
      // The denominator is the lookback, not the axis: this says how much of what the driver
      // read was actually evidence.
      id: 'evidence',
      header: tr('أشهر بحركة', 'Mois actifs', 'Active'),
      width: 104,
      align: 'end',
      mono: true,
      sort: (a, b) => a.activeMonths - b.activeMonths,
      render: (row) => (
        <span style={{ color: row.activeMonths === 0 ? 'var(--fx-text-disabled)' : undefined }}>
          {`${fmt.integer(row.activeMonths, lang)}/${fmt.integer(lookback, lang)}`}
        </span>
      ),
    },
    ...planned,
    {
      id: 'lines',
      header: tr('قيود', 'Écritures', 'Postings'),
      width: 92,
      align: 'end',
      mono: true,
      sort: (a, b) => a.lines - b.lines,
      render: (row) => fmt.integer(row.lines, lang),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.account.id}
      loading={loading}
      density="compact"
      virtualized
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={(keys) => {
        const list = [...keys];
        props.onSelect(list.length === 0 ? null : list[0]);
      }}
      onActivate={props.onActivate}
      onRowContextMenu={props.onContext}
      rowTone={rowTone}
      empty={
        <EmptyState
          icon={LineChartIcon}
          title={
            searching
              ? tr('لا نتائج', 'Aucun résultat', 'No matches')
              : tr('لا شيء يُتوقَّع', 'Rien à projeter', 'Nothing to project')
          }
          description={
            searching
              ? undefined
              : showQuiet
                ? tr(
                    'لا حسابات نتيجة في الدفتر.',
                    'Aucun compte de résultat dans le livre.',
                    'The book holds no income-statement accounts.',
                  )
                : tr(
                    'لا حساب تحرّك في أشهر النظر. أظهِر الساكنة لترى البقية.',
                    'Aucun compte n’a bougé dans la fenêtre. Affichez les comptes inertes pour voir le reste.',
                    'No account moved inside the window. Show the idle accounts to see the rest.',
                  )
          }
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The months
 * ------------------------------------------------------------------ *
 * Actual and projected months share one grid and one set of columns, with a badge saying
 * which is which. Two grids would let the two halves disagree about what "result" means;
 * one grid with a label cannot.
 *
 * The cumulative column is the reason this view exists: a run of small monthly losses is a
 * cash problem long before any single month looks like one.
 */

interface TimelineListProps {
  readonly rows: readonly TimelineRow[];
  readonly loading: boolean;
  onActivate: (row: TimelineRow) => void;
}

export function TimelineList({ rows, loading, onActivate }: TimelineListProps) {
  const { tr, lang } = useLocale();
  const columns: readonly Column<TimelineRow>[] = [
    {
      id: 'month',
      header: tr('الشهر', 'Mois', 'Month'),
      width: 132,
      mono: true,
      render: (row) => <span style={{ fontWeight: row.projected ? 400 : 600 }}>{row.month}</span>,
    },
    {
      id: 'kind',
      header: tr('النوع', 'Nature', 'Kind'),
      width: 128,
      render: (row) =>
        row.projected ? (
          <Badge tone="accent">{tr('متوقّع', 'Projeté', 'Projected')}</Badge>
        ) : (
          <Badge>{tr('منفَّذ', 'Réalisé', 'Actual')}</Badge>
        ),
    },
    {
      id: 'revenue',
      header: tr('الإيرادات', 'Produits', 'Revenue'),
      width: 160,
      align: 'end',
      mono: true,
      render: (row) => fmt.money(row.revenue, 'DZD', lang),
    },
    {
      id: 'expense',
      header: tr('التكاليف', 'Charges', 'Expense'),
      width: 160,
      align: 'end',
      mono: true,
      render: (row) => fmt.money(row.expense, 'DZD', lang),
    },
    {
      id: 'result',
      header: tr('النتيجة', 'Résultat', 'Result'),
      width: 160,
      align: 'end',
      mono: true,
      render: (row) => (
        <span style={{ color: row.result < 0 ? 'var(--fx-danger)' : undefined, fontWeight: 600 }}>
          {fmt.money(row.result, 'DZD', lang)}
        </span>
      ),
    },
    {
      id: 'cumulative',
      header: tr('التراكمي', 'Cumul', 'Cumulative'),
      width: 170,
      align: 'end',
      mono: true,
      render: (row) => (
        <span style={{ color: row.cumulative < 0 ? 'var(--fx-danger)' : undefined }}>
          {fmt.money(row.cumulative, 'DZD', lang)}
        </span>
      ),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.month}
      loading={loading}
      density="compact"
      onActivate={onActivate}
      empty={
        <EmptyState
          icon={Activity}
          title={tr('لا أشهر', 'Aucun mois', 'No months')}
          description={tr(
            'لا قيود مُرحَّلة في الدفتر، فلا محور يُرسم عليه.',
            'Aucune écriture comptabilisée : il n’y a pas d’axe à tracer.',
            'Nothing is posted, so there is no axis to draw on.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * Against the plan
 * ------------------------------------------------------------------ *
 * Two rows, usually. This is the version that goes into the meeting, so the gap column is
 * signed the way the statement reads and coloured only when it runs the wrong way — which
 * is not the same as being negative.
 */

interface CompareListProps {
  readonly rows: readonly CompareRow[];
  readonly loading: boolean;
  readonly hasPlan: boolean;
  onActivate: (row: CompareRow) => void;
}

export function CompareList({ rows, loading, hasPlan, onActivate }: CompareListProps) {
  const { t, tr, lang } = useLocale();
  const columns: readonly Column<CompareRow>[] = [
    {
      id: 'type',
      header: tr('النوع', 'Type', 'Type'),
      render: (row) => <span style={{ fontWeight: 600 }}>{t(ACCOUNT_TYPE_LABEL[row.type])}</span>,
    },
    {
      id: 'projected',
      header: tr('المتوقّع', 'Projeté', 'Projected'),
      width: 180,
      align: 'end',
      mono: true,
      render: (row) => fmt.money(row.projected, 'DZD', lang),
    },
    {
      id: 'planned',
      header: tr('الموازنة', 'Budget', 'Planned'),
      width: 180,
      align: 'end',
      mono: true,
      render: (row) =>
        hasPlan ? (
          fmt.money(row.planned, 'DZD', lang)
        ) : (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ),
    },
    {
      id: 'gap',
      header: tr('الفرق', 'Écart', 'Gap'),
      width: 180,
      align: 'end',
      mono: true,
      render: (row) =>
        hasPlan ? (
          <span style={{ color: adverseGap(row.type, row.gap) > 0.005 ? 'var(--fx-danger)' : undefined }}>
            {fmt.money(row.gap, 'DZD', lang)}
          </span>
        ) : (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ),
    },
    {
      id: 'accounts',
      header: tr('حسابات', 'Comptes', 'Accounts'),
      width: 120,
      align: 'end',
      mono: true,
      render: (row) => fmt.integer(row.accounts, lang),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.type}
      loading={loading}
      onActivate={onActivate}
      rowTone={(row) => (hasPlan && adverseGap(row.type, row.gap) > 0.005 ? 'danger' : undefined)}
      empty={
        <EmptyState
          icon={Scale}
          title={tr('لا شيء يُقارن', 'Rien à comparer', 'Nothing to compare')}
          description={tr(
            'لا حساب تحرّك ولا سطر خطة.',
            'Aucun compte actif et aucune ligne de plan.',
            'No account moved and no plan line was found.',
          )}
        />
      }
    />
  );
}
