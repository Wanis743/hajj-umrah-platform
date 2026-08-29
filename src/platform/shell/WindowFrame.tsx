/**
 * Window frame — Mica chrome, drag, resize, snap.
 *
 * The frame paints and manipulates a window but does not *own* it: geometry
 * lives in the kernel's window manager, and every gesture ends in a `wm` call.
 * That is what makes the same window respond identically to a drag, a snap
 * layout, Alt+Tab, a viewport resize or a Task Manager kill.
 *
 * Windows 11 behaviours implemented here:
 *   - drag by the title bar, with a maximized or snapped window "tearing off"
 *     under the cursor at its pre-maximize size;
 *   - eight resize grips, honouring the manifest's minimum size (enforced by the
 *     WM, not here);
 *   - edge snapping while dragging: top → maximize, sides → halves, corners →
 *     quadrants, with a live preview the shell paints behind the window;
 *   - hover the maximize button to get the snap-layout flyout;
 *   - double-click the title bar to toggle maximize;
 *   - a dirty window asks before closing.
 */
import { Minus, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { AppId, AppManifest, LaunchArgs, SnapZone, WindowId, WindowInfo, WindowRect } from '../kernel/abi';
import type { AppLocale, AppPackage } from '../sdk/types';
import { AppSurface } from './appHost';
import { useKernel } from './bindings';
import { AppIcon } from './icons';

/** Pointer travel before a maximized window tears off, in px. */
const TEAR_THRESHOLD = 6;
/** Distance from a viewport edge that arms an edge snap, in px. */
const EDGE_BAND = 8;
/** Hover dwell before the snap-layout flyout appears, in ms. */
const SNAP_DWELL_MS = 420;

/** Where the pointer sits relative to the window it grabbed. */
interface Grab {
  readonly pointerId: number;
  /** Desktop origin in client coordinates, so all maths stays in one space. */
  readonly hostX: number;
  readonly hostY: number;
  offsetX: number;
  offsetY: number;
  rect: WindowRect;
  /** Set once a maximized or snapped window has been torn off. */
  torn: boolean;
  /** Zone that would be applied if the pointer were released now. */
  zone: SnapZone | null;
}

/** Which edges a grip drags. */
interface GripSpec {
  readonly id: string;
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
  readonly cursor: string;
  readonly style: Record<string, string | number>;
}

const EDGE = 6;
const CORNER = 14;

const GRIPS: readonly GripSpec[] = [
  { id: 'n', dx: 0, dy: -1, cursor: 'ns-resize', style: { top: -EDGE / 2, left: CORNER, right: CORNER, height: EDGE } },
  { id: 's', dx: 0, dy: 1, cursor: 'ns-resize', style: { bottom: -EDGE / 2, left: CORNER, right: CORNER, height: EDGE } },
  { id: 'w', dx: -1, dy: 0, cursor: 'ew-resize', style: { left: -EDGE / 2, top: CORNER, bottom: CORNER, width: EDGE } },
  { id: 'e', dx: 1, dy: 0, cursor: 'ew-resize', style: { right: -EDGE / 2, top: CORNER, bottom: CORNER, width: EDGE } },
  { id: 'nw', dx: -1, dy: -1, cursor: 'nwse-resize', style: { top: 0, left: 0, width: CORNER, height: CORNER } },
  { id: 'ne', dx: 1, dy: -1, cursor: 'nesw-resize', style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  { id: 'sw', dx: -1, dy: 1, cursor: 'nesw-resize', style: { bottom: 0, left: 0, width: CORNER, height: CORNER } },
  { id: 'se', dx: 1, dy: 1, cursor: 'nwse-resize', style: { bottom: 0, right: 0, width: CORNER, height: CORNER } },
];

/* ------------------------------------------------------------------ *
 * Edge snapping
 * ------------------------------------------------------------------ */

/**
 * The zone a pointer at the given desktop position would snap to, or null when
 * it is nowhere near an edge. Corners win over sides, sides over the top edge —
 * the same precedence Windows uses.
 *
 * Module-private: the frame is the only thing that turns a pointer into a zone.
 * Once released it is the window manager's job, and `wm.snap` takes the zone.
 */
function edgeZoneFor(x: number, y: number, w: number, h: number): SnapZone | null {
  const left = x <= EDGE_BAND;
  const right = x >= w - EDGE_BAND;
  const top = y <= EDGE_BAND;
  const bottom = y >= h - EDGE_BAND;
  if (top && left) return 'topLeft';
  if (top && right) return 'topRight';
  if (bottom && left) return 'bottomLeft';
  if (bottom && right) return 'bottomRight';
  if (left) return 'left';
  if (right) return 'right';
  if (top) return 'top';
  return null;
}

/* ------------------------------------------------------------------ *
 * Frame
 * ------------------------------------------------------------------ */

export interface WindowFrameProps {
  readonly win: WindowInfo;
  readonly pkg: AppPackage | null;
  readonly locale: AppLocale;
  /** Launch arguments of the owning process, handed to the app runtime. */
  readonly args: LaunchArgs;
  /** Live snap preview; the shell paints it above the desktop, below windows. */
  readonly onSnapHint: (zone: SnapZone | null) => void;
  /** Anchor for the snap-layout flyout, in desktop coordinates. */
  readonly onSnapFlyout: (anchor: { readonly x: number; readonly y: number; readonly window: WindowId } | null) => void;
  /** Close request; the shell asks about unsaved work before obeying. */
  readonly onRequestClose: (win: WindowInfo) => void;
}

/** Everything the frame needs from a pointer, and nothing a pointer needs from it. */
interface Gestures {
  readonly resizing: boolean;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly beginResize: (event: ReactPointerEvent<HTMLDivElement>, spec: GripSpec) => void;
  readonly armSnapFlyout: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly disarmSnapFlyout: () => void;
}

/**
 * Drag, tear-off, edge snap, resize and the snap-layout dwell, in one hook.
 *
 * Every gesture ends in a `wm` call rather than in local state, so the frame owns
 * no geometry: it reads `win.rect` back on the next render like any other observer
 * of the window manager. That is the whole reason a drag and a Task Manager kill
 * leave the desktop in the same consistent place.
 */
function useFrameGestures(
  win: WindowInfo,
  frameRef: RefObject<HTMLDivElement | null>,
  onSnapHint: WindowFrameProps['onSnapHint'],
  onSnapFlyout: WindowFrameProps['onSnapFlyout'],
): Gestures {
  const { wm } = useKernel();
  const grab = useRef<Grab | null>(null);
  const dwell = useRef<number>(0);
  const [resizing, setResizing] = useState(false);

  /** Desktop origin. Windows are absolutely positioned inside that element. */
  const hostOrigin = useCallback((): { x: number; y: number } => {
    const host = frameRef.current?.offsetParent;
    if (!(host instanceof HTMLElement)) return { x: 0, y: 0 };
    const box = host.getBoundingClientRect();
    return { x: box.left, y: box.top };
  }, [frameRef]);

  useEffect(() => () => window.clearTimeout(dwell.current), []);

  /* ---------------- dragging ---------------- */

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Caption buttons and toolbar affordances handle their own pointers.
    if (event.target instanceof Element && event.target.closest('[data-no-drag]') !== null) return;
    const origin = hostOrigin();
    wm.focus(win.id);
    grab.current = {
      pointerId: event.pointerId,
      hostX: origin.x,
      hostY: origin.y,
      offsetX: event.clientX - origin.x - win.rect.x,
      offsetY: event.clientY - origin.y - win.rect.y,
      rect: win.rect,
      torn: win.state === 'normal',
      zone: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = grab.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    const px = event.clientX - state.hostX;
    const py = event.clientY - state.hostY;

    if (!state.torn) {
      const travelled = Math.abs(px - (state.rect.x + state.offsetX)) + Math.abs(py - (state.rect.y + state.offsetY));
      if (travelled < TEAR_THRESHOLD) return;
      // Tear off at the pre-maximize size, keeping the pointer at the same
      // relative position along the title bar.
      const fraction = state.offsetX / Math.max(1, state.rect.w);
      wm.setState(win.id, 'normal');
      const restored = wm.get(win.id)?.rect ?? state.rect;
      state.rect = restored;
      state.offsetX = Math.round(fraction * restored.w);
      state.offsetY = Math.min(state.offsetY, 16);
      state.torn = true;
    }

    const port = wm.viewport();
    const zone = edgeZoneFor(px, py, port.w, port.h - port.insetBottom);
    if (zone !== state.zone) {
      state.zone = zone;
      onSnapHint(zone);
    }
    wm.setRect(win.id, { x: px - state.offsetX, y: py - state.offsetY, w: state.rect.w, h: state.rect.h });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = grab.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    grab.current = null;
    onSnapHint(null);
    if (state.zone === null) return;
    if (state.zone === 'top') wm.setState(win.id, 'maximized');
    else wm.snap(win.id, state.zone);
  };

  /* ---------------- resizing ---------------- */

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>, spec: GripSpec) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    wm.focus(win.id);
    setResizing(true);
    const start = win.rect;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - startX;
      const dy = move.clientY - startY;
      let { x, y, w, h } = start;
      if (spec.dx === -1) {
        x = start.x + dx;
        w = start.w - dx;
      } else if (spec.dx === 1) {
        w = start.w + dx;
      }
      if (spec.dy === -1) {
        y = start.y + dy;
        h = start.h - dy;
      } else if (spec.dy === 1) {
        h = start.h + dy;
      }
      // The WM enforces the minimum size; anchoring here keeps the opposite
      // edge still while the dragged edge stops moving.
      wm.setRect(win.id, { x, y, w, h });
    };

    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setResizing(false);
    };

    target.setPointerCapture(event.pointerId);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  /* ---------------- snap flyout ---------------- */

  const armSnapFlyout = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    window.clearTimeout(dwell.current);
    dwell.current = window.setTimeout(() => {
      const origin = hostOrigin();
      const box = button.getBoundingClientRect();
      onSnapFlyout({
        x: box.left + box.width / 2 - origin.x,
        y: box.bottom - origin.y + 6,
        window: win.id,
      });
    }, SNAP_DWELL_MS);
  };

  const disarmSnapFlyout = () => {
    window.clearTimeout(dwell.current);
  };

  return {
    resizing,
    onPointerDown: beginDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    beginResize,
    armSnapFlyout,
    disarmSnapFlyout,
  };
}

