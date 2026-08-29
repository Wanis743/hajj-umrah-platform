/**
 * Ledger — the chart grid and the trial-balance grid.
 *
 * Two grids because they are two different objects, not two skins of one. The
 * chart is a tree: its order *is* information, so its columns do not sort — a
 * chart sorted by balance would draw children under whatever row happened to land
 * above them, and the indentation would then be a lie. The trial balance is a
 * list, one row per account, and it sorts on every column.
 *
 * The chart carries no footer for the same reason. Its amount columns roll up, so
 * every parent already contains its children; adding the column down would count
 * the same posting once per generation above it. The page's real totals are in the
 * status bar, where they are computed from the trial rows instead.
 */
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { type MouseEvent, useMemo } from 'react';
import { Badge, type Column, DataGrid, EmptyState, fmt, useApp } from '@/platform/sdk';
import { type Account, ACCOUNT_TYPE_LABEL, type TrialRow } from '../shared/ledger';
import { type ChartRow, type Rollup, type RollupIndex, rollupOf, type TrialTotals } from './accounts';

const ROW_HEIGHT = 33;

/** One empty set, so "nothing selected" is not a new object every render. */
const NO_SELECTION: ReadonlySet<string> = new Set<string>();

/** Indent per generation. Narrow on purpose: a chart is often six deep. */
const INDENT = 14;

const dash = (value: number, text: string): string => (value === 0 ? '—' : text);

export interface ChartGridProps {
  readonly rows: readonly ChartRow[];
  readonly rollups: RollupIndex;
  readonly loading: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onToggle: (accountId: string) => void;
  readonly onActivate: (account: Account) => void;
  readonly onContextMenu: (account: Account, event: MouseEvent) => void;
  readonly filtered: boolean;
  /**
   * True when a filter is deciding what is open. The chevrons then draw the state
   * without offering to change it, because the filter would overrule the click.
   */
  readonly autoExpanded: boolean;
}

/**
 * The chart of accounts as a tree.
 *
 * Amounts are `fmt.amount` and not `fmt.money`: a currency symbol repeated down
 * two hundred rows is noise, and the currency has its own column. A balance that
 * includes descendants is marked and says so on hover — the difference between an
 * account's own balance and its branch's is the whole point of a roll-up.
 */
export function ChartGrid({
  rows,
  rollups,
  loading,
  selectedId,
  onSelect,
  onToggle,
  onActivate,
  onContextMenu,
  filtered,
  autoExpanded,
}: ChartGridProps) {
  const { t, tr, lang, rtl } = useApp().locale;
  const selected = useMemo(
    () => (selectedId === null ? NO_SELECTION : new Set([selectedId])),
    [selectedId],
  );

  const columns = useMemo<readonly Column<ChartRow>[]>(
    () => [
      {
        id: 'code',
        header: tr('الرمز', 'Code', 'Code'),
        width: 252,
        render: (row) => (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              paddingInlineStart: row.depth * INDENT,
            }}
          >
            <TreeToggle row={row} frozen={autoExpanded} rtl={rtl} onToggle={onToggle} />
            <span className="fx-mono">{row.account.code}</span>
            {row.childCount === 0 ? null : (
              <span style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>{row.childCount}</span>
            )}
          </span>
        ),
      },
      {
        id: 'name',
        header: tr('الاسم', 'Nom', 'Name'),
        render: (row) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="fx-title-ellipsis">{row.account.name}</span>
            {row.account.active ? null : (
              <Badge tone="neutral">{tr('موقوف', 'Inactif', 'Inactive')}</Badge>
            )}
          </span>
        ),
      },
      {
        id: 'type',
        header: tr('النوع', 'Nature', 'Type'),
        width: 116,
        render: (row) => (
          <span style={{ color: 'var(--fx-text-secondary)' }}>{t(ACCOUNT_TYPE_LABEL[row.account.type])}</span>
        ),
      },
      {
        id: 'currency',
        header: tr('العملة', 'Devise', 'Currency'),
        width: 68,
        mono: true,
        render: (row) => row.account.currency,
      },
      {
        id: 'debit',
        header: tr('مدين', 'Débit', 'Debit'),
        width: 124,
        align: 'end',
        mono: true,
        render: (row) => {
          const total = rollupOf(rollups, row.account.id);
          return dash(total.debit, fmt.amount(total.debit, lang));
        },
      },
      {
        id: 'credit',
        header: tr('دائن', 'Crédit', 'Credit'),
        width: 124,
        align: 'end',
        mono: true,
        render: (row) => {
          const total = rollupOf(rollups, row.account.id);
          return dash(total.credit, fmt.amount(total.credit, lang));
        },
      },
      {
        id: 'balance',
        header: tr('الرصيد', 'Solde', 'Balance'),
        width: 136,
        align: 'end',
        mono: true,
        render: (row) => <BalanceCell total={rollupOf(rollups, row.account.id)} />,
      },
      {
        id: 'lines',
        header: tr('حركات', 'Mouvements', 'Postings'),
        width: 96,
        align: 'end',
        mono: true,
        render: (row) => {
          const total = rollupOf(rollups, row.account.id);
          return dash(total.lines, fmt.integer(total.lines, lang));
        },
      },
    ],
    [t, tr, lang, rtl, rollups, autoExpanded, onToggle],
  );

  return (
    <DataGrid<ChartRow>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.account.id}
      selectedKeys={selected}
      onSelectionChange={(keys) => {
        const [first] = [...keys];
        onSelect(first ?? null);
      }}
      onActivate={(row) => onActivate(row.account)}
      onRowContextMenu={(row, event) => onContextMenu(row.account, event)}
      loading={loading}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      empty={<ChartEmpty filtered={filtered} />}
    />
  );
}

