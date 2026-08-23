import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { Target, ShieldAlert, CheckCircle2, Play, GitBranch, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';

interface OptimizationWorkspaceProps {
  registry: WorkspaceRegistry;
}

interface OptimizationJob {
  id: string;
  name: string;
  status: string;
}

export function OptimizationWorkspace({ registry }: OptimizationWorkspaceProps) {
  const [objective, setObjective] = useState<string>('maximize_profit');
  const [jobs, setJobs] = useState<OptimizationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOptimizationJobs = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('optimization_jobs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setJobs([]);
            return;
          }
          throw fetchError;
        }

        if (data) {
          setJobs((data as Array<Record<string, unknown>>).map(j => ({
            id: String(j.id || ''),
            name: String(j.name || 'Optimization Task'),
            status: String(j.status || 'pending')
          })));
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch optimization jobs');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchOptimizationJobs();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Optimization Solver</h2>
          <p className="text-sm text-slate-400">Linear and non-linear programming</p>
        </div>
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors shadow-lg shadow-emerald-500/20">
            <Play className="w-4 h-4 text-emerald-100" />
            Run Solver
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Objectives & Constraints */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-2 bg-slate-800/30">
              <Target className="w-5 h-5 text-indigo-400" />
              <h3 className="font-medium">Objective Function</h3>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-4">
                <select 
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  className="bg-slate-950 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-indigo-500/50 w-48"
                >
                  <option value="maximize_profit">Maximize Profit</option>
                  <option value="minimize_cost">Minimize Cost</option>
                  <option value="maximize_capacity">Maximize Capacity</option>
                </select>
                <div className="flex-1 text-sm font-mono text-slate-400 bg-black/20 p-3 rounded-lg border border-white/5">
                  <span className="text-indigo-400">∑</span> (Revenue_i - Cost_i) * Vol_i
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-800/30">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <h3 className="font-medium">Constraints</h3>
              </div>
              <button className="text-sm text-indigo-400 hover:text-indigo-300">Add Constraint</button>
            </div>
            <div className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/50 text-slate-400">
                  <tr>
                    <th className="text-left font-medium py-3 px-5 w-1/3">Variable</th>
                    <th className="text-left font-medium py-3 px-5 w-1/4">Operator</th>
                    <th className="text-left font-medium py-3 px-5">Bound</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-5 text-slate-300">Total Pilgrim Vol</td>
                    <td className="py-3 px-5">
                      <span className="bg-slate-800 px-2 py-1 rounded text-slate-300 font-mono">{'<='}</span>
                    </td>
                    <td className="py-3 px-5 font-mono text-slate-400">1,500,000</td>
                  </tr>
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-5 text-slate-300">Transport Fleet</td>
                    <td className="py-3 px-5">
                      <span className="bg-slate-800 px-2 py-1 rounded text-slate-300 font-mono">{'<='}</span>
                    </td>
                    <td className="py-3 px-5 font-mono text-slate-400">Max_Buses</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Results / History */}
        <div className="space-y-6">
          <div className="bg-slate-900/40 border border-white/10 rounded-xl p-5 h-full min-h-[400px] flex flex-col">
            <h3 className="font-medium text-slate-200 mb-4">Solver History</h3>
            
            {isLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-3" />
                <p className="text-xs text-slate-400">Loading history...</p>
              </div>
            ) : error ? (
              <p className="text-xs text-rose-400 p-3 bg-rose-500/10 rounded-lg">{error}</p>
            ) : jobs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <GitBranch className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">No solver runs yet</p>
                <p className="text-xs text-slate-500 mt-1">Configure your objective and constraints to run the optimizer.</p>
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-auto">
                {jobs.map(job => (
                  <div key={job.id} className="p-3 bg-slate-950 border border-white/5 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-300">{job.name}</span>
                      {job.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <p className="text-xs text-slate-500 capitalize">Status: {job.status}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
