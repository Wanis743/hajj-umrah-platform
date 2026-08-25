import React, { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { AlertCircle, Plus, Trash2, Send } from 'lucide-react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { ChartOfAccountRow } from '@/types/database';

export function JournalBuilder({ onCancel, onSuccess }: { onCancel: () => void, onSuccess: () => void }) {
  const { data: accounts } = useSupabaseData<ChartOfAccountRow>({ table: 'chart_of_accounts' });
  
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<{ account_id: string; debit: number; credit: number; branch_id: string }[]>([
    { account_id: '', debit: 0, credit: 0, branch_id: '' },
    { account_id: '', debit: 0, credit: 0, branch_id: '' }
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const availableAccounts = accounts ?? [];

  const totalDebit = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0), [lines]);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const handlePost = async () => {
    try {
      setSaving(true);
      setError(null);
      
      // Validation rules
      if (!isBalanced) throw new Error('Journal is not balanced (debit != credit)');
      if (lines.some(l => !l.account_id)) throw new Error('All lines must have an account selected');
      if (lines.some(l => l.debit < 0 || l.credit < 0)) throw new Error('Amounts cannot be negative');

      // Create journal entry using the RPC that enforces invariants
      const { error: rpcError } = await supabase.rpc('post_journal_entry', {
        p_description: description,
        p_reference: reference,
        p_entry_date: new Date().toISOString().split('T')[0],
        p_lines: lines.map(l => ({
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          branch_id: l.branch_id || null,
          currency_code: 'SAR',
          exchange_rate: 1
        }))
      });

      if (rpcError) throw new Error(rpcError.message);
      
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-white">New Journal Entry</h2>
        <div className="flex items-center gap-4">
          <div className={"px-3 py-1 rounded-full text-sm font-semibold " + (isBalanced ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400')}>
            {isBalanced ? 'Balanced' : 'Imbalance: ' + Math.abs(totalDebit - totalCredit).toLocaleString() + ' SAR'}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">Description</label>
          <input 
            type="text" 
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500" 
            placeholder="E.g. Monthly Rent" 
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">Reference</label>
          <input 
            type="text" 
            value={reference}
            onChange={e => setReference(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500" 
            placeholder="INV-001" 
          />
        </div>
      </div>

      <div className="mb-6">
        <div className="grid grid-cols-12 gap-4 mb-2 px-4 text-xs font-semibold text-white/50 tracking-wider">
          <div className="col-span-5">ACCOUNT</div>
          <div className="col-span-3">BRANCH (OPTIONAL)</div>
          <div className="col-span-2 text-right">DEBIT</div>
          <div className="col-span-2 text-right">CREDIT</div>
        </div>
        
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-12 gap-4 mb-2 items-center">
            <div className="col-span-5">
              <select 
                value={line.account_id}
                onChange={e => { const newLines = [...lines]; newLines[i].account_id = e.target.value; setLines(newLines); }}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select Account...</option>
                {availableAccounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <input 
                type="text" 
                value={line.branch_id}
                onChange={e => { const newLines = [...lines]; newLines[i].branch_id = e.target.value; setLines(newLines); }}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500" 
                placeholder="Branch ID" 
              />
            </div>
            <div className="col-span-2">
              <input 
                type="number" 
                value={line.debit || ''}
                onChange={e => { const newLines = [...lines]; newLines[i].debit = Number(e.target.value); newLines[i].credit = 0; setLines(newLines); }}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white text-right focus:outline-none focus:border-indigo-500" 
              />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input 
                type="number" 
                value={line.credit || ''}
                onChange={e => { const newLines = [...lines]; newLines[i].credit = Number(e.target.value); newLines[i].debit = 0; setLines(newLines); }}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white text-right focus:outline-none focus:border-indigo-500" 
              />
              <button 
                onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                className="p-2 text-white/30 hover:text-red-400 transition-colors"
                disabled={lines.length <= 2}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        <button 
          onClick={() => setLines([...lines, { account_id: '', debit: 0, credit: 0, branch_id: '' }])}
          className="mt-4 flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Line
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 pt-6">
        <div className="flex gap-8 text-sm">
          <div>
            <span className="text-white/50 block mb-1">Total Debit</span>
            <span className="text-lg font-mono font-bold text-white">{totalDebit.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-white/50 block mb-1">Total Credit</span>
            <span className="text-lg font-mono font-bold text-white">{totalCredit.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="px-6 py-2 rounded-lg font-medium text-white/70 hover:bg-white/5 transition-colors border border-transparent hover:border-white/10"
          >
            Cancel
          </button>
          <button 
            onClick={handlePost}
            disabled={saving || !isBalanced || totalDebit === 0}
            className="px-6 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
            Post Journal
          </button>
        </div>
      </div>
    </div>
  );
}
