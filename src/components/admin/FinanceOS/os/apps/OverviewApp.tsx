import React, { useMemo } from 'react';
import {
  ArrowRight, Banknote, BookOpen, Scale,
} from 'lucide-react';
import { Area, AreaChart } from '@/components/charts/area-chart';
import { Grid } from '@/components/charts/grid';
import { ChartTooltip, TooltipContent } from '@/components/charts/tooltip';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { money } from '@/lib/currency';
import type { BankTransactionRow, FiscalPeriodRow, GenericRow, PaymentRow } from '@/types/database';
import { useOS } from '../OSContext';

/**
 * The Overview — a plain summary of what is in the ledger and what still
 * needs doing. Every figure comes from live Supabase tables; an empty
 * ledger shows an honest empty state (zero-fake-data rule).
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

  const monthly = useMemo(() => {
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - i));
      return {
        key: `${d.getFullYear()}-${d.getMonth()}`,
        date: new Date(d.getTime()),
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
  }, [payments]);

  const monthlySeries = useMemo(
    () => monthly.map((m) => ({ date: m.date, total: m.total })),
    [monthly],
  );
  const maxMonthly = Math.max(0, ...monthly.map((m) => m.total));
  const recentJournals = journals.slice(0, 6);
  const hasData = journals.length > 0 || payments.length > 0 || accounts.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Plain document-style header */}
      <div className="border-b border-white/10 pb-3">
        <h3 className="text-base font-semibold text-white">
          {tr('نظرة عامة على الدفاتر', 'Vue d’ensemble du grand livre', 'Ledger overview')}
        </h3>
        <p className="mt-0.5 text-xs text-white/45">
          {loading
            ? tr('جاري القراءة…', 'Chargement…', 'Loading…')
            : tr(
              `${accounts.length} حساباً · ${journals.length} قيداً · ${payments.length} عملية دفع`,
              `${accounts.length} comptes · ${journals.length} écritures · ${payments.length} paiements`,
              `${accounts.length} accounts · ${journals.length} journal entries · ${payments.length} payments`,
            )}
        </p>
      </div>

      {!hasData && !loading ? (
        <EmptyLedger onOpenLedger={() => openApp('ledger')} tr={tr} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 pt-1 lg:grid-cols-2">
          {/* Facts table — plain rows, not KPI tiles */}
          <div className="min-h-0 overflow-auto lg:border-e lg:border-white/10 lg:pe-4">
            <SectionLabel>{tr('الوضعية', 'Situation', 'Position')}</SectionLabel>
            <dl className="divide-y divide-white/5">
              <FactRow
                icon={<Banknote className="h-3.5 w-3.5" />}
                label={tr('إجمالي المقبوضات', 'Total des encaissements', 'Total collected')}
                value={loading ? '…' : money(cashCollected, 'DZD')}
                onOpen={() => openApp('reports')}
              />
              <FactRow
                icon={<BookOpen className="h-3.5 w-3.5" />}
                label={tr('قيود مرحّلة', 'Écritures validées', 'Posted entries')}
                value={loading ? '…' : String(postedCount)}
                onOpen={() => openApp('journal')}
              />
              <FactRow
                icon={<Scale className="h-3.5 w-3.5" />}
                label={tr('الفترة المفتوحة', 'Période ouverte', 'Open period')}
                value={loading ? '…' : openPeriod?.label ?? tr('لا يوجد', 'Aucune', 'None')}
                onOpen={() => openApp('close')}
              />
            </dl>

            <SectionLabel>{tr('يستوجب المتابعة', 'À traiter', 'Outstanding')}</SectionLabel>
            {draftCount === 0 && unmatched === 0 && !loading ? (
              <p className="px-1 py-2 text-xs text-white/40">
                {tr('لا شيء معلق.', 'Rien en attente.', 'Nothing outstanding.')}
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {draftCount > 0 && (
                  <TaskRow
                    count={draftCount}
                    label={tr('قيود مسودة بانتظار الترحيل', 'écritures brouillon à valider', 'draft entries awaiting posting')}
                    onOpen={() => openApp('journal')}
                    openLabel={tr('فتح اليومية', 'Ouvrir le journal', 'Open journal')}
                  />
                )}
                {unmatched > 0 && (
                  <TaskRow
                    count={unmatched}
                    label={tr('أسطر بنكية غير مطابقة', 'lignes bancaires non rapprochées', 'unmatched bank lines')}
                    onOpen={() => openApp('reconcile')}
                    openLabel={tr('فتح التسوية', 'Ouvrir le rapprochement', 'Open reconciliation')}
                  />
                )}
              </ul>
            )}

            {/* Collections — live ledger sums over the last 6 months (bklit Area chart) */}
            <SectionLabel>{tr('المقبوضات الشهرية (دج)', 'Encaissements mensuels (DZD)', 'Monthly collections (DZD)')}</SectionLabel>
            <MonthlyCollections
              empty={!paymentsLoading && maxMonthly <= 0}
              loading={paymentsLoading}
              locale={locale}
              series={monthlySeries}
              tr={tr}
            />
          </div>

          {/* Recent entries register */}
          <div className="mt-4 flex min-h-0 flex-col lg:mt-0 lg:ps-4">
            <div className="flex items-center justify-between">
              <SectionLabel>{tr('آخر القيود', 'Dernières écritures', 'Recent entries')}</SectionLabel>
              <button
                onClick={() => openApp('journal')}
                className="mb-2 flex items-center gap-1 text-[11px] font-medium text-white/50 transition-colors hover:text-white/85"
              >
                {tr('الكل', 'Tout', 'View all')}
                <ArrowRight className="h-3 w-3 rtl:rotate-180" />
              </button>
            </div>
            <RecentEntries locale={locale} rows={recentJournals} tr={tr} />
          </div>
        </div>
      )}
    </div>
  );
}

