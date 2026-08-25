import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle, RefreshCw, Upload, Search, Link2, Check, FileSpreadsheet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useI18n } from '@/i18n/I18nProvider';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { supabase } from '@/lib/supabase';
import type { BankStatementRow, BankTransactionRow, JournalLineRow } from '@/types/database';

/** Net ledger amount of a line (debit − credit), supporting legacy *_dzd columns. */
function lineNet(l: JournalLineRow): number {
  const rec = l as unknown as Record<string, unknown>;
  const d = Number(l.debit ?? rec['debit_dzd'] ?? 0);
  const c = Number(l.credit ?? rec['credit_dzd'] ?? 0);
  return (Number.isNaN(d) ? 0 : d) - (Number.isNaN(c) ? 0 : c);
}

export function ReconciliationWorkspace() {
  const { lang } = useI18n();
  const t = (ar: string, fr: string, en: string) => (lang === 'ar' || lang === 'dz') ? ar : lang === 'fr' ? fr : en;

  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeStatementId, setActiveStatementId] = useState<string>('');
  const [selectedTx, setSelectedTx] = useState<string | null>(null);
  const [selectedLedger, setSelectedLedger] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: statements } = useSupabaseData<BankStatementRow>({
    table: 'bank_statements',
    columns: 'id,statement_date,start_balance,end_balance,status,bank_account_id',
    orderBy: { column: 'statement_date', ascending: false },
    limit: 100,
  });
  const { data: transactions, refetch: refetchTx } = useSupabaseData<BankTransactionRow>({
    table: 'bank_transactions',
    columns: 'id,statement_id,transaction_date,amount,description,reference,status,matched_journal_line_id',
    limit: 1000,
  });
  const { data: journalLines } = useSupabaseData<JournalLineRow>({
    table: 'journal_lines',
    columns: 'id,journal_entry_id,account_id,debit,credit,memo,currency_code',
    limit: 2000,
  });

  const activeStatement = statements.find((s) => s.id === activeStatementId) ?? statements[0];

  const unmatchedTxs = useMemo(
    () => transactions.filter((t) => t.statement_id === activeStatement?.id && t.status === 'UNMATCHED'),
    [transactions, activeStatement],
  );

  // Unmatched ledger lines on THIS statement's bank account — the old version
  // listed every line in the ledger, which made manual matching meaningless.
  const unreconciledLedgers = useMemo(() => {
    const matchedIds = new Set(
      transactions.map((t) => t.matched_journal_line_id).filter(Boolean) as string[],
    );
    return journalLines.filter((jl) => {
      if (matchedIds.has(jl.id)) return false;
      const account = activeStatement?.bank_account_id as string | undefined;
      if (account) return jl.account_id === account;
      return true;
    });
  }, [journalLines, transactions, activeStatement]);

  const handleAutoMatch = async () => {
    if (!activeStatement) return;
    try {
      setRunning(true);
      const { data, error } = await supabase.rpc('auto_reconcile_bank_statement', { p_statement_id: activeStatement.id });
      if (error) throw error;
      const matched = (data as Record<string, number> | null)?.matched_count ?? 0;
      toast.success(t(
        `تمت المطابقة التلقائية: ${matched} سطراً`,
        `Rapprochement automatique terminé : ${matched} ligne(s)`,
        `Auto-match complete: ${matched} line${matched === 1 ? '' : 's'} matched`,
      ));
      refetchTx();
    } catch (e: unknown) {
      toast.error((e instanceof Error ? e.message : String(e)));
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
        .update({ status: 'MATCHED', matched_journal_line_id: selectedLedger })
        .eq('id', selectedTx);
      if (error) throw error;
      toast.success(t('تمت المطابقة', 'Ligne rapprochée', 'Transaction matched'));
      setSelectedTx(null);
      setSelectedLedger(null);
      refetchTx();
    } catch (e: unknown) {
      toast.error(t('فشلت المطابقة', 'Échec du rapprochement', 'Match failed') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  };

  /**
   * Real CSV import: flexible parser accepting a header row and both comma /
   * semicolon delimiters. Expected columns: date, description, amount [, reference].
   */
  const handleImportFile = async (file: File) => {
    if (!activeStatement) return;
    try {
      setImporting(true);
      const text = await file.text();
      const rowsRaw = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
      if (rowsRaw.length === 0) throw new Error(t('الملف فارغ', 'Fichier vide', 'The file is empty'));
      const delim = rowsRaw[0].includes(';') ? ';' : ',';
      const rows = rowsRaw.map((r) => r.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
      // Skip a header row when the first cell is not a date.
      const startIdx = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(rows[0][0] ?? '') ? 0 : 1;
      const parsed: Partial<BankTransactionRow>[] = rows.slice(startIdx).map((cells) => {
        const rawDate = cells[0] ?? '';
        const date = /^\d{4}-/.test(rawDate)
          ? rawDate
          : rawDate.split(/[-/]/).reverse().join('-'); // dd/mm/yyyy → yyyy-mm-dd
        const amount = Number((cells[2] ?? '').replace(/\s/g, '').replace(',', '.'));
        return {
          statement_id: activeStatement.id,
          transaction_date: date,
          description: cells[1] || undefined,
          amount,
          reference: cells[3] || undefined,
          status: 'UNMATCHED',
        };
      }).filter((r) => !Number.isNaN(r.amount) && String(r.transaction_date ?? '').length >= 8);

      if (parsed.length === 0) {
        throw new Error(t(
          'لا أسطر صالحة. التنسيق: التاريخ، الوصف، المبلغ[, المرجع]',
          'Aucune ligne valide. Format : date, description, montant [, référence]',
          'No valid rows. Format: date, description, amount [, reference]',
        ));
      }
      const { error } = await supabase.from('bank_transactions').insert(parsed);
      if (error) throw error;
      toast.success(t(
        `تم استيراد ${parsed.length} سطراً`,
        `${parsed.length} ligne(s) importée(s)`,
        `${parsed.length} line${parsed.length === 1 ? '' : 's'} imported`,
      ));
      refetchTx();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const tx = unmatchedTxs.find((t2) => t2.id === selectedTx);
  const jl = unreconciledLedgers.find((l) => l.id === selectedLedger);
  const txAmount = tx ? Number(tx.amount) : 0;
  // Bank convention: positive = money In (debit), negative = money OUT (credit).
  const jlAmount = jl ? lineNet(jl) : 0;
  const variance = Math.abs(txAmount - jlAmount);

  return (
    <div className="h-full flex flex-col text-slate-200">
      {/* Toolbar — the window titlebar already names the app; no inner masthead */}
      <div className="flex flex-wrap justify-end items-center gap-2 pb-3 border-b border-slate-700/50">
        {/* Statement picker — previously the statement was chosen silently */}
          <select
            value={activeStatement?.id ?? ''}
            onChange={(e) => { setActiveStatementId(e.target.value); setSelectedTx(null); setSelectedLedger(null); }}
            className="h-9 rounded-lg border border-slate-600 bg-slate-800 px-3 text-sm text-slate-200 focus:outline-none focus:border-purple-400"
            disabled={statements.length === 0}
          >
            {statements.length === 0 ? (
              <option>{t('لا كشوفات', 'Aucun relevé', 'No statements')}</option>
            ) : statements.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.statement_date).toLocaleDateString()} · {s.status}
              </option>
            ))}
          </select>

          <input
            ref={fileInput}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={importing || !activeStatement}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t('استيراد CSV', 'Importer CSV', 'Import CSV')}
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 border border-purple-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            onClick={handleAutoMatch}
            disabled={running || !activeStatement}
          >
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t('مطابقة تلقائية', 'Rapprochement auto', 'Auto-match')}
          </button>
      </div>

      {activeStatement && (
        <div className="flex items-center gap-4 py-2 text-[11px] text-slate-500">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span>
            {t(
              `رصيد الكشف: ${Number(activeStatement.start_balance ?? 0).toLocaleString()} → ${Number(activeStatement.end_balance ?? 0).toLocaleString()}`,
              `Solde du relevé : ${Number(activeStatement.start_balance ?? 0).toLocaleString()} → ${Number(activeStatement.end_balance ?? 0).toLocaleString()}`,
              `Statement balance: ${Number(activeStatement.start_balance ?? 0).toLocaleString()} → ${Number(activeStatement.end_balance ?? 0).toLocaleString()}`,
            )}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col pt-2">
        {/* Match action bar */}
        {selectedTx && selectedLedger && (
          <div className="bg-indigo-900/40 border border-indigo-500/30 rounded-xl mb-3 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xs text-indigo-400 font-medium">{t('سطر البنك', 'Ligne bancaire', 'Bank line')}</div>
                <div className="text-lg font-bold text-white">{txAmount.toLocaleString()} DZD</div>
              </div>
              <Link2 className="w-5 h-5 text-indigo-500" />
              <div>
                <div className="text-xs text-indigo-400 font-medium">{t('سطر الأستاذ', 'Écriture', 'Ledger line')}</div>
                <div className="text-lg font-bold text-white">{jlAmount.toLocaleString()} DZD</div>
              </div>
              <div className="h-8 w-px bg-indigo-500/30" />
              <div>
                <div className="text-xs text-indigo-400 font-medium">{t('الفرق', 'Écart', 'Variance')}</div>
                <div className={`text-lg font-bold ${variance === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {variance.toLocaleString()} DZD
                </div>
              </div>
            </div>
            <button
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 border border-indigo-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
              onClick={handleManualMatch}
              disabled={running}
            >
              <Check className="w-4 h-4" />
              {t('تأكيد المطابقة', 'Confirmer', 'Confirm match')}
            </button>
          </div>
        )}

        <div className="flex-1 flex min-h-0 gap-3">
          {/* Bank lines */}
          <div className="w-1/2 border border-slate-700/50 rounded-xl flex flex-col overflow-hidden bg-slate-900/40">
            <div className="p-3 border-b border-slate-700/50 bg-slate-800/30 font-medium text-slate-300 flex justify-between items-center text-sm">
              <span>{t('أسطر البنك غير المطابقة', 'Lignes bancaires non rapprochées', 'Unmatched bank lines')}</span>
              <span className="px-2 py-0.5 bg-slate-700 rounded text-xs">{unmatchedTxs.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {unmatchedTxs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                  <CheckCircle className="h-8 w-8 mb-2 opacity-20" />
                  <p>{t('كل الأسطر مطابقة', 'Toutes les lignes sont rapprochées', 'All bank lines matched')}</p>
                </div>
              ) : (
                unmatchedTxs.map((t2) => (
                  <button
                    key={t2.id}
                    onClick={() => setSelectedTx(selectedTx === t2.id ? null : t2.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedTx === t2.id
                        ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/50'
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">{t2.description || t('بدون وصف', 'Sans description', 'No description')}</span>
                      <span className={`text-sm font-bold flex-none ${Number(t2.amount) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {Number(t2.amount).toLocaleString()} DZD
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex justify-between">
                      <span>{t2.transaction_date && new Date(t2.transaction_date).toLocaleDateString()}</span>
                      <span className="font-mono">{t2.reference}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Ledger lines */}
          <div className="w-1/2 border border-slate-700/50 rounded-xl flex flex-col overflow-hidden bg-slate-900/40">
            <div className="p-3 border-b border-slate-700/50 bg-slate-800/30 font-medium text-slate-300 flex justify-between items-center text-sm">
              <span>{t('أسطر الأستاذ غير المسوّاة', 'Écritures non rapprochées', 'Unreconciled ledger lines')}</span>
              <span className="px-2 py-0.5 bg-slate-700 rounded text-xs">{unreconciledLedgers.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {unreconciledLedgers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                  <CheckCircle className="h-8 w-8 mb-2 opacity-20" />
                  <p>{t('كل أسطر الأستاذ مسوّاة', 'Toutes les écritures sont rapprochées', 'All ledger lines reconciled')}</p>
                </div>
              ) : (
                unreconciledLedgers.map((l) => {
                  const net = lineNet(l);
                  return (
                    <button
                      key={l.id}
                      onClick={() => setSelectedLedger(selectedLedger === l.id ? null : l.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedLedger === l.id
                          ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/50'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2 gap-2">
                        <span className="text-sm font-medium text-slate-200 truncate">
                          {String((l as unknown as Record<string, unknown>).memo ?? '') || t('سطر أستاذ', 'Ligne du grand livre', 'Ledger line')}
                        </span>
                        <span className={`text-sm font-bold flex-none ${net > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {net.toLocaleString()} DZD
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {t('الحساب', 'Compte', 'Account')}: {String(l.account_id || '').slice(0, 8)}…
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
