/**
 * Window manager.
 *
 * Owns every pixel of window geometry so applications never touch layout: an app
 * asks for a title or a badge, the WM decides where the frame lives. That
 * separation is what makes snap layouts, virtual desktops and Alt+Tab possible
 * without app cooperation.
 *
 * Windows 11 behaviours implemented here:
 *   - 13 snap zones (halves, quadrants, thirds, two-thirds) computed from the
 *     live viewport minus the taskbar inset.
 *   - Restore geometry: maximizing or snapping remembers the previous rect.
 *   - Virtual desktops, with windows moved between them and z-order per desktop.
 *   - MRU focus ordering for the Alt+Tab switcher.
 *   - Cascade / tile / minimize-all for the desktop context menu.
 */
import {
  desktopId as toDesktopId,
  windowId as toWindowId,
  type AppId,
  type DesktopId,
  type Pid,
  type SnapZone,
  type WindowId,
  type WindowInfo,
  type WindowRect,
  type WindowStateName,
} from '../abi';
import type { CreateWindowRequest, KernelLogger, WmSubsystem, WmViewport } from '../contracts';
import { EVENT_IDS } from './eventlog';
import { next, shortId } from './ids';
import { createSignal } from './store';

/** Gap between cascaded windows, matching the shell's 8px rhythm. */
const CASCADE_STEP = 28;
/** Minimum sane viewport so geometry maths never divides by zero. */
const MIN_VIEWPORT = { w: 640, h: 480 } as const;

interface MutableWindow {
  readonly id: WindowId;
  readonly pid: Pid;
  readonly appId: AppId;
  title: string;
  rect: WindowRect;
  /** Geometry to restore to when un-maximizing or un-snapping. */
  restoreRect: WindowRect;
  state: WindowStateName;
  zone: SnapZone | null;
  desktop: DesktopId;
  z: number;
  alwaysOnTop: boolean;
  dirty: boolean;
  progress: number | null;
  badge: number | null;
  readonly minSize: { readonly w: number; readonly h: number };
  readonly resizable: boolean;
}

interface Desktop {
  readonly id: DesktopId;
  name: string;
}

class Wm implements WmSubsystem {
  private readonly windows = new Map<string, MutableWindow>();
  private readonly signal = createSignal();
  private desktopList: Desktop[];
  private active: DesktopId;
  private focusedId: WindowId | null = null;
  /** Most-recently-used first. Drives Alt+Tab. */
  private mru: WindowId[] = [];
  private topZ = 10;
  private port: WmViewport = { w: 1440, h: 900, insetTop: 0, insetBottom: 48 };

  constructor(private readonly log: KernelLogger) {
    const first = toDesktopId('desktop-1');
    this.desktopList = [{ id: first, name: 'Desktop 1' }];
    this.active = first;
  }

  /* ---------------- viewport ---------------- */

  setViewport(viewport: WmViewport): void {
    const w = Math.max(MIN_VIEWPORT.w, Math.round(viewport.w));
    const h = Math.max(MIN_VIEWPORT.h, Math.round(viewport.h));
    if (w === this.port.w && h === this.port.h && viewport.insetBottom === this.port.insetBottom) return;
    this.port = { w, h, insetTop: viewport.insetTop, insetBottom: viewport.insetBottom };

    // Re-flow: maximized and snapped windows follow the viewport; free-floating
    // windows are nudged back on-screen if the viewport shrank past them.
    for (const window of this.windows.values()) {
      if (window.state === 'maximized' || window.state === 'fullscreen') {
        window.rect = this.workArea(window.state === 'fullscreen');
      } else if (window.state === 'snapped' && window.zone !== null) {
        window.rect = this.zoneRect(window.zone);
      } else {
        window.rect = this.clampToWorkArea(window.rect);
      }
    }
    this.signal.bump();
  }

  viewport(): WmViewport {
    return this.port;
  }

  /* ---------------- lifecycle ---------------- */

