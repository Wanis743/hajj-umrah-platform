/**
 * Event Viewer — command bar, status bar and the row menu.
 *
 * Chrome, split out from the shell for the same reason Windows separates its
 * toolbar from its view: none of it holds state. Each of these takes what it
 * shows and reports what was pressed, which keeps `App.tsx` about the view
 * definition and nothing else.
 */
import { ClipboardCopy, Eye, FileDown, Filter, FilterX, ListFilter, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import {
  Button,
  type EventRecord,
  MenuFlyout,
  SearchBox,
  StatusItem,
  Switch,
  ToolbarSeparator,
  ToolbarSpacer,
  fmt,
  useApp,
} from '@/platform/sdk';

export interface LogToolbarProps {
  readonly search: string;
  readonly onSearch: (next: string) => void;
  /** Live tail; off means the view holds still until Refresh. */
  readonly auto: boolean;
  readonly onAuto: (next: boolean) => void;
  readonly onRefresh: () => void;
  readonly busy: 'save' | 'clear' | null;
  readonly canSave: boolean;
  readonly canClear: boolean;
  /** A custom view spans channels, so there is no single log to clear. */
  readonly isView: boolean;
  readonly onSave: () => void;
  readonly onClear: () => void;
}

/** Windows' Actions pane, flattened into the bar the rest of this OS uses. */
export function LogToolbar({
  search,
  onSearch,
  auto,
  onAuto,
  onRefresh,
  busy,
  canSave,
  canClear,
  isView,
  onSave,
  onClear,
}: LogToolbarProps) {
  const { tr } = useApp().locale;
  return (
    <>
      <Button size="sm" icon={RefreshCw} onClick={onRefresh}>
        {tr('تحديث', 'Actualiser', 'Refresh')}
      </Button>
      <Switch checked={auto} onChange={onAuto} label={tr('تلقائي', 'Auto', 'Auto')} />
      <ToolbarSeparator />
      <SearchBox
        value={search}
        onChange={onSearch}
        width={220}
        placeholder={tr('ابحث في الرسائل والمصادر', 'Rechercher un événement', 'Search messages, sources, ids')}
      />
      <ToolbarSpacer />
      <Button
        size="sm"
        icon={FileDown}
        onClick={onSave}
        busy={busy === 'save'}
        disabled={!canSave}
        title={tr('حفظ المعروض في Documents', 'Enregistrer la vue dans Documents', 'Save the filtered view to Documents')}
      >
        {tr('حفظ CSV', 'Enregistrer CSV', 'Save as CSV')}
      </Button>
      <Button
        size="sm"
        variant="danger"
        icon={Trash2}
        onClick={onClear}
        busy={busy === 'clear'}
        disabled={!canClear}
        title={isView ? tr('طريقة العرض ليست سجلًا', 'Une vue n’est pas un journal', 'A view is not a log') : undefined}
      >
        {tr('مسح السجل', 'Effacer', 'Clear log')}
      </Button>
    </>
  );
}
export interface LogStatusProps {
  readonly scope: string;
  readonly shown: number;
  readonly total: number;
  readonly error: string | null;
  /** Timestamp of the newest record on the page, or `null` for an empty log. */
  readonly newestAt: string | null;
  readonly live: boolean;
}

/** "12 of 500 events" is the only census here — a count per channel would cost a
 *  full walk of every ring, and Windows does not show one either. */
export function LogStatus({ scope, shown, total, error, newestAt, live }: LogStatusProps) {
  const { tr, lang } = useApp().locale;
  const counts = `${fmt.integer(shown, lang)} / ${fmt.integer(total, lang)}`;
  return (
    <>
      <StatusItem icon={ScrollText} title={tr('النطاق الحالي', 'Portée actuelle', 'Current scope')}>
        {scope}
      </StatusItem>
      <StatusItem>
        {tr(`${counts} حدثًا`, `${counts} événements`, `${counts} events`)}
      </StatusItem>
      {error === null ? null : <StatusItem tone="danger">{error}</StatusItem>}
      <ToolbarSpacer />
      {newestAt === null ? null : (
        <StatusItem title={fmt.dateTime(newestAt, lang)}>
          {tr(
            `الأحدث ${fmt.time(newestAt, lang)}`,
            `Dernier ${fmt.time(newestAt, lang)}`,
            `Newest ${fmt.time(newestAt, lang)}`,
          )}
        </StatusItem>
      )}
      <StatusItem tone={live ? 'success' : 'neutral'}>
        {live ? tr('مباشر', 'En direct', 'Live') : tr('موقوف', 'En pause', 'Paused')}
      </StatusItem>
    </>
  );
}
export interface RowMenuProps {
  readonly x: number;
  readonly y: number;
  readonly record: EventRecord;
  /** The list is already pinned to this record's source. */
  readonly sourcePinned: boolean;
  readonly dirty: boolean;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Right-click on a row.
 *
 * Windows opens its filter dialog prefilled; here the two filters people actually
 * reach for — this source, this level — are one click, and the dialog never has to
 * appear.
 */
export function RowMenu({ x, y, record, sourcePinned, dirty, onSelect, onDismiss }: RowMenuProps) {
  const { tr } = useApp().locale;
  return (
    <MenuFlyout
      position="fixed"
      x={x}
      y={y}
      onDismiss={onDismiss}
      onSelect={onSelect}
      entries={[
        { id: 'properties', label: tr('خصائص الحدث', 'Propriétés', 'Event properties'), icon: Eye },
        { id: 'copy', label: tr('نسخ التفاصيل', 'Copier les détails', 'Copy details'), icon: ClipboardCopy },
        { id: 'sep', kind: 'separator' },
        {
          id: 'source',
          label: tr('اقتصر على هذا المصدر', 'Filtrer sur cette source', 'Filter by this source'),
          icon: Filter,
          disabled: sourcePinned,
          accelerator: record.source,
        },
        {
          id: 'level',
          label: tr('اقتصر على هذا المستوى', 'Filtrer sur ce niveau', 'Show only this level'),
          icon: ListFilter,
        },
        { id: 'sep2', kind: 'separator' },
        {
          id: 'reset',
          label: tr('مسح المرشّحات', 'Effacer les filtres', 'Clear filters'),
          icon: FilterX,
          disabled: !dirty,
        },
      ]}
    />
  );
}
