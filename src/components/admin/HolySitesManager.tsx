import type { HolySiteCampRow } from '@/types/database';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import Select from '@/components/admin/GlassSelect';
import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Tent, Plus, Trash2, AlertCircle, Phone } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { holySiteCampCommands } from '@/services/domainCommands';

const SITES = ['MINA', 'ARAFAT', 'MUZDALIFAH'];
const CAMP_STATI = ['ACTIVE', 'STAND_BY', 'CLOSED'];

const SITE_BADGE: Record<string, string> = {
  MINA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  ARAFAT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  MUZDALIFAH: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
};

const STATUS_PILL: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  STAND_BY: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  CLOSED: 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]',
};

const inputCls = 'input';
export function HolySitesManager({ camps: fallback = [] }: { camps?: HolySiteCampRow[] }) {
  const confirmDialog = useConfirmDialog();
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const { data: camps, loading } = useSupabaseData<HolySiteCampRow>({
    table: 'holy_site_camps',
    orderBy: { column: 'created_at', ascending: true },
    fallbackData: fallback,
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    site: 'MINA',
    camp_number: '',
    capacity: '',
    occupied: '0',
    manager_name: '',
    manager_phone: '',
    status: 'ACTIVE',
    notes: '',
  });

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.camp_number.trim()) return;
    await holySiteCampCommands.create({
      site: form.site,
      camp_number: form.camp_number,
      capacity: form.capacity ? Number(form.capacity) : null,
      occupied: form.occupied ? Number(form.occupied) : 0,
      manager_name: form.manager_name,
      manager_phone: form.manager_phone,
      status: form.status,
      notes: form.notes,
    });
    setForm({ site: 'MINA', camp_number: '', capacity: '', occupied: '0', manager_name: '', manager_phone: '', status: 'ACTIVE', notes: '' });
    setShowForm(false);
  };
  const pct = (c: HolySiteCampRow) => {
    const cap = Number(c.capacity || 0);
    return cap > 0 ? Math.min(100, Math.round((Number(c.occupied || 0) / cap) * 100)) : 0;
  };

  const barColor = (v: number) => (v >= 90 ? 'bg-rose-500' : v >= 75 ? 'bg-amber-500' : 'bg-brand-500');
  const totalCap = camps.reduce((s: number, c: HolySiteCampRow) => s + Number(c.capacity || 0), 0);
  const totalOcc = camps.reduce((s: number, c: HolySiteCampRow) => s + Number(c.occupied || 0), 0);

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600">
              <Tent className="h-4 w-4" />
            </span>
            {t('مخيمات المشاعر المقدسة', 'Camps des Lieux Saints', 'Holy Sites Camps')}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            {t('منى • عرفة • مزدلفة', 'Mina • Arafat • Muzdalifah', 'Mina • Arafat • Muzdalifah')}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('مخيم جديد', 'Nouveau camp', 'New Camp')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: t('المواقع', 'Sites', 'Sites'), value: SITES.length },
          { label: t('المخيمات', 'Camps', 'Camps'), value: camps.length },
          { label: t('المشغول', 'Occupé', 'Occupied'), value: totalOcc },
          { label: t('نسبة الامتلاء', 'Taux remplissage', 'Fill Rate'), value: `${totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0}%` },
        ].map((s, i) => (
          <div key={i} className="card px-4 py-3">
            <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{s.label}</p>
            <p className="text-xl font-semibold mt-0.5 text-[var(--text-secondary)] dark:text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select className={inputCls} value={form.site} onChange={(e) => set('site', e.target.value)}>
              {SITES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <input className={inputCls} value={form.camp_number} onChange={(e) => set('camp_number', e.target.value)} placeholder={t('رقم المخيم *', 'N° camp *', 'Camp number *')} />
            <input className={inputCls} type="number" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder={t('السعة', 'Capacité', 'Capacity')} />
            <input className={inputCls} type="number" value={form.occupied} onChange={(e) => set('occupied', e.target.value)} placeholder={t('المشغول', 'Occupé', 'Occupied')} />
            <input className={inputCls} value={form.manager_name} onChange={(e) => set('manager_name', e.target.value)} placeholder={t('اسم المسؤول', 'Nom responsable', 'Manager name')} />
            <input className={inputCls} value={form.manager_phone} onChange={(e) => set('manager_phone', e.target.value)} placeholder={t('هاتف المسؤول', 'Tél. responsable', 'Manager phone')} />
            <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {CAMP_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <input className={inputCls} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('ملاحظات', 'Notes', 'Notes')} />
          </div>
          <div className="flex gap-2">
            <button onClick={submit} className="btn btn-primary">
              {t('حفظ', 'Enregistrer', 'Save')}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-md bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-5 py-2 text-sm font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)] transition-all">
              {t('إلغاء', 'Annuler', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner className="p-10" />
        ) : camps.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
            <p>{t('لا توجد مخيمات', 'Aucun camp', 'No camps found')}</p>
          </div>
        ) : (
<div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[880px]">
              <thead className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] border-b border-[var(--border)] dark:border-[var(--border)]">
                <tr>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الموقع', 'Site', 'Site')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('رقم المخيم', 'N° camp', 'Camp No.')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('المسؤول', 'Responsable', 'Manager')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الإشغال', 'Occupation', 'Occupancy')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('ملاحظات', 'Notes', 'Notes')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الحالة', 'Statut', 'Status')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {camps.map((camp: HolySiteCampRow) => (
                  <tr key={camp.id} className="border-b border-[var(--border)] dark:border-[var(--border)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${SITE_BADGE[camp.site as string] || SITE_BADGE.MINA}`}>
                        {camp.site || 'MINA'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[var(--text-secondary)] dark:text-white">{camp.camp_number || '-'}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      <p className="flex items-center gap-1"><Phone className="w-3 h-3 text-[var(--text-secondary)]" />{camp.manager_name || '-'}</p>
                      <p className="text-[10px] text-[var(--text-secondary)]">{camp.manager_phone || ''}</p>
                    </td>
                    <td className="px-4 py-3 min-w-[140px]">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                          <span>{camp.occupied || 0} / {camp.capacity || 0}</span>
                          <span className={pct(camp) >= 90 ? 'text-rose-500' : pct(camp) >= 75 ? 'text-amber-500' : 'text-emerald-500'}>{pct(camp)}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${barColor(pct(camp))}`} style={{ width: `${pct(camp)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        defaultValue={String(camp.notes || '')}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (camp.notes || '')) holySiteCampCommands.update(camp.id, { notes: v }); }}
                        className="w-full min-w-[120px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] focus:border-[var(--accent)] focus:bg-white dark:focus:bg-[var(--bg-hover)] focus:outline-none transition-all"
                        placeholder={t('تعديل...', 'Modifier...', 'Edit...')}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={camp.status || 'ACTIVE'}
                        onChange={(e) => holySiteCampCommands.update(camp.id, { status: e.target.value })}
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border-0 outline-none cursor-pointer ${STATUS_PILL[camp.status as string] || STATUS_PILL.ACTIVE}`}
                      >
                        {CAMP_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={async () => {
                          if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف المخيم؟', 'Supprimer le camp ?', 'Delete camp?'), danger: true })) await holySiteCampCommands.remove(camp.id);
                        }}
                        className="rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
export default HolySitesManager;