interface TreeToggleProps {
  readonly row: ChartRow;
  /** A filter is deciding what is open, so the glyph reports rather than offers. */
  readonly frozen: boolean;
  readonly rtl: boolean;
  readonly onToggle: (accountId: string) => void;
}

function TreeToggle({ row, frozen, rtl, onToggle }: TreeToggleProps) {
  const { tr } = useApp().locale;
  if (row.childCount === 0) return <span style={{ display: 'inline-block', width: 14 }} />;
  const Glyph = row.expanded ? ChevronDown : rtl ? ChevronLeft : ChevronRight;
  if (frozen) return <Glyph size={13} style={{ color: 'var(--fx-text-tertiary)' }} aria-hidden />;
  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      aria-label={row.expanded ? tr('طي', 'Replier', 'Collapse') : tr('توسيع', 'Déplier', 'Expand')}
      // The click must not reach the row: opening a branch is not selecting it.
      onClick={(event) => {
        event.stopPropagation();
        onToggle(row.account.id);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        padding: 0,
        border: 'none',
        background: 'none',
        color: 'var(--fx-text-secondary)',
        cursor: 'pointer',
      }}
    >
      <Glyph size={13} />
    </button>
  );
}

interface BalanceCellProps {
  readonly total: Rollup;
}

/** The balance, marked when descendants are inside it. */
function BalanceCell({ total }: BalanceCellProps) {
  const { tr, lang } = useApp().locale;
  if (total.lines === 0) return <>—</>;
  return (
    <span
      title={
        total.rolled
          ? tr(
              `يشمل الفروع · الرصيد الخاص ${fmt.amount(total.own, lang)}`,
              `Enfants inclus · solde propre ${fmt.amount(total.own, lang)}`,
              `Children included · own balance ${fmt.amount(total.own, lang)}`,
            )
          : undefined
      }
    >
      {total.rolled ? '∑ ' : ''}
      {fmt.amount(total.balance, lang)}
    </span>
  );
}

interface GridEmptyProps {
  readonly filtered: boolean;
}

