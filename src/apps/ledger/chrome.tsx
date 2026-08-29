/**
 * Ledger — command bar, view rail, status bar and the row menu.
 *
 * Stateless chrome: each piece takes what it shows and reports what was pressed.
 *
 * The status bar carries the one disclosure this app owes anybody reading it. The
 * trial balance is not a stored figure — the broker derives it from at most 4000
 * journal lines and it does not filter by entry status, so a draft nobody has
 * posted still moves it. A difference at the bottom of that column is therefore
 * normal in a book with open drafts, and the status bar says so instead of leaving
 * a red number to be interpreted.
 */
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
  CornerDownRight,
  CreditCard,
  FileDown,
  Landmark,
  ListTree,
  Pencil,
  PiggyBank,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Ref } from 'react';
import {
  Button,
  Checkbox,
  IconButton,
  MenuFlyout,
  NavGroupLabel,
  NavItem,
  SearchBox,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  fmt,
  useApp,
} from '@/platform/sdk';
import {
  type Account,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  type AccountType,
  type Currency,
} from '../shared/ledger';
import type { LedgerBusy } from './actions';
import { type ChartTally, DERIVE_LIMIT, EPSILON, type LedgerFilter, type LedgerView, PAGE_LIMIT } from './accounts';

/* ------------------------------------------------------------------ *
 * Command bar
 * ------------------------------------------------------------------ */

export interface LedgerToolbarProps {
  readonly view: LedgerView;
  readonly search: string;
  readonly onSearch: (next: string) => void;
  /** Held by the shell so Ctrl+F can put the caret here. */
  readonly searchRef: Ref<HTMLInputElement>;
  readonly onCommand: (id: string) => void;
  readonly busy: LedgerBusy;
  readonly loading: boolean;
  /** No selection, nothing to edit. */
  readonly canEdit: boolean;
  readonly canExport: boolean;
}

