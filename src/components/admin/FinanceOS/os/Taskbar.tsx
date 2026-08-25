import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, Bell, Settings, Power, ChevronLeft, ChevronRight, LogOut, XSquare, RotateCcw, LayoutGrid,
} from 'lucide-react';
import { APPS, PINNED_APPS } from './apps';
import { useOS } from './OSContext';
import { accent } from './theme';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Floating glass taskbar: Start button, app search, running/pinned apps with
 * minimize-restore semantics, plus a system tray (notifications, calendar,
 * settings, power). Apps are single-instance so the dock stays truthful.
 */
export function Taskbar({ onExit }: { onExit: () => void }) {
  const {
    windows, activeWindowId, openApp, focusWindow, minimizeWindow, restoreWindow,
    closeAllWindows, toggleOverlay, overlay, unreadCount, tr, prefs, lang, resetSession,
  } = useOS();
  const now = useClock();
  const [powerOpen, setPowerOpen] = useState(false);
  const locale = lang === 'ar' || lang === 'dz' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';
  const brandHex = accent(prefs.accent).hex;

  useEffect(() => {
    if (!powerOpen) return;
    const close = () => setPowerOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [powerOpen]);

  // Dock entries: pinned apps first, then any running-but-not-pinned apps.
  const dockApps = useMemo(() => {
    const running = windows.map((w) => w.appId);
    const extras = APPS.filter((a) => running.includes(a.id) && !a.pinned);
    return [...PINNED_APPS, ...extras];
  }, [windows]);

  const windowFor = (appId: string) => windows.find((w) => w.appId === appId);

  const onDockClick = (appId: string) => {
    const win = windowFor(appId);
    if (!win) { openApp(appId); return; }
    if (win.minimized) { restoreWindow(win.id); return; }
    if (activeWindowId === win.id) { minimizeWindow(win.id); return; }
    focusWindow(win.id);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[300] flex justify-center px-3">
      <div className="fos-taskbar pointer-events-auto flex h-14 max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl px-2">
        {/* Start */}
        <button
          onClick={() => toggleOverlay('start')}
          data-active={overlay === 'start'}
          className={`group flex h-10 items-center gap-2 rounded-xl px-3 transition-colors ${
            overlay === 'start' ? 'bg-white/15' : 'hover:bg-white/10'
          }`}
          title={tr('ابدأ', 'Démarrer', 'Start')}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg text-white shadow-md"
            style={{ background: `linear-gradient(135deg, ${brandHex}, #312e81)` }}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </span>
          <span className="hidden text-[13px] font-semibold text-white/85 md:block">
            {tr('ابدأ', 'Démarrer', 'Start')}
          </span>
        </button>

        {/* Search trigger */}
        <button
          onClick={() => toggleOverlay('palette')}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white md:w-auto md:gap-2 md:px-3"
          title={tr('بحث ⌘K', 'Rechercher ⌘K', 'Search ⌘K')}
        >
          <Search className="h-4 w-4" />
          <span className="hidden text-[13px] text-white/55 lg:block">{tr('بحث', 'Rechercher', 'Search')}</span>
          <kbd className="hidden rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-white/45 lg:block">⌘K</kbd>
        </button>

        <span className="mx-0.5 h-8 w-px flex-none bg-white/10" />

        {/* Dock apps */}
        <div className="flex items-center gap-1">
          {dockApps.map((app) => {
            const win = windowFor(app.id);
            const Icon = app.icon;
            const isActive = !!win && !win.minimized && activeWindowId === win.id;
            return (
              <button
                key={app.id}
                data-running={!!win}
                data-active={isActive}
                onClick={() => onDockClick(app.id)}
                className={`fos-task-btn flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                  isActive ? 'bg-white/15' : win && !win.minimized ? 'bg-white/[0.07]' : 'hover:bg-white/10'
                }`}
                title={tr(app.title.ar, app.title.fr, app.title.en)}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br ${app.tile} shadow`}>
                  <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2} />
                </span>
                <span className="fos-run-dot" />
              </button>
            );
          })}
        </div>

        <span className="mx-0.5 h-8 w-px flex-none bg-white/10" />

        {/* Tray: notifications */}
        <button
          onClick={() => toggleOverlay('notifications')}
          className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
            overlay === 'notifications' ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
          }`}
          title={tr('الإشعارات', 'Notifications', 'Notifications')}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white shadow">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Tray: clock + calendar */}
        <button
          onClick={() => toggleOverlay('calendar')}
          className={`hidden h-10 flex-col items-end justify-center rounded-xl px-3 transition-colors sm:flex ${
            overlay === 'calendar' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
          }`}
          title={tr('التقويم', 'Calendrier', 'Calendar')}
        >
          <span className="text-[12px] font-medium leading-none tabular-nums">
            {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="mt-0.5 text-[10px] leading-none text-white/45">
            {now.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
          </span>
        </button>

        {/* Tray: settings */}
        <button
          onClick={() => openApp('settings')}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          title={tr('الإعدادات', 'Réglages', 'Settings')}
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* Tray: power */}
        <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setPowerOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            title={tr('الطاقة', 'Alimentation', 'Power')}
          >
            <Power className="h-4 w-4" />
          </button>
          {powerOpen && (
            <div className="fos-pop absolute bottom-12 end-0 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#151823]/95 p-1.5 shadow-2xl backdrop-blur-xl">
              <PowerItem
                icon={<XSquare className="h-4 w-4 text-amber-400" />}
                label={tr('إغلاق كل النوافذ', 'Fermer toutes les fenêtres', 'Close all windows')}
                onClick={() => { closeAllWindows(); setPowerOpen(false); }}
              />
              <PowerItem
                icon={<RotateCcw className="h-4 w-4 text-sky-400" />}
                label={tr('إعادة تعيين الجلسة', 'Réinitialiser la session', 'Reset session layout')}
                onClick={() => { resetSession(); setPowerOpen(false); }}
              />
              <div className="my-1 h-px bg-white/10" />
              <PowerItem
                icon={<LogOut className="h-4 w-4 text-rose-400" />}
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

/** Month calendar popover anchored above the tray clock. */
export function CalendarPanel() {
  const { tr, lang } = useOS();
  const locale = lang === 'ar' || lang === 'dz' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const monthLabel = cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekdayNames = useMemo(() => {
    const base = new Date(2024, 0, 7); // a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
        .toLocaleDateString(locale, { weekday: 'narrow' }));
  }, [locale]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [cursor]);

  return (
    <div className="fos-pop absolute bottom-[74px] end-4 z-[310] w-72 rounded-2xl border border-white/10 bg-[#151823]/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between">
        <button
          className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label={tr('الشهر السابق', 'Mois précédent', 'Previous month')}
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <span className="text-sm font-semibold capitalize text-white/90">{monthLabel}</span>
        <button
          className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label={tr('الشهر التالي', 'Mois suivant', 'Next month')}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdayNames.map((w, i) => (
          <span key={i} className="py-1 text-[10px] font-semibold uppercase text-white/35">{w}</span>
        ))}
        {cells.map((d, i) => {
          const isToday = d !== null
            && cursor.getFullYear() === today.getFullYear()
            && cursor.getMonth() === today.getMonth()
            && d === today.getDate();
          return (
            <span
              key={i}
              className={`flex aspect-square items-center justify-center rounded-lg text-[12px] ${
                d === null ? '' : isToday
                  ? 'font-bold text-white'
                  : 'text-white/70 hover:bg-white/10'
              }`}
              style={isToday ? { background: 'var(--brand-500)' } : undefined}
            >
              {d ?? ''}
            </span>
          );
        })}
      </div>
      <div className="mt-3 border-t border-white/10 pt-2 text-center text-[11px] text-white/45">
        {today.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
}
