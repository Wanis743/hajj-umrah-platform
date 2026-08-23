import { useEffect, useMemo, useState } from 'react';
import type { ExtendedAdminTab, NavSection } from '@/components/admin/adminDashboardTypes';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Clock3, LogOut, Pin, PinOff } from 'lucide-react';

interface Props {
  isAr: boolean;
  t: (ar: string, fr: string, en: string) => string;
  activeTab: ExtendedAdminTab;
  setActiveTab: (tab: ExtendedAdminTab) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  pinned: boolean;
  setPinned: (value: boolean) => void;
  expanded: boolean;
  onHoverChange: (hovering: boolean) => void;
  filteredSections: NavSection[];
  recentTabs?: ExtendedAdminTab[];
  agencyName: string;
  logoSrc: string;
  onLogout: () => Promise<void>;
}

const COLLAPSED_KEY = 'admin-rail-collapsed-sections';

export default function AdminSidebar({
  isAr, t, activeTab, setActiveTab, setSidebarOpen, pinned, setPinned,
  expanded, onHoverChange, filteredSections, recentTabs = [], agencyName, logoSrc, onLogout,
}: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed)); }, [collapsed]);
  useEffect(() => { if (!expanded) setQuery(''); }, [expanded]);

  // Never leave the section that owns the active tab folded shut.
  useEffect(() => {
    const owner = filteredSections.find((s) => s.items.some((i) => i.id === activeTab));
    if (owner) setCollapsed((prev) => (prev.includes(owner.id) ? prev.filter((s) => s !== owner.id) : prev));
  }, [activeTab, filteredSections]);

  const allCollapsed = filteredSections.length > 0 && filteredSections.every((s) => collapsed.includes(s.id));
  const toggleAll = () =>
    setCollapsed(allCollapsed ? [] : filteredSections.map((s) => s.id));

  const toggleSection = (id: string) =>
    setCollapsed((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!q) return filteredSections;
    return filteredSections
      .map((s) => ({
        ...s,
        items: s.items.filter((i) =>
          [i.ar, i.fr, i.en, i.id, ...(i.keywords ?? [])].some((v) => v.toLowerCase().includes(q))),
      }))
      .filter((s) => s.items.length > 0);
  }, [filteredSections, q]);

  const allItems = useMemo(() => filteredSections.flatMap((s) => s.items), [filteredSections]);
  const recents = recentTabs
    .filter((id) => id !== activeTab)
    .map((id) => allItems.find((i) => i.id === id))
    .filter(Boolean)
    .slice(0, 3) as NavSection['items'];

  const go = (id: ExtendedAdminTab) => { setActiveTab(id); setSidebarOpen(false); setQuery(''); };

  return (
    <aside
      data-expanded={expanded ? 'true' : 'false'}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      className={`admin-rail ${expanded ? 'is-expanded' : ''} ${isAr ? 'is-rtl' : ''}`}
      aria-label={t('التنقل', 'Navigation', 'Navigation')}
    >
      <div className="admin-rail-inner">
        {/* Brand */}
        <div className="flex items-center gap-2.5 h-14 shrink-0 px-3 border-b border-[var(--border)]">
          <img src={logoSrc} alt={agencyName} className="h-9 w-9 rounded-xl object-contain shrink-0" />

          <button
            onClick={() => setPinned(!pinned)}
            aria-pressed={pinned}
            title={pinned ? t('إلغاء التثبيت', 'Détacher', 'Unpin') : t('تثبيت القائمة', 'Épingler', 'Pin sidebar')}
            className={`ms-auto h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors ${expanded ? 'flex' : 'hidden'}`}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        </div>


        {/* Collapsed mini rail — one large icon per section */}
        {!expanded && (
          <nav className="rail-mini flex-1 overflow-y-auto overflow-x-hidden py-3">
            {filteredSections.map((section) => {
              const target = section.items.find((i) => i.id === activeTab) ?? section.items[0];
              if (!target) return null;
              const Icon = target.icon;
              const isActive = section.items.some((i) => i.id === activeTab);
              const alert = section.items.some((i) => i.badge && i.badgeRed);
              const badged = section.items.some((i) => i.badge);
              return (
                <button
                  key={`mini-${section.id}`}
                  onClick={() => go(target.id)}
                  title={`${section.label} — ${t(target.ar, target.fr, target.en)}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={`rail-mini-btn ${isActive ? 'is-active' : ''}`}
                >
                  <Icon className="h-[22px] w-[22px]" />
                  {badged && <span className={`rail-dot ${alert ? 'is-danger' : ''}`} />}
                </button>
              );
            })}
          </nav>
        )}

        {/* Count + collapse-all */}
        {expanded && (
        <div className="px-2.5 pt-2.5 rail-label">
          <div className="mt-1.5 flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--text-muted)]">
              {sections.reduce((n, s) => n + s.items.length, 0)} {t('عنصر', 'éléments', 'items')}
            </span>
            <button onClick={toggleAll} className="rail-toolbtn" title={allCollapsed ? t('توسيع الكل', 'Tout ouvrir', 'Expand all') : t('طي الكل', 'Tout replier', 'Collapse all')}>
              {allCollapsed ? <ChevronsUpDown className="h-3 w-3" /> : <ChevronsDownUp className="h-3 w-3" />}
              <span>{allCollapsed ? t('توسيع الكل', 'Tout ouvrir', 'Expand all') : t('طي الكل', 'Tout replier', 'Collapse all')}</span>
            </button>
          </div>
        </div>

        )}

        {expanded && (
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-1.5">
          {/* Recents */}
          {!q && recents.length > 0 && (
            <div className={`rail-label ${expanded ? '' : 'opacity-0'}`}>
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Clock3 className="h-3 w-3" />{t('الأخيرة', 'Récents', 'Recent')}
              </p>
              <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                {recents.map((r) => (
                  <button key={`recent-${r.id}`} onClick={() => go(r.id)} className="rail-chip">{t(r.ar, r.fr, r.en)}</button>
                ))}
              </div>
            </div>
          )}

          {sections.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">{t('لا نتائج', 'Aucun résultat', 'No results')}</p>
          ) : sections.map((section) => {
            const SectionIcon = section.icon;
            const isCollapsed = !q && collapsed.includes(section.id);
            const hasActive = section.items.some((i) => i.id === activeTab);
            return (
              <div key={section.id} className="rail-section">
                <button
                  onClick={() => expanded && toggleSection(section.id)}
                  aria-expanded={!isCollapsed}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-colors ${hasActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} ${expanded ? 'hover:bg-[var(--bg-hover)]' : 'cursor-default'}`}
                >
                  {SectionIcon && <SectionIcon className="h-4 w-4 shrink-0" />}
                  <span className={`truncate flex-1 text-start rail-label ${expanded ? '' : 'opacity-0'}`}>{section.label}</span>
                  <span className="rail-count">{section.items.length}</span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform rail-label ${expanded ? '' : 'opacity-0'} ${isCollapsed ? '-rotate-90 rtl:rotate-90' : ''}`} />
                </button>

                <div className={`grid transition-[grid-template-rows] duration-300 ${isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="space-y-0.5 pt-0.5">
                      {section.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        const label = t(item.ar, item.fr, item.en);
                        const desc = t(item.descAr ?? '', item.descFr ?? '', item.descEn ?? '');
                        return (
                          <button
                            key={item.id}
                            onClick={() => go(item.id)}
                            aria-current={isActive ? 'page' : undefined}
                            title={expanded ? desc || label : `${label}${desc ? ` — ${desc}` : ''}`}
                            className={`rail-item relative w-full flex items-center gap-3 min-h-11 py-1.5 px-3 text-[14px] rounded-xl transition-all ${isActive ? 'rail-item-active' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
                          >
                            <span className="relative shrink-0">
                              <Icon className={`h-[20px] w-[20px] ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
                              {item.badge && !expanded && (
                                <span className={`rail-dot ${item.badgeRed ? 'is-danger' : ''}`} />
                              )}
                            </span>
                            {isActive && <span className="rail-item-bar" aria-hidden="true" />}
                            <span className={`min-w-0 flex-1 text-start rail-label ${expanded ? '' : 'opacity-0'}`}>
                              <span className="block truncate whitespace-nowrap leading-tight">{label}</span>
                              {isActive && desc && (
                                <span className="block truncate text-[10.5px] leading-tight text-[var(--text-muted)]">{desc}</span>
                              )}
                            </span>
                            {item.badge && (
                              <span className={`rail-label rail-badge ${expanded ? '' : 'opacity-0'} ${item.badgeRed ? 'is-danger' : ''}`}>{item.badge}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        )}

        {/* Footer */}
        <div className="border-t border-[var(--border)] p-2 shrink-0">
          <button
            onClick={onLogout}
            title={t('تسجيل الخروج', 'Déconnexion', 'Logout')}
            className="rail-logout w-full flex items-center gap-3 h-11 px-3 rounded-xl text-[14px] text-[var(--text-secondary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors"
          >
            <LogOut className="h-[20px] w-[20px] shrink-0" />
            <span className={`truncate text-start whitespace-nowrap rail-label ${expanded ? '' : 'opacity-0'}`}>
              {t('تسجيل الخروج', 'Déconnexion', 'Logout')}
            </span>
          </button>
        </div>

      </div>
    </aside>
  );
}
