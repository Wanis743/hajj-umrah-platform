/**
 * Taskbar.
 *
 * The Windows 11 taskbar, as faithfully as a DOM allows: a centred cluster of
 * Start, search, Task View, Widgets and the app buttons, a system tray on the
 * trailing edge, and a one-pixel show-desktop sliver in the corner.
 *
 * The button list is the union of *pinned* apps (from the app registry, which
 * persists pins in `HKCU\…\Taskbar`) and *running* apps (from the window
 * manager, grouped by app id and filtered to the active virtual desktop). Every
 * affordance ends in a kernel call — nothing about a window's state is cached
 * here, which is why a window minimised by Task Manager, a snap layout or an
 * app's own `runtime.close()` all repaint the same button.
 *
 * Flyouts owned by the taskbar (hover previews, jump lists) are positioned
 * *inside* it deliberately: `.fx-taskbar` carries a `backdrop-filter`, which
 * makes it the containing block for fixed-position descendants, so viewport
 * coordinates would be wrong. Taskbar-local coordinates are correct and stay
 * correct when the viewport resizes.
 *
 * Below desktop width the bar keeps its height and its parts — 48px of icons is
 * already the right density for a thumb — but the centred cluster is abandoned
 * for a leading, scrollable one, because centring is done with
 * `translateX(-50%)` on an absolute box and a cluster wider than the bar would
 * then hang off both ends at once. The two flyouts it owns stop being pinned to
 * a button and span the bar instead.
 */
import {
  Bell,
  LayoutGrid,
  Pin,
  PinOff,
  Search,
  Sparkles,
  SquarePlus,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AppId, FormFactor, WindowInfo } from '../kernel/abi';
import type { InstalledApp, Kernel } from '../kernel/contracts';
import type { AppLocale } from '../sdk';
import { MenuFlyout, type MenuEntry } from '../sdk/ui';
import type { Appearance } from './appearance';
import { useKernel, useKernelAction, useKernelView, useKernelView2, useWallClock } from './bindings';
import { AppIcon } from './icons';
import type { ShellActions, ShellUi } from './shellState';

/** Hover dwell before the window-preview flyout opens, in ms. */
const PREVIEW_DWELL_MS = 380;
/** Grace period after the pointer leaves, so the pointer can cross the gap. */
const PREVIEW_GRACE_MS = 200;
/** Rows in a jump list are a fixed height, which lets us place it precisely. */
const MENU_ROW = 32;
const MENU_SEP = 9;
const MENU_HEADER = 26;
const MENU_PADDING = 10;
/** Live previews are wireframes, not screenshots; four is plenty. */
const MAX_PREVIEWS = 4;
/** Jump-list width, also used to keep one from spilling off a narrow bar. */
const JUMP_LIST_WIDTH = 220;

/** One taskbar button: an installed app plus whichever windows it owns now. */
interface TaskItem {
  readonly app: InstalledApp;
  readonly windows: readonly WindowInfo[];
}

interface Anchor {
  readonly appId: AppId;
  /** Centre of the button, in taskbar-local pixels. */
  readonly centerX: number;
}

interface MenuAnchor {
  readonly appId: AppId;
  /** Pointer position in taskbar-local pixels; `y` is negative (above the bar). */
  readonly x: number;
  readonly y: number;
}

/* ------------------------------------------------------------------ *
 * Item model
 * ------------------------------------------------------------------ */

/**
 * Pinned apps in install order, then running apps that are not pinned, in launch
 * order — the same stability Windows gives: a pinned button never moves because
 * something else started.
 */
function buildItems(kernel: Kernel): readonly TaskItem[] {
  const desktop = kernel.wm.activeDesktop();
  const grouped = new Map<string, WindowInfo[]>();
  for (const win of kernel.wm.list()) {
    if (win.desktop !== desktop) continue;
    const key = win.appId as string;
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [win]);
    else bucket.push(win);
  }

  const installed = kernel.apps.list();
  const items: TaskItem[] = [];
  const seen = new Set<string>();

  for (const app of installed) {
    if (!app.pinned || !app.enabled) continue;
    const key = app.manifest.id as string;
    seen.add(key);
    items.push({ app, windows: grouped.get(key) ?? [] });
  }
  for (const app of installed) {
    const key = app.manifest.id as string;
    if (seen.has(key)) continue;
    const windows = grouped.get(key);
    if (windows === undefined || windows.length === 0) continue;
    items.push({ app, windows });
  }
  return items;
}

