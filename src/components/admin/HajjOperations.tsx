import { useConfirmDialog } from '@/components/ConfirmDialog';
import Select from '@/components/admin/GlassSelect';
import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Tent, Users, MapPin, Plus, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { holySiteCampCommands } from '@/services/domainCommands';
import type { HolySiteCampRow } from '@/types/database';

const SITES = ['MINA', 'ARAFAT', 'MUZDALIFAH'];

const SITE_TITLES: Record<string, { ar: string; fr: string; en: string }> = {
  MINA: { ar: 'منى', fr: 'Mina', en: 'Mina' },
  ARAFAT: { ar: 'عرفات', fr: 'Arafat', en: 'Arafat' },
  MUZDALIFAH: { ar: 'مزدلفة', fr: 'Muzdalifah', en: 'Muzdalifah' },
};

const CAMP_STATI = ['ACTIVE', 'STAND_BY', 'CLOSED'];

const inputCls = 'input';

export function HajjOperations({ camps: fallback = [] }: { camps?: HolySiteCampRow[] }) {
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
    });
    setForm({ site: 'MINA', camp_number: '', capacity: '', occupied: '0', manager_name: '', manager_phone: '', status: 'ACTIVE' });
    setShowForm(false);
  };

  const occupancyPct = (c: HolySiteCampRow) => {
    const cap = Number(c.capacity || 0);
    return cap > 0 ? Math.min(100, Math.round((Number(c.occupied || 0) / cap) * 100)) : 0;
  };

  const statusPill = (s: string) =>
    s === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
    : s === 'STAND_BY' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Tent className="h-5 w-5 text-[var(--accent)]" />
            {t('عمليات الحج', 'Opérations du Hajj', 'Hajj Operations')}
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{camps.length} {t('مخيم', 'camps', 'camps')}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('مخيم جديد', 'Nouveau camp', 'New Camp')}
        </button>
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

      {loading ? (
        <Spinner className="p-10" />
      ) : camps.length === 0 ? (
        <div className="card p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          <Tent className="w-12 h-12 mb-3 opacity-50" />
          <p>{t('لا توجد مخيمات', 'Aucun camp', 'No camps found')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {SITES.map((site) => {
            const siteCamps = camps.filter((c: HolySiteCampRow) => c.site === site);
            const totalCap = siteCamps.reduce((s: number, c: HolySiteCampRow) => s + Number(c.capacity || 0), 0);
            const totalOcc = siteCamps.reduce((s: number, c: HolySiteCampRow) => s + Number(c.occupied || 0), 0);
            const st = SITE_TITLES[site];
            return (
              <div key={site} className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-brand-500" />
                    <h3 className="font-semibold text-[var(--text-secondary)] dark:text-white">{t(st.ar, st.fr, st.en)}</h3>
                  </div>
                  <span className="text-[10px] font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                    {totalOcc} / {totalCap}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] overflow-hidden mb-4">
                  <div
                    className="h-full rounded-full transition-all duration-500 bg-brand-500"
                    style={{ width: `${totalCap > 0 ? Math.min(100, Math.round((totalOcc / totalCap) * 100)) : 0}%` }}
                  />
                </div>
                {siteCamps.length === 0 ? (
                  <p className="text-center text-xs text-[var(--text-secondary)] py-6">{t('لا مخيمات', 'Aucun camp', 'No camps')}</p>
                ) : (
                  <div className="space-y-3">
                    {siteCamps.map((camp: HolySiteCampRow) => (
                      <div key={camp.id} className="p-4 border border-[var(--border)] dark:border-[var(--border)] rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/50">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-bold text-[var(--text-secondary)] dark:text-white">{camp.camp_number || '-'}</h4>
                            <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{camp.manager_name || '-'} {camp.manager_phone ? '· ' + camp.manager_phone : ''}</p>
                          </div>
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusPill(camp.status || 'ACTIVE')}`}>
                            {camp.status || 'ACTIVE'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-2">
                          <Users className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                          <span className="font-mono">{camp.occupied || 0} / {camp.capacity || '-'}</span>
                          <span className="text-[10px] font-bold">({occupancyPct(camp)}%)</span>
                          <span className="text-[10px] text-[var(--text-secondary)]">{typeof camp.notes === 'string' && camp.notes ? '· ' + camp.notes : ''}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            defaultValue={camp.occupied || 0}
                            onBlur={(e) => { const v = Number(e.target.value); if (!isNaN(v) && v !== Number(camp.occupied)) holySiteCampCommands.update(camp.id, { occupied: v }); }}
                            className="w-24 rounded-lg border border-[var(--border)] dark:border-[var(--border)] bg-white dark:bg-[var(--bg-hover)] px-2 py-1 text-xs focus:border-[var(--accent)] focus:outline-none"
                            placeholder={t('مشغول', 'Occupé', 'Occupied')}
                          />
                          <Select
                            value={camp.status || 'ACTIVE'}
                            onChange={(e) => holySiteCampCommands.update(camp.id, { status: e.target.value })}
                            className="rounded-lg border border-[var(--border)] dark:border-[var(--border)] bg-white dark:bg-[var(--bg-hover)] px-2 py-1 text-[10px] font-bold focus:outline-none"
                          >
                            {CAMP_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                          <button
                            onClick={async () => {
                              if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف المخيم؟', 'Supprimer le camp ?', 'Delete camp?'), danger: true })) await holySiteCampCommands.remove(camp.id);
                            }}
                            className="ms-auto rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && camps.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-bold text-[var(--text-secondary)] dark:text-white mb-3">{t('السعة الإجمالية', 'Capacité totale', 'Total Occupancy')}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {SITES.map((site) => {
              const siteCamps = camps.filter((c: HolySiteCampRow) => c.site === site);
              const cap = siteCamps.reduce((s: number, c: HolySiteCampRow) => s + Number(c.capacity || 0), 0);
              const occ = siteCamps.reduce((s: number, c: HolySiteCampRow) => s + Number(c.occupied || 0), 0);
              const st = SITE_TITLES[site];
              return (
                <div key={site} className="rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/60 border border-[var(--border)] dark:border-[var(--border)] p-4">
                  <p className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t(st.ar, st.fr, st.en)}</p>
                  <p className="text-2xl font-semibold text-[var(--text-secondary)] dark:text-white">
                    {occ}<span className="text-sm text-[var(--text-secondary)] font-bold"> / {cap}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
