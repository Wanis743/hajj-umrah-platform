/**
 * Store — the window.
 *
 * The shape is Windows 11's own: a rail of views on the left, a grid of tiles in
 * the middle, a details pane on the right. What it does *not* have is the part of
 * a real store that needs a network — no featured carousel, no ratings, no
 * download progress — because this image has no network and a shopfront that
 * invented those would be the only lying surface in the OS.
 *
 * Everything the window can do, it can also be told to do from outside: the jump
 * list, the command palette and `store <view>` in Terminal all arrive through
 * `useAppCommands`, so there is one code path per view rather than two.
 */
import { useMemo, useState } from 'react';
import { Layers, PackageCheck, Pin, RefreshCw, ShieldOff } from 'lucide-react';
import {
  AppFrame,
  type AppCategoryId,
  type AppEntryProps,
  Badge,
  Button,
  InfoBar,
  NavGroupLabel,
  NavItem,
  SearchBox,
  Select,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  fmt,
  useAppCommands,
  useCapability,
  usePolledSyscall,
  useWindowTitle,
} from '@/platform/sdk';
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../shared/categories';
import {
  CATEGORY_ICON,
  HISTORY_LIMIT,
  HISTORY_SOURCE,
  type SortId,
  SORT_LABEL,
  type StoreEntry,
  VIEW_ICON,
  VIEW_LABEL,
  type ViewId,
  selectEntries,
  tally,
  useStore,
  useStoreActions,
} from './catalog';
import { AppDetails, AppGrid, GridEmpty, InstallHistory } from './panels';

/** The Setup channel does not move unless this window moves it. */
const ONCE = 0;

/** Wide enough for a permission badge and a property row side by side. */
const ASIDE_WIDTH = 344;

const VIEWS: readonly ViewId[] = ['catalogue', 'installed', 'library', 'history'];
const SORTS: readonly SortId[] = ['name', 'category', 'installed', 'launches'];

/** `catalogue`, `installed`, `library`, `history` — or nothing we know. */
const asView = (command: string): ViewId | null =>
  (VIEWS as readonly string[]).includes(command) ? (command as ViewId) : null;

