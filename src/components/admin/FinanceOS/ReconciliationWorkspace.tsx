import React, { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { CheckCircle, AlertCircle, RefreshCw, Upload, Scale, Search, Link2, Check } from 'lucide-react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { supabase } from '@/lib/supabase';
import { BankStatementRow, BankTransactionRow, JournalLineRow } from '@/types/database';
import toast from 'react-hot-toast';

export function ReconciliationWorkspace() {
  const { lang } = useI18n();
  const t = (ar: string, fr: string, en: string) => (lang === 'ar' || lang === 'dz') ? ar : lang === 'fr' ? fr : en;
  
  const [running, setRunning] = useState(false);
  const [activeStatementId, setActiveStatementId] = useState<string>('');
  const [selectedTx, setSelectedTx] = useState<string | null>(null);
  const [selectedLedger, setSelectedLedger] = useState<string | null>(null);

  const { data: statements, refetch: refetchStatements } = useSupabaseData<BankStatementRow>({ table: 'bank_statements', orderBy: { column: 'statement_date', ascending: false } });
  const { data: transactions, refetch: refetchTx } = useSupabaseData<BankTransactionRow>({ table: 'bank_transactions' });
  const { data: journalLines, refetch: refetchJl } = useSupabaseData<JournalLineRow>({ table: 'journal_lines' });

  const activeStatement = statements?.find(s => s.id === activeStatementId) || statements?.[0];
  
  const unmatchedTxs = transactions?.filter(t => t.statement_id === activeStatement?.id && t.status === 'UNMATCHED') || [];
  
  // Unreconciled bank ledger lines (assume account_id needs to be bank but we just filter un-matched)
  const unreconciledLedgers = journalLines?.filter(jl => {
    const isMatched = transactions?.some(t => t.matched_journal_line_id === jl.id);
    return !isMatched && (jl.account_id !== null); // In a real app we'd filter by bank account type
  }) || [];

  const handleAutoMatch = async () => {
    if (!activeStatement) return;
    try {
      setRunning(true);
      const { data, error } = await supabase.rpc('auto_reconcile_bank_statement', { p_statement_id: activeStatement.id });
      if (error) throw error;
      toast.success(`Auto-match complete. Matched ${(data as Record<string, number>)?.matched_count || 0} transactions.`);
      refetchTx();
      refetchJl();
    } catch (e: unknown) {
      toast.error('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  };

  const handleManualMatch = async () => {
    if (!selectedTx || !selectedLedger) return;
    try {
      setRunning(true);
      const { error } = await supabase
        .from('bank_transactions')
        .update({ 
          status: 'MATCHED',
          matched_journal_line_id: selectedLedger
        })
        .eq('id', selectedTx);
        
      if (error) throw error;
      toast.success('Transaction matched successfully.');
      setSelectedTx(null);
      setSelectedLedger(null);
      refetchTx();
      refetchJl();
    } catch (e: unknown) {
      toast.error('Failed to match: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  };

  const tx = unmatchedTxs.find(t => t.id === selectedTx);
  const jl = unreconciledLedgers.find(l => l.id === selectedLedger);
  const txAmount = tx ? Number(tx.amount) : 0;
  const jlAmount = jl ? (Number(jl.debit_dzd) - Number(jl.credit_dzd)) : 0;
  const variance = Math.abs(txAmount - jlAmount);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] text-slate-200">
      <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/50">
        <div>
          <h2 className="text-2xl font-light text-white flex items-center gap-3">
            <Scale className="w-6 h-6 text-purple-400" />
            {t('Rapprochement Bancaire', 'Rapprochement Bancaire', 'Reconciliation Center')}
          </h2>
          <p className="text-sm text-slate-400 mt-1">Match bank statement lines with ledger expectations.</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-medium transition-colors">
            <Upload className="h-4 w-4" /> {t('Importer CSV', 'Importer CSV', 'Import Statement')}
          </button>
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 border border-purple-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            onClick={handleAutoMatch}
            disabled={running || !activeStatement}
          >
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t('Rapprochement Auto', 'Rapprochement Auto', 'Auto-Match AI')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Match Action Bar (Appears when both sides selected) */}
        {selectedTx && selectedLedger && (
          <div className="bg-indigo-900/40 border-b border-indigo-500/30 p-4 flex items-center justify-between animate-in slide-in-from-top">
            <div className="flex items-center gap-8">
              <div>
                <div className="text-xs text-indigo-400 font-medium">Bank Transaction</div>
                <div className="text-lg font-bold text-white">{txAmount.toLocaleString()} DZD</div>
              </div>
              <Link2 className="w-6 h-6 text-indigo-500" />
              <div>
                <div className="text-xs text-indigo-400 font-medium">Ledger Line</div>
                <div className="text-lg font-bold text-white">{jlAmount.toLocaleString()} DZD</div>
              </div>
              <div className="h-8 w-px bg-indigo-500/30 mx-4" />
              <div>
                <div className="text-xs text-indigo-400 font-medium">Variance</div>
                <div className={`text-lg font-bold ${variance === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {variance.toLocaleString()} DZD
                </div>
              </div>
            </div>
            <button 
              className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 border border-indigo-500 rounded-lg text-sm font-medium text-white transition-colors"
              onClick={handleManualMatch}
              disabled={running}
            >
              <Check className="w-4 h-4" />
              Confirm Match
            </button>
          </div>
        )}

        <div className="flex-1 flex min-h-0">
          {/* Left Side: Bank Transactions */}
          <div className="w-1/2 border-r border-slate-700/50 flex flex-col">
            <div className="p-3 border-b border-slate-700/50 bg-slate-800/30 font-medium text-slate-300 flex justify-between items-center">
              <span>Unmatched Bank Lines</span>
              <span className="px-2 py-0.5 bg-slate-700 rounded text-xs">{unmatchedTxs.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {unmatchedTxs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <CheckCircle className="h-8 w-8 mb-2 opacity-20" />
                  <p>All bank lines matched</p>
                </div>
              ) : (
                unmatchedTxs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTx(t.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedTx === t.id 
                        ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/50' 
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-sm font-medium text-slate-200">{t.description || 'Unknown Transaction'}</span>
                      <span className={`text-sm font-bold ${Number(t.amount) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {Number(t.amount).toLocaleString()} DZD
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex justify-between">
                      <span>{t.transaction_date && new Date(t.transaction_date).toLocaleDateString()}</span>
                      <span className="font-mono">{t.reference}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right Side: Ledger Lines */}
          <div className="w-1/2 flex flex-col">
            <div className="p-3 border-b border-slate-700/50 bg-slate-800/30 font-medium text-slate-300 flex justify-between items-center">
              <span>Unreconciled Ledger</span>
              <span className="px-2 py-0.5 bg-slate-700 rounded text-xs">{unreconciledLedgers.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {unreconciledLedgers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <CheckCircle className="h-8 w-8 mb-2 opacity-20" />
                  <p>All ledger lines reconciled</p>
                </div>
              ) : (
                unreconciledLedgers.map(l => {
                  const net = Number(l.debit_dzd) - Number(l.credit_dzd);
                  return (
                    <button
                      key={l.id}
                      onClick={() => setSelectedLedger(l.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedLedger === l.id 
                          ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/50' 
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-slate-200">{String(l.description || 'Ledger Entry')}</span>
                        <span className={`text-sm font-bold ${net > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {net.toLocaleString()} DZD
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 flex justify-between">
                        <span>Account: {String(l.account_id || '').slice(0,8)}...</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
