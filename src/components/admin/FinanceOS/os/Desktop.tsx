import React, { useEffect, useState } from 'react';
import {
  Gauge, BookOpen, Scale, Settings, Image as ImageIcon, MonitorCog, Info, LayoutGrid,
} from 'lucide-react';
import { DESKTOP_APPS } from './apps';
import { useOS } from './OSContext';
import { wardrobeWallpaperLabel } from './desktopUtils';
import { useAuth } from '@/lib/auth';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

interface MenuState { x: number; y: number }

/**
 * The desktop itself: wallpaper light blobs, launch icons, live widgets and
 * a right-click context menu. Icons open on double-click like a real desktop.
 */
export function Desktop() {
  const {
    openApp, prefs, setPrefs, signals, tr, lang,
  } = useOS();
  const { session } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const now = useClock();

  const locale = lang === 'ar' || lang === 'dz' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onEsc);
    };
  }, [menu]);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      onPointerDown={() => setSelected(null)}
    >
      {/* Desktop icons — column flow, like a real OS grid */}
      <div
        className="absolute inset-x-0 top-0 flex max-h-[calc(100%-110px)] flex-col flex-wrap content-start gap-1 p-5"
        style={{ bottom: 104 }}
      >
        {DESKTOP_APPS.map((app) => {
          const Icon = app.icon;
          const isSelected = selected === app.id;
          return (
            <button
              key={app.id}
              data-selected={isSelected}
              className="fos-desk-icon group flex w-[92px] flex-col items-center gap-1.5 rounded-xl px-1 py-2 outline-none"
              title={tr(app.desc.ar, app.desc.fr, app.desc.en)}
              onPointerDown={(e) => { e.stopPropagation(); setSelected(app.id); }}
              onDoubleClick={() => openApp(app.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') openApp(app.id); }}
            >
              <span
                className={`fos-desk-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${app.tile}
                  shadow-[0_10px_26px_-8px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.25)]
                  ring-1 ring-white/15 transition-transform group-hover:scale-105`}
              >
                <Icon className="h-5 w-5 text-white drop-shadow" strokeWidth={1.8} />
              </span>
              <span
                className="fos-desk-icon-label max-w-full truncate rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium leading-tight text-white/95"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
              >
                {tr(app.title.ar, app.title.fr, app.title.en)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Widgets column */}
      {prefs.widgets && (
        <div className="absolute end-5 top-5 flex w-[288px] flex-col gap-3 fos-rise">
          {/* Clock + identity widget */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-xl backdrop-blur-xl">
            <div className="flex items-baseline justify-between">
              <span className="text-4xl font-light tabular-nums tracking-tight text-white">
                {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                {now.toLocaleDateString(locale, { weekday: 'long' })}
              </span>
            </div>
            <div className="mt-1 text-sm text-white/65">
              {now.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-white/50">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="truncate">
                {session?.user?.email ?? tr('جلسة ضيف', 'Session invité', 'Guest session')}
              </span>
            </div>
          </div>

          {/* Live signals widget */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-xl backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                {tr('نبض الدفاتر', 'Pouls du grand livre', 'Ledger pulse')}
              </span>
              {signals.loading && (
                <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
              )}
            </div>
            <div className="space-y-1">
              <SignalRow
                active={signals.draftJournals > 0}
                icon={<BookOpen className="h-3.5 w-3.5" />}
                label={tr('قيود غير مرحّلة', 'Brouillons', 'Unposted journals')}
                value={signals.loading ? '—' : String(signals.draftJournals)}
                onClick={() => openApp('journal')}
              />
              <SignalRow
                active={signals.unmatchedBankLines > 0}
                icon={<Scale className="h-3.5 w-3.5" />}
                label={tr('أسطر بنكية معلقة', 'Lignes bancaires', 'Unmatched bank lines')}
                value={signals.loading ? '—' : String(signals.unmatchedBankLines)}
                onClick={() => openApp('reconcile')}
              />
              <SignalRow
                active
                icon={<Gauge className="h-3.5 w-3.5" />}
                label={tr('الفترة المفتوحة', 'Période ouverte', 'Open period')}
                value={signals.loading ? '—' : (signals.openPeriodLabel ?? tr('لا يوجد', 'Aucune', 'None'))}
                onClick={() => openApp('close')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Desktop context menu */}
      {menu && (
        <div
          className="fos-pop fixed z-[330] w-60 overflow-hidden rounded-xl border border-white/10 bg-[#151823]/95 p-1.5 shadow-2xl backdrop-blur-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.min(menu.y, window.innerHeight - 260) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon={<LayoutGrid className="h-4 w-4 text-sky-400" />}
            label={tr('فتح غرفة القيادة', 'Ouvrir le cockpit', 'Open Cockpit')}
            onClick={() => { openApp('overview'); setMenu(null); }}
          />
          <MenuItem
            icon={<ImageIcon className="h-4 w-4 text-purple-400" />}
            label={tr('تغيير الخلفية', 'Changer le fond d’écran', 'Change wallpaper')}
            onClick={() => { wardrobeWallpaperLabel(prefs, setPrefs); setMenu(null); }}
          />
          <MenuItem
            icon={<MonitorCog className="h-4 w-4 text-emerald-400" />}
            label={prefs.widgets
              ? tr('إخفاء الودجات', 'Masquer les widgets', 'Hide widgets')
              : tr('إظهار الودجات', 'Afficher les widgets', 'Show widgets')}
            onClick={() => { setPrefs({ widgets: !prefs.widgets }); setMenu(null); }}
          />
          <div className="my-1 h-px bg-white/10" />
          <MenuItem
            icon={<Settings className="h-4 w-4 text-zinc-400" />}
            label={tr('الإعدادات', 'Réglages', 'Settings')}
            onClick={() => { openApp('settings'); setMenu(null); }}
          />
          <MenuItem
            icon={<Info className="h-4 w-4 text-blue-400" />}
            label={tr('حول Finance OS', 'À propos de Finance OS', 'About Finance OS')}
            onClick={() => { openApp('about'); setMenu(null); }}
          />
        </div>
      )}

      {/* Empty-desktop hint when there are no windows */}
      <div className="pointer-events-none absolute bottom-[120px] left-1/2 -translate-x-1/2 text-center text-[11px] font-medium uppercase tracking-[0.3em] text-white/20">
        Finance OS
      </div>
    </div>
  );
}

function SignalRow({ icon, label, value, active, onClick }: {
  icon: React.ReactNode; label: string; value: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-white/5"
    >
      <span className={`flex items-center gap-2 text-xs ${active ? 'text-white/80' : 'text-white/40'}`}>
        <span className={active ? 'text-white/70' : 'text-white/30'}>{icon}</span>
        {label}
      </span>
      <span className={`text-xs font-semibold tabular-nums ${active ? 'text-white' : 'text-white/40'}`}>
        {value}
      </span>
    </button>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-white/85 transition-colors hover:bg-white/10"
    >
      {icon}
      {label}
    </button>
  );
}