const isFocused = (item: TaskItem): boolean => item.windows.some((win) => win.focused);

/* ------------------------------------------------------------------ *
 * Jump lists
 * ------------------------------------------------------------------ */

function jumpEntries(item: TaskItem, locale: AppLocale): readonly MenuEntry[] {
  const { manifest } = item.app;
  const entries: MenuEntry[] = [{ id: 'title', kind: 'header', label: locale.t(manifest.name) }];

  for (const command of manifest.jumpList ?? []) {
    entries.push({ id: `cmd:${command.id}`, label: locale.t(command.title), accelerator: command.accelerator });
  }
  if ((manifest.jumpList ?? []).length > 0) entries.push({ id: 'sep-1', kind: 'separator' });

  if (!manifest.singleInstance) {
    entries.push({
      id: 'new',
      label: locale.tr('نافذة جديدة', 'Nouvelle fenêtre', 'New window'),
      icon: SquarePlus,
    });
  }
  entries.push(
    item.app.pinned
      ? { id: 'unpin', label: locale.tr('إزالة التثبيت', 'Détacher', 'Unpin from taskbar'), icon: PinOff }
      : { id: 'pin', label: locale.tr('تثبيت في الشريط', 'Épingler', 'Pin to taskbar'), icon: Pin },
  );
  if (item.windows.length > 0) {
    entries.push({ id: 'sep-2', kind: 'separator' });
    entries.push({
      id: 'close',
      label:
        item.windows.length > 1
          ? locale.tr('إغلاق كل النوافذ', 'Fermer toutes les fenêtres', 'Close all windows')
          : locale.tr('إغلاق النافذة', 'Fermer la fenêtre', 'Close window'),
      icon: X,
      danger: true,
    });
  }
  return entries;
}

/** Exact height of a jump list, so it can be placed above the taskbar. */
function menuHeight(entries: readonly MenuEntry[]): number {
  let height = MENU_PADDING;
  for (const entry of entries) {
    if (entry.kind === 'separator') height += MENU_SEP;
    else if (entry.kind === 'header') height += MENU_HEADER;
    else height += MENU_ROW;
  }
  return height;
}

/* ------------------------------------------------------------------ *
 * Taskbar
 * ------------------------------------------------------------------ */

export interface TaskbarProps {
  readonly locale: AppLocale;
  readonly appearance: Appearance;
  readonly ui: ShellUi;
  readonly actions: ShellActions;
  /** Drops centred alignment and un-pins the bar's own flyouts at `compact`. */
  readonly formFactor: FormFactor;
  /** Close goes through the shell so unsaved work is still confirmed. */
  readonly onRequestClose: (win: WindowInfo) => void;
}

