import React, { useEffect, useState } from 'react';
import {
  Search, Bell, Settings, LogOut, XSquare, RotateCcw, Info, BookOpen,
} from 'lucide-react';
import { useOS } from './OSContext';
import { APP_MAP } from './apps';
import { MENUBAR_INSET } from './osTypes';
import { agencyConfig } from '@/config/agency';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * The macOS-style menu bar pinned to the top edge. Left: the system menu
 * (agency mark) plus the focused app's name. Right: Spotlight search,
 * notifications, and a live clock opening the calendar.
 */
export function MenuBar({ onExit }: { onExit: () => void }) {
  const {
    windows, activeWindowId, toggleOverlay, overlay, unreadCount,
    openApp, closeAllWindows, resetSession, tr, lang,
  } = useOS();
  const now = useClock();
  const [sysMenu, setSysMenu] = useState(false);
  const locale = lang === 'ar' || lang === 'dz' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';

  useEffect(() => {
    if (!sysMenu) return;
    const close = () => setSysMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [sysMenu]);

  const activeWin = windows.find((w) => w.id === activeWindowId && !w.minimized);
  const activeTitle = activeWin
    ? tr(APP_MAP[activeWin.appId]?.title.ar ?? '', APP_MAP[activeWin.appId]?.title.fr ?? '', APP_MAP[activeWin.appId]?.title.en ?? '')
    : tr('المالية', 'Finance', 'Finance');

  const itemCls = 'flex h-[22px] items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors hover:bg-white/15';

  return (
    <div
      className="glass-menubar absolute inset-x-0 top-0 z-[450] flex items-stretch justify-between gap-1 px-3"
      style={{ height: MENUBAR_INSET }}
    >
      {/* Left: system menu + focused app name */}
      <div className="flex items-center gap-1">
        <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setSysMenu((v) => !v)}
            data-active={sysMenu}
            className={`${itemCls} ${sysMenu ? 'bg-white/15' : ''}`}
            title={agencyConfig.name}
          >
            <BookOpen className="h-3.5 w-3.5 text-white/90" strokeWidth={1.8} />
          </button>
          {sysMenu && (
            <div className="glass fos-pop absolute start-0 top-[26px] w-64 overflow-hidden rounded-xl p-1.5">
              <MenuItem
                icon={<Info className="h-4 w-4 text-white/50" />}
                label={tr('حول النظام', 'À propos du système', 'About this system')}
                onClick={() => { openApp('about'); setSysMenu(false); }}
              />
              <MenuItem
                icon={<Settings className="h-4 w-4 text-white/50" />}
                label={tr('الإعدادات…', 'Réglages…', 'Settings…')}
                onClick={() => { openApp('settings'); setSysMenu(false); }}
              />
              <div className="my-1 h-px bg-white/10" />
              <MenuItem
                icon={<XSquare className="h-4 w-4 text-white/50" />}
                label={tr('إغلاق كل النوافذ', 'Fermer toutes les fenêtres', 'Close all windows')}
                onClick={() => { closeAllWindows(); setSysMenu(false); }}
              />
              <MenuItem
                icon={<RotateCcw className="h-4 w-4 text-white/50" />}
                label={tr('إعادة تعيين التخطيط', 'Réinitialiser la disposition', 'Reset saved layout')}
                onClick={() => { resetSession(); setSysMenu(false); }}
              />
              <div className="my-1 h-px bg-white/10" />
              <MenuItem
                icon={<LogOut className="h-4 w-4 text-rose-300" />}
                label={tr('الخروج إلى المشغّل', 'Quitter vers le lanceur', 'Exit to Launcher')}
                onClick={onExit}
                danger
              />
            </div>
          )}
        </div>
        <span className="px-1 text-[12.5px] font-semibold text-white/90">{activeTitle}</span>
        <span className="hidden text-[12.5px] text-white/35 md:block">{agencyConfig.name}</span>
      </div>

      {/* Right: status items */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => toggleOverlay('palette')}
          className={`${itemCls} ${overlay === 'palette' ? 'bg-white/15' : ''}`}
          title={tr('بحث ⌘K', 'Rechercher ⌘K', 'Search ⌘K')}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => toggleOverlay('notifications')}
          className={`${itemCls} relative ${overlay === 'notifications' ? 'bg-white/15' : ''}`}
          title={tr('الإشعارات', 'Notifications', 'Notifications')}
        >
          <Bell className="h-3.5 w-3.5" />
          {unreadCount > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[8.5px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => toggleOverlay('calendar')}
          className={`${itemCls} gap-2 tabular-nums ${overlay === 'calendar' ? 'bg-white/15' : ''}`}
          title={tr('التقويم', 'Calendrier', 'Calendar')}
        >
          <span className="capitalize">
            {now.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <span>
            {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </span>
        </button>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: {
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