  create(request: CreateWindowRequest): WindowInfo {
    const id = toWindowId(shortId('win'));
    const rect = this.cascadeSlot(request.defaultSize);
    this.topZ += 1;
    const window: MutableWindow = {
      id,
      pid: request.pid,
      appId: request.appId,
      title: request.title,
      rect,
      restoreRect: rect,
      state: 'normal',
      zone: null,
      desktop: this.active,
      z: this.topZ,
      alwaysOnTop: false,
      dirty: false,
      progress: null,
      badge: null,
      minSize: request.minSize,
      resizable: request.resizable,
    };
    this.windows.set(id as string, window);
    this.focusInternal(id);
    this.log.write(
      'System',
      'verbose',
      EVENT_IDS.windowCreated,
      'Wm',
      `Window created for ${request.appId as string}`,
      { window: id as string, w: rect.w, h: rect.h },
      request.pid,
    );
    this.signal.bump();
    return this.snapshot(window);
  }

  close(id: WindowId): boolean {
    const window = this.windows.get(id as string);
    if (window === undefined) return false;
    this.windows.delete(id as string);
    this.mru = this.mru.filter((candidate) => candidate !== id);
    if (this.focusedId === id) {
      this.focusedId = null;
      const nextFocus = this.mru.find((candidate) => this.windows.get(candidate as string)?.desktop === this.active);
      if (nextFocus !== undefined) this.focusInternal(nextFocus);
    }
    this.log.write('System', 'verbose', EVENT_IDS.windowClosed, 'Wm', 'Window closed', { window: id as string });
    this.signal.bump();
    return true;
  }

  closeForProcess(target: Pid): number {
    let closed = 0;
    for (const window of [...this.windows.values()]) {
      if (window.pid === target && this.close(window.id)) closed += 1;
    }
    return closed;
  }

  get(id: WindowId): WindowInfo | null {
    const window = this.windows.get(id as string);
    return window === undefined ? null : this.snapshot(window);
  }

  list(): readonly WindowInfo[] {
    return [...this.windows.values()].map((window) => this.snapshot(window)).sort((a, b) => a.z - b.z);
  }

  visible(): readonly WindowInfo[] {
    return this.list().filter((window) => window.desktop === this.active && window.state !== 'minimized');
  }

  /* ---------------- focus ---------------- */

  focus(id: WindowId): void {
    if (this.focusedId === id && this.windows.has(id as string)) return;
    this.focusInternal(id);
    this.signal.bump();
  }

  focused(): WindowId | null {
    return this.focusedId;
  }

  mruOrder(): readonly WindowInfo[] {
    const out: WindowInfo[] = [];
    for (const id of this.mru) {
      const window = this.windows.get(id as string);
      if (window !== undefined && window.desktop === this.active) out.push(this.snapshot(window));
    }
    // Windows never focused still belong in the switcher, at the end.
    for (const window of this.windows.values()) {
      if (window.desktop === this.active && !this.mru.includes(window.id)) out.push(this.snapshot(window));
    }
    return out;
  }

  /* ---------------- geometry ---------------- */

  setRect(id: WindowId, rect: WindowRect): void {
    const window = this.windows.get(id as string);
    if (window === undefined) return;
    const clamped = this.clampToWorkArea({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(window.minSize.w, Math.round(rect.w)),
      h: Math.max(window.minSize.h, Math.round(rect.h)),
    });
    window.rect = clamped;
    // Dragging or resizing a snapped window releases the snap, as on Windows.
    if (window.state === 'snapped' || window.state === 'maximized') {
      window.state = 'normal';
      window.zone = null;
    }
    window.restoreRect = clamped;
    this.signal.bump();
  }

  setState(id: WindowId, state: WindowStateName): void {
    const window = this.windows.get(id as string);
    if (window === undefined || window.state === state) return;
    if (window.state === 'normal') window.restoreRect = window.rect;

    window.state = state;
    if (state === 'maximized') {
      window.rect = this.workArea(false);
      window.zone = null;
    } else if (state === 'fullscreen') {
      window.rect = this.workArea(true);
      window.zone = null;
    } else if (state === 'normal') {
      window.rect = this.clampToWorkArea(window.restoreRect);
      window.zone = null;
    }
    this.signal.bump();
  }

