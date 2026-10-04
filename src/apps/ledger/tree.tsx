/**
 * Ledger — the chart tree and the trial-balance grid.
 *
 * A tree and a grid, because they are two different objects rather than two skins of
 * one. The chart is navigation: its order *is* information, nothing about it sorts,
 * and what a person does with it is walk down it until they reach the account they
 * came for. The trial balance is a report: one row per account, footed, sorting on
 * every column.
 *
 * The chart used to be a grid too — eight columns of rolled-up debit, credit, balance
 * and posting counts, tree-ordered. Those columns went when the layout changed, and
 * the reason is that they were the wrong answer to the question the window is for. A
 * table of every account's totals is the trial balance, which is one press away and
 * does it better; what the chart is for is finding one account and reading *its*
 * ledger, and that pane used to get a 336-pixel gutter while the table of totals got
 * the window. Now the tree gets a column and the account gets the rest. One rolled-up
 * figure survives, as a badge on the node, because "this branch contains 4.2M" is the
 * one fact that makes a person open a branch rather than scroll past it.
 *
 * Neither carries a footer here. The chart's figures roll up, so adding them down
 * would count the same posting once per generation above it; the page's real totals
 * are in the status bar, computed from the trial rows instead.
 */
import { type MouseEvent, type ReactNode, useMemo } from 'react';
import {
  Badge,
  type Column,
  DataGrid,
  EmptyState,
  fmt,
  Spinner,
  type TreeNode,
  TreeView,
  useApp,
} from '@/platform/sdk';
import { type Account, ACCOUNT_TYPE_LABEL, type TrialRow } from '../shared/ledger';
import { type ChartRow, type Rollup, type RollupIndex, rollupOf, type TrialTotals } from './accounts';

const ROW_HEIGHT = 33;

/** One empty set, so "nothing selected" is not a new object every render. */
const NO_SELECTION: ReadonlySet<string> = new Set<string>();

/** Indent per generation. Narrow on purpose: a chart is often six deep. */
const INDENT = 14;

const dash = (value: number, text: string): string => (value === 0 ? '—' : text);

/** Nothing to do: a filter is deciding what is open, so a chevron reports rather than offers. */
const FROZEN = (): void => undefined;

export interface ChartTreeProps {
  readonly rows: readonly ChartRow[];
  readonly rollups: RollupIndex;
  readonly loading: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onToggle: (accountId: string) => void;
  readonly onContextMenu: (account: Account, event: MouseEvent) => void;
  readonly filtered: boolean;
  /**
   * True when a filter is deciding what is open. The chevrons then draw the state
   * without offering to change it, because the filter would overrule the click.
   */
  readonly autoExpanded: boolean;
}

/** A node under construction: `TreeNode`'s children are readonly once it is finished. */
interface Building {
  readonly id: string;
  readonly label: ReactNode;
  readonly children: TreeNode[];
  readonly expandable: boolean;
  readonly badge: ReactNode;
}

/**
 * The flattened rows, folded back into the shape they came from.
 *
 * `chartTable` hands over a list with a depth on each row, which is what a grid wants
 * and the inverse of what a tree wants. Re-nesting it here rather than walking the
 * account index again is deliberate: every filter rule — which accounts survived,
 * which ancestors were dragged along by a search hit, what a narrowed chart opens on
 * its own — is already decided in that list, and a second traversal would be a second
 * place for those rules to live.
 *
 * A collapsed branch has no children in the list, so `expandable` carries the chevron
 * instead: `childCount` counts what survived the filter, which is exactly the number
 * that makes opening the branch worth the click.
 */
function nest(rows: readonly ChartRow[], toNode: (row: ChartRow) => Building): readonly TreeNode[] {
  const roots: TreeNode[] = [];
  // One open children array per generation currently being filled.
  const open: TreeNode[][] = [];
  for (const row of rows) {
    const node = toNode(row);
    const depth = Math.min(row.depth, open.length);
    (depth === 0 ? roots : open[depth - 1]).push(node);
    open.length = depth;
    open.push(node.children);
  }
  return roots;
}

/**
 * The chart of accounts as a tree, in a column of its own.
 *
 * Expansion is read back out of the rows rather than taken as a prop. A row knows
 * whether it is open, and under a filter that knowledge is the filter's rather than
 * the person's — deriving the set from the rows means both modes are one code path
 * and the two cannot disagree about which branches are showing.
 */
export function ChartTree({
  rows,
  rollups,
  loading,
  selectedId,
  onSelect,
  onToggle,
  onContextMenu,
  filtered,
  autoExpanded,
}: ChartTreeProps) {
  const { tr } = useApp().locale;

  const nodes = useMemo(
    () =>
      nest(rows, (row) => ({
        id: row.account.id,
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span className="fx-mono" style={{ flex: 'none' }}>
              {row.account.code}
            </span>
            <span className="fx-title-ellipsis">{row.account.name}</span>
            {row.account.active ? null : <Badge tone="neutral">{tr('موقوف', 'Inactif', 'Inactive')}</Badge>}
          </span>
        ),
        children: [],
        expandable: row.childCount > 0,
        badge: <TreeBadge total={rollupOf(rollups, row.account.id)} />,
      })),
    [rows, rollups, tr],
  );

  const expandedIds = useMemo(() => {
    const open = new Set<string>();
    for (const row of rows) if (row.expanded) open.add(row.account.id);
    return open;
  }, [rows]);

  const accountOf = useMemo(() => {
    const byId = new Map<string, Account>();
    for (const row of rows) byId.set(row.account.id, row.account);
    return byId;
  }, [rows]);

  if (rows.length === 0) {
    return loading ? (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    ) : (
      <ChartEmpty filtered={filtered} />
    );
  }

  return (
    <div className="fx-scroll" role="tree" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 6 }}>
      <TreeView
        nodes={nodes}
        selectedId={selectedId}
        onSelect={(node) => onSelect(node.id)}
        expandedIds={expandedIds}
        onToggle={autoExpanded ? FROZEN : onToggle}
        onContextMenu={(node, event) => {
          const account = accountOf.get(node.id);
          if (account !== undefined) onContextMenu(account, event);
        }}
        indent={INDENT}
      />
    </div>
  );
}

interface BalanceCellProps {
  readonly total: Rollup;
}

/**
 * The branch's balance, on the node that owns it.
 *
 * `∑` means descendants are inside the figure, which on a tree is the difference
 * between "this account holds 4.2M" and "something under this account does". An
 * account with no postings anywhere beneath it shows nothing at all rather than a
 * dash: two hundred dashes down a navigation column is noise, and the drill pane
 * states the zero properly for the one account somebody asked about.
 */
function TreeBadge({ total }: BalanceCellProps) {
  const { tr, lang } = useApp().locale;
  if (total.lines === 0) return null;
  return (
    <span
      className="fx-mono"
      style={{ flex: 'none', fontSize: 11, color: 'var(--fx-text-tertiary)' }}
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
