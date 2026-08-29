/**
 * Budgets — the two registers.
 *
 * The variance grid is the report, and its column order is the argument it makes: the
 * plan, what happened, the difference between them, and only then how far through the
 * plan that is. The percentage comes last because it is the least useful number in the
 * row — 90% of a plan means nothing until you know whether the plan was 900 or 9 million.
 *
 * Colour is spent on two rows only: adverse, and activity with no plan. Everything else
 * is left alone, because a grid where every row is coloured is a grid where none of them
 * is. The state badge carries the reading in words for anybody who cannot see the tone.
 *
 * The plan view is the same grid with the idle accounts left in, so there is one set of
 * columns to keep true rather than two that drift.
 */
import type { MouseEvent } from 'react';
import { ClipboardList, Layers, Target } from 'lucide-react';
import { Badge, type Column, DataGrid, EmptyState, fmt, ProgressBar, useLocale } from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL } from '../shared/ledger';
import {
  type RollupRow,
  VARIANCE_STATE_LABEL,
  type VarianceRow,
  varianceTone,
} from './variance';

interface VarianceListProps {
  readonly rows: readonly VarianceRow[];
  readonly selectedId: string | null;
  readonly loading: boolean;
  readonly searching: boolean;
  /** The plan view keeps the accounts nobody has budgeted for; the report drops them. */
  readonly showIdle: boolean;
  onSelect: (id: string | null) => void;
  onActivate: (row: VarianceRow) => void;
  onContext: (row: VarianceRow, event: MouseEvent) => void;
}

/** Only the two states worth a coloured row. */
const rowTone = (row: VarianceRow) =>
  row.state === 'adverse' ? 'danger' : row.state === 'unplanned' ? 'warning' : undefined;