  snap(id: WindowId, zone: SnapZone): WindowInfo | null {
    const window = this.windows.get(id as string);
    if (window === undefined) return null;
    if (window.state === 'normal') window.restoreRect = window.rect;
    window.rect = this.zoneRect(zone);
    window.state = 'snapped';
    window.zone = zone;
    this.focusInternal(id);
    this.signal.bump();
    return this.snapshot(window);
  }

  zoneRect(zone: SnapZone): WindowRect {
    const area = this.workArea(false);
    const halfW = Math.round(area.w / 2);
    const halfH = Math.round(area.h / 2);
    const third = Math.round(area.w / 3);
    const twoThirds = area.w - third;

    switch (zone) {
      case 'left':
        return { x: area.x, y: area.y, w: halfW, h: area.h };
      case 'right':
        return { x: area.x + halfW, y: area.y, w: area.w - halfW, h: area.h };
      case 'top':
        return { x: area.x, y: area.y, w: area.w, h: halfH };
      case 'bottom':
        return { x: area.x, y: area.y + halfH, w: area.w, h: area.h - halfH };
      case 'topLeft':
        return { x: area.x, y: area.y, w: halfW, h: halfH };
      case 'topRight':
        return { x: area.x + halfW, y: area.y, w: area.w - halfW, h: halfH };
      case 'bottomLeft':
        return { x: area.x, y: area.y + halfH, w: halfW, h: area.h - halfH };
      case 'bottomRight':
        return { x: area.x + halfW, y: area.y + halfH, w: area.w - halfW, h: area.h - halfH };
      case 'leftThird':
        return { x: area.x, y: area.y, w: third, h: area.h };
      case 'centerThird':
        return { x: area.x + third, y: area.y, w: third, h: area.h };
      case 'rightThird':
        return { x: area.x + third * 2, y: area.y, w: area.w - third * 2, h: area.h };
      case 'leftTwoThirds':
        return { x: area.x, y: area.y, w: twoThirds, h: area.h };
      case 'rightTwoThirds':
        return { x: area.x + third, y: area.y, w: twoThirds, h: area.h };
    }
  }

  minimize(id: WindowId): void {
    const window = this.windows.get(id as string);
    if (window === undefined || window.state === 'minimized') return;
    if (window.state === 'normal') window.restoreRect = window.rect;
    window.state = 'minimized';
    if (this.focusedId === id) {
      this.focusedId = null;
      const nextFocus = this.mru.find(
        (candidate) =>
          candidate !== id &&
          this.windows.get(candidate as string)?.desktop === this.active &&
          this.windows.get(candidate as string)?.state !== 'minimized',
      );
      if (nextFocus !== undefined) this.focusInternal(nextFocus);
    }
    this.signal.bump();
  }

  restore(id: WindowId): void {
    const window = this.windows.get(id as string);
    if (window === undefined) return;
    if (window.state === 'minimized') {
      window.state = window.zone !== null ? 'snapped' : 'normal';
      window.rect = window.zone !== null ? this.zoneRect(window.zone) : this.clampToWorkArea(window.restoreRect);
    }
    this.focusInternal(id);
    this.signal.bump();
  }

  toggleMaximize(id: WindowId): void {
    const window = this.windows.get(id as string);
    if (window === undefined) return;
    if (!window.resizable) return;
    this.setState(id, window.state === 'maximized' ? 'normal' : 'maximized');
  }

  setAlwaysOnTop(id: WindowId, value: boolean): void {
    const window = this.windows.get(id as string);
    if (window === undefined || window.alwaysOnTop === value) return;
    window.alwaysOnTop = value;
    if (value) {
      this.topZ += 1;
      window.z = this.topZ;
    }
    this.signal.bump();
  }

  /* ---------------- chrome state ---------------- */

  setTitle(id: WindowId, title: string): WindowInfo | null {
    const window = this.windows.get(id as string);
    if (window === undefined) return null;
    if (window.title !== title) {
      window.title = title;
      this.signal.bump();
    }
    return this.snapshot(window);
  }

  setDirty(id: WindowId, dirty: boolean): WindowInfo | null {
    const window = this.windows.get(id as string);
    if (window === undefined) return null;
    if (window.dirty !== dirty) {
      window.dirty = dirty;
      this.signal.bump();
    }
    return this.snapshot(window);
  }

