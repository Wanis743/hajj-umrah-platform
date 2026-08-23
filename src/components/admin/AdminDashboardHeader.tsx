import { useEffect, useRef, useState } from 'react';
import {
  Bell, Check, Globe, Menu, Moon, PanelLeftClose, Plus, RefreshCw, Search, Sun,
} from 'lucide-react';
import { languages, type Lang } from '@/i18n/translations';
import type { ExtendedAdminTab } from '@/components/admin/adminDashboardTypes';

interface Props {
  isAr: boolean;
  t: (ar: string, fr: string, en: string) => string;
  lang: Lang;
  setLang: (lang: Lang) => void;
  currentLang?: { code: string };
  theme: string;
  toggleTheme: () => void;
  activeTab: ExtendedAdminTab;
  activeTitle: { ar: string; fr: string; en: string };
  activeSectionLabel?: string;
  activeDesc?: string;

  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  commandOpen: boolean;
  setCommandOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  notifOpen: boolean;
  setNotifOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  notifications: Array<{ id: string; text: string; time: Date }>;
  langOpen: boolean;
  setLangOpen: (value: boolean | ((prev: boolean) => boolean)) => void;

  agencyName?: string;
  logoSrc?: string;
  userEmail?: string | null;
  openIncidents?: number;
  dataLoading?: boolean;
  onNew?: () => void;
  onRefresh?: () => void;
  onLogout?: () => void;
}

// Dashboard staff UI ships in formal Arabic, French and English only —
// the Darija ("dz") option stays on the public site.
const dashboardLanguages = languages.filter((l) => l.code !== 'dz');

export default function AdminDashboardHeader(props: Props) {
  const {
    isAr, t, lang, setLang, theme, toggleTheme, activeTitle,
    sidebarOpen, setSidebarOpen, setCommandOpen, notifOpen, setNotifOpen,
    notifications, langOpen, setLangOpen,
    dataLoading, onNew, onRefresh,
  } = props;

  const end = isAr ? 'left' : 'right';
  const locale = lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';

  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = () => { setLangOpen(false); setNotifOpen(false); };
    const onDown = (e: MouseEvent) => { if (!barRef.current?.contains(e.target as Node)) close(); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [setLangOpen, setNotifOpen]);

  const solo = (which: 'notif' | 'lang') => {
    setNotifOpen(which === 'notif' ? (v: boolean) => !v : false);
    setLangOpen(which === 'lang' ? (v: boolean) => !v : false);
  };

  // Darija is a public-site language only; fall back to formal Arabic in the dashboard.
  useEffect(() => { if (lang === 'dz') setLang('ar'); }, [lang, setLang]);

  return (
    <header ref={barRef} className="tb shrink-0">
      <div className="tb-main">
        <div className="tb-left">
          <button
            onClick={() => setSidebarOpen((v: boolean) => !v)}
            aria-label={t('القائمة', 'Menu', 'Menu')}
            aria-pressed={sidebarOpen}
            className={`icon-btn ${sidebarOpen ? 'is-on' : ''}`}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <h1 className="tb-title">{t(activeTitle.ar, activeTitle.fr, activeTitle.en)}</h1>
        </div>

        <div className="tb-right">
          <button onClick={() => setCommandOpen(true)} className="tb-search" title={t('بحث', 'Recherche', 'Search')}>
            <Search className="h-4 w-4 shrink-0 opacity-70" />
            <span className="tb-search-text">{t('بحث…', 'Rechercher…', 'Search…')}</span>
            <kbd className="tb-kbd">⌘K</kbd>
          </button>

          <button onClick={() => setCommandOpen(true)} className="icon-btn tb-search-mini" aria-label={t('بحث', 'Rechercher', 'Search')}>
            <Search className="h-4 w-4" />
          </button>

          <button onClick={() => { window.location.hash = '#/admin/finance_os'; window.location.reload(); }} className="tb-cta mr-2" style={{ backgroundColor: '#2563eb', color: 'white', border: 'none' }} title="Finance OS">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            <span className="tb-cta-text">Finance OS</span>
          </button>
          {onNew && (
            <button onClick={onNew} className="tb-cta" title={t('حجز جديد', 'Nouvelle réservation', 'New booking')}>
              <Plus className="h-4 w-4" />
              <span className="tb-cta-text">{t('جديد', 'Nouveau', 'New')}</span>
            </button>
          )}

          {onRefresh && (
            <button onClick={onRefresh} className="icon-btn" aria-label={t('تحديث', 'Actualiser', 'Refresh')} title={t('تحديث', 'Actualiser', 'Refresh')}>
              <RefreshCw className={`h-4 w-4 ${dataLoading ? 'animate-spin' : ''}`} />
            </button>
          )}

          {/* language */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); solo('lang'); }}
              className={`icon-btn tb-lang ${langOpen ? 'is-on' : ''}`}
              aria-label={t('اللغة', 'Langue', 'Language')}
              aria-expanded={langOpen}
              title={t('اللغة', 'Langue', 'Language')}
            >
              <Globe className="h-4 w-4" />
              <span className="tb-lang-code">{lang.toUpperCase()}</span>
            </button>
            {langOpen && (
              <div className="glass-pop tb-pop absolute top-full z-50 mt-2 w-44 p-1.5" style={{ [end]: 0 }}>
                {dashboardLanguages.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code as Lang); setLangOpen(false); }}
                    className={`tb-item ${lang === l.code ? 'is-active' : ''}`}
                  >
                    <span>{l.flag}</span>
                    <span className="flex-1 text-start">{l.label}</span>
                    {lang === l.code && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* notifications */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); solo('notif'); }}
              className={`icon-btn ${notifOpen ? 'is-on' : ''}`}
              aria-label={t('التنبيهات', 'Notifications', 'Notifications')}
              aria-expanded={notifOpen}
            >
              <Bell className="h-4 w-4" />
              {notifications.length > 0 && <span className="notif-dot">{notifications.length > 9 ? '9+' : notifications.length}</span>}
            </button>
            {notifOpen && (
              <div className="glass-pop tb-pop absolute top-full z-50 mt-2 w-[17rem]" style={{ [end]: 0 }}>
                <div className="tb-pop-head">
                  <span className="tb-pop-title">{t('التنبيهات', 'Notifications', 'Notifications')}</span>
                </div>
                <div className="max-h-72 overflow-y-auto p-1.5">
                  {notifications.length === 0 ? (
                    <p className="tb-empty">{t('لا توجد تنبيهات', 'Aucune notification', 'No notifications')}</p>
                  ) : notifications.map((n) => (
                    <div key={n.id} className="tb-notif">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px]">{n.text}</span>
                        <span className="block text-[9.5px] text-[var(--text-muted)]">
                          {n.time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* theme toggle */}
          <button
            onClick={toggleTheme}
            className="icon-btn"
            aria-label={t('السمة', 'Thème', 'Theme')}
            title={theme === 'dark' ? t('الوضع الفاتح', 'Mode clair', 'Light mode') : t('الوضع الداكن', 'Mode sombre', 'Dark mode')}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {dataLoading && <span className="tb-progress" aria-hidden="true" />}
    </header>
  );
}

