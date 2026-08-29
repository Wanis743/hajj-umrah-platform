/**
 * Journal — command bar, view rail, filter bar, status bar and the row menu.
 *
 * Stateless chrome: each piece takes what it shows and reports what was pressed.
 * The split matters more here than in most apps, because the filters are the
 * feature — a journal is a book you interrogate, not a list you scroll — and the
 * controls that narrow it deserve to be readable in one place.
 *
 * Two of the four filters cannot be pushed to the server: the broker's `where`
 * speaks equality, `in` and `is null`, so the period is a query and the date
 * range and the text search are settled over the page. That is why the status bar
 * says when the page it is describing is a window rather than the whole book.
 */
import {
  BookOpen,
  CalendarRange,
  CircleSlash,
  ClipboardCopy,
  Copy,
  FileDown,
  FilePlus2,
  FolderOpen,
  Files,
  Layers,
  RefreshCw,
  Scale,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  MenuFlyout,
  NavGroupLabel,
  NavItem,
  SearchBox,
  Select,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  fmt,
  useApp,
} from '@/platform/sdk';
import type { Ref } from 'react';
import {
  type Currency,
  ENTRY_STATUSES,
  ENTRY_STATUS_LABEL,
  type FiscalPeriod,
  type JournalEntry,
  isBalanced,
} from '../shared/ledger';
import type { JournalBusy } from './actions';
import { type JournalFilter, PAGE_LIMIT, type Tally, type ViewId, isFiltered } from './entries';

/* ------------------------------------------------------------------ *
 * Command bar
 * ------------------------------------------------------------------ */

export interface JournalToolbarProps {
  readonly search: string;
  readonly onSearch: (next: string) => void;
  /** Held by the shell so Ctrl+F can put the caret here. */
  readonly searchRef: Ref<HTMLInputElement>;
  readonly onCommand: (id: string) => void;
  readonly busy: JournalBusy;
  readonly loading: boolean;
  /** Nothing on screen means nothing to export. */
  readonly canExport: boolean;
}

