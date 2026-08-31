import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { safeCrmRead, type CrmReadResult } from '@/services/crmAnalytics';
import type { CrmStage } from '@/types/crm';

/** ar/dz -> Arabic, fr -> French, everything else English. The same helper every
 *  admin screen inlines; hoisted so the CRM files agree with each other. */
export function useCrmI18n() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = useCallback(
    (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en),
    [isAr, isFr],
  );
  return { isAr, t };
}

/* -------------------------------------------------------------------------- */
/* Formatting. A null from the server means "undefined", and it renders as an   */
/* em dash. Printing 0% for an undefined rate would invent a fact.              */
/* -------------------------------------------------------------------------- */

export const DASH = '—';

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function fmtMoney(value: number | null | undefined, currency: 'DZD' | 'SAR' = 'DZD'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${value}%`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString();
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? DASH
    : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Days until a due date; negative means overdue, null when there is no date. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}

/** ISO date (YYYY-MM-DD) n days back from today, for the range pickers. */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Tone tokens                                                                */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'info' | 'progress' | 'warn' | 'good' | 'bad';

export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  progress: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  bad: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
};

export const STAGE_TONE: Record<CrmStage, Tone> = {
  NEW: 'info', QUALIFYING: 'progress', PROPOSAL: 'warn',
  NEGOTIATION: 'warn', WON: 'good', LOST: 'bad',
};

export function toneForStatus(status: string | null | undefined): Tone {
  switch ((status ?? '').toUpperCase()) {
    case 'NEW': case 'DRAFT': case 'PLANNED': case 'OPEN': return 'info';
    case 'CONTACTED': case 'QUALIFYING': case 'SENT': case 'ACTIVE': return 'progress';
    case 'QUALIFIED': case 'PROPOSAL': case 'NEGOTIATION': case 'PAUSED': return 'warn';
    case 'CONVERTED': case 'WON': case 'ACCEPTED': case 'DONE': case 'COMPLETED': return 'good';
    case 'LOST': case 'DECLINED': case 'EXPIRED': case 'CANCELLED': case 'BLOCKED': return 'bad';
    default: return 'neutral';
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface CrmReadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads one analytics payload. Deliberately plain: the RPC already composes a
 * whole screen's worth of data in one round trip, so there is nothing to cache
 * or merge here. `deps` is the argument list -- change it and the read reruns.
 */
export function useCrmRead<T>(run: () => Promise<CrmReadResult<T>>, deps: readonly unknown[]): CrmReadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Latest-ref: the caller passes a fresh closure every render, so the effect
  // keys off the serialized arguments instead of the function identity.
  const runRef = useRef(run);
  runRef.current = run;
  const key = JSON.stringify(deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    safeCrmRead(() => runRef.current()).then((res) => {
      if (!alive) return;
      setData(res.data);
      setError(res.error);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [key, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