type Tr = (ar: string, fr: string, en: string) => string;

function EmptyLedger({ onOpenLedger, tr }: { onOpenLedger: () => void; tr: Tr }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <BookOpen className="h-8 w-8 text-white/20" strokeWidth={1.5} />
      <div>
        <p className="text-sm font-medium text-white/70">
          {tr('الدفاتر فارغة حالياً', 'Le grand livre est vide', 'The ledger is empty')}
        </p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/40">
          {tr(
            'ابدأ بإنشاء دليل الحسابات ثم سجّل أول قيد يومية.',
            'Commencez par le plan comptable, puis saisissez la première écriture.',
            'Start with the chart of accounts, then record the first journal entry.',
          )}
        </p>
      </div>
      <button
        onClick={onOpenLedger}
        className="btn btn-sm btn-primary mt-1"
      >
        {tr('فتح دليل الحسابات', 'Ouvrir le plan comptable', 'Open chart of accounts')}
      </button>
    </div>
  );
}

/** Last-6-month collections summed from live payment rows — bklit time-series chart. */
function MonthlyCollections({
  empty, loading, locale, series, tr,
}: {
  empty: boolean;
  loading: boolean;
  locale: string;
  series: { date: Date; total: number }[];
  tr: Tr;
}) {
  if (empty) {
    return (
      <p className="px-1 py-2 text-xs text-white/40">
        {tr(
          'لا مقبوضات مسجلة في هذه الفترة.',
          'Aucun encaissement sur cette période.',
          'No collections recorded in this window.',
        )}
      </p>
    );
  }
  return (
    <div dir="ltr" className="me-1 mt-1">
      <AreaChart
        aspectRatio="2.4 / 1"
        data={series}
        margin={{ top: 12, right: 12, bottom: 28, left: 44 }}
        status={loading ? 'loading' : 'ready'}
      >
        <Grid numTicksRows={3} />
        <Area dataKey="total" fill="var(--chart-line-primary)" fillOpacity={0.22} />
        <XAxis numTicks={6} />
        <YAxis numTicks={3} />
        <ChartTooltip
          content={({ point }) => (
            <TooltipContent
              rows={[{
                color: 'var(--chart-line-primary)',
                label: tr('المقبوضات', 'Encaissements', 'Collections'),
                value: money(Number(point.total ?? 0), 'DZD'),
              }]}
              title={point.date instanceof Date
                ? point.date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
                : undefined}
            />
          )}
          showDatePill={false}
        />
      </AreaChart>
    </div>
  );
}

function RecentEntries({ locale, rows, tr }: { locale: string; rows: GenericRow[]; tr: Tr }) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-white/40">
        {tr('لا قيود بعد.', 'Aucune écriture.', 'No entries yet.')}
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10 text-start text-[10px] uppercase tracking-wider text-white/35">
            <th className="py-1.5 ps-1 text-start font-medium">{tr('المرجع', 'Référence', 'Reference')}</th>
            <th className="py-1.5 text-start font-medium">{tr('البيان', 'Libellé', 'Description')}</th>
            <th className="py-1.5 text-start font-medium">{tr('التاريخ', 'Date', 'Date')}</th>
            <th className="py-1.5 pe-1 text-end font-medium">{tr('الحالة', 'Statut', 'Status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((j) => {
            const status = String(j.status ?? '');
            const date = j.entry_date ?? j.created_at;
            return (
              <tr key={j.id} className="transition-colors hover:bg-white/[0.03]">
                <td className="py-2 ps-1 font-mono text-[11px] text-white/70">{String(j.reference ?? j.id.slice(0, 8))}</td>
                <td className="max-w-[160px] truncate py-2 text-white/60">{String(j.description ?? '—')}</td>
                <td className="py-2 tabular-nums text-white/50">
                  {date ? new Date(String(date)).toLocaleDateString(locale) : '—'}
                </td>
                <td className="py-2 pe-1 text-end">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    status === 'POSTED'
                      ? 'bg-emerald-500/10 text-emerald-300/90'
                      : status === 'VOID'
                        ? 'bg-white/5 text-white/40'
                        : 'bg-amber-500/10 text-amber-300/90'
                  }`}>
                    {status === 'POSTED'
                      ? tr('مرحّل', 'Validée', 'Posted')
                      : status === 'VOID'
                        ? tr('ملغى', 'Annulée', 'Void')
                        : tr('مسودة', 'Brouillon', 'Draft')}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35 first:mt-1">
      {children}
    </div>
  );
}

function FactRow({ icon, label, value, onOpen }: {
  icon: React.ReactNode; label: string; value: string; onOpen: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex items-center gap-2 text-xs text-white/55">
        <span className="text-white/35">{icon}</span>
        {label}
      </dt>
      <dd>
        <button
          onClick={onOpen}
          className="text-sm font-semibold tabular-nums text-white transition-opacity hover:opacity-70"
          title={label}
        >
          {value}
        </button>
      </dd>
    </div>
  );
}

function TaskRow({ count, label, onOpen, openLabel }: {
  count: number; label: string; onOpen: () => void; openLabel: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-baseline gap-2 text-xs text-white/70">
        <span className="text-sm font-semibold tabular-nums text-amber-300/90">{count}</span>
        {label}
      </span>
      <button
        onClick={onOpen}
        className="flex flex-none items-center gap-1 text-[11px] font-medium text-white/50 transition-colors hover:text-white/85"
      >
        {openLabel}
        <ArrowRight className="h-3 w-3 rtl:rotate-180" />
      </button>
    </li>
  );
}
