import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Power, RotateCcw, XSquare, LogOut, Rocket, Settings,
} from 'lucide-react';
import { APPS, PINNED_APPS } from './apps';
import { useOS } from './OSContext';
import { accent } from './theme';
import type { AppDef } from './osTypes';

/** Magnification profile: peak scale at cursor, smooth cosine falloff. */
const MAG_RANGE = 130;
const MAG_GAIN = 0.55;

function mag(mouseX: number | null, center: number | null): number {
  if (mouseX === null || center === null) return 1;
  const d = Math.abs(mouseX - center);
  if (d >= MAG_RANGE) return 1;
  const t = Math.cos((d / MAG_RANGE) * Math.PI * 0.5);
  return 1 + MAG_GAIN * t * t;
}

/**
 * The Dock — a floating liquid-glass strip with macOS hover magnification.
 * Launchpad on the leading end, pinned and running apps in the middle
 * (single-instance, running dots below), utilities and power at the end.
 */
export function Dock({ onExit }: { onExit: () => void }) {
  const {
    windows, activeWindowId, openApp, focusWindow, minimizeWindow, restoreWindow,
    closeAllWindows, resetSession, toggleOverlay, tr, prefs,
  } = useOS();
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [powerOpen, setPowerOpen] = useState(false);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const centers = useRef(new Map<string, number>());
  const brandHex = accent(prefs.accent).hex;

  const dockApps = useMemo(() => {
    const running = windows.map((w) => w.appId);
    const extras = APPS.filter((a) => running.includes(a.id) && !a.pinned);
    return [...PINNED_APPS, ...extras];
  }, [windows]);

  // Measure each cell's stable center (cells are fixed-width, transforms
  // happen on an inner node, so measurements never feed back on themselves).
  useLayoutEffect(() => {
    const measure = () => {
      const next = new Map<string, number>();
      cellRefs.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        next.set(id, r.left + r.width / 2);
      });
      centers.current = next;
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [dockApps]);

  React.useEffect(() => {
    if (!powerOpen) return;
    const close = () => setPowerOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [powerOpen]);

  const windowFor = (appId: string) => windows.find((w) => w.appId === appId);

  const onDockClick = (appId: string) => {
    const win = windowFor(appId);
    if (!win) { openApp(appId); return; }
    if (win.minimized) { restoreWindow(win.id); return; }
    if (activeWindowId === win.id) { minimizeWindow(win.id); return; }
    focusWindow(win.id);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[450] flex justify-center px-3">
      <div
        className="glass pointer-events-auto flex items-end gap-1 rounded-[22px] px-2.5 pb-1.5 pt-2"
        onMouseMove={(e) => setMouseX(e.clientX)}
        onMouseLeave={() => setMouseX(null)}
      >
        {/* Launchpad */}
        <DockCell
          id="__launchpad"
          register={(id, el) => { if (el) cellRefs.current.set(id, el); }}
          scale={mag(mouseX, centers.current.get('__launchpad') ?? null)}
          tip={tr('منصة التطبيقات', 'Launchpad', 'Launchpad')}
          onClick={() => toggleOverlay('start')}
          tile={
            <span
              className="flex h-11 w-11 items-center justify-center rounded-[13px] shadow-lg ring-1 ring-white/20"
              style={{ background: `linear-gradient(135deg, ${brandHex}e6, ${brandHex}80)` }}
            >
              <Rocket className="h-5 w-5 text-white" strokeWidth={1.8} />
            </span>
          }
        />

        <span className="mx-0.5 mb-2 h-10 w-px flex-none self-end bg-white/10" />

        {/* Apps */}
        {dockApps.map((app) => (
          <DockAppIcon
            key={app.id}
            app={app}
            running={!!windowFor(app.id)}
            minimized={windowFor(app.id)?.minimized ?? false}
            scale={mag(mouseX, centers.current.get(app.id) ?? null)}
            register={(el) => { if (el) cellRefs.current.set(app.id, el); }}
            onClick={() => onDockClick(app.id)}
          />
        ))}

        <span className="mx-0.5 mb-2 h-10 w-px flex-none self-end bg-white/10" />

        {/* Utilities */}
        <DockUtil
          tip={tr('الإعدادات', 'Réglages', 'Settings')}
          onClick={() => openApp('settings')}
        >
          <Settings className="h-[18px] w-[18px]" />
        </DockUtil>
        <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
          <DockUtil
            tip={tr('إنهاء الجلسة', 'Quitter la session', 'Power')}
            onClick={() => setPowerOpen((v) => !v)}
          >
            <Power className="h-[18px] w-[18px]" />
          </DockUtil>
          {powerOpen && (
            <div className="glass fos-pop absolute bottom-14 end-0 w-60 overflow-hidden rounded-xl p-1.5">
              <PowerItem
                icon={<XSquare className="h-4 w-4 text-white/50" />}
                label={tr('إغلاق كل النوافذ', 'Fermer toutes les fenêtres', 'Close all windows')}
                onClick={() => { closeAllWindows(); setPowerOpen(false); }}
              />
              <PowerItem
                icon={<RotateCcw className="h-4 w-4 text-white/50" />}
                label={tr('إعادة تعيين التخطيط', 'Réinitialiser la disposition', 'Reset saved layout')}
                onClick={() => { resetSession(); setPowerOpen(false); }}
              />
              <div className="my-1 h-px bg-white/10" />
              <PowerItem
                icon={<LogOut className="h-4 w-4 text-rose-300" />}
                label={tr('الخروج إلى المشغّل', 'Quitter vers le lanceur', 'Exit to Launcher')}
                onClick={onExit}
                danger
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A fixed-width measurement cell; the icon inside scales without moving it. */
function DockCell({ id, register, scale, tip, onClick, tile }: {
  id: string;
  register: (id: string, el: HTMLElement | null) => void;
  scale: number;
  tip: string;
  onClick: () => void;
  tile: React.ReactNode;
}) {
  return (
    <div
      ref={(el) => register(id, el)}
      className="fos-dock-icon relative flex h-[70px] w-12 flex-none items-end justify-center"
    >
      <button
        onClick={onClick}
        aria-label={tip}
        className="block outline-none"
        style={{
          transform: `scale(${scale.toFixed(3)})`,
          transformOrigin: 'center 100%',
          transition: 'transform 90ms ease-out',
        }}
      >
        {tile}
      </button>
      <span className="fos-dock-tip glass rounded-lg px-2.5 py-1">{tip}</span>
    </div>
  );
}

function DockAppIcon({ app, running, minimized, scale, register, onClick }: {
  app: AppDef;
  running: boolean;
  minimized: boolean;
  scale: number;
  register: (el: HTMLElement | null) => void;
  onClick: () => void;
}) {
  const { tr } = useOS();
  const Icon = app.icon;
  const tip = tr(app.title.ar, app.title.fr, app.title.en);
  return (
    <div
      ref={register}
      className="fos-dock-icon relative flex h-[70px] w-12 flex-none items-end justify-center"
    >
      <button
        onClick={onClick}
        data-minimized={minimized || undefined}
        aria-label={tip}
        className="block outline-none"
        style={{
          transform: `scale(${scale.toFixed(3)})`,
          transformOrigin: 'center 100%',
          transition: 'transform 90ms ease-out',
          opacity: minimized ? 0.55 : 1,
        }}
      >
        <span className={`flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-br ${app.tile} shadow-lg ring-1 ring-white/15`}>
          <Icon className="h-5 w-5 text-white/90" strokeWidth={1.8} />
        </span>
      </button>
      <span className="fos-dock-dot" style={{ opacity: running ? 1 : 0 }} />
      <span className="fos-dock-tip glass rounded-lg px-2.5 py-1">{tip}</span>
    </div>
  );
}

function DockUtil({ tip, onClick, children }: {
  tip: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fos-dock-icon relative flex h-[70px] w-10 flex-none items-end justify-center">
      <button
        onClick={onClick}
        aria-label={tip}
        className="glass-item-hover mb-1 flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:text-white"
      >
        {children}
      </button>
      <span className="fos-dock-tip glass rounded-lg px-2.5 py-1">{tip}</span>
    </div>
  );
}

function PowerItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
        danger ? 'text-rose-300 hover:bg-rose-500/15' : 'text-white/85 hover:bg-white/10'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
