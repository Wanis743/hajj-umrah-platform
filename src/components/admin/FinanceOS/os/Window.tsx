import React, { useCallback, useRef, useState } from 'react';
import { X, Minus, Square, Copy } from 'lucide-react';
import type { OSWindow, Rect } from './osTypes';
import { MENUBAR_INSET, DOCK_INSET } from './osTypes';
import { APP_MAP } from './apps';
import { useOS } from './OSContext';

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const RESIZE_CURSORS: Record<ResizeDir, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

/**
 * An application window: draggable by its title bar (unless maximized),
 * resizable from every edge and corner, with mac-style traffic lights.
 * Geometry is staged locally during gestures and committed to the shell on release.
 */
export function WindowFrame({ win }: { win: OSWindow }) {
  const { activeWindowId, focusWindow, minimizeWindow, toggleMaximize, closeWindow, setWindowRect, tr } = useOS();
  const def = APP_MAP[win.appId];
  const [staging, setStaging] = useState<Rect | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const focused = activeWindowId === win.id;
  const rect: Rect = win.maximized
    ? { x: 10, y: 10, w: 0, h: 0 } // maximized uses CSS insets instead
    : staging ?? win;

  const beginDrag = useCallback((e: React.PointerEvent) => {
    if (win.maximized || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...win };
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      focusWindow(win.id);
      setStaging({ x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h });
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (moved) {
        setWindowRect(win.id, {
          x: origin.x + (ev.clientX - startX),
          y: origin.y + (ev.clientY - startY),
          w: origin.w, h: origin.h,
        });
      }
      setStaging(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }, [win, focusWindow, setWindowRect]);

  const beginResize = useCallback((dir: ResizeDir) => (e: React.PointerEvent) => {
    if (win.maximized || e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...win };

    const onMove = (ev: PointerEvent) => {
      focusWindow(win.id);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { x, y, w, h } = origin;
      if (dir.includes('e')) w = origin.w + dx;
      if (dir.includes('s')) h = origin.h + dy;
      if (dir.includes('w')) { w = origin.w - dx; x = origin.x + dx; }
      if (dir.includes('n')) { h = origin.h - dy; y = origin.y + dy; }
      if (w < def.minSize.w) { if (dir.includes('w')) x = origin.x + origin.w - def.minSize.w; w = def.minSize.w; }
      if (h < def.minSize.h) { if (dir.includes('n')) y = origin.y + origin.h - def.minSize.h; h = def.minSize.h; }
      setStaging({ x, y, w, h });
    };
    const finish = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { x, y, w, h } = origin;
      if (dir.includes('e')) w = origin.w + dx;
      if (dir.includes('s')) h = origin.h + dy;
      if (dir.includes('w')) { w = origin.w - dx; x = origin.x + dx; }
      if (dir.includes('n')) { h = origin.h - dy; y = origin.y + dy; }
      setWindowRect(win.id, { x, y, w, h });
      setStaging(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }, [win, def, focusWindow, setWindowRect]);

  if (win.minimized || !def) return null;

  const title = tr(def.title.ar, def.title.fr, def.title.en);

  const style: React.CSSProperties = win.maximized
    ? { left: 8, top: MENUBAR_INSET + 6, right: 8, bottom: DOCK_INSET, zIndex: win.z }
    : { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: win.z };

  return (
    <div
      ref={frameRef}
      data-focused={focused}
      className="fos-window fos-window-frame absolute flex flex-col border border-white/[0.14]"
      style={style}
      onPointerDown={() => focusWindow(win.id)}
      role="dialog"
      aria-label={title}
    >
      {/* Title bar — liquid glass over the wallpaper, like macOS chrome */}
      <div
        className="relative flex h-10 shrink-0 select-none items-center gap-3 border-b border-white/[0.08] px-3"
        onPointerDown={beginDrag}
        onDoubleClick={() => toggleMaximize(win.id)}
        style={{
          cursor: win.maximized ? 'default' : 'grab',
          touchAction: 'none',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))',
          backgroundColor: 'rgba(20,22,30,0.55)',
          backdropFilter: 'blur(24px) saturate(170%)',
          WebkitBackdropFilter: 'blur(24px) saturate(170%)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)' }}
        />
        <div className="fos-traffic-zone flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button
            className="fos-traffic bg-[#ff5f57] hover:brightness-110"
            onClick={() => closeWindow(win.id)}
            title={tr('إغلاق', 'Fermer', 'Close')}
          >
            <X strokeWidth={2.5} />
          </button>
          <button
            className="fos-traffic bg-[#febc2e] hover:brightness-110"
            onClick={() => minimizeWindow(win.id)}
            title={tr('تصغير', 'Réduire', 'Minimize')}
          >
            <Minus strokeWidth={3} />
          </button>
          <button
            className="fos-traffic bg-[#28c840] hover:brightness-110"
            onClick={() => toggleMaximize(win.id)}
            title={win.maximized ? tr('استعادة', 'Restaurer', 'Restore') : tr('تكبير', 'Agrandir', 'Maximize')}
          >
            {win.maximized ? <Copy strokeWidth={2.5} /> : <Square strokeWidth={2.5} />}
          </button>
        </div>

        <div className="pointer-events-none absolute inset-x-14 flex items-center justify-center gap-2">
          <span className="truncate text-[13px] font-medium text-white/80">{title}</span>
        </div>
      </div>

      {/* Content — translucent, wallpaper refracts through (liquid glass) */}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={{
          backgroundColor: 'rgba(13,15,22,0.62)',
          backdropFilter: 'blur(28px) saturate(150%)',
          WebkitBackdropFilter: 'blur(28px) saturate(150%)',
        }}
      >
        <div className="h-full w-full overflow-y-auto p-3.5">
          <def.component />
        </div>
      </div>

      {/* Resize handles */}
      {!win.maximized && (
        <>
          {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDir[]).map((dir) => (
            <div
              key={dir}
              onPointerDown={beginResize(dir)}
              className="absolute z-20"
              style={{
                cursor: RESIZE_CURSORS[dir], touchAction: 'none',
                ...(dir === 'n' && { top: -3, left: 10, right: 10, height: 6 }),
                ...(dir === 's' && { bottom: -3, left: 10, right: 10, height: 6 }),
                ...(dir === 'e' && { right: -3, top: 10, bottom: 10, width: 6 }),
                ...(dir === 'w' && { left: -3, top: 10, bottom: 10, width: 6 }),
                ...(dir === 'ne' && { top: -4, right: -4, width: 12, height: 12 }),
                ...(dir === 'nw' && { top: -4, left: -4, width: 12, height: 12 }),
                ...(dir === 'se' && { bottom: -4, right: -4, width: 12, height: 12 }),
                ...(dir === 'sw' && { bottom: -4, left: -4, width: 12, height: 12 }),
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}
