import React, { useState, useRef } from 'react';
import {
  Check, AlertTriangle, Clock, Lock, Loader2, CalendarPlus, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useAuth } from '@/lib/auth';
import type { BankTransactionRow, FiscalPeriodRow, GenericRow } from '@/types/database';

interface ValidationTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'blocked';
  message?: string;
}

const INITIAL_TASKS: ValidationTask[] = [
  { id: 'drafts', name: 'drafts', status: 'pending' },
  { id: 'bank', name: 'bank', status: 'pending' },
  { id: 'integrity', name: 'integrity', status: 'pending' },
  { id: 'gates', name: 'gates', status: 'pending' },
];

/**
 * Period Close Center. Every validation computes from live data — no canned
 * "OK" results: draft journals from journal_entries, bank lines from
 * bank_transactions, and ledger integrity by re-summing journal_lines.
 */
export function CloseCenter() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : lang === 'fr' ? fr : en);
  const { session } = useAuth();

  const [locking, setLocking] = useState(false);
  const [validating, setValidating] = useState(false);
  const [opening, setOpening] = useState(false);

  const { data: periods, refetch: refetchPeriods } = useSupabaseData<FiscalPeriodRow>({
    table: 'fiscal_periods',
    columns: 'id,label,start_date,end_date,status',
    orderBy: { column: 'start_date', ascending: false },
    limit: 60,
  });
  const openPeriod = periods.find((p) => p.status === 'OPEN');

  const { data: journals } = useSupabaseData<GenericRow>({
    table: 'journal_entries', columns: 'id,status', limit: 2000,
  });
  const { data: txs } = useSupabaseData<BankTransactionRow>({
    table: 'bank_transactions', columns: 'id,status', limit: 2000,
  });

  const pendingRecon = txs.filter((t2) => t2.status === 'UNMATCHED').length;
  const pendingJournals = journals.filter((j) => j.status === 'DRAFT' || j.status === 'PENDING').length;

  const taskNames = (id: string) => ({
    drafts: t('فحص القيود المسودة', 'Écritures en brouillon', 'Draft journals check'),
    bank: t('التسوية البنكية', 'Rapprochement bancaire', 'Bank reconciliation'),
    integrity: t('تكامل الأستاذ', 'Intégrité du grand livre', 'Ledger integrity'),
    gates: t('بوابات الرقابة', 'Contrôles finaux', 'Control gates'),
  } as Record<string, string>)[id] ?? id;

  const [tasks, setTasks] = useState<ValidationTask[]>(INITIAL_TASKS);
  const taskListRef = useRef<HTMLDivElement>(null);

  const canLock = !validating && tasks.every((t2) => t2.status === 'done');

  const patchTask = (idx: number, patch: Partial<ValidationTask>) => {
    setTasks((prev) => prev.map((task, i) => (i === idx ? { ...task, ...patch } : task)));
  };

  /** Step through the four real checks, sequentially, animating each row. */
  const runValidations = async () => {
    setValidating(true);
    setTasks(INITIAL_TASKS);

    // 1. Draft journals
    patchTask(0, { status: 'running' });
    await wait(350);
    if (pendingJournals > 0) {
      patchTask(0, {
        status: 'error',
        message: t(`${pendingJournals} قيداً غير مرحل يمنع الإقفال.`, `${pendingJournals} écriture(s) en brouillon bloquent la clôture.`, `${pendingJournals} unposted entr${pendingJournals > 1 ? 'ies' : 'y'} blocking the close.`),
      });
    } else {
      patchTask(0, { status: 'done', message: t('كل القيود مرحّلة.', 'Toutes les écritures sont validées.', 'All journals are posted.') });
    }

    // 2. Bank reconciliation
    patchTask(1, { status: 'running' });
    await wait(350);
    if (pendingRecon > 0) {
      patchTask(1, {
        status: 'error',
        message: t(`${pendingRecon} سطر بنكي غير مطابق.`, `${pendingRecon} ligne(s) bancaire(s) non rapprochée(s).`, `${pendingRecon} unmatched bank line${pendingRecon > 1 ? 's' : ''}.`),
      });
    } else {
      patchTask(1, { status: 'done', message: t('الحسابات البنكية مسوّاة.', 'Comptes bancaires rapprochés.', 'Bank accounts reconciled.') });
    }

    // 3. Ledger integrity — re-sum every journal's lines and look for imbalance.
    patchTask(2, { status: 'running' });
    let imbalances = 0;
    try {
      const { data: lines, error } = await supabase
        .from('journal_lines')
        .select('journal_entry_id,currency_code,debit,credit')
        .limit(5000);
      if (error) throw error;
      const sums = new Map<string, { d: number; c: number }>();
      for (const l of (lines ?? []) as { journal_entry_id: string; currency_code: string; debit: number; credit: number }[]) {
        const key = `${l.journal_entry_id}|${l.currency_code}`;
        const cur = sums.get(key) ?? { d: 0, c: 0 };
        cur.d += Number(l.debit ?? 0);
        cur.c += Number(l.credit ?? 0);
        sums.set(key, cur);
      }
      for (const v of sums.values()) {
        if (Math.abs(v.d - v.c) > 0.005) imbalances += 1;
      }
      if (imbalances > 0) {
        patchTask(2, {
          status: 'error',
          message: t(`${imbalances} قيداً غير متوازن.`, `${imbalances} écriture(s) déséquilibrée(s).`, `${imbalances} unbalanced entr${imbalances > 1 ? 'ies' : 'y'} detected.`),
        });
      } else {
        patchTask(2, { status: 'done', message: t('كل قيد متوازن بين مدين ودائن.', 'Chaque écriture est équilibrée.', 'Every entry balances debit vs credit.') });
      }
    } catch {
      patchTask(2, { status: 'error', message: t('تعذر فحص التكامل.', 'Vérification impossible.', 'Integrity check unavailable.') });
    }
    await wait(300);

    // 4. Gates = rollup of the previous three.
    setTasks((prev) => {
      const failed = prev.slice(0, 3).some((task) => task.status === 'error');
      return prev.map((task, i) => i === 3
        ? {
            ...task,
            status: failed ? 'blocked' : 'done',
            message: failed
              ? t('عالج الخطوات السابقة أولاً.', 'Corrigez les étapes précédentes.', 'Resolve previous steps first.')
              : t('الفترة جاهزة للإقفال.', 'Période prête à clôturer.', 'Period ready to lock.'),
          }
        : task);
    });
    setValidating(false);
  };

  /** Create the next calendar month as an OPEN period — replaces the old text that told users to "go to system settings" (which did not exist). */
  const openNewPeriod = async () => {
    try {
      setOpening(true);
      // Resolve agency like the workspace convention: staff_profiles → agency_id.
      const { data: me } = await supabase
        .from('staff_profiles')
        .select('agency_id')
        .eq('user_id', session?.user?.id ?? '')
        .maybeSingle();
      const agencyId = me ? (me as { agency_id?: string }).agency_id : null;
      if (!agencyId) throw new Error(t('تعذر تحديد الوكالة.', 'Agence introuvable.', 'Could not resolve your agency.'));

      const anchor = periods[0] ? new Date(String(periods[0].end_date)) : new Date();
      const next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
      const label = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
      const end = new Date(next.getFullYear(), next.getMonth() + 1, 0);

      const { error } = await supabase.from('fiscal_periods').insert({
        agency_id: agencyId,
        label,
        start_date: next.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        status: 'OPEN',
      });
      if (error) throw error;
      toast.success(t(`تم فتح الفترة ${label}`, `Période ${label} ouverte`, `Opened period ${label}`));
      refetchPeriods();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const handleLock = async () => {
    if (!openPeriod) return;
    try {
      setLocking(true);
      const { error } = await supabase.rpc('close_fiscal_period', { p_period_id: openPeriod.id });
      if (error) throw error;
      toast.success(t('تم إقفال الفترة بنجاح.', 'Période clôturée avec succès.', 'Period closed successfully.'));
      refetchPeriods();
      setTasks(INITIAL_TASKS);
    } catch (e: unknown) {
      toast.error(t('فشل الإقفال', 'Échec de la clôture', 'Failed to close period') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="h-full flex flex-col text-slate-200">
      {/* Toolbar — the window titlebar names the app; keep actions compact */}
      <div className="flex flex-wrap justify-end items-center gap-2 pb-3 border-b border-slate-700/50">
        <div className="flex gap-2">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            onClick={runValidations}
            disabled={validating}
          >
            {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('تشغيل الفحوصات', 'Lancer les contrôles', 'Run validations')}
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 border border-red-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canLock || locking || !openPeriod}
            onClick={handleLock}
          >
            {locking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {t('إقفال الفترة', 'Clôturer la période', 'Lock period')}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pt-4">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Active period card */}
          <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/30">
              <span className="font-medium text-slate-300">{t('الفترة النشطة', 'Période active', 'Active period')}</span>
              {openPeriod ? (
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-bold tracking-wide">
                  {t('مفتوحة', 'OUVERTE', 'OPEN')}
                </span>
              ) : (
                <span className="px-3 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-full text-xs font-bold tracking-wide">
                  {t('لا فترة مفتوحة', 'AUCUNE OUVERTE', 'NONE OPEN')}
                </span>
              )}
            </div>
            <div className="p-6">
              {openPeriod ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold text-white">{openPeriod.label}</div>
                    <div className="text-sm text-slate-400 mt-1">
                      {new Date(openPeriod.start_date).toLocaleDateString()} — {new Date(openPeriod.end_date).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-6 text-end">
                    <div>
                      <div className="text-xs text-slate-400">{t('قيود غير مرحّلة', 'Brouillons', 'Unposted journals')}</div>
                      <div className={`text-xl font-medium ${pendingJournals > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{pendingJournals}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">{t('أسطر معلقة', 'Lignes pendantes', 'Unmatched bank lines')}</div>
                      <div className={`text-xl font-medium ${pendingRecon > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{pendingRecon}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-slate-500 space-y-3">
                  <p>{t('كل الفترات مغلقة حالياً.', 'Toutes les périodes sont clôturées.', 'All periods are currently closed.')}</p>
                  <button
                    onClick={openNewPeriod}
                    disabled={opening}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 border border-emerald-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                  >
                    {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                    {t('فتح الفترة التالية', 'Ouvrir la période suivante', 'Open next period')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Validation checklist */}
          <div className="space-y-3" ref={taskListRef}>
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`p-4 bg-slate-900/50 border rounded-xl flex items-center justify-between transition-colors duration-300 ${
                  task.status === 'done' ? 'border-emerald-500/30 bg-emerald-500/5'
                    : task.status === 'error' ? 'border-rose-500/30 bg-rose-500/5'
                    : task.status === 'running' ? 'border-sky-500/30 bg-sky-500/5'
                    : 'border-slate-700/50'
                }`}
              >
                <div>
                  <span className={`text-sm font-medium ${
                    task.status === 'done' ? 'text-emerald-400'
                      : task.status === 'error' ? 'text-rose-400'
                      : 'text-slate-300'
                  }`}>
                    {task.name === 'drafts' ? taskNames('drafts') : taskNames(task.id)}
                  </span>
                  {task.message && (
                    <div className="text-xs text-slate-500 mt-1">{task.message}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-none">
                  {task.status === 'pending' && <Clock className="w-5 h-5 text-slate-600" />}
                  {task.status === 'running' && <Loader2 className="w-5 h-5 animate-spin text-sky-400" />}
                  {task.status === 'done' && <Check className="w-5 h-5 text-emerald-500" />}
                  {task.status === 'blocked' && (
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('محظور', 'Bloqué', 'Blocked')}</span>
                  )}
                  {task.status === 'error' && (
                    <span className="px-2 py-1 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded text-xs font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {t('فشل', 'Échec', 'FAIL')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
