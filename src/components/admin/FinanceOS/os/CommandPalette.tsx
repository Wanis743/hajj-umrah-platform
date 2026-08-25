import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ArrowRight, CornerDownLeft, XSquare, MinusSquare, Image as ImageIcon,
  MonitorCog, LogOut, RotateCcw, type LucideIcon,
} from 'lucide-react';
import { APPS } from './apps';
import { useOS } from './OSContext';
import { nextWallpaperId } from './theme';

interface PaletteItem {
  id: string;
  kind: 'app' | 'command';
  title: string;
  hint: string;
  icon: LucideIcon;
  tile?: string;
  keywords: string;
  run: () => void;
}

/**
 * Global ⌘K palette: full-text search across apps and shell commands with
 * keyboard navigation. This is the functional replacement for the old
 * decorative palette whose input was not even wired to anything.
 */
export function CommandPalette({ onExit }: { onExit: () => void }) {
  const {
    openApp, setOverlay, closeAllWindows, windows, minimizeWindow,
    prefs, setPrefs, resetSession, tr,
  } = useOS();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlay(null); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [setOverlay]);

  const items = useMemo<PaletteItem[]>(() => {
    const appItems: PaletteItem[] = APPS.map((app) => ({
      id: `app:${app.id}`,
      kind: 'app',
      title: tr(app.title.ar, app.title.fr, app.title.en),
      hint: tr(app.desc.ar, app.desc.fr, app.desc.en),
      icon: app.icon,
      tile: app.tile,
      keywords: [app.id, app.title.ar, app.title.fr, app.title.en, app.desc.en, app.desc.fr].join(' ').toLowerCase(),
      run: () => openApp(app.id),
    }));
    const commandItems: PaletteItem[] = [
      {
        id: 'cmd:close-all', kind: 'command',
        title: tr('إغلاق كل النوافذ', 'Fermer toutes les fenêtres', 'Close all windows'),
        hint: tr(`${windows.length} نافذة مفتوحة`, `${windows.length} fenêtre(s) ouverte(s)`, `${windows.length} open window${windows.length === 1 ? '' : 's'}`),
        icon: XSquare,
        keywords: 'close all windows fermer fenetres اغلاق',
        run: closeAllWindows,
      },
      {
        id: 'cmd:min-all', kind: 'command',
        title: tr('تصغير كل النوافذ', 'Tout réduire', 'Minimize all windows'),
        hint: tr('إظهار سطح المكتب', 'Afficher le bureau', 'Reveal the desktop'),
        icon: MinusSquare,
        keywords: 'minimize all windows show desktop bureau reduire تصغير',
        run: () => windows.forEach((w) => { if (!w.minimized) minimizeWindow(w.id); }),
      },
      {
        id: 'cmd:wallpaper', kind: 'command',
        title: tr('الخلفية التالية', 'Fond d’écran suivant', 'Next wallpaper'),
        hint: tr('تدوير خلفيات سطح المكتب', 'Parcourir les fonds d’écran', 'Cycle desktop wallpapers'),
        icon: ImageIcon,
        keywords: 'wallpaper background fond ecran خلفية',
        run: () => setPrefs({ wallpaper: nextWallpaperId(prefs.wallpaper) }),
      },
      {
        id: 'cmd:widgets', kind: 'command',
        title: prefs.widgets
          ? tr('إخفاء ودجات سطح المكتب', 'Masquer les widgets', 'Hide desktop widgets')
          : tr('إظهار ودجات سطح المكتب', 'Afficher les widgets', 'Show desktop widgets'),
        hint: tr('الساعة ونبض الدفاتر', 'Horloge et pouls du grand livre', 'Clock and ledger pulse'),
        icon: MonitorCog,
        keywords: 'widgets desktop bureau ودجات',
        run: () => setPrefs({ widgets: !prefs.widgets }),
      },
      {
        id: 'cmd:reset', kind: 'command',
        title: tr('إعادة تعيين تخطيط الجلسة', 'Réinitialiser la session', 'Reset session layout'),
        hint: tr('إغلاق النوافذ ومحو المواضع المحفوظة', 'Fermer et effacer les positions', 'Close windows and forget saved positions'),
        icon: RotateCcw,
        keywords: 'reset layout session reinitialiser اعادة',
        run: resetSession,
      },
      {
        id: 'cmd:exit', kind: 'command',
        title: tr('الخروج إلى المشغّل', 'Quitter vers le lanceur', 'Exit to Launcher'),
        hint: tr('العودة إلى اختيار البيئة', "Retour au choix d'environnement", 'Back to environment chooser'),
        icon: LogOut,
        keywords: 'exit quit logout quitter خروج',
        run: onExit,
      },
    ];
    return [...appItems, ...commandItems];
  }, [tr, openApp, closeAllWindows, windows, minimizeWindow, prefs, setPrefs, resetSession, onExit]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return items;
    const parts = q.split(/\s+/);
    return items.filter((i) => {
      const hay = `${i.title} ${i.keywords}`.toLowerCase();
      return parts.every((p) => hay.includes(p));
    });
  }, [items, q]);

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const runItem = (item: PaletteItem) => {
    setOverlay(null);
    item.run();
  };

  return (
    <div className="absolute inset-0 z-[320] bg-black/50 backdrop-blur-sm fos-fade" onClick={() => setOverlay(null)}>
      <div
        className="fos-slide-down mx-auto mt-[12vh] w-[min(640px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/10 bg-[#12151f]/95 shadow-2xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
          <Search className="h-5 w-5 flex-none text-white/40" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === 'Enter' && results[cursor]) runItem(results[cursor]);
            }}
            placeholder={tr('ابحث عن تطبيقات وأوامر…', 'Applications et commandes…', 'Search apps and commands…')}
            className="w-full bg-transparent text-[15px] text-white placeholder-white/35 outline-none"
          />
          <kbd className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-white/45">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <div className="py-12 text-center text-sm text-white/40">
              {tr('لا نتائج مطابقة', 'Aucun résultat', 'No matching results')}
            </div>
          )}
          {results.map((item, idx) => {
            const Icon = item.icon;
            const active = idx === cursor;
            return (
              <button
                key={item.id}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => runItem(item)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition-colors ${
                  active ? 'bg-white/10' : ''
                }`}
              >
                <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg shadow ${
                  item.tile ? `bg-gradient-to-br ${item.tile} ring-1 ring-white/15` : 'bg-white/10'
                }`}>
                  <Icon className="h-4 w-4 text-white" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white/90">{item.title}</span>
                  <span className="block truncate text-xs text-white/45">{item.hint}</span>
                </span>
                {item.kind === 'app'
                  ? <ArrowRight className="h-4 w-4 flex-none text-white/30 rtl:rotate-180" />
                  : <CornerDownLeft className="h-4 w-4 flex-none text-white/30" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-white/35">
          <span>↑↓ {tr('تنقل', 'Naviguer', 'Navigate')}</span>
          <span>↵ {tr('فتح', 'Ouvrir', 'Open')}</span>
          <span>ESC {tr('إغلاق', 'Fermer', 'Close')}</span>
        </div>
      </div>
    </div>
  );
}
