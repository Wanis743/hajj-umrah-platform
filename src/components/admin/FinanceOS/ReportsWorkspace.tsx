import React, { useEffect, useMemo, useState } from 'react';
import {
  FileBarChart, Download, Lock, Loader2, PieChart, Scale, Coins,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useI18n } from '@/i18n/I18nProvider';
import { money } from '@/lib/currency';
import type { ChartOfAccountRow } from '@/types/database';

type StatementKind = 'pnl' | 'balance' | 'cashvar';

type PeriodKey = 'mtd' | 'last-month' | 'ytd' | 'all';

interface EntryRow { id: string; entry_date: string }
interface LineRow { journal_entry_id: string; account_id: string; debit: number; credit: number; currency_code: string }

/** Account totals for a single currency, keyed by account id. */
type Totals = Map<string, { debit: number; credit: number }>;

function periodRange(key: PeriodKey): { from: string | null; to: string | null; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (key) {
    case 'mtd': return { from: iso(new Date(y, m, 1)), to: null, label: `${y}-${String(m + 1).padStart(2, '0')}` };
    case 'last-month': {
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0);
      return { from: iso(first), to: iso(last), label: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}` };
    }
    case 'ytd': return { from: `${y}-01-01`, to: null, label: `${y}` };
    default: return { from: null, to: null, label: 'all' };
  }
}

/**
 * Statements — the old static card grid with dead download buttons replaced by
 * a real generator: P&L, Balance Sheet and Account Activity, all computed from
 * POSTED journal lines, per currency, with one-click CSV export.
 */
export function ReportsWorkspace() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : lang === 'fr' ? fr : en);

  const [statement, setStatement] = useState<StatementKind>('pnl');
  const [period, setPeriod] = useState<PeriodKey>('mtd');
  const [currency, setCurrency] = useState<string>('DZD');

  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { data: accounts } = useSupabaseData<ChartOfAccountRow>({
    table: 'chart_of_accounts',
    columns: 'id,code,name,account_type,currency_code',
    orderBy: { column: 'code', ascending: true },
    limit: 500,
  });

  const range = periodRange(period);

  // Fetch posted entries for the range, then their lines. Chunked `in` keeps
  // this correct even when a busy period has thousands of entries.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        let q = supabase
          .from('journal_entries')
          .select('id,entry_date')
          .eq('status', 'POSTED')
          .order('entry_date', { ascending: true })
          .limit(2000);
        if (range.from) q = q.gte('entry_date', range.from);
        if (range.to) q = q.lte('entry_date', range.to);
        const { data: entryRows, error: e1 } = await q;
        if (e1) throw e1;
        const es = (entryRows ?? []) as EntryRow[];
        if (cancelled) return;
        setEntries(es);
        if (es.length === 0) { setLines([]); setLoading(false); return; }

        const collected: LineRow[] = [];
        for (let i = 0; i < es.length; i += 400) {
          const chunk = es.slice(i, i + 400).map((r) => r.id);
          const { data: ls, error: e2 } = await supabase
            .from('journal_lines')
            .select('journal_entry_id,account_id,debit,credit,currency_code')
            .in('journal_entry_id', chunk)
            .limit(5000);
          if (e2) throw e2;
          collected.push(...((ls ?? []) as LineRow[]));
        }
        if (!cancelled) setLines(collected);
      } catch (e: unknown) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) set.add(l.currency_code || 'DZD');
    if (set.size === 0) set.add('DZD');
    return Array.from(set).sort();
  }, [lines]);

  useEffect(() => {
    if (!currencies.includes(currency)) setCurrency(currencies[0]);
  }, [currencies, currency]);

  const totals = useMemo<Totals>(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    for (const l of lines) {
      if ((l.currency_code || 'DZD') !== currency) continue;
      const cur = map.get(l.account_id) ?? { debit: 0, credit: 0 };
      cur.debit += Number(l.debit ?? 0);
      cur.credit += Number(l.credit ?? 0);
      map.set(l.account_id, cur);
    }
    return map;
  }, [lines, currency]);

  /** Net amount in the account's "normal" direction (statement sign convention). */
  const net = (accountId: string, type: string): number => {
    const tot = totals.get(accountId);
    if (!tot) return 0;
    return type === 'ASSET' || type === 'EXPENSE'
      ? tot.debit - tot.credit
      : tot.credit - tot.debit;
  };

  const accountsByType = (type: string) =>
    accounts.filter((a) => String(a.account_type ?? '').toUpperCase() === type);

  const revenueRows = accountsByType('REVENUE').map((a) => ({ a, amount: net(a.id, 'REVENUE') })).filter((r) => r.amount !== 0);
  const expenseRows = accountsByType('EXPENSE').map((a) => ({ a, amount: net(a.id, 'EXPENSE') })).filter((r) => r.amount !== 0);
  const assetRows = accountsByType('ASSET').map((a) => ({ a, amount: net(a.id, 'ASSET') })).filter((r) => r.amount !== 0);
  const liabilityRows = accountsByType('LIABILITY').map((a) => ({ a, amount: net(a.id, 'LIABILITY') })).filter((r) => r.amount !== 0);
  const equityRows = accountsByType('EQUITY').map((a) => ({ a, amount: net(a.id, 'EQUITY') })).filter((r) => r.amount !== 0);

  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);
  const netIncome = totalRevenue - totalExpense;
  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equityRows.reduce((s, r) => s + r.amount, 0);
  const equitySide = totalLiabilities + totalEquity + netIncome;

  const activityRows = useMemo(() => {
    const arr: { a: ChartOfAccountRow; debit: number; credit: number; net: number }[] = [];
    for (const a of accounts) {
      const tot = totals.get(a.id);
      if (!tot || (tot.debit === 0 && tot.credit === 0)) continue;
      const type = String(a.account_type ?? 'ASSET').toUpperCase();
      arr.push({
        a,
        debit: tot.debit,
        credit: tot.credit,
        net: type === 'ASSET' || type === 'EXPENSE' ? tot.debit - tot.credit : tot.credit - tot.debit,
      });
    }
    return arr.sort((x, y) => String(x.a.code ?? '').localeCompare(String(y.a.code ?? '')));
  }, [accounts, totals]);

  const exportCsv = () => {
    const rows: string[][] = [['statement', 'period', 'currency', 'section', 'code', 'account', 'amount']];
    const periodName = range.label;
    const push = (section: string, code: string, name: string, amount: number) =>
      rows.push([statement, periodName, currency, section, code, name, amount.toFixed(2)]);
    if (statement === 'pnl') {
      revenueRows.forEach((r) => push('revenue', String(r.a.code ?? ''), String(r.a.name ?? ''), r.amount));
      push('revenue_total', '', '', totalRevenue);
      expenseRows.forEach((r) => push('expense', String(r.a.code ?? ''), String(r.a.name ?? ''), r.amount));
      push('expense_total', '', '', totalExpense);
      push('net_income', '', '', netIncome);
    } else if (statement === 'balance') {
      assetRows.forEach((r) => push('assets', String(r.a.code ?? ''), String(r.a.name ?? ''), r.amount));
      push('assets_total', '', '', totalAssets);
      liabilityRows.forEach((r) => push('liabilities', String(r.a.code ?? ''), String(r.a.name ?? ''), r.amount));
      equityRows.forEach((r) => push('equity', String(r.a.code ?? ''), String(r.a.name ?? ''), r.amount));
      push('net_income_current', '', '', netIncome);
      push('liabilities_equity_total', '', '', equitySide);
    } else {
      activityRows.forEach((r) => push('activity', String(r.a.code ?? ''), String(r.a.name ?? ''), r.net));
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${statement}_${periodName}_${currency}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('تم تصدير الملف', 'Fichier exporté', 'CSV exported'));
  };

  const STATEMENTS: { id: StatementKind; label: string; icon: React.ReactNode }[] = [
    { id: 'pnl', label: t('قائمة الدخل', 'Compte de résultat', 'Profit & Loss'), icon: <PieChart className="h-4 w-4" /> },
    { id: 'balance', label: t('الميزانية العمومية', 'Bilan', 'Balance Sheet'), icon: <Scale className="h-4 w-4" /> },
    { id: 'cashvar', label: t('حركة الحسابات', 'Activité des comptes', 'Account Activity'), icon: <Coins className="h-4 w-4" /> },
  ];
  const PERIODS: { id: PeriodKey; label: string }[] = [
    { id: 'mtd', label: t('هذا الشهر', 'Mois courant', 'This month') },
    { id: 'last-month', label: t('الشهر الماضي', 'Mois dernier', 'Last month') },
    { id: 'ytd', label: t('منذ بداية السنة', 'Depuis janvier', 'Year to date') },
    { id: 'all', label: t('كل الفترات', 'Tout', 'All time') },
  ];

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Toolbar — window titlebar already names the app */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-muted)]">
          {t('من القيود المرحّلة فقط', 'Écritures validées uniquement', 'Posted entries only')}
        </p>
        <div className="flex items-center gap-2">
          {/* Currency chips — only currencies that actually appear in the lines */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {currencies.map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  currency === c ? 'bg-[var(--brand-500)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            onClick={exportCsv}
            disabled={loading || lines.length === 0}
            className="btn btn-sm btn-primary flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            {t('تصدير CSV', 'Exporter CSV', 'Export CSV')}
          </button>
        </div>
      </div>

      {/* Statement type + period pickers */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
          {STATEMENTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatement(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                statement === s.id ? 'bg-[var(--brand-500)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                period === p.id ? 'bg-white/15 text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--text-muted)] ms-auto">
          {t(
            `${entries.length} قيداً مرحلاً · ${range.label}`,
            `${entries.length} écritures validées · ${range.label}`,
            `${entries.length} posted entries · ${range.label}`,
          )}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl overflow-y-auto p-5">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <Loader2 className="h-6 w-6 animate-spin" />
            {t('جاري حساب البيان من الدفاتر…', 'Calcul des états…', 'Computing statements from the ledger…')}
          </div>
        ) : loadError ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
            <Lock className="h-8 w-8 text-rose-400 opacity-60" />
            <p className="text-sm text-[var(--text-muted)] max-w-md">{loadError}</p>
          </div>
        ) : lines.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-[var(--text-muted)]">
            <FileBarChart className="h-10 w-10 opacity-20" />
            <p className="text-sm">
              {t(
                'لا توجد قيود مرحّلة في هذه الفترة — البيان يظهر بمجرد ترحيل القيود.',
                'Aucune écriture validée sur cette période — les états apparaîtront dès validation.',
                'No posted entries in this period — statements appear once entries are posted.',
              )}
            </p>
          </div>
        ) : statement === 'pnl' ? (
          <div className="max-w-2xl mx-auto space-y-6">
            <StatementSection title={t('الإيرادات', 'Produits', 'Revenue')} rows={revenueRows} total={totalRevenue} currency={currency} t={t} />
            <StatementSection title={t('المصروفات', 'Charges', 'Expenses')} rows={expenseRows} total={totalExpense} currency={currency} t={t} />
            <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
              netIncome >= 0 ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'
            }`}>
              <span className="font-semibold text-white">{t('صافي الدخل', 'Résultat net', 'Net income')}</span>
              <span className={`font-mono text-lg font-bold ${netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {money(netIncome, currency)}
              </span>
            </div>
          </div>
        ) : statement === 'balance' ? (
          <div className="max-w-2xl mx-auto space-y-6">
            <StatementSection title={t('الأصول', 'Actifs', 'Assets')} rows={assetRows} total={totalAssets} currency={currency} t={t} />
            <StatementSection title={t('الخصوم', 'Passifs', 'Liabilities')} rows={liabilityRows} total={totalLiabilities} currency={currency} t={t} />
            <StatementSection title={t('حقوق الملكية', 'Capitaux propres', 'Equity')} rows={equityRows} total={totalEquity} currency={currency} t={t} />
            <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-[var(--text-secondary)]">{t('صافي دخل الفترة', 'Résultat de la période', 'Current-period net income')}</span>
                <span className={`font-mono font-semibold ${netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{money(netIncome, currency)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 text-sm font-semibold">
                <span className="text-white">{t('إجمالي الخصوم وحقوق الملكية', 'Total passif + capitaux', 'Total liabilities & equity')}</span>
                <span className="font-mono text-white">{money(equitySide, currency)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-[var(--text-secondary)]">{t('فرق التوازن', 'Écart d’équilibre', 'Balance check')}</span>
                <span className={`font-mono font-semibold ${Math.abs(totalAssets - equitySide) < 0.01 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {money(totalAssets - equitySide, currency)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-start">{t('الحساب', 'Compte', 'Account')}</th>
                    <th className="px-4 py-2.5 text-end">{t('مدين', 'Débit', 'Debit')}</th>
                    <th className="px-4 py-2.5 text-end">{t('دائن', 'Crédit', 'Credit')}</th>
                    <th className="px-4 py-2.5 text-end">{t('الصافي', 'Net', 'Net')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {activityRows.map((r) => (
                    <tr key={r.a.id}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-[var(--text-primary)]">{r.a.name}</span>
                        <span className="ms-2 font-mono text-[10px] text-[var(--text-muted)]">{r.a.code}</span>
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono text-[var(--text-secondary)]">{money(r.debit, currency)}</td>
                      <td className="px-4 py-2.5 text-end font-mono text-[var(--text-secondary)]">{money(r.credit, currency)}</td>
                      <td className={`px-4 py-2.5 text-end font-mono font-semibold ${r.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {money(r.net, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatementSection({ title, rows, total, currency, t }: {
  title: string;
  rows: { a: ChartOfAccountRow; amount: number }[];
  total: number;
  currency: string;
  t: (ar: string, fr: string, en: string) => string;
}) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">{title}</h4>
      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-sm text-[var(--text-muted)]">
            {t('لا حركة في هذه الفترة', 'Aucun mouvement sur la période', 'No activity this period')}
          </div>
        ) : rows.map((r) => (
          <div key={r.a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-[var(--text-primary)]">
              {r.a.name}
              <span className="ms-2 font-mono text-[10px] text-[var(--text-muted)]">{r.a.code}</span>
            </span>
            <span className="font-mono text-[var(--text-secondary)]">{money(r.amount, currency)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold">
          <span className="text-white">{t('الإجمالي', 'Total', 'Total')}</span>
          <span className="font-mono text-white">{money(total, currency)}</span>
        </div>
      </div>
    </section>
  );
}
