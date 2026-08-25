import React, { useState, useEffect } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Network, Calculator, Play, Plus, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/currency';
import type {
  FinancialModelRow,
  ModelScenarioRow,
  ModelAssumptionRow,
  ModelProjectionRow,
} from '@/types/database';

/** JSONB contract of `simulate_scenario` (modeling_engine.sql). */
interface ScenarioSimulationResult {
  projected_revenue: number;
  projected_cost: number;
  projected_margin: number;
  projected_margin_percent: number;
}

function isScenarioSimulationResult(value: unknown): value is ScenarioSimulationResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['projected_revenue'] === 'number' &&
    typeof v['projected_cost'] === 'number' &&
    typeof v['projected_margin'] === 'number' &&
    typeof v['projected_margin_percent'] === 'number'
  );
}

export function ModelingWorkspace() {
  const { lang } = useI18n();
  const { session } = useAuth();
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const t = (ar: string, fr: string, en: string) => lang === 'ar' ? ar : lang === 'fr' ? fr : en;

  const [models, setModels] = useState<FinancialModelRow[]>([]);
  const [activeModel, setActiveModel] = useState<FinancialModelRow | null>(null);
  const [scenarios, setScenarios] = useState<ModelScenarioRow[]>([]);
  const [activeScenario, setActiveScenario] = useState<ModelScenarioRow | null>(null);
  const [assumptions, setAssumptions] = useState<Record<string, number>>({});
  const [projection, setProjection] = useState<ScenarioSimulationResult | ModelProjectionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [newModelName, setNewModelName] = useState('');

  const keys = ['target_pilgrims', 'price_per_pilgrim', 'flight_cost_per_pilgrim', 'hotel_cost_per_pilgrim', 'visa_cost_per_pilgrim', 'other_cost_per_pilgrim'];

  useEffect(() => {
    const fetchAgency = async () => {
      if (!session?.user?.id) return;
      const { data } = await supabase.from('staff_profiles').select('agency_id').eq('user_id', session.user.id).single();
      if (data?.agency_id) setAgencyId(String(data.agency_id));
    };
    fetchAgency();
  }, [session?.user?.id]);

  useEffect(() => {
    if (agencyId) fetchModels();
  }, [agencyId]);

  const fetchModels = async () => {
    const { data } = await supabase.from('financial_models').select('*').eq('agency_id', String(agencyId));
    setModels(data || []);
  };

  const createModel = async () => {
    if (!newModelName) return;
    const { data } = await supabase.from('financial_models').insert({ agency_id: String(agencyId), name: newModelName }).select().single();
    if (data) {
      setModels([...models, data]);
      setNewModelName('');
      loadModel(data);
      const { data: sData } = await supabase.from('model_scenarios').insert({ model_id: data.id, name: 'Base Case', is_baseline: true }).select().single();
      if (sData) {
        setScenarios([sData]);
        loadScenario(sData);
      }
    }
  };

  const loadModel = async (model: FinancialModelRow) => {
    setActiveModel(model);
    const { data } = await supabase.from('model_scenarios').select('*').eq('model_id', model.id);
    setScenarios(data || []);
    if (data && data.length > 0) loadScenario(data[0]);
    else { setActiveScenario(null); setAssumptions({}); setProjection(null); }
  };

  const loadScenario = async (scenario: ModelScenarioRow) => {
    setActiveScenario(scenario);
    const { data: asm } = await supabase.from('model_assumptions').select('*').eq('scenario_id', scenario.id);
    const mapped: Record<string, number> = {};
    keys.forEach(k => mapped[k] = 0);
    if (asm) asm.forEach((a: ModelAssumptionRow) => { mapped[a.variable_key] = Number(a.variable_value); });
    setAssumptions(mapped);

    const { data: proj } = await supabase.from('model_projections').select('*').eq('scenario_id', scenario.id).maybeSingle();
    setProjection(proj);
  };

  const updateAssumption = async (key: string, value: number) => {
    if (!activeScenario) return;
    setAssumptions(prev => ({ ...prev, [key]: value }));
    const { data: existing } = await supabase.from('model_assumptions').select('id').eq('scenario_id', activeScenario.id).eq('variable_key', key).maybeSingle();
    if (existing) {
      await supabase.from('model_assumptions').update({ variable_value: value }).eq('id', existing.id);
    } else {
      await supabase.from('model_assumptions').insert({ scenario_id: activeScenario.id, variable_key: key, variable_value: value });
    }
  };

  const simulate = async () => {
    if (!activeScenario) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('simulate_scenario', { p_scenario_id: activeScenario.id });
      if (error) throw error;
      // Runtime guard narrows the JSONB payload to its declared contract.
      setProjection(isScenarioSimulationResult(data) ? data : null);
      toast.success(t('نجحت المحاكاة', 'Simulation réussie', 'Simulation successful'));
      fetchModels();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">
          {t('النمذجة المالية', 'Modélisation Financière', 'Financial Modeling')}
        </h3>
        <div className="flex gap-2">
          <button onClick={simulate} disabled={loading || !activeScenario} className="btn btn-sm btn-primary flex items-center gap-2">
            <Play className="h-4 w-4" /> {loading ? '...' : t('محاكاة', 'Simuler', 'Run Simulation')}
          </button>
        </div>
      </div>
      <div className="flex-1 flex gap-4 h-full overflow-hidden">
        
        {/* Sidebar: Browser */}
        <div className="w-64 flex flex-col gap-4">
          <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 flex-1 overflow-y-auto">
            <h4 className="font-semibold mb-3">{t('النماذج', 'Modèles', 'Models')}</h4>
            <div className="flex gap-2 mb-4">
              <input type="text" className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 text-sm" placeholder={t('نموذج جديد', 'Nouveau modèle', 'New model…')} value={newModelName} onChange={e => setNewModelName(e.target.value)} />
              <button onClick={createModel} className="p-1 bg-[var(--brand-500)] text-white rounded"><Plus className="w-4 h-4"/></button>
            </div>
            <div className="space-y-2">
              {models.map(m => (
                <div key={m.id} className="space-y-1">
                  <button 
                    onClick={() => loadModel(m)}
                    className={"w-full text-left px-3 py-2 rounded-lg text-sm font-medium " + (activeModel?.id === m.id ? "bg-[var(--brand-500)]/10 text-[var(--brand-500)]" : "hover:bg-[var(--bg-hover)]")}
                  >
                    {m.name}
                  </button>
                  {activeModel?.id === m.id && scenarios.map(s => (
                    <button 
                      key={s.id}
                      onClick={() => loadScenario(s)}
                      className={"w-full text-left pl-6 pr-3 py-1.5 rounded-lg text-xs " + (activeScenario?.id === s.id ? "bg-[var(--bg-tertiary)] font-bold" : "hover:bg-[var(--bg-hover)] text-[var(--text-muted)]")}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
          {!activeScenario ? (
            <div className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl flex flex-col items-center justify-center text-[var(--text-muted)]">
              <Network className="h-12 w-12 mb-4 opacity-20" />
              <p>{t('اختر سيناريو', 'Sélectionnez un scénario', 'Select a scenario')}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                
                {/* Assumptions */}
                <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4">
                  <h4 className="font-semibold mb-4 flex items-center gap-2"><Calculator className="w-4 h-4"/>{t('الافتراضات (مدخلات)', 'Hypothèses (entrées)', 'Assumptions (inputs)')}</h4>
                  <div className="space-y-3">
                    {keys.map(k => (
                      <div key={k} className="flex items-center justify-between">
                        <label className="text-sm text-[var(--text-muted)] capitalize">{k.replace(/_/g, ' ')}</label>
                        <input 
                          type="number" 
                          value={assumptions[k] || 0}
                          onChange={e => updateAssumption(k, Number(e.target.value))}
                          className="w-24 bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 text-right text-sm font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Projection Canvas */}
                <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 flex flex-col">
                  <h4 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4"/>{t('الإسقاط (مخرجات)', 'Projection (sorties)', 'Projection (outputs)')}</h4>
                  {projection ? (
                    <div className="flex-1 flex flex-col justify-center space-y-4">
                      <div className="flex justify-between items-center p-3 bg-[var(--bg-secondary)] rounded-lg">
                        <span className="text-sm font-medium">{t('الإيرادات', 'Revenus', 'Revenue')}</span>
                        <span className="font-mono text-green-600">{money(projection.projected_revenue, 'DZD')}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-[var(--bg-secondary)] rounded-lg">
                        <span className="text-sm font-medium">{t('التكاليف المباشرة', 'Coûts directs', 'Direct costs')}</span>
                        <span className="font-mono text-red-600">-{money(projection.projected_cost, 'DZD')}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-[var(--brand-500)]/10 rounded-lg border border-[var(--brand-500)]/30">
                        <span className="font-bold text-[var(--brand-500)]">{t('هامش الربح', 'Marge brute', 'Gross margin')}</span>
                        <div className="text-right">
                          <p className="font-mono font-bold text-[var(--brand-500)]">{money(projection.projected_margin, 'DZD')}</p>
                          <p className="text-xs font-bold text-[var(--brand-500)]">{Number(projection.projected_margin_percent).toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
                      {t('شغّل المحاكاة لحساب المخرجات', 'Lancez la simulation pour calculer les sorties', 'Run the simulation to calculate outputs')}
                    </div>
                  )}
                </div>

              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
