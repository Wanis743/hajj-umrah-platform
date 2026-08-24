import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { Send, Lock, Edit3, CheckSquare, Eye, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';

interface PlanningStep {
  id: string;
  name: string;
  status: string;
  owner: string;
}

interface PlanningWorkspaceProps {
  registry: WorkspaceRegistry;
}

export function PlanningWorkspace({ registry }: PlanningWorkspaceProps) {
  const [steps, setSteps] = useState<PlanningStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchPlanningSteps = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('fpa_planning_cycles')
          .select('*')
          .order('start_date', { ascending: false })
          .limit(20);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setSteps([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setSteps((data as Array<Record<string, unknown>>).map(s => ({
            id: String(s.id || ''),
            name: String(s.name || 'Unnamed Cycle'),
            status: String(s.status || 'open'),
            owner: 'Finance' // Mocking owner resolution for now
          })));
        } else {
          setSteps([
            { id: 'p1', name: 'Q1 Revenue Inputs', status: 'Draft', owner: 'Sales' },
            { id: 'p2', name: 'CapEx Review', status: 'In Review', owner: 'Operations' },
            { id: 'p3', name: 'Headcount Plan', status: 'Published', owner: 'HR' },
            { id: 'p4', name: 'Base Model FY27', status: 'Locked', owner: 'Finance' }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch planning cycles');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchPlanningSteps();
  }, []);

  return (
    <div className="flex flex-col h-full bg-transparent text-white/90">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/[0.04]/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Planning & Workflow</h1>
          <p className="text-sm text-white/55">Orchestrate cross-functional budgeting cycles</p>
        </div>
        <button className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 transition-colors">
          Start New Cycle
        </button>
      </div>

      <div className="p-6 flex-1 overflow-auto max-w-5xl mx-auto w-full">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-white/55">Loading planning cycles...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center justify-between p-5 bg-white/[0.04]/40 border border-white/5 rounded-xl hover:bg-white/[0.07] transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full flex items-center justify-center ${
                    step.status === 'Locked' ? 'bg-slate-500/10 text-white/55' :
                    step.status === 'Published' ? 'bg-emerald-500/10 text-emerald-400' :
                    step.status === 'In Review' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-indigo-500/10 text-indigo-400'
                  }`}>
                    {step.status === 'Locked' ? <Lock className="w-5 h-5" /> :
                     step.status === 'Published' ? <CheckSquare className="w-5 h-5" /> :
                     step.status === 'In Review' ? <Eye className="w-5 h-5" /> :
                     <Edit3 className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-white/90">{step.name}</h3>
                    <div className="flex items-center gap-3 text-sm text-white/55 mt-1">
                      <span>Owner: {step.owner}</span>
                      <span>•</span>
                      <span className={`font-medium ${
                        step.status === 'Locked' ? 'text-white/40' :
                        step.status === 'Published' ? 'text-emerald-500' :
                        step.status === 'In Review' ? 'text-amber-500' :
                        'text-indigo-400'
                      }`}>{step.status}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-colors">
                    Review
                  </button>
                  {step.status !== 'Locked' && (
                    <button className="px-4 py-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                      <Send className="w-4 h-4" />
                      Approve
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
            {steps.length === 0 && (
              <div className="py-12 text-center text-white/55 border border-dashed border-white/10 rounded-xl">
                <p>No planning cycles found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