/* ------------------------------------------------------------------ *
 * The frame
 * ------------------------------------------------------------------ */

export function WindowFrame({ win, pkg, locale, args, onSnapHint, onSnapFlyout, onRequestClose }: WindowFrameProps) {
  const { wm } = useKernel();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const gestures = useFrameGestures(win, frameRef, onSnapHint, onSnapFlyout);

  if (win.state === 'minimized') return null;

  const manifest = pkg?.manifest ?? null;
  const title = win.title.length > 0 ? win.title : (manifest === null ? (win.appId as string) : locale.t(manifest.name));

  return (
    <div
      ref={frameRef}
      className="fx-window"
      data-focused={win.focused}
      data-state={win.state}
      data-resizing={gestures.resizing}
      style={{
        left: win.rect.x,
        top: win.rect.y,
        width: win.rect.w,
        height: win.rect.h,
        // `win.z` already encodes always-on-top (the window manager offsets it),
        // and the shell's window layer is isolated, so the raw value is safe to
        // use: a topmost window floats above its siblings, never above the
        // taskbar or a modal dialog.
        zIndex: win.z,
      }}
      onPointerDownCapture={() => {
        if (!win.focused) wm.focus(win.id);
      }}
    >
      <div
        className="fx-titlebar"
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerUp}
        onDoubleClick={() => wm.toggleMaximize(win.id)}
      >
        <div className="fx-titlebar-text">
          {manifest === null ? null : <AppIcon icon={manifest.icon} category={manifest.category} size={16} />}
          <span className="fx-title-ellipsis">{title}</span>
          {win.dirty ? <span className="fx-dirty-dot" aria-hidden /> : null}
        </div>
        <div className="fx-caption-buttons" data-no-drag>
          <button
            type="button"
            className="fx-caption-btn"
            title={locale.tr('تصغير', 'Réduire', 'Minimize')}
            aria-label={locale.tr('تصغير', 'Réduire', 'Minimize')}
            onClick={() => wm.minimize(win.id)}
          >
            <Minus size={14} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="fx-caption-btn"
            title={locale.tr('تكبير', 'Agrandir', 'Maximize')}
            aria-label={locale.tr('تكبير', 'Agrandir', 'Maximize')}
            onPointerEnter={gestures.armSnapFlyout}
            onPointerLeave={gestures.disarmSnapFlyout}
            onClick={() => {
              gestures.disarmSnapFlyout();
              onSnapFlyout(null);
              wm.toggleMaximize(win.id);
            }}
          >
            {win.state === 'maximized' ? <RestoreGlyph /> : <Square size={12} strokeWidth={1.6} />}
          </button>
          <button
            type="button"
            className="fx-caption-btn"
            data-close="true"
            title={locale.tr('إغلاق', 'Fermer', 'Close')}
            aria-label={locale.tr('إغلاق', 'Fermer', 'Close')}
            onClick={() => onRequestClose(win)}
          >
            <X size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      <div className="fx-window-body">
        <AppSurface
          pkg={pkg}
          locale={locale}
          spec={{
            pid: win.pid,
            appId: win.appId,
            manifest: manifest ?? fallbackManifest(win.appId),
            window: win.id,
            args,
          }}
        />
      </div>

      {win.state === 'normal'
        ? GRIPS.map((spec) => (
            <div
              key={spec.id}
              className="fx-grip"
              style={{ ...spec.style, cursor: spec.cursor }}
              onPointerDown={(event) => gestures.beginResize(event, spec)}
            />
          ))
        : null}
    </div>
  );
}

/** The two-square "restore" glyph Windows uses; Lucide has no exact match. */
function RestoreGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden focusable="false">
      <rect x="0.75" y="3.25" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.6 3.1V2.2a1 1 0 0 1 1-1h7.4a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-.9" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/**
 * A window can outlive its package only if an app was uninstalled while running.
 * The surface renders its "not installed" pane; this keeps the types honest.
 */
function fallbackManifest(id: AppId): AppManifest {
  const label = id as string;
  return {
    id,
    name: { ar: label, fr: label, en: label },
    description: { ar: '', fr: '', en: '' },
    version: '0.0.0',
    publisher: 'unknown',
    category: 'system',
    icon: 'app-window',
    capabilities: [],
    defaultSize: { w: 720, h: 480 },
    minSize: { w: 360, h: 240 },
    resizable: true,
    singleInstance: false,
    pinned: false,
    desktopShortcut: false,
    systemComponent: false,
  };
}