export function VarianceList(props: VarianceListProps) {
  const { rows, selectedId, loading, searching, showIdle, onSelect, onActivate, onContext } = props;
  const { t, tr, lang } = useLocale();
  const columns: readonly Column<VarianceRow>[] = [
    {
      id: 'account',
      header: tr('الحساب', 'Compte', 'Account'),
      sort: (a, b) => a.account.code.localeCompare(b.account.code),
      render: (row) => (
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          {/* A planned account is the subject of the report; an unplanned one is a finding. */}
          <span className="fx-title-ellipsis" style={{ fontWeight: row.lineId === null ? 400 : 600 }}>
            {`${row.account.code} · ${row.account.name}`}
          </span>
          <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
            {t(ACCOUNT_TYPE_LABEL[row.account.type])}
          </span>
        </div>
      ),
    },
    {
      id: 'state',
      header: tr('الحالة', 'État', 'State'),
      width: 132,
      sort: (a, b) => a.state.localeCompare(b.state),
      render: (row) => <Badge tone={varianceTone(row.state)}>{t(VARIANCE_STATE_LABEL[row.state])}</Badge>,
    },
    {
      id: 'planned',
      header: tr('الخطة', 'Budget', 'Planned'),
      width: 148,
      align: 'end',
      mono: true,
      sort: (a, b) => a.planned - b.planned,
      render: (row) =>
        row.lineId === null ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          fmt.money(row.planned, 'DZD', lang)
        ),
    },
    {
      id: 'actual',
      header: tr('المنفَّذ', 'Réalisé', 'Actual'),
      width: 148,
      align: 'end',
      mono: true,
      sort: (a, b) => a.actual - b.actual,
      render: (row) => fmt.money(row.actual, 'DZD', lang),
    },
    {
      id: 'variance',
      header: tr('الفرق', 'Écart', 'Variance'),
      width: 148,
      align: 'end',
      mono: true,
      sort: (a, b) => a.variance - b.variance,
      render: (row) => (
        <span style={{ color: row.state === 'adverse' ? 'var(--fx-danger)' : undefined }}>
          {fmt.money(row.variance, 'DZD', lang)}
        </span>
      ),
    },
    {
      id: 'used',
      header: tr('المنفَّذ %', 'Consommé', 'Used'),
      width: 128,
      sort: (a, b) => (a.used ?? -1) - (b.used ?? -1),
      render: (row) =>
        row.used === null ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          <div style={{ display: 'grid', gap: 3 }}>
            <span className="fx-num" style={{ fontSize: 'var(--fx-caption)' }}>
              {fmt.percent(row.used, lang, 0)}
            </span>
            <ProgressBar value={row.used} tone={varianceTone(row.state)} height={4} />
          </div>
        ),
    },
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
        onSelect(list.length === 0 ? null : list[0]);
      }}
      onActivate={onActivate}
      onRowContextMenu={onContext}
      rowTone={rowTone}
      empty={
        <EmptyState
          icon={showIdle ? ClipboardList : Target}
          title={
            searching
              ? tr('لا نتائج', 'Aucun résultat', 'No matches')
              : showIdle
                ? tr('لا حسابات', 'Aucun compte', 'No accounts')
                : tr('لا شيء يُقارن', 'Rien à comparer', 'Nothing to compare')
          }
          description={
            searching || showIdle
              ? undefined
              : tr(
                  'لا سطور خطة ولا حركة: ابدأ من عرض الخطة وعيّن مبلغًا.',
                  'Ni ligne de budget ni mouvement : passez à la vue Plan et saisissez un montant.',
                  'No plan lines and no activity: switch to the plan view and set an amount.',
                )
          }
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The rollup
 * ------------------------------------------------------------------ *
 * Five rows at most, so nothing is virtualised and nothing is selected: this is the
 * version that goes into the meeting, and the only thing anybody does with a row is
 * take it away — which is what activating one does.
 */

interface RollupListProps {
  readonly rows: readonly RollupRow[];
  readonly loading: boolean;
  onActivate: (row: RollupRow) => void;
}

export function RollupList({ rows, loading, onActivate }: RollupListProps) {
  const { t, tr, lang } = useLocale();
  const columns: readonly Column<RollupRow>[] = [
    {
      id: 'type',
      header: tr('النوع', 'Type', 'Type'),
      render: (row) => <span style={{ fontWeight: 600 }}>{t(ACCOUNT_TYPE_LABEL[row.type])}</span>,
    },
    {
      id: 'planned',
      header: tr('الخطة', 'Budget', 'Planned'),
      width: 172,
      align: 'end',
      mono: true,
      render: (row) => fmt.money(row.planned, 'DZD', lang),
    },
    {
      id: 'actual',
      header: tr('المنفَّذ', 'Réalisé', 'Actual'),
      width: 172,
      align: 'end',
      mono: true,
      render: (row) => fmt.money(row.actual, 'DZD', lang),
    },
    {
      id: 'variance',
      header: tr('الفرق', 'Écart', 'Variance'),
      width: 172,
      align: 'end',
      mono: true,
      render: (row) => (
        <span style={{ color: row.adverse > 0 ? 'var(--fx-danger)' : undefined }}>
          {fmt.money(row.variance, 'DZD', lang)}
        </span>
      ),
    },
    {
      id: 'accounts',
      header: tr('حسابات', 'Comptes', 'Accounts'),
      width: 116,
      align: 'end',
      mono: true,
      render: (row) => fmt.integer(row.accounts, lang),
    },
    {
      // A count, not a tone: the row is already red when this is non-zero.
      id: 'adverse',
      header: tr('غير مواتٍ', 'Défavorables', 'Adverse'),
      width: 132,
      align: 'end',
      render: (row) =>
        row.adverse === 0 ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          <Badge tone="danger">{fmt.integer(row.adverse, lang)}</Badge>
        ),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.type}
      loading={loading}
      onActivate={onActivate}
      rowTone={(row) => (row.adverse > 0 ? 'danger' : undefined)}
      empty={
        <EmptyState
          icon={Layers}
          title={tr('لا شيء يُجمَّع', 'Rien à synthétiser', 'Nothing to roll up')}
          description={tr(
            'لا سطور خطة ولا حركة في هذه الموازنة.',
            'Ni ligne de budget ni mouvement dans ce budget.',
            'No plan lines and no activity in this budget.',
          )}
        />
      }
    />
  );
}
