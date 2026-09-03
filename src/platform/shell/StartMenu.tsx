/**
 * Start menu.
 *
 * Windows 11 layout: a search field, a pinned grid with an "All apps" pivot, a
 * recommended strip fed by the file system, and a footer carrying the signed-in
 * principal and the power menu.
 *
 * The menu is a *view* over kernel state — installed apps come from the app
 * registry, recommendations from the VFS, the account from the security
 * subsystem, the "Show recommended" preference from the registry. Nothing is
 * stored here, so uninstalling an app or renaming a file is reflected on the next
 * notification without any bookkeeping.
 */
import { ChevronRight, Power, Search, Trash2, SquareArrowOutUpRight, Pin, PinOff } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { APP_IDS, REG, type PowerAction, type VfsStat } from '../kernel/abi';
import type { InstalledApp, Kernel } from '../kernel/contracts';
import { KERNEL_USER_FOLDER } from '../kernel/kernel';
import type { AppLocale } from '../sdk';
import { fmt } from '../sdk';
import { MenuFlyout, type MenuEntry } from '../sdk/ui';
import { useDismissOnOutside, useKernel, useKernelAction, useKernelView, useKernelView2, useToast } from './bindings';
import { iconForContentType } from './iconRegistry';
import { AppIcon } from './icons';
import { rankApps } from './ranking';

/** Three rows of six, which is what the 640px width affords. */
const MAX_TILES = 18;
const MAX_RECOMMENDED = 6;
const MAX_RESULTS = 8;
/** Menu row heights, so the power flyout can be placed above its button. */
const MENU_ROW = 32;
const MENU_SEP = 9;

const RECENT_ROOTS: readonly string[] = [
  `${KERNEL_USER_FOLDER}\\Desktop`,
  `${KERNEL_USER_FOLDER}\\Documents`,
];

/* ------------------------------------------------------------------ *
 * Selection model
 * ------------------------------------------------------------------ */

type Row =
  | { readonly kind: 'app'; readonly app: InstalledApp }
  | { readonly kind: 'file'; readonly stat: VfsStat };

/**
 * Apps a user may start. System components (Settings, Event Viewer, Registry
 * Editor) belong in the list exactly as they do in Windows — `systemComponent` only
 * means the app cannot be uninstalled, which the tile menu enforces separately.
 * Policy disables an app by clearing `enabled`, and that is the only thing hidden
 * here.
 */
const launchable = (apps: readonly InstalledApp[]): readonly InstalledApp[] =>
  apps.filter((app) => app.enabled);

/**
 * Start-menu ordering: pinned apps first (the user's own choice), then the rest
 * by launch count. Ties fall back to the display name so the grid never
 * reshuffles for no reason.
 */
function tileOrder(apps: readonly InstalledApp[], locale: AppLocale): readonly InstalledApp[] {
  return [...launchable(apps)].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.launches !== b.launches) return b.launches - a.launches;
    return locale.t(a.manifest.name).localeCompare(locale.t(b.manifest.name), locale.intlLocale);
  });
}

/** Recently modified documents, which is the honest local answer to "recent". */
function recentFiles(kernel: Kernel, limit: number): readonly VfsStat[] {
  const found: VfsStat[] = [];
  for (const root of RECENT_ROOTS) {
    const listed = kernel.vfs.list(root, false);
    if (!listed.ok) continue;
    for (const stat of listed.value) if (stat.kind === 'file') found.push(stat);
  }
  return found.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, limit);
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/* ------------------------------------------------------------------ *
 * Start menu
 * ------------------------------------------------------------------ */

export interface StartMenuProps {
  readonly locale: AppLocale;
  readonly onDismiss: () => void;
  readonly onPower: (action: PowerAction) => void;
}