export function LedgerToolbar({
  view,
  search,
  onSearch,
  searchRef,
  onCommand,
  busy,
  loading,
  canEdit,
  canExport,
}: LedgerToolbarProps) {
  const { tr } = useApp().locale;
  return (
    <>
      <Button size="sm" variant="accent" icon={Plus} onClick={() => onCommand('new')}>
        {tr('حساب جديد', 'Nouveau compte', 'New account')}
      </Button>
      <Button size="sm" icon={Pencil} disabled={!canEdit} onClick={() => onCommand('edit')}>
        {tr('تعديل', 'Modifier', 'Edit')}
      </Button>
      <ToolbarSeparator />
      <Button size="sm" icon={RefreshCw} busy={loading} onClick={() => onCommand('refresh')}>
        {tr('تحديث', 'Actualiser', 'Refresh')}
      </Button>
      <ToolbarSeparator />
      <SearchBox
        ref={searchRef}
        value={search}
        onChange={onSearch}
        width={240}
        placeholder={tr('الرمز أو اسم الحساب', 'Code ou nom du compte', 'Code or account name')}
      />
      {view === 'chart' ? (
        <>
          <ToolbarSeparator />
          <IconButton
            icon={ChevronsUpDown}
            size={28}
            label={tr('توسيع الكل', 'Tout déplier', 'Expand all')}
            onClick={() => onCommand('expand')}
          />
          <IconButton
            icon={ChevronsDownUp}
            size={28}
            label={tr('طي الكل', 'Tout replier', 'Collapse all')}
            onClick={() => onCommand('collapse')}
          />
        </>
      ) : null}
      <ToolbarSpacer />
      <Button
        size="sm"
        icon={FileDown}
        busy={busy === 'export'}
        disabled={!canExport}
        onClick={() => onCommand('export')}
        title={tr(
          'تصدير المعروض إلى CSV',
          'Exporter l’affichage en CSV',
          'Export what is on screen as CSV',
        )}
      >
        {tr('تصدير CSV', 'Exporter CSV', 'Export CSV')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * View rail
 * ------------------------------------------------------------------ */

const TYPE_ICON: Readonly<Record<AccountType, LucideIcon>> = {
  ASSET: Wallet,
  LIABILITY: CreditCard,
  EQUITY: PiggyBank,
  REVENUE: TrendingUp,
  EXPENSE: TrendingDown,
};

export interface ViewRailProps {
  readonly filter: LedgerFilter;
  readonly onFilter: (next: LedgerFilter) => void;
  readonly tally: ChartTally;
}

/**
 * The two views, the five types, and the two switches.
 *
 * The type badges honour the search but not the type itself, which is what makes
 * them worth reading: typing "bank" and seeing `Liability 1` next to `Asset 3` is
 * how you find the one account filed under the wrong nature.
 */
export function ViewRail({ filter, onFilter, tally }: ViewRailProps) {
  const { t, tr, lang } = useApp().locale;
  const patch = (next: Partial<LedgerFilter>) => onFilter({ ...filter, ...next });
  const badge = (count: number): number | null => (count === 0 ? null : count);
  return (
    <>
      <NavGroupLabel>{tr('العرض', 'Vues', 'Views')}</NavGroupLabel>
      <NavItem
        icon={ListTree}
        label={tr('دليل الحسابات', 'Plan comptable', 'Chart of accounts')}
        selected={filter.view === 'chart'}
        onClick={() => patch({ view: 'chart' })}
      />
      <NavItem
        icon={Scale}
        label={tr('ميزان المراجعة', 'Balance générale', 'Trial balance')}
        selected={filter.view === 'trial'}
        onClick={() => patch({ view: 'trial' })}
      />
      <NavGroupLabel>{tr('الأنواع', 'Natures', 'Types')}</NavGroupLabel>
      <NavItem
        icon={Landmark}
        label={tr('كل الأنواع', 'Toutes natures', 'All types')}
        selected={filter.type === null}
        badge={badge(tally.all)}
        onClick={() => patch({ type: null })}
      />
      {ACCOUNT_TYPES.map((type) => (
        <NavItem
          key={type}
          icon={TYPE_ICON[type]}
          label={t(ACCOUNT_TYPE_LABEL[type])}
          selected={filter.type === type}
          badge={badge(tally.byType[type])}
          onClick={() => patch({ type })}
        />
      ))}
      <NavGroupLabel>{tr('الإظهار', 'Affichage', 'Show')}</NavGroupLabel>
      <div style={{ display: 'grid', gap: 8, padding: '2px 10px 10px' }}>
        <Checkbox
          checked={filter.showInactive}
          onChange={(next) => patch({ showInactive: next })}
          label={
            tally.inactive === 0
              ? tr('غير المفعّلة', 'Comptes inactifs', 'Inactive accounts')
              : `${tr('غير المفعّلة', 'Comptes inactifs', 'Inactive accounts')} (${fmt.integer(tally.inactive, lang)})`
          }
        />
        <Checkbox
          checked={filter.withActivityOnly}
          onChange={(next) => patch({ withActivityOnly: next })}
          label={
            tally.unused === 0
              ? tr('التي بها حركة فقط', 'Avec mouvements', 'With postings only')
              : `${tr('التي بها حركة فقط', 'Avec mouvements', 'With postings only')} (${fmt.integer(tally.loaded - tally.unused, lang)})`
          }
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

export interface LedgerStatusProps {
  readonly shown: number;
  readonly loaded: number;
  /** Accounts whose parent is not on this page — shown as roots, counted here. */
  readonly orphans: number;
  readonly debit: number;
  readonly credit: number;
  readonly difference: number;
  /** Journal lines the trial balance was derived from. */
  readonly lines: number;
  readonly currency: Currency;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

export function LedgerStatus({
  shown,
  loaded,
  orphans,
  debit,
  credit,
  difference,
  lines,
  currency,
  error,
  fetchedAt,
}: LedgerStatusProps) {
  const { tr, lang } = useApp().locale;
  const counts = `${fmt.integer(shown, lang)} / ${fmt.integer(loaded, lang)}`;
  const balanced = Math.abs(difference) < EPSILON;
  return (
    <>
      <StatusItem icon={ListTree} title={tr('المعروض من المحمّل', 'Affichés sur chargés', 'Shown of loaded')}>
        {tr(`${counts} حساب`, `${counts} comptes`, `${counts} accounts`)}
      </StatusItem>
      {loaded < PAGE_LIMIT ? null : (
        <StatusItem
          tone="warning"
          title={tr(
            `الوسيط يحمّل ${String(PAGE_LIMIT)} حسابًا كحد أقصى. ضيّق البحث لرؤية الباقي.`,
            `Le courtier charge au plus ${String(PAGE_LIMIT)} comptes. Affinez la recherche pour voir le reste.`,
            `The broker loads at most ${String(PAGE_LIMIT)} accounts. Narrow the search to see the rest.`,
          )}
        >
          {tr('صفحة مقتطعة', 'Page tronquée', 'Page truncated')}
        </StatusItem>
      )}
      {orphans === 0 ? null : (
        <StatusItem
          tone="warning"
          title={tr(
            'حسابات أبوها ليس في هذه الصفحة، فتظهر في الجذر.',
            'Comptes dont le parent est absent de cette page : affichés à la racine.',
            'Accounts whose parent is not on this page, shown at the root instead.',
          )}
        >
          {tr(
            `${fmt.integer(orphans, lang)} بلا أب`,
            `${fmt.integer(orphans, lang)} sans parent`,
            `${fmt.integer(orphans, lang)} detached`,
          )}
        </StatusItem>
      )}
      {error === null ? null : <StatusItem tone="danger">{error}</StatusItem>}
      <ToolbarSpacer />
      <StatusItem
        title={tr(
          `مشتق من ${String(DERIVE_LIMIT)} سطر كحد أقصى، بما فيها المسودات غير المرحّلة.`,
          `Dérivé de ${String(DERIVE_LIMIT)} lignes au plus, brouillons non comptabilisés compris.`,
          `Derived from at most ${String(DERIVE_LIMIT)} lines, unposted drafts included.`,
        )}
      >
        {tr(
          `${fmt.integer(lines, lang)} سطر`,
          `${fmt.integer(lines, lang)} lignes`,
          `${fmt.integer(lines, lang)} lines`,
        )}
      </StatusItem>
      <StatusItem title={tr('مجموع المدين', 'Total débit', 'Debit total')}>
        {tr('مدين', 'Débit', 'Debit')} {fmt.money(debit, currency, lang)}
      </StatusItem>
      <StatusItem title={tr('مجموع الدائن', 'Total crédit', 'Credit total')}>
        {tr('دائن', 'Crédit', 'Credit')} {fmt.money(credit, currency, lang)}
      </StatusItem>
      <StatusItem
        icon={Scale}
        tone={balanced ? 'success' : 'warning'}
        title={tr(
          'الميزان يضم كل الأسطر بما فيها المسودات، لذا الفرق طبيعي في دفتر به قيود غير مرحّلة.',
          'La balance inclut les brouillons : un écart est normal dans un livre où des écritures ne sont pas comptabilisées.',
          'The trial balance counts drafts too, so a difference is expected in a book with unposted entries.',
        )}
      >
        {balanced
          ? tr('متوازن', 'Équilibrée', 'Balanced')
          : `${tr('الفرق', 'Écart', 'Difference')} ${fmt.money(difference, currency, lang)}`}
      </StatusItem>
      {fetchedAt === null ? null : (
        <StatusItem title={fmt.dateTime(fetchedAt, lang)}>{fmt.time(fetchedAt, lang)}</StatusItem>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Row menu
 * ------------------------------------------------------------------ */

export interface AccountMenuProps {
  readonly x: number;
  readonly y: number;
  readonly account: Account;
  /** Live accounts underneath, named in the menu before anything is switched off. */
  readonly activeChildren: number;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Right-click on an account.
 *
 * Deactivating from here skips the form, so the one thing the form would have said
 * is said in the accelerator slot instead: switching off a parent leaves its
 * children switched on, and a chart where a live account hangs under a dead one is
 * a chart whose pickers disagree with its tree.
 */
export function AccountMenu({ x, y, account, activeChildren, onSelect, onDismiss }: AccountMenuProps) {
  const { tr } = useApp().locale;
  const orphaning = account.active && activeChildren > 0;
  return (
    <MenuFlyout
      position="fixed"
      x={x}
      y={y}
      onDismiss={onDismiss}
      onSelect={onSelect}
      minWidth={244}
      entries={[
        { id: 'head', kind: 'header', label: `${account.code} · ${account.name}` },
        { id: 'edit', label: tr('تعديل الحساب…', 'Modifier le compte…', 'Edit account…'), icon: Pencil },
        {
          id: 'child',
          label: tr('حساب فرعي جديد…', 'Nouveau sous-compte…', 'New child account…'),
          icon: CornerDownRight,
        },
        { id: 'sep1', kind: 'separator' },
        {
          id: 'toggle',
          label: account.active
            ? tr('إيقاف الحساب', 'Désactiver le compte', 'Deactivate account')
            : tr('تفعيل الحساب', 'Réactiver le compte', 'Reactivate account'),
          icon: account.active ? PowerOff : Power,
          danger: account.active,
          accelerator: orphaning
            ? tr(
                `${String(activeChildren)} فرعًا مفعّلًا`,
                `${String(activeChildren)} enfant(s) actifs`,
                `${String(activeChildren)} active children`,
              )
            : undefined,
        },
        { id: 'sep2', kind: 'separator' },
        {
          id: 'trial',
          label: tr('إظهاره في الميزان', 'Voir dans la balance', 'Find in the trial balance'),
          icon: Scale,
        },
        {
          id: 'copy',
          label: tr('نسخ الحساب وحركته', 'Copier le compte et ses mouvements', 'Copy account and postings'),
          icon: ClipboardCopy,
        },
      ]}
    />
  );
}
