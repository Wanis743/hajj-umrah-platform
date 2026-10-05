/**
 * Budgets — the variance board and the rollup register.
 *
 * The variance report is not a table any more, and the reason is what the report is for.
 * A budget review asks one question — which lines are off, and by how much — and a column
 * of signed figures answers it by making somebody read all of them to find the big ones.
 * Drawn against zero, the big ones are simply the long ones, and which side of the centre
 * they fall on says over or under before a minus sign has been noticed. Every bar in the
 * set shares one scale, which is the only thing that makes the lengths mean anything, and
 * the board is ordered by the size of the gap rather than by account code: the largest
 * adverse line is the subject of the meeting, and the alphabet puts it wherever it likes.
 *
 * The meter beside each bar is the other half of the reading. The bar says how far from
 * plan in money; the meter says how much of the plan is gone, which is a different fact —
 * 90% consumed means nothing until you know whether the plan was 900 or nine million, and
 * a line that is 40% through its plan with the season over is as much a finding as one at
 * 140%. Its tone goes amber past 90 and red past 100 on its own.
 *
 * Colour is spent on the gap and nothing else. A board where every row is coloured is a
 * board where none of them is, and the state is in words under the account name for
 * anybody who cannot see the tone.
 *
 * The rollup stays a grid: five rows, no selection, and a footed table is the right shape
 * for five totals.
 */
import type { MouseEvent } from 'react';
import { ClipboardList, Layers, Target } from 'lucide-react';
import {
  Badge,
  type Column,
  DataGrid,
  EmptyState,
  fmt,
  Meter,
  Spinner,
  useLocale,
  VarianceRow as VarianceBar,
} from '@/platform/sdk';
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

/**
 * Whether a gap is good news, which the sign does not say.
 *
 * Spending less than budgeted on a cost line is a negative variance and a result worth
 * having; earning less than budgeted is the same arithmetic and the opposite verdict.
 * `verdict` has already decided which, so the bar is told rather than left to guess — and
 * `undefined` for the three states that are neither, where the sign may decide.
 */
const favourableOf = (row: VarianceRow): boolean | undefined =>
  row.state === 'favourable' ? true : row.state === 'adverse' || row.state === 'unplanned' ? false : undefined;

/** The widest gap in the set. One scale, or the lengths compare nothing. */
const scaleOf = (rows: readonly VarianceRow[]): number =>
  rows.reduce((widest, row) => Math.max(widest, Math.abs(row.variance)), 0);

export function VarianceList(props: VarianceListProps) {
  const { rows, selectedId, loading, searching, showIdle, onSelect, onActivate, onContext } = props;
  const { t, tr, lang } = useLocale();

  if (loading && rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
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
    );
  }

  const scale = scaleOf(rows);
  const ordered = [...rows].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  return (
    <div
      className="fx-scroll"
      role="list"
      aria-label={tr('الفروق', 'Écarts', 'Variances')}
      style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gap: 2, alignContent: 'start' }}
    >
      {ordered.map((row) => {
        const planned = Math.abs(row.planned);
        return (
          <div
            key={row.account.id}
            role="listitem"
            // Double-click sets the amount and right-click opens the row menu, exactly as
            // they did on the grid. The bar itself takes the single click, so all three
            // gestures survive the change of shape.
            onDoubleClick={() => onActivate(row)}
            onContextMenu={(event) => onContext(row, event)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 132px',
              gap: 12,
              alignItems: 'center',
              padding: '0 6px',
              borderRadius: 'var(--fx-radius-control)',
              background: row.account.id === selectedId ? 'var(--fx-control)' : undefined,
            }}
          >
            <VarianceBar
              label={`${row.account.code} · ${row.account.name}`}
              meta={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {t(ACCOUNT_TYPE_LABEL[row.account.type])}
                  <Badge tone={varianceTone(row.state)}>{t(VARIANCE_STATE_LABEL[row.state])}</Badge>
                  <span className="fx-mono">{fmt.integer(row.lines, lang)}</span>
                </span>
              }
              value={row.variance}
              scale={scale}
              display={fmt.money(row.variance, 'DZD', lang)}
              favourable={favourableOf(row)}
              labelWidth={280}
              onClick={() => onSelect(row.account.id)}
            />
            {planned === 0 ? (
              <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-disabled)' }}>
                {tr('بلا خطة', 'Hors plan', 'No plan')}
              </span>
            ) : (
              <Meter
                value={Math.abs(row.actual)}
                max={planned}
                tone={varianceTone(row.state)}
                label={tr('المنفَّذ', 'Consommé', 'Used')}
              />
            )}
          </div>
        );
      })}
    </div>
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