export function StartMenu({ locale, onDismiss, onPower }: StartMenuProps) {
  const kernel = useKernel();
  const run = useKernelAction();
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [allApps, setAllApps] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [power, setPower] = useState<{ x: number; y: number } | null>(null);
  const [tileMenu, setTileMenu] = useState<{ app: InstalledApp; x: number; y: number } | null>(null);

  useDismissOnOutside(true, onDismiss, '.fx-start, .fx-taskbar, .fx-menu');

  const installed = useKernelView(kernel.apps, () => kernel.apps.list());
  const files = useKernelView2(kernel.vfs, kernel.apps, () => recentFiles(kernel, MAX_RECOMMENDED));
  const showRecommended = useKernelView(kernel.registry, () =>
    kernel.registry.getBoolean(REG.userStart, 'ShowRecommended', true),
  );
  const principal = kernel.security.principal();

  const needle = query.trim().toLowerCase();
  const results = useMemo<readonly Row[]>(() => {
    if (needle.length === 0) return [];
    const apps = rankApps(launchable(installed), needle, locale, MAX_RESULTS).map<Row>((entry) => ({
      kind: 'app',
      app: entry.app,
    }));
    const hits = kernel.vfs.search(KERNEL_USER_FOLDER, needle, 5);
    const fileRows = hits.ok ? hits.value.map<Row>((stat) => ({ kind: 'file', stat })) : [];
    return [...apps, ...fileRows];
  }, [needle, installed, locale, kernel]);

  const open = (row: Row) => {
    onDismiss();
    if (row.kind === 'app') {
      const { id, name } = row.app.manifest;
      void run(locale.t(name), () => kernel.launch(id));
      return;
    }
    void run(row.stat.name, () => kernel.openPath(row.stat.path));
  };

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (query.length > 0) setQuery('');
      else onDismiss();
      return;
    }
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((value) => (value + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((value) => (value - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = results[Math.min(cursor, results.length - 1)];
      if (row !== undefined) open(row);
    }
  };

  const openTileMenu = (app: InstalledApp, clientX: number, clientY: number) => {
    const box = rootRef.current?.getBoundingClientRect();
    setTileMenu({ app, x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) });
  };

  const onTileCommand = (app: InstalledApp, id: string) => {
    const { id: appId, name } = app.manifest;
    if (id === 'open') {
      onDismiss();
      void run(locale.t(name), () => kernel.launch(appId));
      return;
    }
    if (id === 'pin' || id === 'unpin') {
      kernel.apps.setPinned(appId, id === 'pin');
      return;
    }
    if (id === 'uninstall') {
      const result = kernel.apps.uninstall(appId);
      if (!result.ok) toast({ kind: 'error', title: locale.t(name), body: result.error.message });
    }
  };

  return (
    <div ref={rootRef} className="fx-start" onContextMenu={(event) => event.preventDefault()}>
      <div className="fx-start-search">
        <Search size={15} strokeWidth={1.8} />
        <input
          className="fx-start-input"
          autoFocus
          value={query}
          placeholder={locale.tr('اكتب للبحث', 'Rechercher', 'Type here to search')}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onSearchKey}
        />
      </div>

      <div className="fx-start-body fx-scroll">
        {needle.length > 0 ? (
          <ResultList locale={locale} rows={results} cursor={cursor} onOpen={open} />
        ) : allApps ? (
          <AllApps
            locale={locale}
            apps={tileOrder(installed, locale)}
            onBack={() => setAllApps(false)}
            onOpen={(app) => open({ kind: 'app', app })}
            onContext={openTileMenu}
          />
        ) : (
          <PinnedBoard
            locale={locale}
            apps={tileOrder(installed, locale)}
            files={files}
            showRecommended={showRecommended}
            onAllApps={() => setAllApps(true)}
            onOpen={(app) => open({ kind: 'app', app })}
            onOpenFile={(stat) => open({ kind: 'file', stat })}
            onContext={openTileMenu}
          />
        )}
      </div>

      <div className="fx-start-footer">
        <button
          type="button"
          className="fx-start-user"
          title={principal.email ?? principal.displayName}
          onClick={() => {
            onDismiss();
            void run(locale.tr('الحساب', 'Compte', 'Account'), () =>
              kernel.launch(APP_IDS.settings, { page: 'accounts' }),
            );
          }}
        >
          <span className="fx-start-avatar">{initials(principal.displayName)}</span>
          <span className="fx-start-user-name">{principal.displayName}</span>
        </button>
        <button
          type="button"
          className="fx-icon-btn"
          data-active={power !== null}
          title={locale.tr('الطاقة', 'Marche/Arrêt', 'Power')}
          aria-label={locale.tr('الطاقة', 'Marche/Arrêt', 'Power')}
          onClick={(event) => {
            const box = rootRef.current?.getBoundingClientRect();
            const button = event.currentTarget.getBoundingClientRect();
            const height = MENU_ROW * 4 + MENU_SEP + 10;
            setPower({
              x: button.right - (box?.left ?? 0) - 200,
              y: button.top - (box?.top ?? 0) - height - 6,
            });
          }}
        >
          <Power size={17} strokeWidth={1.8} />
        </button>
      </div>

      {power !== null ? (
        <MenuFlyout
          position="absolute"
          x={power.x}
          y={power.y}
          minWidth={200}
          entries={powerEntries(locale)}
          onDismiss={() => setPower(null)}
          onSelect={(id) => {
            onDismiss();
            onPower(id as PowerAction);
          }}
        />
      ) : null}

      {tileMenu !== null ? (
        <MenuFlyout
          position="absolute"
          x={tileMenu.x}
          y={tileMenu.y}
          minWidth={210}
          entries={tileEntries(tileMenu.app, locale)}
          onDismiss={() => setTileMenu(null)}
          onSelect={(id) => onTileCommand(tileMenu.app, id)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Pinned board
 * ------------------------------------------------------------------ */

/**
 * The default page: the pinned grid, and the recommended list under it.
 *
 * "Recommended" is a registry setting, so it is passed in rather than read here —
 * one reader per value keeps the menu's subscriptions in one place.
 */
function PinnedBoard({
  locale,
  apps,
  files,
  showRecommended,
  onAllApps,
  onOpen,
  onOpenFile,
  onContext,
}: {
  locale: AppLocale;
  apps: readonly InstalledApp[];
  files: readonly VfsStat[];
  showRecommended: boolean;
  onAllApps: () => void;
  onOpen: (app: InstalledApp) => void;
  onOpenFile: (stat: VfsStat) => void;
  onContext: (app: InstalledApp, clientX: number, clientY: number) => void;
}) {
  return (
    <>
      <div className="fx-start-section">
        <span className="fx-subtitle-text">{locale.tr('مثبّتة', 'Épinglées', 'Pinned')}</span>
        <button type="button" className="fx-btn" data-size="sm" onClick={onAllApps}>
          {locale.tr('كل التطبيقات', 'Toutes les applications', 'All apps')}
          <ChevronRight size={13} />
        </button>
      </div>
      <div className="fx-start-grid">
        {apps.slice(0, MAX_TILES).map((app) => (
          <button
            key={app.manifest.id as string}
            type="button"
            className="fx-start-tile"
            onClick={() => onOpen(app)}
            onContextMenu={(event) => onContext(app, event.clientX, event.clientY)}
          >
            <AppIcon icon={app.manifest.icon} category={app.manifest.category} size={32} />
            <span className="fx-start-tile-label">{locale.t(app.manifest.name)}</span>
          </button>
        ))}
      </div>

      {showRecommended ? (
        <>
          <div className="fx-start-section">
            <span className="fx-subtitle-text">{locale.tr('موصى به', 'Recommandé', 'Recommended')}</span>
          </div>
          <Recommended locale={locale} files={files} onOpen={onOpenFile} />
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Menus
 * ------------------------------------------------------------------ */

function powerEntries(locale: AppLocale): readonly MenuEntry[] {
  return [
    { id: 'lock', label: locale.tr('تأمين', 'Verrouiller', 'Lock') },
    { id: 'signOut', label: locale.tr('تسجيل الخروج', 'Se déconnecter', 'Sign out') },
    { id: 'sep', kind: 'separator' },
    { id: 'restart', label: locale.tr('إعادة التشغيل', 'Redémarrer', 'Restart') },
    { id: 'shutdown', label: locale.tr('إيقاف التشغيل', 'Arrêter', 'Shut down'), danger: true },
  ];
}

function tileEntries(app: InstalledApp, locale: AppLocale): readonly MenuEntry[] {
  return [
    { id: 'open', label: locale.tr('فتح', 'Ouvrir', 'Open'), icon: SquareArrowOutUpRight },
    app.pinned
      ? { id: 'unpin', label: locale.tr('إزالة من الشريط', 'Détacher', 'Unpin from taskbar'), icon: PinOff }
      : { id: 'pin', label: locale.tr('تثبيت في الشريط', 'Épingler', 'Pin to taskbar'), icon: Pin },
    { id: 'sep', kind: 'separator' },
    {
      id: 'uninstall',
      label: locale.tr('إلغاء التثبيت', 'Désinstaller', 'Uninstall'),
      icon: Trash2,
      danger: true,
      disabled: app.manifest.systemComponent,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Panes
 * ------------------------------------------------------------------ */

function ResultList({
  locale,
  rows,
  cursor,
  onOpen,
}: {
  locale: AppLocale;
  rows: readonly Row[];
  cursor: number;
  onOpen: (row: Row) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="fx-start-empty fx-caption-text">
        {locale.tr('لا توجد نتائج', 'Aucun résultat', 'No results found')}
      </p>
    );
  }
  return (
    <div className="fx-start-list">
      {rows.map((row, index) => {
        const selected = index === Math.min(cursor, rows.length - 1);
        if (row.kind === 'app') {
          const { manifest } = row.app;
          return (
            <button
              key={`app:${manifest.id as string}`}
              type="button"
              className="fx-start-list-item"
              data-selected={selected}
              onClick={() => onOpen(row)}
            >
              <AppIcon icon={manifest.icon} category={manifest.category} size={24} />
              <span className="fx-start-list-text">
                <span>{locale.t(manifest.name)}</span>
                <span className="fx-caption-text">{locale.t(manifest.description)}</span>
              </span>
            </button>
          );
        }
        const Glyph = iconForContentType(row.stat.contentType, 'file');
        return (
          <button
            key={`file:${row.stat.path}`}
            type="button"
            className="fx-start-list-item"
            data-selected={selected}
            onClick={() => onOpen(row)}
          >
            <Glyph size={20} strokeWidth={1.7} />
            <span className="fx-start-list-text">
              <span>{row.stat.name}</span>
              <span className="fx-caption-text">{row.stat.path}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One app in the A–Z list, with its display name resolved once. */
interface AppRow {
  readonly app: InstalledApp;
  readonly name: string;
}

/** Every app sharing an initial, under the divider that labels them. */
interface LetterGroup {
  /**
   * The first app's id. Keying on the letter itself would assume that
   * `localeCompare` never interleaves two initials — true for en/fr, not a
   * promise worth making for every locale the shell can run in.
   */
  readonly key: string;
  readonly letter: string;
  readonly rows: AppRow[];
}

function AllApps({
  locale,
  apps,
  onBack,
  onOpen,
  onContext,
}: {
  locale: AppLocale;
  apps: readonly InstalledApp[];
  onBack: () => void;
  onOpen: (app: InstalledApp) => void;
  onContext: (app: InstalledApp, clientX: number, clientY: number) => void;
}) {
  /**
   * Grouped by initial rather than merely tagged with one. The divider is
   * `position: sticky`, and a sticky box can only travel inside its own
   * containing block — so the wrapper has to span the whole group. One wrapper
   * per app caps the pin at a single row's worth of scrolling, which reads as a
   * divider that slides away instead of one that holds its section.
   */
  const groups = useMemo<readonly LetterGroup[]>(() => {
    const named: AppRow[] = apps.map((app) => ({ app, name: locale.t(app.manifest.name) }));
    named.sort((a, b) => a.name.localeCompare(b.name, locale.intlLocale));
    const out: LetterGroup[] = [];
    for (const row of named) {
      const letter = row.name.slice(0, 1).toUpperCase();
      const last = out.length === 0 ? undefined : out[out.length - 1];
      if (last !== undefined && last.letter === letter) last.rows.push(row);
      else out.push({ key: row.app.manifest.id as string, letter, rows: [row] });
    }
    return out;
  }, [apps, locale]);

  return (
    <>
      <div className="fx-start-section">
        <button type="button" className="fx-btn" data-size="sm" onClick={onBack}>
          <ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} />
          {locale.tr('رجوع', 'Retour', 'Back')}
        </button>
        <span className="fx-subtitle-text">{locale.tr('كل التطبيقات', 'Toutes les applications', 'All apps')}</span>
      </div>
      <div className="fx-start-list">
        {groups.map((group) => (
          <div key={group.key} className="fx-start-group">
            <div className="fx-start-letter">{group.letter}</div>
            {group.rows.map(({ app, name }) => (
              <button
                key={app.manifest.id as string}
                type="button"
                className="fx-start-list-item"
                onClick={() => onOpen(app)}
                onContextMenu={(event) => onContext(app, event.clientX, event.clientY)}
              >
                <AppIcon icon={app.manifest.icon} category={app.manifest.category} size={24} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function Recommended({
  locale,
  files,
  onOpen,
}: {
  locale: AppLocale;
  files: readonly VfsStat[];
  onOpen: (stat: VfsStat) => void;
}) {
  if (files.length === 0) {
    return (
      <p className="fx-start-empty fx-caption-text">
        {locale.tr(
          'ستظهر هنا الملفات المستخدمة حديثًا',
          'Vos fichiers récents apparaîtront ici',
          'Recently used files will show up here',
        )}
      </p>
    );
  }
  return (
    <div className="fx-start-rec">
      {files.map((stat) => {
        const Glyph = iconForContentType(stat.contentType, 'file');
        return (
          <button key={stat.path} type="button" className="fx-start-rec-item" onClick={() => onOpen(stat)}>
            <Glyph size={22} strokeWidth={1.6} />
            <span className="fx-start-list-text">
              <span>{stat.name}</span>
              <span className="fx-caption-text">
                {fmt.relativeTime(stat.modifiedAt, locale.lang)} · {fmt.bytes(stat.size, locale.lang)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