  setProgress(id: WindowId, progress: number | null): WindowInfo | null {
    const window = this.windows.get(id as string);
    if (window === undefined) return null;
    const clamped = progress === null ? null : Math.min(1, Math.max(0, progress));
    if (window.progress !== clamped) {
      window.progress = clamped;
      this.signal.bump();
    }
    return this.snapshot(window);
  }

  setBadge(id: WindowId, badge: number | null): WindowInfo | null {
    const window = this.windows.get(id as string);
    if (window === undefined) return null;
    const clamped = badge === null ? null : Math.max(0, Math.round(badge));
    if (window.badge !== clamped) {
      window.badge = clamped;
      this.signal.bump();
    }
    return this.snapshot(window);
  }

  /* ---------------- arrangement ---------------- */

  cascade(): void {
    const area = this.workArea(false);
    let index = 0;
    for (const window of this.onActiveDesktop()) {
      const w = Math.min(Math.round(area.w * 0.62), Math.max(window.minSize.w, 900));
      const h = Math.min(Math.round(area.h * 0.72), Math.max(window.minSize.h, 620));
      window.state = 'normal';
      window.zone = null;
      window.rect = this.clampToWorkArea({
        x: area.x + 24 + index * CASCADE_STEP,
        y: area.y + 24 + index * CASCADE_STEP,
        w,
        h,
      });
      window.restoreRect = window.rect;
      index += 1;
    }
    this.signal.bump();
  }

  tile(): void {
    const windows = this.onActiveDesktop().filter((window) => window.state !== 'minimized');
    if (windows.length === 0) return;
    const area = this.workArea(false);
    const columns = Math.ceil(Math.sqrt(windows.length));
    const rows = Math.ceil(windows.length / columns);
    const cellW = Math.floor(area.w / columns);
    const cellH = Math.floor(area.h / rows);

    windows.forEach((window, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      window.state = 'normal';
      window.zone = null;
      window.rect = {
        x: area.x + column * cellW,
        y: area.y + row * cellH,
        w: cellW,
        h: cellH,
      };
      window.restoreRect = window.rect;
    });
    this.signal.bump();
  }

  minimizeAll(): void {
    for (const window of this.onActiveDesktop()) {
      if (window.state === 'normal') window.restoreRect = window.rect;
      window.state = 'minimized';
    }
    this.focusedId = null;
    this.signal.bump();
  }

  /* ---------------- virtual desktops ---------------- */

  desktops(): readonly { readonly id: DesktopId; readonly name: string }[] {
    return this.desktopList.map((desktop) => ({ id: desktop.id, name: desktop.name }));
  }

  activeDesktop(): DesktopId {
    return this.active;
  }

  addDesktop(name?: string): DesktopId {
    const id = toDesktopId(`desktop-${next('desktop') + 1}`);
    this.desktopList = [...this.desktopList, { id, name: name ?? `Desktop ${this.desktopList.length + 1}` }];
    this.signal.bump();
    return id;
  }

  removeDesktop(id: DesktopId): boolean {
    if (this.desktopList.length <= 1) return false;
    const index = this.desktopList.findIndex((desktop) => desktop.id === id);
    if (index === -1) return false;
    const fallback = this.desktopList[index === 0 ? 1 : index - 1];
    // Windows on a removed desktop move to the neighbour rather than vanishing.
    for (const window of this.windows.values()) {
      if (window.desktop === id) window.desktop = fallback.id;
    }
    this.desktopList = this.desktopList.filter((desktop) => desktop.id !== id);
    if (this.active === id) this.active = fallback.id;
    this.signal.bump();
    return true;
  }

  switchDesktop(id: DesktopId): void {
    if (this.active === id || !this.desktopList.some((desktop) => desktop.id === id)) return;
    this.active = id;
    this.focusedId = null;
    const nextFocus = this.mru.find(
      (candidate) =>
        this.windows.get(candidate as string)?.desktop === id &&
        this.windows.get(candidate as string)?.state !== 'minimized',
    );
    if (nextFocus !== undefined) this.focusInternal(nextFocus);
    this.signal.bump();
  }

