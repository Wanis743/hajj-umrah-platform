import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, CheckCircle2, Loader2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { JournalBuilder } from './JournalBuilder';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { supabase } from '@/lib/supabase';
import type { ChartOfAccountRow, GenericRow, JournalLineRow } from '@/types/database';
import { useI18n } from '@/i18n/I18nProvider';

const STATUS_STYLES: Record<string, string> = {
  POSTED: 'bg-emerald-500/15 text-emerald-400',
  DRAFT: 'bg-amber-500/15 text-amber-400',
  PENDING: 'bg-amber-500/15 text-amber-400',
  VOID: 'bg-white/10 text-white/40',
};

export function JournalWorkspace() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : lang === 'fr' ? fr : en);

  const [searchTerm, setSearchTerm] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<JournalLineRow[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [posting, setPosting] = useState(false);

  const { data: journals, loading, refetch } = useSupabaseData<GenericRow>({
    table: 'journal_entries',
    columns: 'id,reference,description,status,entry_date,source_type,created_at',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
    limit: 200,
  });
  const { data: accounts } = useSupabaseData<ChartOfAccountRow>({
    table: 'chart_of_accounts', columns: 'id,code,name', limit: 500,
  });

  const accountById = useMemo(() => {
    const map = new Map<string, ChartOfAccountRow>();
    for (const a of accounts) map.set(a.id, a);
    return map;
  }, [accounts]);

  const filtered = journals.filter((j) =>
    (j.reference && String(j.reference).toLowerCase().includes(searchTerm.toLowerCase()))
    || (j.description && String(j.description).toLowerCase().includes(searchTerm.toLowerCase())),
  );

  const selected = journals.find((j) => j.id === selectedId) ?? null;

  // Drill into the selected entry: load its real lines from journal_lines.
  useEffect(() => {
    if (!selectedId) { setLines([]); return; }
    let cancelled = false;
    setLinesLoading(true);
    supabase
      .from('journal_lines')
      .select('id,journal_entry_id,account_id,debit,credit,memo,currency_code')
      .eq('journal_entry_id', selectedId)
      .then(({ data }) => {
        if (cancelled) return;
        setLines((data ?? []) as unknown as JournalLineRow[]);
        setLinesLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);

  const postEntry = async (id: string) => {
    try {
      setPosting(true);
      const { error } = await supabase.rpc('approve_journal_entry', { p_journal_id: id });
      if (error) throw error;
      toast.success(t('تم ترحيل القيد', 'Écriture validée', 'Journal posted'));
      await refetch();
    } catch (e: unknown) {
      toast.error(t('فشل الترحيل', 'Échec de la validation', 'Failed to post') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPosting(false);
    }
  };

  if (isBuilding) {
    return (
      <JournalBuilder
        onCancel={() => setIsBuilding(false)}
        onSuccess={() => {
          setIsBuilding(false);
          void refetch();
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">
          {t('دفتر اليومية', 'Journal', 'Journal')}
        </h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] rtl:left-auto rtl:right-3" />
            <input
              type="text"
              placeholder={t('بحث…', 'Rechercher…', 'Search…')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm w-56 focus:outline-none focus:border-[var(--brand-500)] rtl:pl-4 rtl:pr-9"
            />
          </div>
          <button onClick={() => setIsBuilding(true)} className="btn btn-sm btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> {t('قيد جديد', 'Nouvelle écriture', 'New Entry')}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-3">
        {/* Entries table */}
        <div className="flex-1 min-w-0 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap rtl:text-right">
              <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-secondary)] font-medium sticky top-0">
                <tr>
                  <th className="px-4 py-3">{t('التاريخ', 'Date', 'Date')}</th>
                  <th className="px-4 py-3">{t('المرجع', 'Référence', 'Reference')}</th>
                  <th className="px-4 py-3">{t('الوصف', 'Description', 'Description')}</th>
                  <th className="px-4 py-3">{t('الحالة', 'Statut', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      {t('جاري التحميل…', 'Chargement…', 'Loading…')}
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      {t('لم يتم العثور على قيود', 'Aucune écriture trouvée', 'No journal entries found')}
                    </td>
                  </tr>
                ) : (
                  filtered.map((j) => (
                    <tr
                      key={String(j.id)}
                      onClick={() => setSelectedId(String(j.id) === selectedId ? null : String(j.id))}
                      className={`transition-colors cursor-pointer ${
                        selectedId === j.id ? 'bg-[var(--brand-500)]/10' : 'hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                        {j.entry_date ? new Date(String(j.entry_date)).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <span className="flex items-center gap-2">
                          {String(j.reference || '-')}
                          {!!j.source_type && (
                            <span
                              className="px-1.5 py-0.5 bg-sky-500/15 text-sky-400 rounded text-[10px] uppercase font-bold"
                              title={t('مولّد آلياً من ' + String(j.source_type), 'Généré depuis ' + String(j.source_type), `System generated from ${String(j.source_type)}`)}
                            >
                              {t('آلي', 'AUTO', 'AUTO')}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[320px] truncate">{String(j.description || '-')}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-md text-xs font-semibold ${STATUS_STYLES[String(j.status || 'DRAFT')] ?? STATUS_STYLES.DRAFT}`}>
                          {String(j.status || 'DRAFT')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Entry inspector drawer */}
        {selected && (
          <div className="w-[380px] flex-none bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl flex flex-col overflow-hidden fos-rise">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-[var(--text-muted)] flex-none" />
                <span className="font-mono text-sm font-semibold text-[var(--text-primary)] truncate">
                  {String(selected.reference || '-')}
                </span>
              </div>
              <button className="icon-btn" onClick={() => setSelectedId(null)} aria-label={t('إغلاق', 'Fermer', 'Close')}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                  {t('الوصف', 'Description', 'Description')}
                </div>
                <p className="text-sm text-[var(--text-primary)]">{String(selected.description || '-')}</p>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  {t('الأسطر', 'Lignes', 'Lines')}
                </div>
                {linesLoading ? (
                  <div className="py-6 flex items-center justify-center text-[var(--text-muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : lines.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] py-4 text-center">
                    {t('لا أسطر لهذا القيد', 'Aucune ligne pour cette écriture', 'No lines on this entry')}
                  </p>
                ) : (
                  <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                        <tr>
                          <th className="px-3 py-2 text-start">{t('الحساب', 'Compte', 'Account')}</th>
                          <th className="px-3 py-2 text-end">{t('مدين', 'Débit', 'Debit')}</th>
                          <th className="px-3 py-2 text-end">{t('دائن', 'Crédit', 'Credit')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {lines.map((l) => {
                          const acc = accountById.get(l.account_id);
                          return (
                            <tr key={l.id}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-[var(--text-primary)]">{acc?.name ?? l.account_id.slice(0, 8)}</div>
                                <div className="text-[var(--text-muted)] font-mono text-[10px]">{acc?.code ?? ''}</div>
                              </td>
                              <td className="px-3 py-2 text-end font-mono text-[var(--text-secondary)]">
                                {Number(l.debit ?? 0) > 0 ? Number(l.debit).toLocaleString() : '-'}
                              </td>
                              <td className="px-3 py-2 text-end font-mono text-[var(--text-secondary)]">
                                {Number(l.credit ?? 0) > 0 ? Number(l.credit).toLocaleString() : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-[var(--bg-secondary)] font-semibold">
                        <tr>
                          <td className="px-3 py-2 text-[var(--text-muted)]">{t('الإجمالي', 'Total', 'Total')}</td>
                          <td className="px-3 py-2 text-end font-mono">{totalDebit.toLocaleString()}</td>
                          <td className="px-3 py-2 text-end font-mono">{totalCredit.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {(selected.status === 'DRAFT' || selected.status === 'PENDING') && (
              <div className="p-3 border-t border-[var(--border)]">
                <button
                  onClick={() => postEntry(String(selected.id))}
                  disabled={posting}
                  className="btn btn-sm btn-primary w-full flex items-center justify-center gap-2"
                >
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {t('ترحيل القيد', 'Valider l’écriture', 'Post entry')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
