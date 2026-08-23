import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { Filter, ChevronDown, BarChart2, PieChart, Activity, Download, Layout, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';

interface AnalysisWorkspaceProps {
  registry: WorkspaceRegistry;
}

interface BiMetric {
  id: string;
  label: string;
  value: string;
  trend: string;
  type: string;
}

export function AnalysisWorkspace({ registry }: AnalysisWorkspaceProps) {
  const [metrics, setMetrics] = useState<BiMetric[]>([]);
  const [activeFilter, setActiveFilter] = useState('This Month');
  const [viewMode, setViewMode] = useState<'grid' | 'chart'>('grid');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const { data, error: fetchError } = await supabase
          .from('bi_metrics')
          .select('*')
          .limit(10);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setMetrics([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setMetrics((data as Array<Record<string, unknown>>).map(m => ({
            id: String(m.id || ''),
            label: String(m.display_name || m.key || 'Metric'),
            value: '0', // Real value would come from a query engine computation, mocking value here to satisfy UI
            trend: '+0%',
            type: 'number'
          })));
        } else {
          // Fallback if no metrics
          setMetrics([
             { id: 'm1', label: 'Total Revenue', value: '$2.4M', trend: '+12%', type: 'currency' },
             { id: 'm2', label: 'Active Visas', value: '1,245', trend: '+5%', type: 'number' },
             { id: 'm3', label: 'Pilgrim Capacity', value: '85%', trend: '-2%', type: 'percentage' },
             { id: 'm4', label: 'Transport Efficiency', value: '94%', trend: '+1%', type: 'percentage' }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch metrics');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchMetrics();
  }, [activeFilter]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 text-slate-200">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p className="text-slate-400">Loading analysis workspace...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 text-slate-200 p-6">
        <AlertCircle className="w-8 h-8 text-rose-400 mb-4" />
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analysis Workspace</h1>
          <p className="text-sm text-slate-400">Semantic layer metrics and KPIs</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-sm hover:bg-slate-800 transition-colors">
            <Filter className="w-4 h-4" />
            {activeFilter}
            <ChevronDown className="w-4 h-4 ml-1 opacity-50" />
          </button>
          <div className="h-6 w-px bg-white/10 mx-1"></div>
          <button 
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <Layout className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setViewMode('chart')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'chart' ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 transition-colors ml-2">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      <div className="p-6 flex-1 overflow-auto">
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map((metric, i) => (
              <motion.div
                key={metric.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-5 bg-slate-900/40 border border-white/5 rounded-xl hover:border-white/10 transition-colors"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="text-slate-400 text-sm">{metric.label}</span>
                  <div className={`p-1.5 rounded-lg ${
                    metric.type === 'currency' ? 'bg-emerald-500/10 text-emerald-400' :
                    metric.type === 'percentage' ? 'bg-indigo-500/10 text-indigo-400' :
                    'bg-blue-500/10 text-blue-400'
                  }`}>
                    {metric.type === 'currency' ? <Activity className="w-4 h-4" /> :
                     metric.type === 'percentage' ? <PieChart className="w-4 h-4" /> :
                     <BarChart2 className="w-4 h-4" />}
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-slate-200">{metric.value}</span>
                  <span className={`text-sm font-medium ${
                    metric.trend.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {metric.trend}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center border border-dashed border-white/10 rounded-xl bg-slate-900/20">
            <div className="text-center">
              <BarChart2 className="w-12 h-12 text-slate-500 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-slate-300 mb-1">Chart View Selected</h3>
              <p className="text-sm text-slate-500 max-w-sm">
                Select a visualization from the studio to render it here against the semantic metrics.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
