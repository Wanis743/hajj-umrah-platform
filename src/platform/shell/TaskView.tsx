/**
 * Task View and the Alt+Tab switcher.
 *
 * Task View is the full-screen overview Win+Tab opens: every window on the
 * active virtual desktop as a card, plus the desktop strip along the bottom for
 * creating, renaming, switching and closing desktops. The switcher is the small
 * centred overlay Alt+Tab shows while the key is held.
 *
 * There is no compositor here, so a card cannot show live pixels. Instead of
 * faking a screenshot it draws the window's *actual geometry* inside a
 * viewport-shaped box — which is genuinely useful, because it tells the user
 * where the window is and how it is snapped, and it is never a lie.
 *
 * Neither surface owns state. Task View reads the window manager and writes
 * through it; the switcher is handed the MRU index the root tracks while Alt is
 * down. Closing a window always goes back through `onRequestClose` so unsaved
 * work is still confirmed.
 */
import { MoveRight, Pin, PinOff, Plus, SquareSplitHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  AppCategoryId,
  DesktopId,
  SnapZone,
  WindowInfo,
} from '../kernel/abi';
import type { Kernel, WmViewport } from '../kernel/contracts';
import type { AppLocale } from '../sdk';
import { MenuFlyout, type MenuEntry } from '../sdk/ui';
import { useKernel, useKernelView, useKernelView2 } from './bindings';
import { AppIcon } from './icons';

