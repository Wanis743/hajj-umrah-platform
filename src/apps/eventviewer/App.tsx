/**
 * Event Viewer — the shell.
 *
 * One page, three panes: the log tree, the record list and the detail pane — the
 * anatomy Windows has shipped since Vista. What this file holds is a *view
 * definition* (which log, which levels, which age, which source) and the single
 * query derived from it. Nothing is cached: the kernel owns the rings.
 *
 * The split between kernel-side and app-side filtering is deliberate. Channel,
 * source and free text go into `eventlog.query`, because the kernel can settle
 * them while it walks the ring and the page it returns is bounded at 500. Level
 * and age are applied here, to that page, because that is what lets the level
 * chips carry a count: a query already filtered by level could never report how
 * many warnings it had left behind.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  AppWindow,
  Cpu,
  Filter,
  FolderTree,
  Layers,
  type LucideIcon,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import {
  AppFrame,
  type AppEntryProps,
  type EventChannel,
  type EventLevel,
  type EventQuery,
  type EventRecord,
  type Localized,
  TreeView,
  type TreeNode,
  useAppCommands,
  useContextMenu,
  usePolledSyscall,
  useWindowTitle,
} from '@/platform/sdk';
import {
  ADMIN_LEVELS,
  ADMIN_VIEW,
  CHANNELS,
  CHANNEL_LABEL,
  LEVELS,
  PAGE_LIMIT,
  type RangeId,
  rangeCutoff,
} from './catalog';
import { useLogActions } from './actions';
import { EventGrid, FilterStrip } from './grid';
import { LogStatus, LogToolbar, RowMenu } from './chrome';
import { EventDetails, EventProperties } from './panels';

/** A log, or the one custom view — `admin` spans every channel. */
type Scope = EventChannel | 'admin';

/** Windows refreshes on F5 alone. A live log is more useful, so: both. */
const REFRESH_MS = 5000;

const CUSTOM_ROOT = 'root:custom';
const WINDOWS_ROOT = 'root:windows';
const ADMIN_NODE = 'view:admin';

const CUSTOM_VIEWS: Localized = { ar: 'طرق عرض مخصّصة', fr: 'Vues personnalisées', en: 'Custom Views' };
const WINDOWS_LOGS: Localized = { ar: 'سجلات النظام', fr: 'Journaux Windows', en: 'Windows Logs' };

const CHANNEL_ICON: Readonly<Record<EventChannel, LucideIcon>> = {
  Application: AppWindow,
  Security: ShieldAlert,
  Setup: Wrench,
  System: Cpu,
};

/** The detail pane is fixed; the grid absorbs everything the window gains. */
const DETAIL_HEIGHT = 236;

/** Shared because they are never mutated: "nothing selected", "no level filter". */
const NO_LEVELS: ReadonlySet<EventLevel> = new Set<EventLevel>();
const NO_KEYS: ReadonlySet<string> = new Set<string>();

const ZERO_COUNTS: Readonly<Record<EventLevel, number>> = {
  critical: 0,
  error: 0,
  warning: 0,
  information: 0,
  verbose: 0,
};
/** Two roots, four logs and one view — the shape of the Event Viewer tree. */
function logTree(t: (text: Localized) => string): readonly TreeNode[] {
  return [
    {
      id: CUSTOM_ROOT,
      label: t(CUSTOM_VIEWS),
      icon: FolderTree,
      children: [{ id: ADMIN_NODE, label: t(ADMIN_VIEW), icon: Filter }],
    },
    {
      id: WINDOWS_ROOT,
      label: t(WINDOWS_LOGS),
      icon: Layers,
      children: CHANNELS.map((channel) => ({
        id: `channel:${channel}`,
        label: t(CHANNEL_LABEL[channel]),
        icon: CHANNEL_ICON[channel],
      })),
    },
  ];
}

/** `channel:Security` → `Security`; a root node is not a scope, so `null`. */
function scopeOf(nodeId: string): Scope | null {
  if (nodeId === ADMIN_NODE) return 'admin';
  return CHANNELS.find((candidate) => `channel:${candidate}` === nodeId) ?? null;
}