  moveToDesktop(window: WindowId, desktop: DesktopId): void {
    const record = this.windows.get(window as string);
    if (record === undefined || !this.desktopList.some((candidate) => candidate.id === desktop)) return;
    record.desktop = desktop;
    if (this.focusedId === window && desktop !== this.active) this.focusedId = null;
    this.signal.bump();
  }

  renameDesktop(id: DesktopId, name: string): void {
    const desktop = this.desktopList.find((candidate) => candidate.id === id);
    if (desktop === undefined || name.trim() === '') return;
    desktop.name = name.trim();
    this.signal.bump();
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  /* ---------------- internals ---------------- */

  private onActiveDesktop(): MutableWindow[] {
    return [...this.windows.values()].filter((window) => window.desktop === this.active).sort((a, b) => a.z - b.z);
  }

  private focusInternal(id: WindowId): void {
    const window = this.windows.get(id as string);
    if (window === undefined) return;
    this.topZ += 1;
    window.z = this.topZ;
    if (window.state === 'minimized') {
      window.state = window.zone !== null ? 'snapped' : 'normal';
      window.rect = window.zone !== null ? this.zoneRect(window.zone) : this.clampToWorkArea(window.restoreRect);
    }
    this.focusedId = id;
    this.mru = [id, ...this.mru.filter((candidate) => candidate !== id)];
  }

  /** The rectangle windows may occupy: viewport minus reserved shell edges. */
  private workArea(ignoreInsets: boolean): WindowRect {
    if (ignoreInsets) return { x: 0, y: 0, w: this.port.w, h: this.port.h };
    return {
      x: 0,
      y: this.port.insetTop,
      w: this.port.w,
      h: Math.max(MIN_VIEWPORT.h / 2, this.port.h - this.port.insetTop - this.port.insetBottom),
    };
  }

  private clampToWorkArea(rect: WindowRect): WindowRect {
    const area = this.workArea(false);
    const w = Math.min(rect.w, area.w);
    const h = Math.min(rect.h, area.h);
    // Keep at least a titlebar's worth of the window reachable.
    const x = Math.min(Math.max(rect.x, area.x - w + 120), area.x + area.w - 120);
    const y = Math.min(Math.max(rect.y, area.y), area.y + area.h - 40);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  private cascadeSlot(size: { readonly w: number; readonly h: number }): WindowRect {
    const area = this.workArea(false);
    const w = Math.min(size.w, area.w - 32);
    const h = Math.min(size.h, area.h - 32);
    const openCount = this.onActiveDesktop().length;
    const offset = (openCount % 6) * CASCADE_STEP;
    const baseX = Math.max(area.x + 16, Math.round(area.x + (area.w - w) / 2) - 60);
    const baseY = Math.max(area.y + 12, Math.round(area.y + (area.h - h) / 2) - 40);
    return this.clampToWorkArea({ x: baseX + offset, y: baseY + offset, w, h });
  }

  private snapshot(window: MutableWindow): WindowInfo {
    return {
      id: window.id,
      pid: window.pid,
      appId: window.appId,
      title: window.title,
      rect: window.rect,
      state: window.state,
      zone: window.zone,
      desktop: window.desktop,
      // Always-on-top windows float above the rest without reshuffling z.
      z: window.alwaysOnTop ? window.z + 100000 : window.z,
      focused: this.focusedId === window.id,
      alwaysOnTop: window.alwaysOnTop,
      dirty: window.dirty,
      progress: window.progress,
      badge: window.badge,
    };
  }
}

export function createWm(log: KernelLogger): WmSubsystem {
  return new Wm(log);
}

/** Snap layouts offered in the maximize-button flyout, in Windows 11 order. */
export const SNAP_LAYOUTS: readonly { readonly id: string; readonly zones: readonly SnapZone[] }[] = [
  { id: 'halves', zones: ['left', 'right'] },
  { id: 'quadrants', zones: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] },
  { id: 'thirds', zones: ['leftThird', 'centerThird', 'rightThird'] },
  { id: 'twoThirdsLeft', zones: ['leftTwoThirds', 'rightThird'] },
  { id: 'twoThirdsRight', zones: ['leftThird', 'rightTwoThirds'] },
  { id: 'stacked', zones: ['top', 'bottom'] },
];
