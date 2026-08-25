import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, Power, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { ChartOfAccountRow, JournalLineRow } from '@/types/database';
import { useI18n } from '@/i18n/I18nProvider';

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;

export function ChartOfAccounts() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : lang === 'fr' ? fr : en);
  const { session } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('EXPENSE');
  const [agencyId, setAgencyId] = useState<string | null>(null);

  const { data: accounts, loading, refetch, update } = useSupabaseData<ChartOfAccountRow>({
    table: 'chart_of_accounts',
    columns: 'id,code,name,account_type,currency_code,parent_id,is_active,created_at',
    orderBy: { column: 'code', ascending: true },
    fallbackData: [],
    limit: 500,
  });
  // Balances are computed from posted lines — the table has no denormalised
  // balance column, so showing one from `chart_of_accounts` lied by omission.
  const { data: lines } = useSupabaseData<JournalLineRow>({
    table: 'journal_lines',
    columns: 'id,account_id,currency_code,debit,credit',
    limit: 2000,
  });

  const { data: staff } = useSupabaseData<Record<string, unknown> & { id: string }>({
    table: 'staff_profiles', columns: 'user_id,agency_id', limit: 50,
  });
  useEffect(() => {
    const me = staff.find((s) => String(s.user_id) === session?.user?.id);
    if (me?.agency_id) setAgencyId(String(me.agency_id));
  }, [staff, session?.user?.id]);

  const filtered = accounts.filter((a) =>
    (a.code && a.code.toLowerCase().includes(searchTerm.toLowerCase()))
    || (a.name && a.name.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  /** Net balance per account (debit − credit; statement readers flip liability/revenue signs). */
  const balanceById = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      const prev = map.get(l.account_id) ?? 0;
      map.set(l.account_id, prev + Number(l.debit ?? 0) - Number(l.credit ?? 0));
    }
    return map;
  }, [lines]);

  const netFor = (acc: ChartOfAccountRow): number => {
    const raw = balanceById.get(acc.id) ?? 0;
    const typeUpper = String(acc.account_type ?? '').toUpperCase();
    return typeUpper === 'ASSET' || typeUpper === 'EXPENSE' ? raw : -raw;
  };

  const addAccount = async () => {
    if (!code.trim() || !name.trim()) return;
    if (!agencyId) {
      toast.error(t(
        'لم يتم العثور على وكالتك — لا يمكن إنشاء الحساب',
        'Agence introuvable — création impossible',
        'Your agency could not be resolved — cannot create the account',
      ));
      return;
    }
    if (accounts.some((a) => a.code === code.trim())) {
      toast.error(t('هذا الرمز مستخدم بالفعل', 'Ce code est déjà utilisé', 'This code is already in use'));
      return;
    }
    try {
      setSaving(true);
      const { error } = await supabase.from('chart_of_accounts').insert({
        agency_id: agencyId,
        code: code.trim(),
        name: name.trim(),
        account_type: type,
        is_active: true,
      });
      if (error) throw error;
      toast.success(t('تم إنشاء الحساب', 'Compte créé', 'Account created'));
      setShowAdd(false);
      setCode(''); setName(''); setType('EXPENSE');
      await refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (acc: ChartOfAccountRow) => {
    const next = !(acc.is_active !== false);
    const { error } = await update(acc.id, { is_active: next });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(next
        ? t('تم تفعيل الحساب', 'Compte activé', 'Account activated')
        : t('تم تعطيل الحساب', 'Compte désactivé', 'Account deactivated'));
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">
          {t('دليل الحسابات', 'Plan Comptable', 'Chart of Accounts')}
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
          <button onClick={() => setShowAdd(true)} className="btn btn-sm btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> {t('حساب جديد', 'Nouveau compte', 'New Account')}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-sm whitespace-nowrap rtl:text-right">
            <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-secondary)] font-medium sticky top-0">
              <tr>
                <th className="px-4 py-3">{t('الرمز', 'Code', 'Code')}</th>
                <th className="px-4 py-3">{t('الاسم', 'Nom', 'Name')}</th>
                <th className="px-4 py-3">{t('النوع', 'Type', 'Type')}</th>
                <th className="px-4 py-3 text-end">{t('الرصيد', 'Solde', 'Balance')}</th>
                <th className="px-4 py-3 text-center">{t('الحالة', 'Statut', 'Status')}</th>
                <th className="px-4 py-3 text-center">{t('إجراء', 'Action', 'Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {t('جاري التحميل…', 'Chargement…', 'Loading…')}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {t('لا توجد حسابات', 'Aucun compte trouvé', 'No accounts found')}
                  </td>
                </tr>
              ) : (
                filtered.map((acc) => {
                  const active = acc.is_active !== false;
                  const net = netFor(acc);
                  const cur = String((acc as Record<string, unknown>).currency_code ?? '');
                  return (
                    <tr key={acc.id} className={`transition-colors ${active ? 'hover:bg-[var(--bg-hover)]' : 'opacity-45'}`}>
                      <td className="px-4 py-3 font-medium font-mono text-[var(--text-primary)]">{acc.code}</td>
                      <td className="px-4 py-3 text-[var(--text-primary)]">{acc.name}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded-md text-xs">
                          {acc.account_type || 'GENERAL'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-[var(--text-secondary)]">
                        {net.toLocaleString()}{cur ? ` ${cur}` : ''}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-white/25'}`}
                          title={active ? t('نشط', 'Actif', 'Active') : t('معطّل', 'Inactif', 'Inactive')}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          className="icon-btn"
                          title={active ? t('تعطيل', 'Désactiver', 'Deactivate') : t('تفعيل', 'Activer', 'Activate')}
                          onClick={() => toggleActive(acc)}
                        >
                          <Power className={`h-4 w-4 ${active ? 'text-rose-400' : 'text-emerald-400'}`} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add account modal */}
      {showAdd && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm fos-fade" onClick={() => setShowAdd(false)}>
          <div
            className="w-[380px] rounded-xl border border-white/10 bg-[#151823] p-5 shadow-2xl fos-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-base font-semibold text-white">{t('حساب جديد', 'Nouveau compte', 'New Account')}</h4>
              <button className="icon-btn" onClick={() => setShowAdd(false)} aria-label={t('إغلاق', 'Fermer', 'Close')}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-white/50">{t('الرمز', 'Code', 'Code')}</span>
                <input
                  className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--brand-500)]"
                  placeholder={t('مثال: 4110', 'Ex: 4110', 'e.g. 4110')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-white/50">{t('الاسم', 'Nom', 'Name')}</span>
                <input
                  className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--brand-500)]"
                  placeholder={t('مثال: ذمم العملاء', 'Ex: Clients', 'e.g. Accounts Receivable')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-white/50">{t('النوع', 'Type', 'Type')}</span>
                <select
                  className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--brand-500)]"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {ACCOUNT_TYPES.map((at) => (
                    <option key={at} value={at} className="bg-[#151823]">{at}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={addAccount}
                disabled={saving || !code.trim() || !name.trim()}
                className="btn btn-sm btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('إنشاء', 'Créer', 'Create')}
              </button>
              <button onClick={() => setShowAdd(false)} className="btn btn-sm flex-1">
                {t('إلغاء', 'Annuler', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
