/* eslint-disable react-refresh/only-export-components -- OS kernel module intentionally
   exports the context hook alongside the provider component. */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { BankTransactionRow, FiscalPeriodRow, GenericRow } from '@/types/database';
import { APP_MAP, APPS } from './apps';
import {
  DEFAULT_PREFS, TASKBAR_INSET,
  type OSNotification, type OSPrefs, type OSSignals, type OSWindow, type Rect,
} from './osTypes';

const STORAGE_WINDOWS = 'financeos.v2.windows';
const STORAGE_PREFS = 'financeos.v2.prefs';
const SESSION_WELCOME = 'financeos.v2.welcomed';

export type OverlayName = 'start' | 'palette' | 'notifications' | 'calendar' | null;

interface OSContextValue {
  // windows
  windows: OSWindow[];
  activeWindowId: string | null;
  openApp: (appId: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  closeWindow: (id: string) => void;
  closeAllWindows: () => void;
  setWindowRect: (id: string, rect: Rect) => void;
  resetSession: () => void;
  // prefs
  prefs: OSPrefs;
  setPrefs: (patch: Partial<OSPrefs>) => void;
  // overlays
  overlay: OverlayName;
  setOverlay: (name: OverlayName) => void;
  toggleOverlay: (name: Exclude<OverlayName, null>) => void;
  // notifications
  notifications: OSNotification[];
  unreadCount: number;
  pushNotification: (n: Omit<OSNotification, 'id' | 'time'>) => void;
  clearNotifications: () => void;
  markAllRead: () => void;
  // live ledger signals
  signals: OSSignals;
  // shell helpers
  viewport: { w: number; h: number };
  lang: string;
  isAr: boolean;
  tr: (ar: string, fr: string, en: string) => string;
}

const OSContext = createContext<OSContextValue | null>(null);

function useViewport() {
  const [vp, setVp] = useState(() => ({
    w: typeof window === 'undefined' ? 1440 : window.innerWidth,
    h: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

function loadPrefs(): OSPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<OSPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface PersistedWindow { appId: string; rect: Rect; minimized: boolean }

function loadPersistedWindows(): PersistedWindow[] {
  try {
    const raw = localStorage.getItem(STORAGE_WINDOWS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedWindow[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.appId === 'string' && APP_MAP[p.appId]);
  } catch {
    return [];
  }
}

export function OSProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const tr = useCallback(
    (ar: string, fr: string, en: string) => (isAr ? ar : lang === 'fr' ? fr : en),
    [isAr, lang],
  );
  const viewport = useViewport();
  const zCounter = useRef(200);

  const [prefs, setPrefsState] = useState<OSPrefs>(loadPrefs);
  const [windows, setWindows] = useState<OSWindow[]>(() => {
    const persisted = loadPersistedWindows();
    return persisted.map((p, i) => ({
      id: `w-${p.appId}-${i}`,
      appId: p.appId,
      ...p.rect,
      z: 100 + i,
      minimized: p.minimized,
      maximized: false,
    }));
  });
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [overlay, setOverlayState] = useState<OverlayName>(null);
  const [sessionNotes, setSessionNotes] = useState<OSNotification[]>([]);
  const [readCutoff, setReadCutoff] = useState<number>(() => Date.now());
  const [dismissedSignals, setDismissedSignals] = useState<string[]>([]);

  // Mirror of windows/active id so window-manager ops can compute their next
  // state without side effects inside updaters (double-invoked in dev).
  const stateRef = useRef<{ windows: OSWindow[]; activeId: string | null }>({ windows: [], activeId: null });
  useEffect(() => {
    stateRef.current = { windows, activeId: activeWindowId };
  }, [windows, activeWindowId]);

  // ---------- live ledger signals (power the tray badge, widgets, action items) ----------
  const { data: journalEntries, loading: journalsLoading } = useSupabaseData<GenericRow>({
    table: 'journal_entries', columns: 'id,status', limit: 500,
  });
  const { data: bankTx, loading: txLoading } = useSupabaseData<BankTransactionRow>({
    table: 'bank_transactions', columns: 'id,status', limit: 500,
  });
  const { data: fiscalPeriods, loading: periodsLoading } = useSupabaseData<FiscalPeriodRow>({
    table: 'fiscal_periods', columns: 'id,label,start_date,end_date,status',
    orderBy: { column: 'start_date', ascending: false },
  });

  const signals = useMemo<OSSignals>(() => {
    const draftJournals = journalEntries.filter(
      (j) => j.status === 'DRAFT' || j.status === 'PENDING',
    ).length;
    const unmatchedBankLines = bankTx.filter((t) => t.status === 'UNMATCHED').length;
    const openPeriod = fiscalPeriods.find((p) => p.status === 'OPEN');
    return {
      loading: journalsLoading || txLoading || periodsLoading,
      draftJournals,
      unmatchedBankLines,
      openPeriodLabel: openPeriod?.label ?? null,
    };
  }, [journalEntries, bankTx, fiscalPeriods, journalsLoading, txLoading, periodsLoading]);

  // ---------- notifications ----------
  const signalNotifications = useMemo<OSNotification[]>(() => {
    if (signals.loading) return [];
    const items: OSNotification[] = [];
    if (signals.draftJournals > 0) {
      items.push({
        id: 'sig:draft-journals', kind: 'warning',
        title: tr('قيود غير مرحّلة', 'Écritures en brouillon', 'Unposted journals'),
        body: tr(
          `${signals.draftJournals} قيد بانتظار الترحيل ويمنع الإقفال.`,
          `${signals.draftJournals} écriture(s) bloquent la clôture.`,
          `${signals.draftJournals} journal entr${signals.draftJournals > 1 ? 'ies are' : 'y is'} waiting to be posted and blocking the period close.`,
        ),
        time: Date.now(), appId: 'journal',
      });
    }
    if (signals.unmatchedBankLines > 0) {
      items.push({
        id: 'sig:unmatched-bank', kind: 'info',
        title: tr('أسطر بنكية غير مطابقة', 'Lignes bancaires non rapprochées', 'Unmatched bank lines'),
        body: tr(
          `${signals.unmatchedBankLines} سطر بحاجة إلى مراجعة في التسوية.`,
          `${signals.unmatchedBankLines} ligne(s) à revoir au rapprochement.`,
          `${signals.unmatchedBankLines} statement line${signals.unmatchedBankLines > 1 ? 's' : ''} need${signals.unmatchedBankLines > 1 ? '' : 's'} review in Reconciliation.`,
        ),
        time: Date.now(), appId: 'reconcile',
      });
    }
    if (signals.openPeriodLabel) {
      items.push({
        id: 'sig:open-period', kind: 'info',
        title: tr('الفترة المالية مفتوحة', 'Période ouverte', 'Fiscal period open'),
        body: tr(
          `${signals.openPeriodLabel} ما زالت مفتوحة للقيود.`,
          `${signals.openPeriodLabel} reste ouverte aux écritures.`,
          `${signals.openPeriodLabel} remains open for posting.`,
        ),
        time: Date.now(), appId: 'close',
      });
    }
    return items.filter((i) => !dismissedSignals.includes(i.id));
  }, [signals, dismissedSignals, tr]);

  const notifications = useMemo(
    () => [...sessionNotes, ...signalNotifications].sort((a, b) => b.time - a.time),
    [sessionNotes, signalNotifications],
  );

  const unreadCount = useMemo(() => {
    const unread = sessionNotes.filter((n) => n.time > readCutoff).length;
    return unread + signalNotifications.length;
  }, [sessionNotes, signalNotifications, readCutoff]);

  // Session welcome note — once per browser session, like an OS login toast.
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_WELCOME)) return;
    sessionStorage.setItem(SESSION_WELCOME, '1');
    setSessionNotes([{
      id: 'sys:welcome', kind: 'success',
      title: tr('مرحباً بك في Finance OS', 'Bienvenue dans Finance OS', 'Welcome to Finance OS'),
      body: tr(
        'تم تحميل بيئة سطح المكتب المالية. انقر نقراً مزدوجاً على أيقونة أو افتح قائمة البدء.',
        "L'environnement financier est prêt. Double-cliquez une icône ou ouvrez le menu Démarrer.",
        'Your financial desktop is ready. Double-click an icon or open the Start menu to begin.',
      ),
      time: Date.now(), appId: 'overview',
    }]);
  }, [tr]);

  const pushNotification = useCallback((n: Omit<OSNotification, 'id' | 'time'>) => {
    setSessionNotes((prev) => [
      { ...n, id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, time: Date.now() },
      ...prev,
    ].slice(0, 30));
  }, []);

  const clearNotifications = useCallback(() => {
    setSessionNotes([]);
    setDismissedSignals(signalNotifications.map((n) => n.id));
  }, [signalNotifications]);

  const markAllRead = useCallback(() => setReadCutoff(Date.now()), []);

  // ---------- prefs ----------
  const setPrefs = useCallback((patch: Partial<OSPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_PREFS, JSON.stringify(next)); } catch { /* quota */ }
      // Keep the workspace accent token in sync with the selected accent.
      const root = document.querySelector('.finance-os-root');
      if (root instanceof HTMLElement) root.style.setProperty('--brand-500', patch.accent ? brandFor(patch.accent) : brandFor(next.accent));
      return next;
    });
  }, []);

  // ---------- overlays ----------
  const setOverlay = useCallback((name: OverlayName) => {
    setOverlayState(name);
    if (name === 'notifications') setReadCutoff(Date.now());
  }, []);
  const toggleOverlay = useCallback((name: Exclude<OverlayName, null>) => {
    setOverlayState((prev) => {
      const next = prev === name ? null : name;
      if (next === 'notifications') setReadCutoff(Date.now());
      return next;
    });
  }, []);

  // ---------- window manager ----------
  const clampRect = useCallback((r: Rect, minW: number, minH: number): Rect => {
    const deskH = Math.max(360, viewport.h - TASKBAR_INSET);
    const w = Math.min(Math.max(r.w, minW), viewport.w - 24);
    const h = Math.min(Math.max(r.h, minH), deskH - 12);
    const x = Math.min(Math.max(r.x, 8 - (w - 160)), Math.max(8, viewport.w - w - 8));
    const y = Math.min(Math.max(r.y, 8), Math.max(8, deskH - h - 8));
    return { x, y, w, h };
  }, [viewport]);

  const focusWindow = useCallback((id: string) => {
    setActiveWindowId(id);
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, z: ++zCounter.current } : w)));
  }, []);

  const openApp = useCallback((appId: string) => {
    const def = APP_MAP[appId];
    if (!def) return;
    const prev = stateRef.current.windows;
    const existing = prev.find((w) => w.appId === appId);
    if (existing) {
      setActiveWindowId(existing.id);
      setWindows(prev.map((w) => w.id === existing.id
        ? { ...w, minimized: false, z: ++zCounter.current }
        : w));
    } else {
      const z = ++zCounter.current;
      const cascade = (prev.length % 5) * 28;
      const rect = clampRect({
        x: Math.round((viewport.w - def.defaultSize.w) / 2) + cascade,
        y: Math.round(Math.max(24, (viewport.h - TASKBAR_INSET - def.defaultSize.h) / 3)) + cascade,
        w: def.defaultSize.w,
        h: def.defaultSize.h,
      }, def.minSize.w, def.minSize.h);
      const win: OSWindow = {
        id: `w-${appId}-${Date.now()}`, appId, ...rect, z,
        minimized: false, maximized: false,
      };
      setActiveWindowId(win.id);
      setWindows([...prev, win]);
    }
    setOverlayState(null);
  }, [clampRect, viewport]);

  const minimizeWindow = useCallback((id: string) => {
    const prev = stateRef.current.windows;
    const next = prev.map((w) => (w.id === id ? { ...w, minimized: true } : w));
    setWindows(next);
    if (stateRef.current.activeId === id) {
      const topMost = next
        .filter((w) => !w.minimized)
        .sort((a, b) => b.z - a.z)[0];
      setActiveWindowId(topMost?.id ?? null);
    }
  }, []);

  const restoreWindow = useCallback((id: string) => {
    setActiveWindowId(id);
    setWindows((prev) => prev.map((w) => (w.id === id
      ? { ...w, minimized: false, z: ++zCounter.current }
      : w)));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setActiveWindowId(id);
    setWindows((prev) => prev.map((w) => {
      if (w.id !== id) return w;
      if (w.maximized && w.restore) {
        const def = APP_MAP[w.appId];
        return {
          ...w, maximized: false, z: ++zCounter.current,
          ...clampRect(w.restore, def?.minSize.w ?? 480, def?.minSize.h ?? 320),
        };
      }
      return {
        ...w, maximized: true, minimized: false, z: ++zCounter.current,
        restore: { x: w.x, y: w.y, w: w.w, h: w.h },
      };
    }));
  }, [clampRect]);

  const closeWindow = useCallback((id: string) => {
    const prev = stateRef.current.windows;
    const next = prev.filter((w) => w.id !== id);
    setWindows(next);
    if (stateRef.current.activeId === id) {
      const topMost = next.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];
      setActiveWindowId(topMost?.id ?? null);
    }
  }, []);

  const closeAllWindows = useCallback(() => {
    setWindows([]);
    setActiveWindowId(null);
  }, []);

  const setWindowRect = useCallback((id: string, rect: Rect) => {
    setWindows((prev) => prev.map((w) => {
      if (w.id !== id) return w;
      const def = APP_MAP[w.appId];
      return { ...w, ...clampRect(rect, def?.minSize.w ?? 480, def?.minSize.h ?? 320) };
    }));
  }, [clampRect]);

  const resetSession = useCallback(() => {
    setWindows([]);
    setActiveWindowId(null);
    try { localStorage.removeItem(STORAGE_WINDOWS); } catch { /* ignore */ }
  }, []);

  // Persist window geometry so the desktop comes back the way you left it.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        const persisted: PersistedWindow[] = windows.map((w) => ({
          appId: w.appId, rect: { x: w.x, y: w.y, w: w.w, h: w.h }, minimized: w.minimized,
        }));
        localStorage.setItem(STORAGE_WINDOWS, JSON.stringify(persisted));
      } catch { /* quota */ }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [windows]);

  // Keep windows on-screen when the browser resizes.
  useEffect(() => {
    setWindows((prev) => prev.map((w) => {
      const def = APP_MAP[w.appId];
      return { ...w, ...clampRect(w, def?.minSize.w ?? 480, def?.minSize.h ?? 320) };
    }));
  }, [clampRect]);

  const value: OSContextValue = {
    windows, activeWindowId,
    openApp, focusWindow, minimizeWindow, restoreWindow, toggleMaximize, closeWindow,
    closeAllWindows, setWindowRect, resetSession,
    prefs, setPrefs,
    overlay, setOverlay: setOverlay, toggleOverlay,
    notifications, unreadCount, pushNotification, clearNotifications, markAllRead,
    signals,
    viewport, lang, isAr, tr,
  };

  return <OSContext.Provider value={value}>{children}</OSContext.Provider>;
}

function brandFor(accentId: string): string {
  const map: Record<string, string> = {
    indigo: '#6366f1', blue: '#3b82f6', emerald: '#10b981', amber: '#f59e0b', rose: '#f43f5e',
  };
  return map[accentId] ?? map.indigo;
}

export function useOS(): OSContextValue {
  const ctx = useContext(OSContext);
  if (!ctx) throw new Error('useOS must be used within OSProvider');
  return ctx;
}

/** Resolve an app's localized title outside of components. */
export function appTitle(appId: string, tr: (ar: string, fr: string, en: string) => string): string {
  const def = APP_MAP[appId];
  if (!def) return appId;
  return tr(def.title.ar, def.title.fr, def.title.en);
}

export { APPS, APP_MAP };
