import React, { useState } from 'react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { ChartOfAccountRow } from '@/types/database';
import { FileText, Plus, Search, Filter } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';

export function ChartOfAccounts() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const [searchTerm, setSearchTerm] = useState('');
  const { data: accounts, loading } = useSupabaseData<ChartOfAccountRow>({
    table: 'chart_of_accounts',
    orderBy: { column: 'code', ascending: true },
    fallbackData: [],
  });

  const filtered = accounts.filter(a => 
    (a.code && a.code.includes(searchTerm)) || 
    (a.name && a.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">
          {t('دليل الحسابات', 'Plan Comptable', 'Chart of Accounts')}
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
          <button className="btn btn-sm btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> {t('إضافة حساب', 'Ajouter', 'Add Account')}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-secondary)] font-medium">
              <tr>
                <th className="px-4 py-3">{t('الرمز', 'Code', 'Code')}</th>
                <th className="px-4 py-3">{t('الاسم', 'Nom', 'Name')}</th>
                <th className="px-4 py-3">{t('النوع', 'Type', 'Type')}</th>
                <th className="px-4 py-3 text-right">{t('الرصيد', 'Solde', 'Balance')}</th>
                <th className="px-4 py-3 text-center">{t('الحالة', 'Statut', 'Status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {t('جاري التحميل...', 'Chargement...', 'Loading...')}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {t('لا توجد حسابات', 'Aucun compte trouvé', 'No accounts found')}
                  </td>
                </tr>
              ) : (
                filtered.map(acc => (
                  <tr key={acc.id} className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group">
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{acc.code}</td>
                    <td className="px-4 py-3 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[var(--text-muted)]" />
                      {acc.name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded-md text-xs">
                        {acc.account_type || 'GENERAL'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {acc.balance != null ? acc.balance.toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {acc.is_active !== false ? (
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-slate-300 inline-block"></span>
                      )}
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
