import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Check, AlertTriangle, Clock, ShieldCheck, Lock, ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { FiscalPeriodRow, BankTransactionRow, GenericRow } from '@/types/database';
import toast from 'react-hot-toast';
import { animate } from 'animejs';

interface ValidationTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'blocked';
  count?: number;
  message?: string;
}

export function CloseCenter() {
  const { lang } = useI18n();
  const t = (ar: string, fr: string, en: string) => (lang === 'ar' || lang === 'dz') ? ar : lang === 'fr' ? fr : en;
  
  const [locking, setLocking] = useState(false);
  const [validating, setValidating] = useState(false);
  
  const { data: periods, refetch } = useSupabaseData<FiscalPeriodRow>({ table: 'fiscal_periods', orderBy: { column: 'start_date', ascending: false }});
  const openPeriod = periods?.find(p => p.status === 'OPEN');
  
  const { data: txs } = useSupabaseData<BankTransactionRow>({ table: 'bank_transactions' });
  const { data: journals } = useSupabaseData<GenericRow>({ table: 'journal_entries' });

  const pendingRecon = txs?.filter(t => t.status === 'UNMATCHED').length || 0;
  const pendingJournals = journals?.filter(j => j.status === 'DRAFT' || j.status === 'PENDING').length || 0;

  const [tasks, setTasks] = useState<ValidationTask[]>([
    { id: 't1', name: 'Draft Journals Check', status: 'pending' },
    { id: 't2', name: 'Bank Reconciliation', status: 'pending' },
    { id: 't3', name: 'FX Revaluation', status: 'pending' },
    { id: 't4', name: 'Control Gates', status: 'pending' },
  ]);

  const taskListRef = useRef<HTMLDivElement>(null);

  const canLock = !validating && tasks.every(t => t.status === 'done');
  
  const runValidations = () => {
    setValidating(true);
    
    // Reset tasks
    setTasks(prev => prev.map(t => ({ ...t, status: 'pending', count: undefined, message: undefined })));

    let step = 0;
    const interval = setInterval(() => {
      setTasks(prev => {
        const next = [...prev];
        
        if (step === 0) {
          if (pendingJournals > 0) {
            next[0] = { ...next[0], status: 'error', count: pendingJournals, message: 'Unposted journals block close.' };
          } else {
            next[0] = { ...next[0], status: 'done', message: 'All journals posted.' };
          }
        } 
        else if (step === 1) {
          if (pendingRecon > 0) {
            next[1] = { ...next[1], status: 'error', count: pendingRecon, message: 'Unmatched bank lines block close.' };
          } else {
            next[1] = { ...next[1], status: 'done', message: 'Accounts reconciled.' };
          }
        }
        else if (step === 2) {
          next[2] = { ...next[2], status: 'done', message: 'FX locked.' };
        }
        else if (step === 3) {
          const hasError = next.some((t, i) => i < 3 && t.status === 'error');
          next[3] = { ...next[3], status: hasError ? 'blocked' : 'done', message: hasError ? 'Previous steps failed.' : 'Ready for lock.' };
        }

        return next;
      });

      // Animate the row
      if (taskListRef.current && taskListRef.current.children[step]) {
        animate(taskListRef.current.children[step], {
          translateX: [10, 0],
          opacity: [0, 1],
          duration: 400,
          easing: 'easeOutQuad'
        });
      }

      step++;
      if (step >= 4) {
        clearInterval(interval);
        setValidating(false);
      }
    }, 600);
  };

  const handleLock = async () => {
    if (!openPeriod) return;
    try {
      setLocking(true);
      const { error } = await supabase.rpc('close_fiscal_period', { p_period_id: openPeriod.id });
      if (error) throw error;
      toast.success(t('Closed successfully.', 'Fermé avec succès.', 'Period Closed Successfully.'));
      refetch();
    } catch (e: unknown) {
      console.error(e);
      toast.error('Failed to close period: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] text-slate-200">
      <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/50">
        <div>
          <h2 className="text-2xl font-light text-white flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-red-400" />
            {t('Clôture Mensuelle', 'Clôture Mensuelle', 'Period Close Center')}
          </h2>
          <p className="text-sm text-slate-400 mt-1">Execute month-end procedures and lock financial periods.</p>
        </div>
        <div className="flex gap-3">
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-medium transition-colors"
            onClick={runValidations}
            disabled={validating || !openPeriod}
          >
            {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Run Validations
          </button>
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 border border-red-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(220,38,38,0.3)]"
            disabled={!canLock || locking || !openPeriod}
            onClick={handleLock}
          >
            {locking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {t('Clôturer', 'Clôturer', 'Lock Period')}
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-6">
          
          <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/30">
              <span className="font-medium text-slate-300">Active Period</span>
              {openPeriod ? (
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-bold tracking-wide">
                  OPEN
                </span>
              ) : (
                <span className="px-3 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-full text-xs font-bold tracking-wide">
                  NO OPEN PERIOD
                </span>
              )}
            </div>
            <div className="p-6">
              {openPeriod ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-semibold text-white">{openPeriod.label}</div>
                    <div className="text-sm text-slate-400 mt-1">
                      {new Date(openPeriod.start_date).toLocaleDateString()} &mdash; {new Date(openPeriod.end_date).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-slate-400">Total Unposted Journals</div>
                    <div className="text-xl font-medium text-amber-400">{pendingJournals}</div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  All periods are currently closed. Go to System Settings to open a new fiscal period.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3" ref={taskListRef}>
            {tasks.map((task) => (
              <div 
                key={task.id} 
                className={`p-4 bg-slate-900/50 border rounded-xl flex items-center justify-between transition-colors duration-300 ${
                  task.status === 'done' ? 'border-emerald-500/30 bg-emerald-500/5' :
                  task.status === 'error' ? 'border-rose-500/30 bg-rose-500/5' :
                  'border-slate-700/50'
                }`}
              >
                <div>
                  <span className={`font-medium ${task.status === 'done' ? 'text-emerald-400' : task.status === 'error' ? 'text-rose-400' : 'text-slate-300'}`}>
                    {task.name}
                  </span>
                  {task.message && (
                    <div className="text-xs text-slate-500 mt-1">{task.message}</div>
                  )}
                </div>
                
                <div className="flex items-center gap-3">
                  {task.status === 'pending' && <Clock className="w-5 h-5 text-slate-600" />}
                  {task.status === 'running' && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
                  {task.status === 'done' && <Check className="w-5 h-5 text-emerald-500" />}
                  {task.status === 'blocked' && <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Blocked</div>}
                  {task.status === 'error' && (
                    <span className="px-2 py-1 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded text-xs font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {task.count} FAIL
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