export default function StoreApp({ runtime }: AppEntryProps) {
  const { t, tr, lang } = runtime.locale;
  const [view, setView] = useState<ViewId>('catalogue');
  const [category, setCategory] = useState<AppCategoryId | null>(null);
  const [needle, setNeedle] = useState('');
  const [sort, setSort] = useState<SortId>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const store = useStore();
  const actions = useStoreActions(store.refresh);

  // Install and removal rewrite HKLM; pins are per-user settings. Two different
  // capabilities, so a role can have one without the other — and both have to be
  // asked about rather than assumed, or a viewer gets buttons that only fail.
  const manage = useCapability('registry.write');
  const pin = useCapability('settings.write');

  // The history view is the only one that reads the log, but the request is
  // stable, so it costs one syscall for the lifetime of the window either way.
  const history = usePolledSyscall(
    'eventlog.query',
    { channel: 'Setup', source: HISTORY_SOURCE, limit: HISTORY_LIMIT },
    ONCE,
  );

  useWindowTitle(tr('المتجر', 'Boutique', 'Store'));

  useAppCommands((command) => {
    const requested = asView(command);
    if (requested !== null) {
      setView(requested);
      setCategory(null);
      return;
    }
    if (command === 'refresh') {
      store.refresh();
      history.refresh();
    }
  });

  const counts = useMemo(() => tally(store.entries), [store.entries]);

  const rows = useMemo(
    () => selectEntries(store.entries, { view, category, needle }, sort, t),
    [store.entries, view, category, needle, sort, t],
  );

  const selected: StoreEntry | null =
    store.entries.find((entry) => String(entry.manifest.id) === selectedId) ?? null;

  // A view change can strand the selection outside the visible rows. The details
  // pane keeps showing it on purpose: it is still a real app, and losing the pane
  // on every click of the rail would be the more annoying answer.
  const choose = (entry: StoreEntry) => setSelectedId(String(entry.manifest.id));

  const historyRows = history.data ?? [];

  const commands = (
    <>
      <SearchBox
        value={needle}
        onChange={setNeedle}
        width={260}
        placeholder={tr('ابحث في التطبيقات', 'Rechercher une application', 'Search apps')}
      />
      <ToolbarSeparator />
      <Select
        value={sort}
        onChange={(next) => setSort(next as SortId)}
        width={190}
        options={SORTS.map((id) => ({ value: id, label: t(SORT_LABEL[id]) }))}
      />
      <Button
        variant="subtle"
        icon={RefreshCw}
        onClick={() => {
          store.refresh();
          history.refresh();
        }}
      >
        {tr('تحديث', 'Actualiser', 'Refresh')}
      </Button>
      <ToolbarSpacer />
      <Badge tone="neutral" icon={Layers}>
        {view === 'history'
          ? fmt.integer(historyRows.length, lang)
          : `${fmt.integer(rows.length, lang)} / ${fmt.integer(counts.total, lang)}`}
      </Badge>
    </>
  );

  const nav = (
    <>
      <NavGroupLabel>{tr('المتجر', 'Boutique', 'Store')}</NavGroupLabel>
      {VIEWS.map((id) => (
        <NavItem
          key={id}
          icon={VIEW_ICON[id]}
          label={t(VIEW_LABEL[id])}
          selected={view === id}
          badge={
            id === 'installed'
              ? counts.installed
              : id === 'library'
                ? counts.removed
                : id === 'catalogue'
                  ? counts.total
                  : null
          }
          onClick={() => {
            setView(id);
            setCategory(null);
          }}
        />
      ))}

      <NavGroupLabel>{tr('الفئات', 'Catégories', 'Categories')}</NavGroupLabel>
      {CATEGORY_ORDER.map((id) => (
        <NavItem
          key={id}
          icon={CATEGORY_ICON[id]}
          label={t(CATEGORY_LABEL[id])}
          depth={1}
          selected={category === id}
          badge={counts.byCategory[id] ?? 0}
          disabled={view === 'history'}
          // Clicking the active category clears it, which is what a filter chip
          // does everywhere else in this OS.
          onClick={() => {
            setCategory((current) => (current === id ? null : id));
            if (view === 'history') setView('catalogue');
          }}
        />
      ))}
    </>
  );

  const status = (
    <>
      <StatusItem icon={PackageCheck}>
        {tr('مثبّتة', 'Installées', 'Installed')}: {fmt.integer(counts.installed, lang)}
      </StatusItem>
      <StatusItem icon={Layers}>
        {tr('في المكتبة', 'Bibliothèque', 'Library')}: {fmt.integer(counts.removed, lang)}
      </StatusItem>
      <StatusItem icon={Pin}>
        {tr('مثبّتة بالشريط', 'Épinglées', 'Pinned')}: {fmt.integer(counts.pinned, lang)}
      </StatusItem>
      <ToolbarSpacer />
      {manage.granted ? null : (
        <StatusItem icon={ShieldOff} tone="warning" title={tr('للقراءة فقط', 'Lecture seule', 'Read-only')}>
          {tr('عرض فقط', 'Consultation', 'View only')}
        </StatusItem>
      )}
      {store.error === null ? null : (
        <StatusItem tone="danger" title={store.error}>
          {store.error}
        </StatusItem>
      )}
    </>
  );

  const aside = (
    <div style={{ padding: 16 }}>
      <AppDetails
        entry={selected}
        actions={actions}
        canManage={manage.granted}
        managePrompts={manage.elevationRequired}
        canPin={pin.granted}
      />
    </div>
  );

  return (
    <AppFrame commands={commands} nav={nav} navWidth={228} aside={aside} asideWidth={ASIDE_WIDTH} status={status} padded>
      {store.error === null ? null : (
        <InfoBar tone="danger" title={tr('تعذّر قراءة القائمة', 'Inventaire illisible', 'Inventory unavailable')}>
          {store.error}
        </InfoBar>
      )}
      {view === 'history' ? (
        <InstallHistory rows={historyRows} loading={history.data === null} />
      ) : (
        <AppGrid
          entries={rows}
          selectedId={selectedId}
          onSelect={choose}
          onOpen={(entry) => actions.open(entry)}
          empty={<GridEmpty icon={VIEW_ICON[view]} needle={needle} onClear={() => setNeedle('')} />}
        />
      )}
    </AppFrame>
  );
}
