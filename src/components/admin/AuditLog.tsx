import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { History, Search, Plus } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';

interface AuditLogRow {
  id: string;
  action?: string;
  resource?: string;
  resource_id?: string;
  user_email?: string;
  details?: Record<string, unknown> | null;
  timestamp?: string;
  created_at?: string;
  [key: string]: unknown;
}

export default function AuditLog() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: logs, loading } = useSupabaseData<AuditLogRow>({
    table: 'audit_logs',
    orderBy: { column: 'timestamp', ascending: false },
    fallbackData: [],
  });

  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ action: '', resource: '', resource_id: '', user_email: '', details: '' });

  const filtered = logs.filter(l => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [l.action, l.resource, l.resource_id, l.user_email, JSON.stringify(l.details || {})]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  const badgeColor = (action: string) => {
    const a = (action || '').toUpperCase();
    if (a.includes('CREATE') || a.includes('INSERT')) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    if (a.includes('DELETE') || a.includes('REMOVE')) return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    if (a.includes('UPDATE') || a.includes('EDIT')) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    if (a.includes('LOGIN') || a.includes('LOGOUT')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
  };

  const inputCls = 'input';

  const spinner = (
    <div className="p-10 flex justify-center">
      <Spinner />
    </div>
  );

  return (
    <div className={"space-y-6 flex flex-col h-full " + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-brand-500/10 flex items-center justify-center">
            <History className="h-5 w-5 text-brand-500" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {t('سجل التدقيق', 'Journal d\'audit', 'Audit Log')}
            </h1>
            <p className="text-[13px] text-[var(--text-muted)]">
              {t('تتبع جميع التغييرات في النظام', 'Suivre toutes les modifications du système', 'Track all changes in the system')}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 card p-4 opacity-60" aria-disabled="true">
        <div>
          <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الإجراء', 'Action', 'Action')}</label>
          <input
            value={form.action}
            onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
            placeholder={t('CREATE / UPDATE / DELETE...', 'CREATE / UPDATE / DELETE...', 'CREATE / UPDATE / DELETE...')}
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('المورد', 'Ressource', 'Resource')}</label>
          <input
            value={form.resource}
            onChange={e => setForm(f => ({ ...f, resource: e.target.value }))}
            placeholder={t('Booking #B100...', 'Réservation #B100...', 'Booking #B100...')}
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('معرف المورد', 'ID ressource', 'Resource ID')}</label>
          <input
            value={form.resource_id}
            onChange={e => setForm(f => ({ ...f, resource_id: e.target.value }))}
            placeholder={t('اختياري', 'Optionnel', 'Optional')}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('البريد الإلكتروني', 'Email', 'User email')}</label>
          <input
            type="email"
            value={form.user_email}
            onChange={e => setForm(f => ({ ...f, user_email: e.target.value }))}
            placeholder={t('admin@example.com', 'admin@example.com', 'admin@example.com')}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('التفاصيل (JSON)', 'Détails (JSON)', 'Details (JSON)')}</label>
          <input
            value={form.details}
            onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
            placeholder={'{"old": "...", "new": "..."}'}
            className={inputCls}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
          <button type="button" disabled className="btn btn-primary">
            <Plus className="w-4 h-4" />
            {t('تسجيل إدخال', 'Enregistrer une entrée', 'Record Entry')}
          </button>
        </div>
      </div>

      <div className="flex-1 card flex flex-col overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/50">
          <div className={`relative ${isAr ? 'rtl' : 'ltr'}`}>
            <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)] start-3`} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('البحث في السجل...', 'Rechercher...', 'Search logs...')}
              className={`w-full bg-white dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg py-2 text-sm focus:outline-none focus:border-[var(--accent)] ps-10 pe-4`}
            />
          </div>
        </div>

        {loading ? spinner : (
          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[720px] text-sm text-start">
              <thead className={`text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/50 ${isAr ? 'text-end' : 'text-start'}`}>
                <tr>
                  <th className="px-4 py-3 font-medium">{t('التاريخ', 'Date', 'Date')}</th>
                  <th className="px-4 py-3 font-medium">{t('المستخدم', 'Utilisateur', 'User')}</th>
                  <th className="px-4 py-3 font-medium">{t('الإجراء', 'Action', 'Action')}</th>
                  <th className="px-4 py-3 font-medium">{t('المورد', 'Ressource', 'Resource')}</th>
                  <th className="px-4 py-3 font-medium">{t('التفاصيل', 'Détails', 'Details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {t('لا توجد سجلات مطابقة', 'Aucun enregistrement correspondant', 'No matching records')}
                    </td>
                  </tr>
                ) : (
                  filtered.map(log => (
                    <tr key={log.id} className="hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                        {log.timestamp || log.created_at ? new Date(log.timestamp || log.created_at || '').toLocaleString() : ''}
                      </td>
                      <td className="px-4 py-3 font-medium text-[var(--text-secondary)] dark:text-white">{log.user_email || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor(log.action || '')}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                        {log.resource}
                        {log.resource_id && <span className="ms-2 text-xs text-[var(--text-secondary)] font-mono">{log.resource_id}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {log.details ? (
                          <span className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] font-mono">
                            {JSON.stringify(log.details).slice(0, 120)}{JSON.stringify(log.details).length > 120 ? '...' : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
