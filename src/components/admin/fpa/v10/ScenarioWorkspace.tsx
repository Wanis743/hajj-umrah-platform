import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { GitBranch, GitMerge, Plus, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';

interface FpaScenario {
  id: string;
  name: string;
  type: string;
  variance: string;
  status: string;
}

interface ScenarioWorkspaceProps {
  registry: WorkspaceRegistry;
}

export function ScenarioWorkspace({ registry }: ScenarioWorkspaceProps) {
  const [scenarios, setScenarios] = useState<FpaScenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchScenarios = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('fpa_scenarios')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(20);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setScenarios([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setScenarios((data as Array<Record<string, unknown>>).map(s => ({
            id: String(s.id || ''),
            name: String(s.name || 'Unnamed Scenario'),
            type: s.base_version_id ? 'Override' : 'Baseline',
            variance: '0%', // Mocking variance logic
            status: String(s.status || 'draft')
          })));
        } else {
          setScenarios([
            { id: 's1', name: 'Base Case 2027', type: 'Baseline', variance: '0%', status: 'Active' },
            { id: 's2', name: 'High Fuel Cost', type: 'Override', variance: '-4.2%', status: 'Draft' },
            { id: 's3', name: 'Max Capacity (+15%)', type: 'Assumption', variance: '+12.5%', status: 'Review' }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch scenarios');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchScenarios();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scenario Planning</h1>
          <p className="text-sm text-slate-400">Branching and merging financial scenarios</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors">
          <GitBranch className="w-4 h-4" />
          Branch Scenario
        </button>
      </div>

      <div className="p-6 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-slate-400">Loading scenarios...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {scenarios.map((scenario, i) => (
              <motion.div
                key={scenario.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                className="p-5 bg-slate-900/40 border border-white/10 rounded-xl relative overflow-hidden group hover:border-indigo-500/50 transition-colors"
              >
                {scenario.type === 'Baseline' && (
                  <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-500/10 blur-2xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
                )}
                
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-slate-800 rounded-lg">
                      <GitBranch className="w-4 h-4 text-slate-400" />
                    </div>
                    <span className="text-sm font-medium text-slate-400">{scenario.type}</span>
                  </div>
                  <span className={`px-2 py-1 text-xs font-medium rounded-md ${
                    scenario.status.toLowerCase() === 'active' ? 'bg-emerald-500/10 text-emerald-400' :
                    scenario.status.toLowerCase() === 'draft' ? 'bg-slate-500/10 text-slate-400' :
                    'bg-amber-500/10 text-amber-400'
                  }`}>
                    {scenario.status}
                  </span>
                </div>

                <h3 className="text-lg font-medium text-slate-200 mb-2">{scenario.name}</h3>
                
                <div className="flex justify-between items-end mt-6 pt-4 border-t border-white/5">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Variance to Base</p>
                    <p className={`text-lg font-semibold ${
                      scenario.variance.startsWith('+') ? 'text-emerald-400' :
                      scenario.variance.startsWith('-') ? 'text-rose-400' :
                      'text-slate-300'
                    }`}>
                      {scenario.variance}
                    </p>
                  </div>
                  <button className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors opacity-0 group-hover:opacity-100">
                    <GitMerge className="w-4 h-4" />
                    Compare
                  </button>
                </div>
              </motion.div>
            ))}
            
            {scenarios.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-400 border border-dashed border-white/10 rounded-xl">
                <GitBranch className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No scenarios found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
