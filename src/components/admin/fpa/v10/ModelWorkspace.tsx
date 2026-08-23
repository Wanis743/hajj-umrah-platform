import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { Calculator, Database, Box, Plus, Search, Layers, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';

interface FpaModel {
  id: string;
  name: string;
  type: string;
  formula: string;
  dimension: string;
}

interface ModelWorkspaceProps {
  registry: WorkspaceRegistry;
}

export function ModelWorkspace({ registry }: ModelWorkspaceProps) {
  const [items, setItems] = useState<FpaModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchModels = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('fpa_models')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(50);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setItems([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setItems((data as Array<Record<string, unknown>>).map(m => ({
            id: String(m.id || ''),
            name: String(m.name || 'Unnamed Model'),
            type: String(m.model_type || 'variable'),
            formula: 'Formula computation pending...',
            dimension: String(m.data_type || 'Unknown')
          })));
        } else {
          // Fallback if no data
          setItems([
            { id: 'v1', name: 'Revenue per Pilgrim', type: 'Variable', formula: 'PackagePrice + Upsells', dimension: 'Finance' },
            { id: 'v2', name: 'Total Transport Cost', type: 'Formula', formula: 'Buses * Rate + Fuel', dimension: 'Operations' },
            { id: 'v3', name: 'Visa Processing Fee', type: 'Variable', formula: 'Fixed Base ($50)', dimension: 'Gov' }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch models');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchModels();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Modeling Engine</h1>
          <p className="text-sm text-slate-400">Define dimensional variables and financial formulas</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-500/30 transition-colors">
            <Plus className="w-4 h-4" />
            New Variable
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors">
            <Calculator className="w-4 h-4" />
            New Formula
          </button>
        </div>
      </div>

      <div className="p-6 flex-1 overflow-auto">
        <div className="flex space-x-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search variables or formulas..."
              className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-slate-400">Loading models...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-5 bg-slate-900/40 border border-white/5 rounded-xl hover:border-white/10 transition-colors cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 rounded-lg ${
                    item.type.toLowerCase() === 'variable' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                  }`}>
                    {item.type.toLowerCase() === 'variable' ? <Database className="w-5 h-5" /> : <Calculator className="w-5 h-5" />}
                  </div>
                  <span className="text-xs font-medium text-slate-500 bg-white/5 px-2 py-1 rounded-md">
                    {item.dimension}
                  </span>
                </div>
                
                <h3 className="font-medium text-slate-200 mb-1">{item.name}</h3>
                <div className="flex items-center gap-2 text-sm text-slate-400 font-mono bg-black/20 p-2 rounded-md mt-3 border border-white/5">
                  <span className="text-indigo-400">ƒ</span>
                  <span className="truncate">{item.formula}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
