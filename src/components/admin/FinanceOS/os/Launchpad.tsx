import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { APPS } from './apps';
import { useOS } from './OSContext';

/**
 * Launchpad — the macOS-style full-screen app grid. Fills the display with
 * a heavy glass sheet, a centered search field, and staggered icon tiles.
 * Click anywhere off a tile (or press Escape) to dismiss.
 */
export function Launchpad() {
  const { openApp, setOverlay, tr } = useOS();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOverlay]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return APPS;
    return APPS.filter((a) =>
      [a.title.ar, a.title.fr, a.title.en, a.desc.en, a.desc.fr, a.id]
        .join(' ')
        .toLowerCase()
        .includes(q));
  }, [query]);

  const launch = (id: string) => {
    setOverlay(null);
    openApp(id);
  };

  return (
    <div
      className="glass-sheet fos-launchpad absolute inset-0 z-[440] flex flex-col items-center"
      onClick={() => setOverlay(null)}
    >
      {/* Search */}
      <div
        className="glass mt-[9vh] flex w-[min(340px,calc(80vw))] items-center gap-2.5 rounded-full px-4 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <Search className="h-4 w-4 flex-none text-white/45" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered.length > 0) launch(filtered[0].id);
          }}
          placeholder={tr('بحث', 'Rechercher', 'Search')}
          aria-label={tr('بحث في التطبيقات', 'Rechercher une app', 'Search apps')}
          className="w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
        />
      </div>

      {/* Icon grid */}
      <div
        className="mt-[6vh] grid w-[min(860px,calc(94vw))] grid-cols-4 gap-x-4 gap-y-9 overflow-y-auto px-6 pb-16 sm:grid-cols-5 md:grid-cols-6"
        onClick={(e) => e.stopPropagation()}
      >
        {filtered.length === 0 && (
          <p className="col-span-full pt-10 text-center text-sm text-white/40">
            {tr('لا نتائج', 'Aucun résultat', 'No results')}
          </p>
        )}
        {filtered.map((app, i) => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              onClick={() => launch(app.id)}
              className="fos-launch-icon group flex flex-col items-center gap-2.5"
              style={{ animationDelay: `${Math.min(i * 18, 240)}ms` }}
              title={tr(app.desc.ar, app.desc.fr, app.desc.en)}
            >
              <span
                className={`flex h-[68px] w-[68px] items-center justify-center rounded-[18px] bg-gradient-to-br ${app.tile}
                  shadow-[0_14px_34px_-10px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.18)] ring-1 ring-white/15
                  transition-transform duration-150 group-hover:scale-[1.07] group-active:scale-95`}
              >
                <Icon className="h-7 w-7 text-white/90" strokeWidth={1.7} />
              </span>
              <span
                className="max-w-full truncate rounded px-1 text-[12px] font-medium text-white/85 group-hover:bg-white/10"
              >
                {tr(app.title.ar, app.title.fr, app.title.en)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