export function JournalToolbar({
  search,
  onSearch,
  searchRef,
  onCommand,
  busy,
  loading,
  canExport,
}: JournalToolbarProps) {
  const { tr } = useApp().locale;
  return (
    <>
      <Button size="sm" variant="accent" icon={FilePlus2} onClick={() => onCommand('new')}>
        {tr('قيد جديد', 'Nouvelle écriture', 'New entry')}
      </Button>
      <Button size="sm" icon={FolderOpen} busy={busy === 'open'} onClick={() => onCommand('open')}>
        {tr('فتح مسودة', 'Ouvrir', 'Open draft')}
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
        width={230}
        placeholder={tr('المرجع أو الوصف أو المصدر', 'Référence, libellé, origine', 'Reference, description, source')}
      />
      <ToolbarSpacer />
      <Button
        size="sm"
        icon={FileDown}
        busy={busy === 'export'}
        disabled={!canExport}
        onClick={() => onCommand('export')}
        title={tr(
          'تصدير القيود المعروضة إلى CSV',
          'Exporter les écritures affichées en CSV',
          'Export the visible entries as CSV',
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

export interface ViewRailProps {
  readonly view: ViewId;
  readonly onView: (next: ViewId) => void;
  /** Counts honour every filter except the view itself. */
  readonly counts: Tally['counts'];
  readonly periods: readonly FiscalPeriod[];
  readonly periodId: string | null;
  readonly onPeriod: (next: string | null) => void;
}

const VIEW_ALL: ViewId = 'all';

/**
 * The four lifecycle states, plus everything, with live counts.
 *
 * The counts are why the view is settled here rather than pushed down to the
 * broker: a query already narrowed to `posted` could never report how many drafts
 * it had left behind, and "3 drafts" in the rail is the reason anyone opens this
 * app on a Monday.
 */
export function ViewRail({ view, onView, counts, periods, periodId, onPeriod }: ViewRailProps) {
  const { t, tr, lang } = useApp().locale;
  const badge = (count: number): number | null => (count === 0 ? null : count);
  return (
    <>
      <NavGroupLabel>{tr('العرض', 'Vues', 'Views')}</NavGroupLabel>
      <NavItem
        icon={Layers}
        label={tr('كل القيود', 'Toutes', 'All entries')}
        selected={view === VIEW_ALL}
        badge={badge(counts.all)}
        onClick={() => onView(VIEW_ALL)}
      />
      {ENTRY_STATUSES.map((candidate) => (
        <NavItem
          key={candidate}
          icon={candidate === 'void' ? CircleSlash : candidate === 'posted' ? BookOpen : Files}
          label={t(ENTRY_STATUS_LABEL[candidate])}
          selected={view === candidate}
          badge={badge(counts[candidate])}
          onClick={() => onView(candidate)}
        />
      ))}
      <NavGroupLabel>{tr('الفترة المالية', 'Période', 'Fiscal period')}</NavGroupLabel>
      <div style={{ padding: '2px 8px 8px' }}>
        <Select
          value={periodId ?? ''}
          onChange={(next) => onPeriod(next === '' ? null : next)}
          width="100%"
          placeholder={tr('كل الفترات', 'Toutes les périodes', 'All periods')}
          options={[
            { value: '', label: tr('كل الفترات', 'Toutes les périodes', 'All periods') },
            ...periods.map((period) => ({
              value: period.id,
              label: `${period.label} · ${fmt.date(period.start, lang)}`,
            })),
          ]}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Filter bar
 * ------------------------------------------------------------------ */

export interface FilterBarProps {
  readonly filter: JournalFilter;
  readonly onFilter: (next: JournalFilter) => void;
  readonly sources: readonly string[];
  readonly unbalanced: number;
}

/**
 * The row of narrowing controls under the command bar.
 *
 * "Clear filters" ignores the view on purpose: the view is where you are, not a
 * filter, so leaving Drafts is something you do by clicking Drafts again.
 */
export function FilterBar({ filter, onFilter, sources, unbalanced }: FilterBarProps) {
  const { tr, lang } = useApp().locale;
  const patch = (next: Partial<JournalFilter>) => onFilter({ ...filter, ...next });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '6px 12px',
        borderBottom: '1px solid var(--fx-stroke)',
        background: 'var(--fx-layer-alt)',
        fontSize: 12,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--fx-text-secondary)' }}>
        <CalendarRange size={13} />
        {tr('من', 'Du', 'From')}
      </span>
      <Input
        type="date"
        value={filter.from}
        onChange={(next) => patch({ from: next })}
        style={{ width: 142 }}
        aria-label={tr('من تاريخ', 'Date de début', 'From date')}
      />
      <span style={{ color: 'var(--fx-text-secondary)' }}>{tr('إلى', 'Au', 'to')}</span>
      <Input
        type="date"
        value={filter.to}
        onChange={(next) => patch({ to: next })}
        style={{ width: 142 }}
        aria-label={tr('إلى تاريخ', 'Date de fin', 'To date')}
      />
      <ToolbarSeparator />
      <Select
        value={filter.source ?? ''}
        onChange={(next) => patch({ source: next === '' ? null : next })}
        width={168}
        options={[
          { value: '', label: tr('كل المصادر', 'Toutes origines', 'All sources') },
          ...sources.map((source) => ({ value: source, label: source })),
        ]}
      />
      <Checkbox
        checked={filter.unbalancedOnly}
        onChange={(next) => patch({ unbalancedOnly: next })}
        label={
          unbalanced === 0
            ? tr('غير المتوازنة فقط', 'Déséquilibrées seulement', 'Unbalanced only')
            : tr(
                `غير المتوازنة فقط (${fmt.integer(unbalanced, lang)})`,
                `Déséquilibrées seulement (${fmt.integer(unbalanced, lang)})`,
                `Unbalanced only (${fmt.integer(unbalanced, lang)})`,
              )
        }
      />
      <ToolbarSpacer />
      {isFiltered(filter) ? (
        <Button
          size="sm"
          variant="subtle"
          icon={X}
          onClick={() => patch({ search: '', from: '', to: '', source: null, unbalancedOnly: false })}
        >
          {tr('مسح المرشّحات', 'Effacer les filtres', 'Clear filters')}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

export interface JournalStatusProps {
  readonly shown: number;
  readonly loaded: number;
  readonly debit: number;
  readonly credit: number;
  readonly unbalanced: number;
  readonly currency: Currency;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

/**
 * Counts, the two totals, and the truth about the page.
 *
 * The broker caps a page at 500 rows. When the book has more, saying so is not a
 * detail: a footer that sums 500 of 900 entries and calls it a total is how a
 * month gets closed on the wrong number.
 */
export function JournalStatus({
  shown,
  loaded,
  debit,
  credit,
  unbalanced,
  currency,
  error,
  fetchedAt,
}: JournalStatusProps) {
  const { tr, lang } = useApp().locale;
  const counts = `${fmt.integer(shown, lang)} / ${fmt.integer(loaded, lang)}`;
  const balanced = Math.abs(debit - credit) < 0.005;
  return (
    <>
      <StatusItem icon={BookOpen} title={tr('المعروض من المحمّل', 'Affichées sur chargées', 'Shown of loaded')}>
        {tr(`${counts} قيد`, `${counts} écritures`, `${counts} entries`)}
      </StatusItem>
      {loaded < PAGE_LIMIT ? null : (
        <StatusItem
          tone="warning"
          title={tr(
            `الوسيط يحمّل ${String(PAGE_LIMIT)} سطرًا كحد أقصى. ضيّق الفترة أو التواريخ لرؤية الباقي.`,
            `Le courtier charge au plus ${String(PAGE_LIMIT)} lignes. Réduisez la période pour voir le reste.`,
            `The broker loads at most ${String(PAGE_LIMIT)} rows. Narrow the period or dates to see the rest.`,
          )}
        >
          {tr('صفحة مقتطعة', 'Page tronquée', 'Page truncated')}
        </StatusItem>
      )}
      {unbalanced === 0 ? null : (
        <StatusItem icon={Scale} tone="danger">
          {tr(
            `${fmt.integer(unbalanced, lang)} غير متوازن`,
            `${fmt.integer(unbalanced, lang)} déséquilibrées`,
            `${fmt.integer(unbalanced, lang)} unbalanced`,
          )}
        </StatusItem>
      )}
      {error === null ? null : <StatusItem tone="danger">{error}</StatusItem>}
      <ToolbarSpacer />
      <StatusItem title={tr('مجموع المدين المعروض', 'Total débit affiché', 'Visible debit total')}>
        {tr('مدين', 'Débit', 'Debit')} {fmt.money(debit, currency, lang)}
      </StatusItem>
      <StatusItem title={tr('مجموع الدائن المعروض', 'Total crédit affiché', 'Visible credit total')}>
        {tr('دائن', 'Crédit', 'Credit')} {fmt.money(credit, currency, lang)}
      </StatusItem>
      <StatusItem tone={balanced ? 'success' : 'danger'}>
        {balanced
          ? tr('متوازن', 'Équilibré', 'Balanced')
          : `${tr('الفرق', 'Écart', 'Difference')} ${fmt.money(debit - credit, currency, lang)}`}
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

export interface EntryMenuProps {
  readonly x: number;
  readonly y: number;
  readonly entry: JournalEntry;
  /** A duplicate needs the lines, and they arrive one query later. */
  readonly linesLoaded: boolean;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Right-click on an entry.
 *
 * The lifecycle decides what is offered rather than greying out everything and
 * letting the server refuse: a posted entry cannot be posted again, a void one
 * cannot be voided, and an unbalanced draft cannot go to the books at all — the
 * RPC would reject it, so the menu says so before the round trip.
 */
export function EntryMenu({ x, y, entry, linesLoaded, onSelect, onDismiss }: EntryMenuProps) {
  const { tr } = useApp().locale;
  const balanced = isBalanced(entry);
  return (
    <MenuFlyout
      position="fixed"
      x={x}
      y={y}
      onDismiss={onDismiss}
      onSelect={onSelect}
      minWidth={232}
      entries={[
        { id: 'head', kind: 'header', label: entry.reference === '' ? entry.date : entry.reference },
        {
          id: 'post',
          label: tr('ترحيل إلى الدفاتر', 'Comptabiliser', 'Post to the books'),
          icon: Send,
          disabled: entry.status === 'posted' || entry.status === 'void' || !balanced,
          accelerator: balanced ? undefined : tr('غير متوازن', 'Déséquilibré', 'Unbalanced'),
        },
        {
          id: 'void',
          label: tr('إلغاء بقيد معاكس…', 'Annuler par contre-passation…', 'Void with a reversal…'),
          icon: Undo2,
          danger: true,
          disabled: entry.status === 'void' || entry.status === 'draft',
        },
        { id: 'sep', kind: 'separator' },
        {
          id: 'duplicate',
          label: tr('تكرار كمسودة', 'Dupliquer en brouillon', 'Duplicate as draft'),
          icon: Copy,
          // Without the lines a duplicate would carry the header and no detail,
          // which is worse than not offering it for the moment it takes to load.
          disabled: !linesLoaded,
          accelerator: linesLoaded ? undefined : tr('جارٍ التحميل…', 'Chargement…', 'Loading…'),
        },
        { id: 'copy', label: tr('نسخ القيد وسطوره', 'Copier avec les lignes', 'Copy entry and lines'), icon: ClipboardCopy },
      ]}
    />
  );
}