export function Taskbar({ locale, appearance, ui, actions, formFactor, onRequestClose }: TaskbarProps) {
  const kernel = useKernel();
  const run = useKernelAction();
  const barRef = useRef<HTMLDivElement | null>(null);
  const dwell = useRef(0);
  const [preview, setPreview] = useState<Anchor | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const compact = formFactor === 'compact';

  const items = useKernelView2(kernel.wm, kernel.apps, () => buildItems(kernel));

  useEffect(() => () => window.clearTimeout(dwell.current), []);

  /** Button centre in taskbar-local pixels, which is the flyout frame. */
  const localCenter = useCallback((element: HTMLElement): number => {
    const bar = barRef.current?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return box.left + box.width / 2 - (bar?.left ?? 0);
  }, []);

  const openPreview = (item: TaskItem, element: HTMLElement) => {
    window.clearTimeout(dwell.current);
    if (item.windows.length === 0) return;
    const centerX = localCenter(element);
    dwell.current = window.setTimeout(() => {
      setPreview({ appId: item.app.manifest.id, centerX });
    }, PREVIEW_DWELL_MS);
  };

  const closePreview = () => {
    window.clearTimeout(dwell.current);
    dwell.current = window.setTimeout(() => setPreview(null), PREVIEW_GRACE_MS);
  };

  const holdPreview = () => {
    window.clearTimeout(dwell.current);
  };

  const activate = (item: TaskItem, element: HTMLElement) => {
    actions.closeFlyout();
    setPreview(null);
    const { windows } = item;
    if (windows.length === 0) {
      void run(locale.t(item.app.manifest.name), () => kernel.launch(item.app.manifest.id));
      return;
    }
    if (windows.length > 1) {
      window.clearTimeout(dwell.current);
      setPreview({ appId: item.app.manifest.id, centerX: localCenter(element) });
      return;
    }
    const win = windows[0];
    if (win.focused && win.state !== 'minimized') {
      kernel.wm.minimize(win.id);
      return;
    }
    kernel.wm.restore(win.id);
    kernel.wm.focus(win.id);
  };

  const openJumpList = (item: TaskItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    window.clearTimeout(dwell.current);
    setPreview(null);
    const bar = barRef.current?.getBoundingClientRect();
    const height = menuHeight(jumpEntries(item, locale));
    const localX = event.clientX - (bar?.left ?? 0);
    // A 220px menu opened near the trailing edge of a 375px bar would hang off
    // the screen. There is always room on a desktop, so it is left alone there.
    const limit = Math.max(8, (bar?.width ?? 0) - JUMP_LIST_WIDTH - 8);
    setMenu({
      appId: item.app.manifest.id,
      x: compact ? Math.min(Math.max(8, localX), limit) : localX,
      y: -(height + 8),
    });
  };

  const onJumpSelect = (item: TaskItem, id: string) => {
    const appId = item.app.manifest.id;
    const name = locale.t(item.app.manifest.name);
    if (id.startsWith('cmd:')) {
      void run(name, () => kernel.sendCommand(appId, id.slice(4)));
      return;
    }
    if (id === 'new') {
      void run(name, () => kernel.launch(appId));
      return;
    }
    if (id === 'pin' || id === 'unpin') {
      kernel.apps.setPinned(appId, id === 'pin');
      return;
    }
    if (id === 'close') for (const win of item.windows) onRequestClose(win);
  };

  const menuItem = menu === null ? null : (items.find((item) => item.app.manifest.id === menu.appId) ?? null);
  const previewItem = preview === null ? null : (items.find((item) => item.app.manifest.id === preview.appId) ?? null);

  const cluster = (
    <>
      <SystemButtons locale={locale} appearance={appearance} ui={ui} actions={actions} />
      {items.map((item) => (
        <TaskButton
          key={item.app.manifest.id as string}
          item={item}
          locale={locale}
          active={preview?.appId === item.app.manifest.id || menu?.appId === item.app.manifest.id}
          onActivate={activate}
          onHover={openPreview}
          onLeave={closePreview}
          onContext={openJumpList}
          onNewInstance={(target) => {
            void run(locale.t(target.app.manifest.name), () => kernel.launch(target.app.manifest.id));
          }}
        />
      ))}
    </>
  );

  return (
    <div ref={barRef} className="fx-taskbar" onContextMenu={(event) => event.preventDefault()}>
      {appearance.taskbarAlignment === 'center' && !compact ? (
        <>
          <div className="fx-taskbar-left" />
          <div className="fx-taskbar-center">{cluster}</div>
        </>
      ) : (
        <div className="fx-taskbar-left">{cluster}</div>
      )}

      <TrayCluster locale={locale} ui={ui} actions={actions} />

      {previewItem !== null && preview !== null ? (
        <PreviewFlyout
          item={previewItem}
          locale={locale}
          centerX={preview.centerX}
          compact={compact}
          onEnter={holdPreview}
          onLeave={closePreview}
          onPick={(win) => {
            setPreview(null);
            kernel.wm.restore(win.id);
            kernel.wm.focus(win.id);
          }}
          onClose={(win) => onRequestClose(win)}
        />
      ) : null}

      {menuItem !== null && menu !== null ? (
        <MenuFlyout
          position="absolute"
          x={menu.x}
          y={menu.y}
          entries={jumpEntries(menuItem, locale)}
          onSelect={(id) => onJumpSelect(menuItem, id)}
          onDismiss={() => setMenu(null)}
          minWidth={JUMP_LIST_WIDTH}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shell buttons
 * ------------------------------------------------------------------ */

/**
 * Start, Search, Task View and Widgets.
 *
 * Three of the four are optional because Windows lets you hide them, and the
 * setting lives in the registry — so this reads `appearance` rather than deciding.
 */
function SystemButtons({
  locale,
  appearance,
  ui,
  actions,
}: {
  locale: AppLocale;
  appearance: Appearance;
  ui: ShellUi;
  actions: ShellActions;
}) {
  const { tr } = locale;
  return (
    <>
      <button
        type="button"
        className="fx-tb-btn"
        data-active={ui.flyout === 'start'}
        title={tr('ابدأ', 'Démarrer', 'Start')}
        aria-label={tr('ابدأ', 'Démarrer', 'Start')}
        onClick={() => actions.toggleFlyout('start')}
      >
        <StartGlyph />
      </button>
      {appearance.showSearch ? (
        <button
          type="button"
          className="fx-tb-btn"
          data-active={ui.flyout === 'search'}
          title={tr('بحث', 'Rechercher', 'Search')}
          aria-label={tr('بحث', 'Rechercher', 'Search')}
          onClick={() => actions.toggleFlyout('search')}
        >
          <Search size={19} strokeWidth={1.7} />
        </button>
      ) : null}
      {appearance.showTaskView ? (
        <button
          type="button"
          className="fx-tb-btn"
          data-active={ui.flyout === 'taskview'}
          title={tr('عرض المهام', 'Vue des tâches', 'Task View')}
          aria-label={tr('عرض المهام', 'Vue des tâches', 'Task View')}
          onClick={() => actions.toggleFlyout('taskview')}
        >
          <LayoutGrid size={18} strokeWidth={1.7} />
        </button>
      ) : null}
      {appearance.showWidgets ? (
        <button
          type="button"
          className="fx-tb-btn"
          data-active={ui.flyout === 'widgets'}
          title={tr('عناصر واجهة', 'Widgets', 'Widgets')}
          aria-label={tr('عناصر واجهة', 'Widgets', 'Widgets')}
          onClick={() => actions.toggleFlyout('widgets')}
        >
          <Sparkles size={18} strokeWidth={1.7} />
        </button>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * App button
 * ------------------------------------------------------------------ */

interface TaskButtonProps {
  readonly item: TaskItem;
  readonly locale: AppLocale;
  readonly active: boolean;
  readonly onActivate: (item: TaskItem, element: HTMLElement) => void;
  readonly onHover: (item: TaskItem, element: HTMLElement) => void;
  readonly onLeave: () => void;
  readonly onContext: (item: TaskItem, event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onNewInstance: (item: TaskItem) => void;
}

function TaskButton({ item, locale, active, onActivate, onHover, onLeave, onContext, onNewInstance }: TaskButtonProps) {
  const { manifest } = item.app;
  const running = item.windows.length > 0;
  const label = locale.t(manifest.name);
  // The most advanced progress of the group, which is what Windows shows.
  const progress = item.windows.reduce<number | null>(
    (best, win) => (win.progress === null ? best : Math.max(best ?? 0, win.progress)),
    null,
  );
  const badge = item.windows.reduce<number | null>(
    (sum, win) => (win.badge === null ? sum : (sum ?? 0) + win.badge),
    null,
  );

  return (
    <button
      type="button"
      className="fx-tb-btn"
      data-running={running}
      data-focusedwin={isFocused(item)}
      data-active={active}
      title={label}
      aria-label={label}
      onClick={(event) => onActivate(item, event.currentTarget)}
      onAuxClick={(event) => {
        // Middle click starts a second copy, as on Windows.
        if (event.button === 1 && !manifest.singleInstance) onNewInstance(item);
      }}
      onPointerEnter={(event) => onHover(item, event.currentTarget)}
      onPointerLeave={onLeave}
      onPointerDown={(event) => {
        if (event.button === 2) onContext(item, event);
      }}
    >
      {progress !== null ? (
        <span className="fx-tb-progress" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden />
      ) : null}
      <AppIcon icon={manifest.icon} category={manifest.category} size={24} />
      <span className="fx-tb-indicator" aria-hidden />
      {badge !== null && badge > 0 ? <span className="fx-tb-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Window previews
 * ------------------------------------------------------------------ */

interface PreviewFlyoutProps {
  readonly item: TaskItem;
  readonly locale: AppLocale;
  readonly centerX: number;
  /** Span the bar instead of pointing at a button, which a phone has no room for. */
  readonly compact: boolean;
  readonly onEnter: () => void;
  readonly onLeave: () => void;
  readonly onPick: (win: WindowInfo) => void;
  readonly onClose: (win: WindowInfo) => void;
}

/**
 * Hover previews. A browser cannot cheaply rasterise a live subtree, so each
 * card is a wireframe of the window's own geometry rather than a fake screenshot
 * — it still tells the user which window is which, and it never lies.
 */
function PreviewFlyout({ item, locale, centerX, compact, onEnter, onLeave, onPick, onClose }: PreviewFlyoutProps) {
  const shown = item.windows.slice(0, MAX_PREVIEWS);
  // Four cards centred on a 40px button need 600px of bar to sit under; a phone
  // has 375, so it becomes a strip across the bar and wraps in CSS instead.
  const anchor: CSSProperties = compact
    ? { insetInline: 8, bottom: 'calc(100% + 8px)' }
    : { left: centerX, bottom: 'calc(100% + 8px)', transform: 'translateX(-50%)' };
  return (
    <div
      className="fx-flyout fx-tb-preview"
      style={anchor}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {shown.map((win) => (
        <div key={win.id as string} className="fx-tb-preview-card" data-focused={win.focused}>
          <div className="fx-tb-preview-head">
            <AppIcon icon={item.app.manifest.icon} category={item.app.manifest.category} size={16} />
            <span className="fx-tb-preview-title">{win.title.length > 0 ? win.title : locale.t(item.app.manifest.name)}</span>
            <button
              type="button"
              className="fx-tb-preview-close"
              title={locale.tr('إغلاق', 'Fermer', 'Close')}
              aria-label={locale.tr('إغلاق', 'Fermer', 'Close')}
              onClick={() => onClose(win)}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
          <button type="button" className="fx-tb-preview-body" onClick={() => onPick(win)}>
            <span className="fx-tb-preview-wire" data-state={win.state}>
              <AppIcon icon={item.app.manifest.icon} category={item.app.manifest.category} size={28} />
            </span>
          </button>
        </div>
      ))}
      {item.windows.length > shown.length ? (
        <span className="fx-caption-text">
          {locale.tr(
            `+${item.windows.length - shown.length} أخرى`,
            `+${item.windows.length - shown.length} autres`,
            `+${item.windows.length - shown.length} more`,
          )}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tray
 * ------------------------------------------------------------------ */

function TrayCluster({ locale, ui, actions }: { locale: AppLocale; ui: ShellUi; actions: ShellActions }) {
  const kernel = useKernel();
  const now = useWallClock(20_000);
  const unread = useKernelView(kernel.notifications, () => kernel.notifications.unreadCount());

  const time = new Intl.DateTimeFormat(locale.intlLocale, { hour: '2-digit', minute: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat(locale.intlLocale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);

  return (
    <div className="fx-tray">
      <button
        type="button"
        className="fx-tray-btn"
        data-active={ui.flyout === 'quick'}
        title={locale.tr('الإعدادات السريعة', 'Paramètres rapides', 'Quick settings')}
        aria-label={locale.tr('الإعدادات السريعة', 'Paramètres rapides', 'Quick settings')}
        onClick={() => actions.toggleFlyout('quick')}
      >
        <Wifi size={15} strokeWidth={1.8} />
        <Volume2 size={15} strokeWidth={1.8} />
      </button>

      <button
        type="button"
        className="fx-tray-btn fx-tray-clock"
        data-active={ui.flyout === 'calendar'}
        title={new Intl.DateTimeFormat(locale.intlLocale, { dateStyle: 'full', timeStyle: 'short' }).format(now)}
        onClick={() => actions.toggleFlyout('calendar')}
      >
        <span>{time}</span>
        <span>{date}</span>
      </button>

      <button
        type="button"
        className="fx-tray-btn"
        data-active={ui.flyout === 'notifications'}
        title={locale.tr('الإشعارات', 'Notifications', 'Notifications')}
        aria-label={locale.tr('الإشعارات', 'Notifications', 'Notifications')}
        onClick={() => actions.toggleFlyout('notifications')}
      >
        <Bell size={15} strokeWidth={1.8} />
        {unread > 0 ? <span className="fx-tray-count">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      <button
        type="button"
        className="fx-show-desktop"
        title={locale.tr('إظهار سطح المكتب', 'Afficher le bureau', 'Show desktop')}
        aria-label={locale.tr('إظهار سطح المكتب', 'Afficher le bureau', 'Show desktop')}
        onClick={() => kernel.wm.minimizeAll()}
      />
    </div>
  );
}

/** The four-pane Windows mark, drawn rather than imported. */
function StartGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden focusable="false">
      <rect x="0" y="0" width="8.4" height="8.4" rx="1" fill="var(--fx-accent-light1)" />
      <rect x="10.6" y="0" width="8.4" height="8.4" rx="1" fill="var(--fx-accent-light1)" />
      <rect x="0" y="10.6" width="8.4" height="8.4" rx="1" fill="var(--fx-accent-light1)" />
      <rect x="10.6" y="10.6" width="8.4" height="8.4" rx="1" fill="var(--fx-accent-light1)" />
    </svg>
  );
}