function ChartEmpty({ filtered }: GridEmptyProps) {
  const { tr } = useApp().locale;
  return (
    <EmptyState
      title={
        filtered
          ? tr('لا حسابات مطابقة', 'Aucun compte correspondant', 'No matching accounts')
          : tr('لا حسابات بعد', 'Aucun compte', 'No accounts yet')
      }
      description={
        filtered
          ? tr(
              'امسح البحث أو أظهر غير المفعّلة.',
              'Effacez la recherche ou affichez les inactifs.',
              'Clear the search, or show the inactive accounts.',
            )
          : tr(
              'ابدأ بحساب جديد (Ctrl+N).',
              'Commencez par un nouveau compte (Ctrl+N).',
              'Start with a new account (Ctrl+N).',
            )
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * Trial balance
 * ------------------------------------------------------------------ */

export interface TrialGridProps {
  readonly rows: readonly TrialRow[];
  readonly totals: TrialTotals;
  readonly loading: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onActivate: (accountId: string) => void;
  readonly filtered: boolean;
}

/**
 * One row per account, with the two sides footed.
 *
 * The balance column has no footer on purpose. Each balance is signed by its own
 * account's nature, so assets and liabilities are both positive when normal and
 * their sum means nothing. What can be added down is debit and credit, and the
 * gap between those two is the number the status bar reports.
 */
export function TrialGrid({
  rows,
  totals,
  loading,
  selectedId,
  onSelect,
  onActivate,
  filtered,
}: TrialGridProps) {
  const { t, tr, lang } = useApp().locale;
  const selected = useMemo(
    () => (selectedId === null ? NO_SELECTION : new Set([selectedId])),
    [selectedId],
  );

  const columns = useMemo<readonly Column<TrialRow>[]>(
    () => [
      {
        id: 'code',
        header: tr('الرمز', 'Code', 'Code'),
        width: 116,
        mono: true,
        render: (row) => row.code,
        sort: (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }),
      },
      {
        id: 'name',
        header: tr('الحساب', 'Compte', 'Account'),
        render: (row) => <span className="fx-title-ellipsis">{row.name}</span>,
        sort: (a, b) => a.name.localeCompare(b.name),
      },
      {
        id: 'type',
        header: tr('النوع', 'Nature', 'Type'),
        width: 120,
        render: (row) => (
          <span style={{ color: 'var(--fx-text-secondary)' }}>{t(ACCOUNT_TYPE_LABEL[row.type])}</span>
        ),
        sort: (a, b) => a.type.localeCompare(b.type),
      },
      {
        id: 'currency',
        header: tr('العملة', 'Devise', 'Currency'),
        width: 72,
        mono: true,
        render: (row) => row.currency,
        sort: (a, b) => a.currency.localeCompare(b.currency),
      },
      {
        id: 'debit',
        header: tr('مدين', 'Débit', 'Debit'),
        width: 132,
        align: 'end',
        mono: true,
        render: (row) => dash(row.debit, fmt.amount(row.debit, lang)),
        sort: (a, b) => a.debit - b.debit,
        footer: fmt.amount(totals.debit, lang),
      },
      {
        id: 'credit',
        header: tr('دائن', 'Crédit', 'Credit'),
        width: 132,
        align: 'end',
        mono: true,
        render: (row) => dash(row.credit, fmt.amount(row.credit, lang)),
        sort: (a, b) => a.credit - b.credit,
        footer: fmt.amount(totals.credit, lang),
      },
      {
        id: 'balance',
        header: tr('الرصيد', 'Solde', 'Balance'),
        width: 140,
        align: 'end',
        mono: true,
        render: (row) => dash(row.balance, fmt.amount(row.balance, lang)),
        sort: (a, b) => a.balance - b.balance,
      },
      {
        id: 'lines',
        header: tr('حركات', 'Mouvements', 'Postings'),
        width: 100,
        align: 'end',
        mono: true,
        render: (row) => dash(row.lines, fmt.integer(row.lines, lang)),
        sort: (a, b) => a.lines - b.lines,
        footer: fmt.integer(totals.lines, lang),
      },
    ],
    [t, tr, lang, totals],
  );

  return (
    <DataGrid<TrialRow>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.accountId}
      selectedKeys={selected}
      onSelectionChange={(keys) => {
        const [first] = [...keys];
        onSelect(first ?? null);
      }}
      onActivate={(row) => onActivate(row.accountId)}
      loading={loading}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      showFooter
      initialSort={{ columnId: 'code', direction: 'asc' }}
      empty={
        <EmptyState
          title={
            filtered
              ? tr('لا أرصدة مطابقة', 'Aucun solde correspondant', 'No matching balances')
              : tr('لا حركة بعد', 'Aucun mouvement', 'No postings yet')
          }
          description={tr(
            'الميزان يُشتق من سطور اليومية، فحساب بلا حركة لا يظهر هنا.',
            'La balance est dérivée des lignes du journal : un compte sans mouvement n’y figure pas.',
            'The trial balance is derived from journal lines, so an account with no postings has no row.',
          )}
        />
      }
    />
  );
}
