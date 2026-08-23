import { JournalBuilder } from './JournalBuilder';
import React, { useState } from 'react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { GenericRow } from '@/types/database';
import { FileText, Plus, Search } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';

export function JournalWorkspace() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const [searchTerm, setSearchTerm] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const { data: journals, loading } = useSupabaseData<GenericRow>({
    table: 'journal_entries',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const filtered = journals.filter(j => 
    (j.reference && String(j.reference).includes(searchTerm)) || 
    (j.description && String(j.description).toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (isBuilding) {
    return <JournalBuilder onCancel={() => setIsBuilding(false)} onSuccess={() => setIsBuilding(false)} />;
  }

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">
          {t('دفتر اليومية', 'Journal', 'Journal')}
        </h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <input 
              type="text" 
              placeholder={t('بحث...', 'Rechercher...', 'Search...')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm w-64 focus:outline-none focus:border-[var(--brand-500)]"
            />
          </div>
          <button onClick={() => setIsBuilding(true)} className="btn btn-sm btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> {t('إضافة قيد', 'Nouvelle', 'New Entry')}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-secondary)] font-medium">
              <tr>
                <th className="px-4 py-3">{t('التاريخ', 'Date', 'Date')}</th>
                <th className="px-4 py-3">{t('المرجع', 'RAcfAcrence', 'Reference')}</th>
                <th className="px-4 py-3">{t('الوصف', 'Description', 'Description')}</th>
                <th className="px-4 py-3">{t('الحالة', 'Statut', 'Status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {t('جاري التحميل...', 'Chargement...', 'Loading...')}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {t('لم يتم العثور على قيود', 'Aucune Accriture trouvAce', 'No journals found')}
                  </td>
                </tr>
              ) : (
                filtered.map(j => (
                  <tr key={String(j.id)} className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group">
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      {j.entry_date ? new Date(String(j.entry_date)).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono flex items-center gap-2">
  {String(j.reference || '-')}
  {!!j.source_type && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] uppercase font-bold" title={`System generated from ${String(j.source_type)}`}>AUTO</span>}
</td>
                    <td className="px-4 py-3">{String(j.description || '-')}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded-md text-xs">
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
    </div>
  );
}
