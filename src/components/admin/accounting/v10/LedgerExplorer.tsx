import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface LedgerAccountDTO {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  balance: number;
}

export function LedgerExplorer() {
  const [accounts, setAccounts] = useState<LedgerAccountDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data, error: fetchError } = await supabase
          .from('chart_of_accounts')
          .select('id, code, name, account_type, balance')
          .order('code', { ascending: true });

        if (fetchError) throw fetchError;

        const mapped: LedgerAccountDTO[] = (data || []).map((d: unknown) => {
          const acc = d as Record<string, unknown>;
          return {
            id: String(acc.id || ''),
            code: String(acc.code || ''),
            name: String(acc.name || ''),
            type: (acc.account_type as LedgerAccountDTO['type']) || 'ASSET',
            balance: Number(acc.balance || 0)
          };
        });
        setAccounts(mapped);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 text-slate-200 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Ledger Explorer</h1>
      <div className="backdrop-blur-md bg-slate-900/40 border border-white/10 rounded-xl p-4 flex-1">
         <div className="grid grid-cols-4 gap-4 pb-2 border-b-2 border-indigo-400 mb-4 text-slate-400 uppercase tracking-wider text-xs font-medium">
           <div>Code</div>
           <div>Account Name</div>
           <div>Type</div>
           <div>Balance</div>
         </div>
         {loading && <div className="text-slate-500 mt-4 text-sm">Loading...</div>}
         {error && <div className="text-red-500 mt-4 text-sm">Error: {error}</div>}
         {!loading && !error && accounts.length === 0 && <div className="text-slate-500 mt-4 text-sm">No accounts found.</div>}
         {!loading && !error && accounts.map(account => (
           <div key={account.id} className="grid grid-cols-4 gap-4 py-2 border-b border-white/5 text-sm">
             <div>{account.code}</div>
             <div>{account.name}</div>
             <div>{account.type}</div>
             <div>{account.balance}</div>
           </div>
         ))}
      </div>
    </div>
  );
}