interface Card {
  readonly win: WindowInfo;
  readonly icon: string;
  readonly category: AppCategoryId;
  readonly app: string;
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

function buildCards(kernel: Kernel, locale: AppLocale, desktop: DesktopId): readonly Card[] {
  return kernel.wm
    .list()
    .filter((win) => win.desktop === desktop)
    .map((win) => {
      const installed = kernel.apps.get(win.appId);
      return {
        win,
        icon: installed === null ? 'app-window' : installed.manifest.icon,
        category: installed === null ? ('system' as AppCategoryId) : installed.manifest.category,
        app: installed === null ? (win.appId as string) : locale.t(installed.manifest.name),
      };
    });
}

/** The work area a window is positioned inside, in viewport coordinates. */
function workArea(viewport: WmViewport): { readonly w: number; readonly h: number; readonly top: number } {
  return {
    w: Math.max(1, viewport.w),
    h: Math.max(1, viewport.h - viewport.insetTop - viewport.insetBottom),
    top: viewport.insetTop,
  };
}

function MiniLayout({ win, viewport }: { win: WindowInfo; viewport: WmViewport }) {
  const area = workArea(viewport);
  const minimized = win.state === 'minimized';
  return (
    <div className="fx-tv-mini" style={{ aspectRatio: `${area.w} / ${area.h}` }} aria-hidden="true">
      <span
        className="fx-tv-mini-win"
        data-dim={minimized ? 'true' : 'false'}
        style={{
          insetInlineStart: `${clamp01(win.rect.x / area.w) * 100}%`,
          top: `${clamp01((win.rect.y - area.top) / area.h) * 100}%`,
          width: `${clamp01(win.rect.w / area.w) * 100}%`,
          height: `${clamp01(win.rect.h / area.h) * 100}%`,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Task view
 * ------------------------------------------------------------------ */

export interface TaskViewProps {
  readonly locale: AppLocale;
  readonly onDismiss: () => void;
  readonly onRequestClose: (win: WindowInfo) => void;
}

export function TaskView({ locale, onDismiss, onRequestClose }: TaskViewProps) {
  const kernel = useKernel();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ card: Card; x: number; y: number } | null>(null);

  const { wm } = kernel;
  const active = useKernelView(wm, () => wm.activeDesktop());
  const viewport = useKernelView(wm, () => wm.viewport());
  const cards = useKernelView2(wm, kernel.apps, () => buildCards(kernel, locale, active));

  // Task View takes focus so Escape and Tab work the moment it appears.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const pick = (win: WindowInfo) => {
    if (win.state === 'minimized') wm.restore(win.id);
    wm.focus(win.id);
    onDismiss();
  };

  const openMenu = (card: Card, clientX: number, clientY: number) => {
    const box = rootRef.current?.getBoundingClientRect();
    setMenu({ card, x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) });
  };

  const onCommand = (card: Card, id: string) => {
    const { win } = card;
    if (id === 'close') {
      onRequestClose(win);
      return;
    }
    if (id === 'top') {
      wm.setAlwaysOnTop(win.id, !win.alwaysOnTop);
      return;
    }
    if (id.startsWith('snap:')) {
      wm.snap(win.id, id.slice(5) as SnapZone);
      onDismiss();
      return;
    }
    if (id.startsWith('move:')) {
      wm.moveToDesktop(win.id, id.slice(5) as DesktopId);
    }
  };

  return (
    <div
      ref={rootRef}
      className="fx-taskview"
      role="dialog"
      aria-label={locale.tr('عرض المهام', 'Vue des tâches', 'Task view')}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      <div className="fx-tv-cards fx-scroll">
        {cards.length === 0 ? (
          <p className="fx-tv-empty fx-caption-text">
            {locale.tr('لا نوافذ مفتوحة', 'Aucune fenêtre ouverte', 'No open windows')}
          </p>
        ) : (
          cards.map((card) => (
            <div key={card.win.id as string} className="fx-tv-card" data-focused={card.win.focused ? 'true' : 'false'}>
              <button
                type="button"
                className="fx-tv-card-main"
                onClick={() => pick(card.win)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenu(card, event.clientX, event.clientY);
                }}
              >
                <MiniLayout win={card.win} viewport={viewport} />
                <span className="fx-tv-card-foot">
                  <AppIcon icon={card.icon} category={card.category} size={20} />
                  <span className="fx-tv-card-text">
                    <span className="fx-title-ellipsis">{card.win.title}</span>
                    <span className="fx-caption-text">
                      {card.app}
                      {card.win.state === 'minimized'
                        ? ` · ${locale.tr('مصغّرة', 'Réduite', 'Minimised')}`
                        : card.win.state === 'snapped'
                          ? ` · ${locale.tr('مثبّتة', 'Ancrée', 'Snapped')}`
                          : ''}
                    </span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="fx-tv-card-close"
                title={locale.tr('إغلاق', 'Fermer', 'Close')}
                aria-label={locale.tr('إغلاق', 'Fermer', 'Close')}
                onClick={() => onRequestClose(card.win)}
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      <DesktopStrip locale={locale} />

      {menu !== null ? (
        <MenuFlyout
          position="absolute"
          x={menu.x}
          y={menu.y}
          minWidth={230}
          entries={cardEntries(menu.card, locale, wm.desktops(), active)}
          onDismiss={() => setMenu(null)}
          onSelect={(id) => onCommand(menu.card, id)}
        />
      ) : null}
    </div>
  );
}

function cardEntries(
  card: Card,
  locale: AppLocale,
  desktops: readonly { readonly id: DesktopId; readonly name: string }[],
  active: DesktopId,
): readonly MenuEntry[] {
  const others = desktops.filter((desktop) => desktop.id !== active);
  return [
    {
      id: 'snap',
      label: locale.tr('تثبيت', 'Ancrer', 'Snap'),
      icon: SquareSplitHorizontal,
      submenu: [
        { id: 'snap:left', label: locale.tr('اليسار', 'Gauche', 'Left half') },
        { id: 'snap:right', label: locale.tr('اليمين', 'Droite', 'Right half') },
        { id: 'snap:topLeft', label: locale.tr('أعلى اليسار', 'Haut gauche', 'Top left') },
        { id: 'snap:topRight', label: locale.tr('أعلى اليمين', 'Haut droite', 'Top right') },
        { id: 'snap:bottomLeft', label: locale.tr('أسفل اليسار', 'Bas gauche', 'Bottom left') },
        { id: 'snap:bottomRight', label: locale.tr('أسفل اليمين', 'Bas droite', 'Bottom right') },
      ],
    },
    {
      id: 'move',
      label: locale.tr('نقل إلى سطح مكتب', 'Déplacer vers un bureau', 'Move to desktop'),
      icon: MoveRight,
      disabled: others.length === 0,
      submenu: others.map((desktop) => ({ id: `move:${desktop.id as string}`, label: desktop.name })),
    },
    {
      id: 'top',
      label: locale.tr('دائمًا في المقدمة', 'Toujours visible', 'Always on top'),
      icon: card.win.alwaysOnTop ? PinOff : Pin,
      checked: card.win.alwaysOnTop,
    },
    { id: 'sep', kind: 'separator' },
    { id: 'close', label: locale.tr('إغلاق', 'Fermer', 'Close'), icon: X, danger: true },
  ];
}

/* ------------------------------------------------------------------ *
 * Virtual desktops
 * ------------------------------------------------------------------ */

function DesktopStrip({ locale }: { locale: AppLocale }) {
  const { wm } = useKernel();
  const desktops = useKernelView(wm, () => wm.desktops());
  const active = useKernelView(wm, () => wm.activeDesktop());
  const counts = useKernelView(wm, () => {
    const tally = new Map<string, number>();
    for (const win of wm.list()) tally.set(win.desktop as string, (tally.get(win.desktop as string) ?? 0) + 1);
    return tally;
  });
  const [editing, setEditing] = useState<DesktopId | null>(null);

  const commit = (id: DesktopId, next: string) => {
    const clean = next.trim();
    setEditing(null);
    if (clean.length > 0) wm.renameDesktop(id, clean);
  };

  return (
    <div className="fx-tv-strip">
      {desktops.map((desktop, index) => (
        <div
          key={desktop.id as string}
          className="fx-tv-desk"
          data-active={desktop.id === active ? 'true' : 'false'}
        >
          <button
            type="button"
            className="fx-tv-desk-main"
            onClick={() => wm.switchDesktop(desktop.id)}
            title={locale.tr('تبديل', 'Basculer', 'Switch')}
          >
            <span className="fx-tv-desk-thumb">{index + 1}</span>
            {editing === desktop.id ? (
              <DeskName value={desktop.name} onCommit={(next) => commit(desktop.id, next)} onCancel={() => setEditing(null)} />
            ) : (
              <span
                className="fx-tv-desk-name"
                title={locale.tr('انقر مزدوجًا لإعادة التسمية', 'Double-cliquez pour renommer', 'Double-click to rename')}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setEditing(desktop.id);
                }}
              >
                {desktop.name}
                <span className="fx-caption-text"> · {counts.get(desktop.id as string) ?? 0}</span>
              </span>
            )}
          </button>
          {desktops.length > 1 ? (
            <button
              type="button"
              className="fx-tv-desk-close"
              title={locale.tr('إزالة سطح المكتب', 'Supprimer le bureau', 'Close desktop')}
              aria-label={locale.tr('إزالة سطح المكتب', 'Supprimer le bureau', 'Close desktop')}
              onClick={(event) => {
                event.stopPropagation();
                wm.removeDesktop(desktop.id);
              }}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" className="fx-tv-desk-add" onClick={() => wm.addDesktop()}>
        <Plus size={16} />
        {locale.tr('سطح مكتب جديد', 'Nouveau bureau', 'New desktop')}
      </button>
    </div>
  );
}

function DeskName({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(text);
    else onCancel();
  };
  return (
    <input
      className="fx-tv-desk-input"
      autoFocus
      value={text}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Alt+Tab
 * ------------------------------------------------------------------ */

export interface SwitcherProps {
  readonly locale: AppLocale;
  /** Index into the MRU list; the root advances it while Alt is held. */
  readonly index: number;
  readonly onPick: (win: WindowInfo) => void;
}

/** The windows Alt+Tab cycles: MRU order, active desktop only, as in Windows. */
function useSwitcherOrder(): readonly WindowInfo[] {
  const { wm } = useKernel();
  const active = useKernelView(wm, () => wm.activeDesktop());
  const mru = useKernelView(wm, () => wm.mruOrder());
  return useMemo(() => mru.filter((win) => win.desktop === active), [mru, active]);
}

export function Switcher({ locale, index, onPick }: SwitcherProps) {
  const kernel = useKernel();
  const order = useSwitcherOrder();
  if (order.length === 0) return null;
  const current = Math.abs(index) % order.length;

  return (
    <div className="fx-switcher" role="dialog" aria-label={locale.tr('تبديل النوافذ', 'Changer de fenêtre', 'Switch windows')}>
      <div className="fx-switcher-row">
        {order.map((win, position) => {
          const installed = kernel.apps.get(win.appId);
          return (
            <button
              key={win.id as string}
              type="button"
              className="fx-switcher-tile"
              data-active={position === current ? 'true' : 'false'}
              onClick={() => onPick(win)}
            >
              <AppIcon
                icon={installed === null ? 'app-window' : installed.manifest.icon}
                category={installed === null ? ('system' as AppCategoryId) : installed.manifest.category}
                size={40}
              />
              <span className="fx-switcher-label fx-title-ellipsis">{win.title}</span>
            </button>
          );
        })}
      </div>
      <p className="fx-switcher-title fx-title-ellipsis">{order[current]?.title ?? ''}</p>
    </div>
  );
}
