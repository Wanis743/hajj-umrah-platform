import React, { useState, useEffect } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/currency';
import { BarChart2, Plus, Target, CheckCircle2, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  FiscalPeriodRow,
  FiscalBudgetRow,
  BudgetLineRow,
  ChartOfAccountRow,
} from '@/types/database';

/** Row contract of the `get_budget_variance` RPC (RETURNS JSONB array; planning_engine.sql). */
interface BudgetVarianceRow {
  account_id: string;
  code: string;
  name: string;
  type: string;
  budgeted_dzd: number;
  actual_dzd: number;
  variance_dzd: number;
  variance_pct: number;
}

function isBudgetVarianceRow(value: unknown): value is BudgetVarianceRow {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['account_id'] === 'string' &&
    typeof v['code'] === 'string' &&
    typeof v['actual_dzd'] === 'number' &&
    typeof v['budgeted_dzd'] === 'number' &&
    typeof v['variance_dzd'] === 'number'
  );
}

export function PlanningWorkspace() {
  const { lang } = useI18n();
  const { session } = useAuth();
  const t = (ar: string, fr: string, en: string) => lang === 'ar' ? ar : lang === 'fr' ? fr : en;

  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [periods, setPeriods] = useState<FiscalPeriodRow[]>([]);
  const [activePeriod, setActivePeriod] = useState<FiscalPeriodRow | null>(null);

  const [budgets, setBudgets] = useState<FiscalBudgetRow[]>([]);
  const [activeBudget, setActiveBudget] = useState<FiscalBudgetRow | null>(null);

  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [budgetLines, setBudgetLines] = useState<Record<string, number>>({});
  const [variance, setVariance] = useState<BudgetVarianceRow[]>([]);

  const [newBudgetName, setNewBudgetName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAgency = async () => {
      if (!session?.user?.id) return;
      const { data } = await supabase.from('staff_profiles').select('agency_id').eq('user_id', session.user.id).single();
      if (data?.agency_id) setAgencyId(String(data.agency_id));
    };
    fetchAgency();
  }, [session?.user?.id]);

  useEffect(() => {
    if (agencyId) {
      fetchPeriods();
      fetchAccounts();
    }
  }, [agencyId]);

  const fetchPeriods = async () => {
    const { data } = await supabase.from('fiscal_periods').select('*').eq('agency_id', String(agencyId)).order('start_date', { ascending: false });
    setPeriods(data || []);
  };

  const fetchAccounts = async () => {
    const { data } = await supabase.from('chart_of_accounts').select('*').eq('agency_id', String(agencyId)).order('code', { ascending: true });
    setAccounts(data || []);
  };

  const loadPeriod = async (period: FiscalPeriodRow) => {
    setActivePeriod(period);
    const { data } = await supabase.from('fiscal_budgets').select('*').eq('period_id', period.id);
    setBudgets(data || []);
    if (data && data.length > 0) loadBudget(data[0]);
    else {
      setActiveBudget(null);
      setVariance([]);
      setBudgetLines({});
    }
  };

  const createBudget = async () => {
    if (!newBudgetName || !activePeriod) return;
    const { data } = await supabase.from('fiscal_budgets').insert({ 
      agency_id: String(agencyId), 
      period_id: activePeriod.id, 
      name: newBudgetName 
    }).select().single();
    if (data) {
      setBudgets([...budgets, data]);
      setNewBudgetName('');
      loadBudget(data);
    }
  };

  const loadBudget = async (budget: FiscalBudgetRow) => {
    setActiveBudget(budget);
    const { data: lines } = await supabase.from('budget_lines').select('*').eq('budget_id', budget.id);
    const mapped: Record<string, number> = {};
    if (lines) {
      lines.forEach((l: BudgetLineRow) => { mapped[l.account_id] = Number(l.amount_dzd); });
    }
    setBudgetLines(mapped);
    fetchVariance(budget.id);
  };

  const updateBudgetLine = async (accountId: string, amount: number) => {
    if (!activeBudget || activeBudget.status === 'LOCKED') return;
    setBudgetLines(prev => ({ ...prev, [accountId]: amount }));
    
    const { data: existing } = await supabase.from('budget_lines').select('id').eq('budget_id', activeBudget.id).eq('account_id', accountId).maybeSingle();
    if (existing) {
      await supabase.from('budget_lines').update({ amount_dzd: amount }).eq('id', existing.id);
    } else {
      await supabase.from('budget_lines').insert({ budget_id: activeBudget.id, account_id: accountId, amount_dzd: amount });
    }
  };

  const fetchVariance = async (budgetId: string) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_budget_variance', { p_budget_id: budgetId });
    if (error !== null) {
      setVariance([]);
    } else if (Array.isArray(data)) {
      // Runtime guard narrows the JSONB payload to its declared contract.
      setVariance(data.filter(isBudgetVarianceRow));
    } else {
      setVariance([]);
    }
    setLoading(false);
  };

  const updateStatus = async (status: string) => {
    if (!activeBudget) return;
    await supabase.from('fiscal_budgets').update({ status }).eq('id', activeBudget.id);
    setActiveBudget({ ...activeBudget, status });
    toast.success(t('تم التحديث', 'Statut mis à jour', 'Status updated'));
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">
          {t('التخطيط والميزانية', 'Planification et Budget', 'Planning & Budgeting')}
        </h3>
        <div className="flex gap-2">
          {activeBudget && (
            <>
              {activeBudget.status === 'DRAFT' && (
                <button onClick={() => updateStatus('IN_REVIEW')} className="btn btn-sm border border-[var(--border)]">{t('إرسال للمراجعة', 'Soumettre', 'Submit')}</button>
              )}
              {activeBudget.status === 'IN_REVIEW' && (
                <button onClick={() => updateStatus('APPROVED')} className="btn btn-sm btn-primary"><CheckCircle2 className="w-4 h-4 mr-2" />{t('موافقة', 'Approuver', 'Approve')}</button>
              )}
              {activeBudget.status === 'APPROVED' && (
                <button onClick={() => updateStatus('PUBLISHED')} className="btn btn-sm btn-primary">{t('نشر', 'Publier', 'Publish')}</button>
              )}
              {activeBudget.status === 'PUBLISHED' && (
                <button onClick={() => updateStatus('LOCKED')} className="btn btn-sm bg-red-600 text-white"><Lock className="w-4 h-4 mr-2" />{t('قفل', 'Verrouiller', 'Lock')}</button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex gap-4 h-full overflow-hidden">
        
        {/* Sidebar: Periods & Budgets */}
        <div className="w-64 flex flex-col gap-4">
          <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 flex-1 overflow-y-auto">
            <h4 className="font-semibold mb-3">{t('الفترات والميزانيات', 'Périodes', 'Periods & Budgets')}</h4>
            <div className="space-y-2">
              {periods.map(p => (
                <div key={p.id} className="space-y-1">
                  <button 
                    onClick={() => loadPeriod(p)}
                    className={"w-full text-left px-3 py-2 rounded-lg text-sm font-medium " + (activePeriod?.id === p.id ? "bg-[var(--brand-500)]/10 text-[var(--brand-500)]" : "hover:bg-[var(--bg-hover)]")}
                  >
                    {p.label}
                  </button>
                  {activePeriod?.id === p.id && (
                    <div className="pl-4 pr-2 space-y-2 py-2">
                      <div className="flex gap-2">
                        <input type="text" className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 text-xs" placeholder="New Budget" value={newBudgetName} onChange={e => setNewBudgetName(e.target.value)} />
                        <button onClick={createBudget} className="p-1 bg-[var(--brand-500)] text-white rounded"><Plus className="w-3 h-3"/></button>
                      </div>
                      {budgets.map(b => (
                        <button 
                          key={b.id}
                          onClick={() => loadBudget(b)}
                          className={"w-full text-left px-2 py-1.5 rounded-md text-xs flex justify-between items-center " + (activeBudget?.id === b.id ? "bg-[var(--bg-tertiary)] font-bold text-[var(--text-primary)]" : "hover:bg-[var(--bg-hover)] text-[var(--text-muted)]")}
                        >
                          <span>{b.name}</span>
                          <span className={"text-[10px] px-1.5 py-0.5 rounded " + (b.status === 'LOCKED' ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500')}>{b.status}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 overflow-y-auto">
          {!activeBudget ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
              <Target className="h-12 w-12 mb-4 opacity-20" />
              <p>{t('اختر ميزانية', 'Sélectionnez un budget', 'Select a budget')}</p>
            </div>
          ) : (
            <div className="space-y-6">
              
              <div className="flex justify-between items-center">
                <h4 className="font-semibold text-lg flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-[var(--brand-500)]" /> 
                  Variance Dashboard ({activeBudget.name})
                </h4>
                <button onClick={() => fetchVariance(activeBudget.id)} className="btn btn-sm border border-[var(--border)] text-xs">Refresh Actuals</button>
              </div>

              {/* Grid */}
              <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-muted)] uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Account</th>
                      <th className="px-4 py-3 text-right">Budget (DZD)</th>
                      <th className="px-4 py-3 text-right">Actual (DZD)</th>
                      <th className="px-4 py-3 text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(acc => {
                      const v = variance.find(x => x.account_id === acc.id);
                      const isLocked = activeBudget.status === 'LOCKED';
                      return (
                        <tr key={acc.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                          <td className="px-4 py-2 font-mono text-xs">{acc.code}</td>
                          <td className="px-4 py-2 font-medium">{acc.name}</td>
                          <td className="px-4 py-2 text-right">
                            <input 
                              type="number"
                              disabled={isLocked}
                              className={"w-24 text-right bg-transparent border-b px-1 py-1 font-mono " + (isLocked ? 'border-transparent text-[var(--text-muted)]' : 'border-[var(--border)] focus:border-[var(--brand-500)] outline-none')}
                              value={budgetLines[acc.id] || 0}
                              onChange={e => updateBudgetLine(acc.id, Number(e.target.value))}
                              onBlur={() => fetchVariance(activeBudget.id)}
                            />
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-[var(--text-muted)]">
                            {v ? money(v.actual_dzd, 'DZD') : '-'}
                          </td>
                          <td className={"px-4 py-2 text-right font-mono font-medium " + (v && v.variance_dzd < 0 ? 'text-red-500' : v && v.variance_dzd > 0 ? 'text-green-500' : 'text-[var(--text-muted)]')}>
                            {v ? money(v.variance_dzd, 'DZD') : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
