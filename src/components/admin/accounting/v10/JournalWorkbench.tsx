import React, { useState, useEffect } from 'react';
import { supabase } from '../../../../lib/supabase';
import { Loader2, AlertCircle, Plus, FileText } from 'lucide-react';

export interface JournalEntryDTO {
  id: string;
  reference: string;
  description: string;
  lines: JournalLineDTO[];
  status: 'draft' | 'posted';
}

export interface JournalLineDTO {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

interface SupabaseInsertClient {
  from(table: string): {
    insert(data: unknown): Promise<{ error: Error | null; data: unknown }> & {
      select(): { single(): Promise<{ data: unknown; error: Error | null }> }
    };
    update(data: unknown): {
      eq(col: string, val: string): Promise<{ error: Error | null }>;
    };
  };
}

export function JournalWorkbench() {
  const [entries, setEntries] = useState<JournalEntryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error: fetchError } = await supabase
        .from('journals')
        .select(`
          id,
          reference,
          description,
          status,
          journal_lines (
            id,
            account_id,
            debit,
            credit,
            description
          )
        `)
        .order('created_at', { ascending: false });

      if (fetchError) {
        if (fetchError.code === '42P01') {
          setEntries([]);
          return;
        }
        throw fetchError;
      }

      const mapped: JournalEntryDTO[] = (data || []).map((d: unknown) => {
        const entry = d as Record<string, unknown>;
        const lines = Array.isArray(entry.journal_lines) ? entry.journal_lines : [];
        return {
          id: String(entry.id || ''),
          reference: String(entry.reference || ''),
          description: String(entry.description || ''),
          status: entry.status as 'draft' | 'posted',
          lines: lines.map((l: unknown) => {
            const line = l as Record<string, unknown>;
            return {
              id: String(line.id || ''),
              accountId: String(line.account_id || ''),
              debit: Number(line.debit || 0),
              credit: Number(line.credit || 0),
              description: String(line.description || '')
            };
          })
        };
      });
      setEntries(mapped);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateDualEntry = async () => {
    try {
      setIsPosting(true);
      setError(null);

      const db = supabase as unknown as SupabaseInsertClient;

      // Create journal header
      const { data: journalData, error: journalError } = await db.from('journals').insert([
        {
          reference: `JRN-${Math.floor(Math.random() * 10000)}`,
          description: 'Automated Dual-Entry Test',
          status: 'draft'
        }
      ]).select().single();

      if (journalError) throw journalError;

      if (journalData && typeof journalData === 'object' && 'id' in journalData) {
        const journalId = String((journalData as Record<string, unknown>).id);
        
        // Insert balanced lines
        const { error: lineError } = await db.from('journal_lines').insert([
          {
            journal_id: journalId,
            account_id: '00000000-0000-0000-0000-000000000001', // Example UUID
            debit: 5000,
            credit: 0,
            description: 'Cash in Bank'
          },
          {
            journal_id: journalId,
            account_id: '00000000-0000-0000-0000-000000000002', // Example UUID
            debit: 0,
            credit: 5000,
            description: 'Service Revenue'
          }
        ]);

        if (lineError) throw lineError;

        // Attempt to post
        const { error: postError } = await db
          .from('journals')
          .update({ status: 'posted' })
          .eq('id', journalId);

        if (postError) throw postError;
      }

      await load();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError('Failed to create entry: ' + err.message);
      }
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent text-white/90">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/[0.04]/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal Workbench</h1>
          <p className="text-sm text-white/55">Manage and post double-entry general ledger journals</p>
        </div>
        <button 
          onClick={handleCreateDualEntry}
          disabled={isPosting}
          className="flex items-center space-x-2 px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-all duration-200 ease-in-out font-medium disabled:opacity-50"
        >
          {isPosting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2} />}
          <span>{isPosting ? 'Posting...' : 'New Balanced Entry'}</span>
        </button>
      </div>

      <div className="p-6 flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-white/55">Loading journals...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 mb-6">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}
        
        {!loading && entries.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 border border-dashed border-white/10 rounded-xl">
            <FileText className="w-8 h-8 text-white/40 mb-4" />
            <p className="text-white/55">No journal entries found</p>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-4">
            {entries.map(entry => (
              <div key={entry.id} className="bg-white/[0.04]/40 border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-colors">
                <div className="p-4 bg-white/[0.05] flex items-center justify-between border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-white/90">{entry.reference || 'Untitled'}</span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      entry.status === 'posted' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {entry.status.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-sm text-white/55">{entry.description}</span>
                </div>
                <div className="p-4">
                  <table className="w-full text-sm">
                    <thead className="text-white/40 text-left border-b border-white/5">
                      <tr>
                        <th className="pb-2 font-medium">Account ID</th>
                        <th className="pb-2 font-medium">Description</th>
                        <th className="pb-2 font-medium text-right">Debit</th>
                        <th className="pb-2 font-medium text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {entry.lines.map(line => (
                        <tr key={line.id}>
                          <td className="py-2 text-white/80 font-mono text-xs">{line.accountId.substring(0, 8)}...</td>
                          <td className="py-2 text-white/55">{line.description}</td>
                          <td className="py-2 text-emerald-400 text-right">{line.debit > 0 ? `$${line.debit.toLocaleString()}` : '-'}</td>
                          <td className="py-2 text-rose-400 text-right">{line.credit > 0 ? `$${line.credit.toLocaleString()}` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
