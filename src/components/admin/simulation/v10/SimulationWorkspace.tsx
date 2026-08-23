import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { Play, Settings, RefreshCcw, Activity, Info, BarChart2, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';

interface SimulationWorkspaceProps {
  registry: WorkspaceRegistry;
}

interface SimulationRun {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'pending' | 'cancelled';
  date: string;
}

export function SimulationWorkspace({ registry }: SimulationWorkspaceProps) {
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [monteCarloRuns, setMonteCarloRuns] = useState<number>(1000);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSimulationJobs = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('simulation_jobs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setRuns([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setRuns((data as Array<Record<string, unknown>>).map(r => ({
            id: String(r.id || ''),
            name: String(r.name || 'Unnamed Simulation'),
            status: (r.status as 'running' | 'completed' | 'failed' | 'pending' | 'cancelled') || 'pending',
            date: r.created_at ? new Date(String(r.created_at)).toLocaleDateString() : 'N/A'
          })));
        } else {
          setRuns([
            { id: '1', name: 'Demand Shock Q3', status: 'completed', date: new Date().toLocaleDateString() },
            { id: '2', name: 'Cost Variation Model', status: 'running', date: new Date().toLocaleDateString() }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch simulation jobs');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchSimulationJobs();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Business Simulation</h1>
          <p className="text-sm text-slate-400">Monte Carlo and sensitivity analysis</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors">
          <Play className="w-4 h-4" />
          Run Simulation
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 flex flex-col lg:flex-row gap-6">
        {/* Left Config Panel */}
        <div className="w-full lg:w-1/3 space-y-6">
          <div className="bg-slate-900/40 border border-white/10 rounded-xl p-5">
            <h3 className="font-medium text-slate-200 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              Engine Parameters
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Simulation Type</label>
                <select className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-indigo-500/50">
                  <option>Monte Carlo (Stochastic)</option>
                  <option>Deterministic Scenario</option>
                  <option>Sensitivity Analysis</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Iterations</label>
                <input 
                  type="number" 
                  value={monteCarloRuns}
                  onChange={(e) => setMonteCarloRuns(parseInt(e.target.value) || 1000)}
                  className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Target Model</label>
                <select className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-indigo-500/50">
                  <option>Base Case 2027</option>
                  <option>Q3 High Volume</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className="bg-slate-900/40 border border-white/10 rounded-xl p-5">
            <h3 className="font-medium text-slate-200 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" />
              Recent Runs
            </h3>
            
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-3" />
                <p className="text-xs text-slate-400">Loading jobs...</p>
              </div>
            ) : error ? (
              <p className="text-xs text-rose-400 p-2 bg-rose-500/10 rounded">{error}</p>
            ) : (
              <div className="space-y-3">
                {runs.map(run => (
                  <div key={run.id} className="p-3 bg-slate-950 border border-white/5 rounded-lg flex items-center justify-between group hover:border-white/10 transition-colors cursor-pointer">
                    <div>
                      <p className="text-sm font-medium text-slate-300">{run.name}</p>
                      <p className="text-xs text-slate-500">{run.date}</p>
                    </div>
                    {run.status === 'running' ? (
                      <RefreshCcw className="w-4 h-4 text-indigo-400 animate-spin" />
                    ) : run.status === 'completed' ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    ) : run.status === 'failed' ? (
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                    )}
                  </div>
                ))}
                
                {runs.length === 0 && (
                  <p className="text-xs text-slate-500 italic text-center py-4">No recent simulation runs</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Preview Panel */}
        <div className="flex-1 bg-slate-900/40 border border-white/10 rounded-xl flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute top-4 left-4 flex items-center gap-2 text-slate-400 text-sm">
            <Info className="w-4 h-4" />
            <span>Select a completed run to view probability distributions</span>
          </div>
          <div className="text-center p-8">
            <div className="w-24 h-24 rounded-full bg-slate-800/50 mx-auto flex items-center justify-center mb-6">
              <BarChart2 className="w-10 h-10 text-slate-600" />
            </div>
            <h3 className="text-xl font-medium text-slate-300 mb-2">No Results Selected</h3>
            <p className="text-slate-500 max-w-md mx-auto">
              Run a new simulation or select an existing one to visualize probability density functions, confidence intervals, and cumulative distributions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
