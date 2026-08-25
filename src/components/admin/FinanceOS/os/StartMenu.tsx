import React, { useEffect, useMemo, useState } from 'react';
import { Search, LogOut } from 'lucide-react';
import { APPS, CATEGORY_ORDER } from './apps';
import { useOS } from './OSContext';
import type { AppDef } from './osTypes';

/**
 * Start menu / launcher. Slides up from the taskbar, groups apps by area,
 * and filters live as you type. Enter launches the first match.
 */
export function StartMenu({ onExit }: { onExit: () => void }) {
  const { openApp, setOverlay, tr } = useOS();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlay(null); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [setOverlay]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return APPS;
    return APPS.filter((a) => {
      const hay = [a.title.ar, a.title.fr, a.title.en, a.desc.ar, a.desc.fr, a.desc.en, a.id]
        .join(' ').toLowerCase();
      return q.split(/\s+/).every((part) => hay.includes(part));
    });
  }, [q]);

  const visibleCategories = CATEGORY_ORDER
    .map((cat) => ({ ...cat, apps: matches.filter((a) => a.category === cat.id) }))
    .filter((cat) => cat.apps.length > 0);

  const launch = (app: AppDef) => {
    openApp(app.id);
    setOverlay(null);
  };

  return (
    <div className="absolute inset-0 z-[310]" onPointerDown={() => setOverlay(null)}>
      <div
        className="fos-pop absolute inset-x-0 bottom-[76px] mx-auto w-[min(680px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/10 bg-[#131622]/92 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="border-b border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 focus-within:border-white/25">
            <Search className="h-4 w-4 flex-none text-white/40" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches.length > 0) launch(matches[0]);
              }}
              placeholder={tr('ابحث عن تطبيقات…', 'Rechercher des applications…', 'Search apps…')}
              className="w-full bg-transparent text-sm text-white placeholder-white/35 outline-none"
            />
          </div>
        </div>

        {/* App grid, grouped by area */}
        <div className="max-h-[46vh] overflow-y-auto p-4">
          {visibleCategories.length === 0 && (
            <div className="py-10 text-center text-sm text-white/40">
              {tr('لا نتائج', 'Aucun résultat', 'No results')}
            </div>
          )}
          {visibleCategories.map((cat) => {
            const CatIcon = cat.icon;
            return (
              <div key={cat.id} className="mb-4 last:mb-0">
                <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  <CatIcon className="h-3 w-3" />
                  {tr(cat.label.ar, cat.label.fr, cat.label.en)}
                </div>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-5">
                  {cat.apps.map((app) => {
                    const Icon = app.icon;
                    return (
                      <button
                        key={app.id}
                        onClick={() => launch(app)}
                        className="group flex flex-col items-center gap-1.5 rounded-xl p-2.5 transition-colors hover:bg-white/10"
                        title={tr(app.desc.ar, app.desc.fr, app.desc.en)}
                      >
                        <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${app.tile} shadow-lg ring-1 ring-white/15 transition-transform group-hover:scale-110`} style={{ transitionTimingFunction: 'cubic-bezier(0.34,1.56,0.64,1)' }}>
                          <Icon className="h-4 w-4 text-white" strokeWidth={1.9} />
                        </span>
                        <span className="max-w-full truncate text-[11px] font-medium text-white/85">
                          {tr(app.title.ar, app.title.fr, app.title.en)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: session + exit */}
        <div className="flex items-center justify-between border-t border-white/10 bg-white/[0.03] px-4 py-2.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-white/35">
            Finance OS
          </span>
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            {tr('خروج', 'Quitter', 'Exit to Launcher')}
          </button>
        </div>
      </div>
    </div>
  );
}
