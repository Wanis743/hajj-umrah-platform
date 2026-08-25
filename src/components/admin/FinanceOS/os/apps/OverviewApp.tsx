import React, { useMemo } from 'react';
import {
  ArrowRight, Banknote, BookOpen, Scale, CalendarClock, Wallet,
  TrendingUp, AlertTriangle, CheckCircle2, Zap,
} from 'lucide-react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { money } from '@/lib/currency';
import type { BankTransactionRow, FiscalPeriodRow, GenericRow, PaymentRow } from '@/types/database';
import { APPS } from '../apps';
import { useOS } from '../OSContext';

const QUICK_LAUNCH = ['journal', 'ledger', 'reconcile', 'close', 'reports', 'modeling'];

/**
 * The Cockpit — the desktop's home application. Every figure is computed from
 * live Supabase tables; when the ledger is empty the app says so, per the
 * platform's zero-fake-business-data rule.
 */
export function OverviewApp() {
  const { openApp, tr, lang } = useOS();
  const locale = lang === 'ar' || lang === 'dz' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';

  const { data: payments, loading: paymentsLoading } = useSupabaseData<PaymentRow>({
    table: 'payments', columns: 'id,amount_dzd,method,status,received_at,created_at', limit: 500,
  });
  const { data: journals, loading: journalsLoading } = useSupabaseData<GenericRow>({
    table: 'journal_entries', columns: 'id,reference,description,status,entry_date,created_at',
    orderBy: { column: 'created_at', ascending: false }, limit: 500,
  });
  const { data: bankTx, loading: txLoading } = useSupabaseData<BankTransactionRow>({
    table: 'bank_transactions', columns: 'id,status', limit: 500,
  });
  const { data: periods, loading: periodsLoading } = useSupabaseData<FiscalPeriodRow>({
    table: 'fiscal_periods', columns: 'id,label,status,start_date,end_date',
    orderBy: { column: 'start_date', ascending: false },
  });
  const { data: accounts, loading: accountsLoading } = useSupabaseData<GenericRow>({
    table: 'chart_of_accounts', columns: 'id', limit: 500,
  });

  const loading = paymentsLoading || journalsLoading || txLoading || periodsLoading || accountsLoading;

  const cashCollected = useMemo(
    () => payments.reduce((sum, p) => sum + Number(p.amount_dzd ?? 0), 0),
    [payments],
  );
  const draftCount = useMemo(
    () => journals.filter((j) => j.status === 'DRAFT' || j.status === 'PENDING').length,
    [journals],
  );
  const postedCount = useMemo(
    () => journals.filter((j) => j.status === 'POSTED').length,
    [journals],
  );
  const unmatched = useMemo(() => bankTx.filter((t) => t.status === 'UNMATCHED').length, [bankTx]);
  const openPeriod = useMemo(() => periods.find((p) => p.status === 'OPEN') ?? null, [periods]);

  // Last-6-months collections for the mini bar chart (real rows only).
  const monthly = useMemo(() => {
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - i));
      return {
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString(locale, { month: 'short' }),
        total: 0,
      };
    });
    for (const p of payments) {
      const raw = p.received_at ?? p.created_at;
      if (!raw) continue;
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) continue;
      const bucket = buckets.find((b) => b.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (bucket) bucket.total += Number(p.amount_dzd ?? 0);
    }
    return buckets;
  }, [payments, locale]);

  const maxMonthly = Math.max(0, ...monthly.map((m) => m.total));

  const recentJournals = journals.slice(0, 5);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {tr('غرفة القيادة المالية', 'Cockpit financier', 'Financial Cockpit')}
          </h3>
          <p className="text-xs text-white/45">
            {tr('كل الأرقام محسوبة مباشرة من الدفاتر', 'Calculé en direct du grand livre', 'Every figure computed live from the ledger')}
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          {tr('مباشر', 'EN DIRECT', 'LIVE')}
        </span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<Banknote className="h-4 w-4 text-emerald-400" />}
          label={tr('المقبوضات (دج)', 'Encaissements (DZD)', 'Collected (DZD)')}
          value={loading ? '…' : cashCollected > 0 ? money(cashCollected, 'DZD') : money(0, 'DZD')}
          sub={tr(`${payments.length} عملية دفع`, `${payments.length} paiements`, `${payments.length} payment${payments.length === 1 ? '' : 's'}`)}
          onClick={() => openApp('reports')}
        />
        <KpiCard
          icon={<BookOpen className="h-4 w-4 text-indigo-400" />}
          label={tr('قيود مرحّلة', 'Écritures validées', 'Posted entries')}
          value={loading ? '…' : String(postedCount)}
          sub={draftCount > 0
            ? tr(`${draftCount} بانتظار الترحيل`, `${draftCount} en brouillon`, `${draftCount} awaiting posting`)
            : tr('لا شيء معلق', 'Rien en attente', 'Nothing pending')}
          warn={draftCount > 0}
          onClick={() => openApp('journal')}
        />
        <KpiCard
          icon={<Scale className="h-4 w-4 text-purple-400" />}
          label={tr('أسطر غير مطابقة', 'Lignes non rapprochées', 'Unmatched bank lines')}
          value={loading ? '…' : String(unmatched)}
          sub={unmatched > 0
            ? tr('تحتاج مراجعة', 'À revoir', 'Needs review')
            : tr('التسوية مكتملة', 'Rapprochement à jour', 'Reconciliation is clean')}
          warn={unmatched > 0}
          onClick={() => openApp('reconcile')}
        />
        <KpiCard
          icon={<CalendarClock className="h-4 w-4 text-amber-400" />}
          label={tr('الفترة المالية', 'Période fiscale', 'Fiscal period')}
          value={loading ? '…' : openPeriod?.label ?? tr('لا يوجد', 'Aucune', 'None open')}
          sub={openPeriod
            ? tr('مفتوحة للترحيل', 'Ouverte à la saisie', 'Open for posting')
            : tr('كل الفترات مغلقة', 'Toutes clôturées', 'All periods closed')}
          onClick={() => openApp('close')}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-5">
        {/* Collections chart */}
        <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white/85">
              <TrendingUp className="h-4 w-4 text-indigo-400" />
              {tr('المقبوضات — آخر 6 أشهر', 'Encaissements — 6 derniers mois', 'Collections — last 6 months')}
            </h4>
            <span className="text-[11px] text-white/35">DZD</span>
          </div>
          <div className="flex min-h-[140px] flex-1 items-end justify-stretch gap-2">
            {monthly.map((m) => (
              <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <div className="flex h-[110px] w-full items-end justify-center">
                  <div
                    className="w-full max-w-[42px] rounded-t-md bg-gradient-to-t from-indigo-600/70 to-indigo-400/80 transition-all"
                    style={{
                      height: m.total > 0 && maxMonthly > 0
                        ? `${Math.max(6, Math.round((m.total / maxMonthly) * 104))}px`
                        : '2px',
                      opacity: m.total > 0 ? 1 : 0.25,
                    }}
                    title={`${m.label}: ${money(m.total, 'DZD')}`}
                  />
                </div>
                <span className="truncate text-[10px] uppercase tracking-wide text-white/40">{m.label}</span>
              </div>
            ))}
          </div>
          {maxMonthly === 0 && !loading && (
            <p className="mt-2 text-center text-[11px] text-white/35">
              {tr('لا توجد مقبوضات مسجلة خلال هذه الفترة.', 'Aucun encaissement sur la période.', 'No collections recorded in this window.')}
            </p>
          )}
        </div>

        {/* Attention list */}
        <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4 lg:col-span-2">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/85">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            {tr('يتطلب انتباهك', 'Points d’attention', 'Needs your attention')}
          </h4>
          <div className="space-y-2">
            {draftCount === 0 && unmatched === 0 && !loading && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 flex-none" />
                {tr('كل شيء نظيف — لا مهام معلقة.', 'Tout est propre — rien en attente.', 'Everything is clean — nothing outstanding.')}
              </div>
            )}
            {draftCount > 0 && (
              <AttentionRow
                onClick={() => openApp('journal')}
                tone="amber"
                title={tr('رحّل القيود المسودة', 'Valider les brouillons', 'Post draft journals')}
                body={tr(`${draftCount} قيد يمنع الإقفال`, `${draftCount} écriture(s) bloquent la clôture`, `${draftCount} entr${draftCount > 1 ? 'ies' : 'y'} blocking the close`)}
              />
            )}
            {unmatched > 0 && (
              <AttentionRow
                onClick={() => openApp('reconcile')}
                tone="purple"
                title={tr('طابق الأسطر البنكية', 'Rapprocher les lignes', 'Match bank lines')}
                body={tr(`${unmatched} سطر غير مطابق`, `${unmatched} ligne(s) non rapprochée(s)`, `${unmatched} unmatched line${unmatched > 1 ? 's' : ''}`)}
              />
            )}
          </div>

          {/* Quick launch */}
          <div className="mt-auto pt-4">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
              <Zap className="h-3 w-3" />
              {tr('تشغيل سريع', 'Lancement rapide', 'Quick launch')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_LAUNCH.map((id) => {
                const app = APPS.find((a) => a.id === id);
                if (!app) return null;
                const Icon = app.icon;
                return (
                  <button
                    key={id}
                    onClick={() => openApp(id)}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <Icon className="h-3 w-3" />
                    {tr(app.title.ar, app.title.fr, app.title.en)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Recent journals + accounts footer */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Wallet className="h-4 w-4 flex-none text-white/40" />
          <span className="truncate text-xs text-white/55">
            {loading
              ? tr('جاري القراءة من الدفاتر…', 'Lecture du grand livre…', 'Reading the ledger…')
              : tr(
                `${accounts.length} حساباً في الدليل · ${journals.length} قيداً مسجلاً`,
                `${accounts.length} comptes · ${journals.length} écritures`,
                `${accounts.length} ledger accounts · ${journals.length} journal entries on record`,
              )}
          </span>
        </div>
        <button
          onClick={() => openApp(recentJournals.length > 0 ? 'journal' : 'ledger')}
          className="flex flex-none items-center gap-1 text-xs font-semibold text-indigo-300 transition-colors hover:text-indigo-200"
        >
          {tr('فتح الدفاتر', 'Ouvrir le journal', 'Open the books')}
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, warn, onClick }: {
  icon: React.ReactNode; label: string; value: string; sub: string; warn?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-start transition-colors hover:border-white/20 hover:bg-white/[0.06]"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">{icon}</span>
        {warn && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
      </div>
      <div className="mt-2.5 truncate text-lg font-semibold tabular-nums text-white">{value}</div>
      <div className="truncate text-[11px] text-white/40">{label}</div>
      <div className={`mt-1 truncate text-[10px] ${warn ? 'text-amber-400/90' : 'text-white/35'}`}>{sub}</div>
    </button>
  );
}

function AttentionRow({ onClick, tone, title, body }: {
  onClick: () => void; tone: 'amber' | 'purple'; title: string; body: string;
}) {
  const color = tone === 'amber'
    ? 'border-amber-500/25 bg-amber-500/10 text-amber-200'
    : 'border-purple-500/25 bg-purple-500/10 text-purple-200';
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-start text-xs transition-opacity hover:opacity-85 ${color}`}
    >
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block opacity-70">{body}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 flex-none rtl:rotate-180" />
    </button>
  );
}
