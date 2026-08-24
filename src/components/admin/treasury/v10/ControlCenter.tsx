import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, AlertTriangle, FileCheck, CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface ControlCenterProps {
  registry: WorkspaceRegistry;
}

interface FinancialControl {
  id: string;
  code: string;
  description: string;
  status: string;
}

export function ControlCenter({ registry }: ControlCenterProps) {
  const [controls, setControls] = useState<FinancialControl[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchControls = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('financial_controls')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setControls([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setControls((data as Array<Record<string, unknown>>).map(c => ({
            id: String(c.id || ''),
            code: String(c.control_code || 'CTRL-UNKNOWN'),
            description: String(c.description || 'No description'),
            status: String(c.status || 'OPEN')
          })));
        } else {
          setControls([
            { id: '1', code: 'EX-001', description: 'Bank statement vs GL mismatch in Main Operating', status: 'OPEN' },
            { id: '2', code: 'EX-002', description: 'Wire transfer exceeds daily limit without secondary approval', status: 'OPEN' },
            { id: '3', code: 'EX-003', description: 'Missing vendor tax ID for new payee', status: 'OPEN' }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch controls');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchControls();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/90">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p className="text-white/55">Loading controls...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/90 p-6">
        <AlertCircle className="w-8 h-8 text-rose-400 mb-4" />
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 text-white/90">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-400" />
            Financial Control Center
          </h2>
          <p className="text-sm text-white/55 mt-1">Monitor SOX compliance, exceptions, and month-end close status</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-white/[0.04]/50 border border-white/5 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <h3 className="font-medium text-white/80">Open Exceptions</h3>
          </div>
          <p className="text-3xl font-semibold text-white">{controls.filter(c => c.status === 'OPEN').length}</p>
        </div>
        <div className="p-4 bg-white/[0.04]/50 border border-white/5 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <FileCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="font-medium text-white/80">Controls Tested</h3>
          </div>
          <p className="text-3xl font-semibold text-white">42 / 45</p>
        </div>
        <div className="p-4 bg-white/[0.04]/50 border border-white/5 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <h3 className="font-medium text-white/80">Close Readiness</h3>
          </div>
          <p className="text-3xl font-semibold text-white">88%</p>
        </div>
      </div>

      <div className="bg-white/[0.04]/40 border border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/[0.05]">
          <h3 className="font-medium text-white/90">Exception Management</h3>
          <button className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">View All</button>
        </div>
        <div className="divide-y divide-white/5">
          {controls.map((exc) => (
            <div key={exc.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors group">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-full bg-rose-500/10 text-rose-400`}>
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white/90">{exc.code}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10 text-white/55">
                      {exc.status}
                    </span>
                  </div>
                  <p className="text-sm text-white/55 mt-1">{exc.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-2 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors" title="Resolve">
                  <CheckCircle2 className="w-5 h-5" />
                </button>
                <button className="p-2 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors" title="Escalate">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
          {controls.length === 0 && (
            <div className="p-8 text-center text-white/40 text-sm">
              No financial controls or exceptions found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