export default function EventViewerApp({ runtime }: AppEntryProps) {
  const { t, tr } = runtime.locale;
  const [scope, setScope] = useState<Scope>('System');
  const [source, setSource] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [levels, setLevels] = useState<ReadonlySet<EventLevel>>(NO_LEVELS);
  const [range, setRange] = useState<RangeId>('all');
  const [auto, setAuto] = useState(true);
  const [selection, setSelection] = useState<ReadonlySet<string>>(NO_KEYS);
  const [properties, setProperties] = useState<EventRecord | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([CUSTOM_ROOT, WINDOWS_ROOT]));
  const menu = useContextMenu<EventRecord>();

  const needle = search.trim();
  const request: EventQuery = {
    ...(scope === 'admin' ? {} : { channel: scope }),
    ...(source === null ? {} : { source }),
    ...(needle === '' ? {} : { search: needle }),
    limit: PAGE_LIMIT,
  };
  const page = usePolledSyscall('eventlog.query', request, auto ? REFRESH_MS : 0);

  useWindowTitle(tr('عارض الأحداث', 'Observateur d’événements', 'Event Viewer'));

  // Jump-list and palette entries arrive as `channel:<Channel>` or `filter:errors`.
  useAppCommands((command) => {
    const requested = scopeOf(command);
    if (requested !== null) {
      setScope(requested);
      setLevels(NO_LEVELS);
      return;
    }
    if (command === 'filter:errors') setLevels(new Set<EventLevel>(['critical', 'error']));
  });

  const view = scope === 'admin' ? ADMIN_LEVELS : LEVELS;

  // The page as the view defines it: age first, then the level chips. The cutoff
  // is taken when this runs, so a paused viewer holds its window still instead of
  // quietly dropping rows out of the bottom of it.
  const { visible, counts } = useMemo(() => {
    const cutoff = rangeCutoff(range, Date.now());
    const tally = { ...ZERO_COUNTS };
    const rows: EventRecord[] = [];
    for (const record of page.data ?? []) {
      if (!view.includes(record.level)) continue;
      if (Date.parse(record.at) < cutoff) continue;
      tally[record.level] += 1;
      if (levels.size > 0 && !levels.has(record.level)) continue;
      rows.push(record);
    }
    return { visible: rows, counts: tally };
  }, [page.data, view, levels, range]);

  const total = page.data?.length ?? 0;
  const newest = page.data?.[0] ?? null;
  const selected = visible.find((record) => selection.has(String(record.id))) ?? null;
  const scopeLabel = scope === 'admin' ? t(ADMIN_VIEW) : t(CHANNEL_LABEL[scope]);
  const dirty = levels.size > 0 || source !== null || range !== 'all' || needle !== '';

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const toggleLevel = (level: EventLevel) =>
    setLevels((current) => {
      const next = new Set(current);
      if (!next.delete(level)) next.add(level);
      return next;
    });

  const reset = () => {
    setLevels(NO_LEVELS);
    setSource(null);
    setRange('all');
    setSearch('');
  };

  // Picking a log clears the filters with it: a level chip that made sense on
  // Security is rarely what you want to carry into Setup.
  const choose = (node: TreeNode) => {
    const requested = scopeOf(node.id);
    if (requested === null) {
      toggle(node.id);
      return;
    }
    setScope(requested);
    setSelection(NO_KEYS);
    reset();
  };

  // A cleared log invalidates both the page and whatever was selected inside it.
  const { refresh } = page;
  const afterClear = useCallback(() => {
    setSelection(NO_KEYS);
    refresh();
  }, [refresh]);

  const actions = useLogActions(scope === 'admin' ? null : scope, scopeLabel, visible, afterClear);

  const act = (id: string, record: EventRecord) => {
    menu.close();
    if (id === 'copy') actions.copy(record);
    else if (id === 'source') setSource(record.source);
    else if (id === 'level') setLevels(new Set<EventLevel>([record.level]));
    else if (id === 'reset') reset();
    else if (id === 'properties') setProperties(record);
  };

  const commands = (
    <LogToolbar
      search={search}
      onSearch={setSearch}
      auto={auto}
      onAuto={setAuto}
      onRefresh={page.refresh}
      busy={actions.busy}
      canSave={visible.length > 0}
      canClear={scope !== 'admin' && total > 0}
      isView={scope === 'admin'}
      onSave={actions.save}
      onClear={actions.clear}
    />
  );

  const status = (
    <LogStatus
      scope={scopeLabel}
      shown={visible.length}
      total={total}
      error={page.error}
      newestAt={newest === null ? null : newest.at}
      live={auto}
    />
  );

  const target = menu.menu;
  const nav = (
    <TreeView
      nodes={logTree(t)}
      selectedId={scope === 'admin' ? ADMIN_NODE : `channel:${scope}`}
      expandedIds={expanded}
      onToggle={toggle}
      onSelect={choose}
    />
  );

  return (
    <AppFrame commands={commands} nav={nav} navWidth={244} status={status} scroll={false}>
      <FilterStrip
        view={view}
        active={levels}
        counts={counts}
        onToggle={toggleLevel}
        range={range}
        onRange={setRange}
        source={source}
        onClearSource={() => setSource(null)}
        dirty={dirty}
        onReset={reset}
      />
      <EventGrid
        rows={visible}
        loading={page.data === null}
        selection={selection}
        onSelectionChange={setSelection}
        onActivate={setProperties}
        onContextMenu={(record, event) => menu.open(event, record)}
      />
      <div
        className="fx-scroll"
        style={{
          flex: 'none',
          height: DETAIL_HEIGHT,
          overflow: 'auto',
          borderBlockStart: '1px solid var(--fx-divider)',
          background: 'var(--fx-card-secondary)',
        }}
      >
        <EventDetails record={selected} />
      </div>
      {target === null ? null : (
        <RowMenu
          x={target.x}
          y={target.y}
          record={target.target}
          sourcePinned={source === target.target.source}
          dirty={dirty}
          onSelect={(id) => act(id, target.target)}
          onDismiss={menu.close}
        />
      )}
      <EventProperties record={properties} onClose={() => setProperties(null)} />
    </AppFrame>
  );
}
