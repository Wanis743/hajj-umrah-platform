import { useConfirmDialog } from '@/components/ConfirmDialog';
import Select from '@/components/admin/GlassSelect';
import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Phone, Users, Star, Globe, Plus, Trash2, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';

const GUIDE_STATI = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'];

const inputCls = 'input';

export function MutawwifManager({ guides: fallback = [] }: { guides?: Record<string, string | number | string[] | undefined | null>[] }) {
  const confirmDialog = useConfirmDialog();
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: guides, loading, insert, update, remove } = useSupabaseData<Record<string, string | number | string[] | undefined | null>>({
    table: 'mutawwif_guides',
    orderBy: { column: 'created_at', ascending: true },
    fallbackData: fallback,
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    name_ar: '',
    phone: '',
    license_number: '',
    languages: '',
    rating: '5',
    status: 'ACTIVE',
  });

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) return;
    await insert({
      name: form.name,
      name_ar: form.name_ar,
      phone: form.phone,
      license_number: form.license_number,
      languages: form.languages,
      rating: Number(form.rating || 0),
      status: form.status,
    });
    setForm({ name: '', name_ar: '', phone: '', license_number: '', languages: '', rating: '5', status: 'ACTIVE' });
    setShowForm(false);
  };

  const statusPill = (s: string) =>
    s === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
    : s === 'ON_LEAVE' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';

  const avgRating = guides.length > 0
    ? (guides.reduce((s: number, g: Record<string, string | number | string[] | undefined | null>) => s + Number(g.rating || 0), 0) / guides.length).toFixed(1)
    : '0';

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('كادر المطوفين', 'Équipe Mutawwifs', 'Mutawwifs & Guides')}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            {t('المرشدون الميدانيون واللغات والتقييم', 'Guides de terrain, langues et notes', 'Field guides, languages & ratings')}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('مرشد جديد', 'Nouveau guide', 'New Guide')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: t('إجمالي المرشدين', 'Total guides', 'Total Guides'), value: guides.length, color: 'text-[var(--text-secondary)] dark:text-white' },
          { label: t('متوسط التقييم', 'Note moyenne', 'Avg. Rating'), value: `${avgRating} / 5`, color: 'text-brand-600 dark:text-brand-400' },
          { label: t('نشطون', 'Actifs', 'Active'), value: guides.filter((g: Record<string, string | number | string[] | undefined | null>) => g.status === 'ACTIVE').length, color: 'text-emerald-500' },
        ].map((s, i) => (
          <div key={i} className="card px-4 py-3">
            <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{s.label}</p>
            <p className={`text-xl font-semibold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('الاسم *', 'Nom *', 'Name *')} />
            <input className={inputCls} value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} placeholder={t('الاسم بالعربية', 'Nom AR', 'Name AR')} />
            <input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder={t('الهاتف', 'Téléphone', 'Phone')} />
            <input className={inputCls} value={form.license_number} onChange={(e) => set('license_number', e.target.value)} placeholder={t('رقم الرخصة', 'N° licence', 'License number')} />
            <input className={inputCls} value={form.languages} onChange={(e) => set('languages', e.target.value)} placeholder={t('اللغات (عربية، فرنسية)', 'Langues (Arabe, Français)', 'Languages (Arabic, French)')} />
            <input className={inputCls} type="number" min={0} max={5} value={form.rating} onChange={(e) => set('rating', e.target.value)} placeholder={t('التقييم', 'Note', 'Rating')} />
            <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {GUIDE_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
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
      ) : guides.length === 0 ? (
        <div className="card p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
          <p>{t('لا يوجد مرشدون', 'Aucun guide', 'No guides found')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {guides.map((g: Record<string, string | number | string[] | undefined | null>) => (
            <div key={g.id as string} className="card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-1.5 mb-1 min-w-0">
                  <div className="h-9 w-9 rounded-md bg-brand-500/10 flex items-center justify-center text-base font-semibold text-brand-600 dark:text-brand-400 shrink-0">
                    {(String(isAr ? g.name_ar || g.name : g.name || '?')).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-[var(--text-secondary)] dark:text-white text-sm truncate">
                      {isAr ? g.name_ar || g.name : g.name || '-'}
                    </h3>
                    <div className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                      <Phone className="h-2.5 w-2.5" />
                      <span className="font-mono">{g.phone || '-'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Star className="h-3.5 w-3.5 fill-brand-400 text-brand-400" />
                  <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">{g.rating ?? '-'}</span>
                </div>
              </div>

              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between items-center rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/60 px-3 py-2">
                  <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('رقم الرخصة', 'Licence', 'License')}</span>
                  <span className="font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] font-mono">{g.license_number || '-'}</span>
                </div>
                <div className="flex justify-between items-center rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/60 px-3 py-2">
                  <span className="flex items-center gap-1 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                    <Users className="h-3 w-3" />
                    {t('الحالة', 'Statut', 'Status')}
                  </span>
                  <Select
                    value={(g.status as string) || 'ACTIVE'}
                    onChange={(e) => update(g.id as string, { status: e.target.value })}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border-0 outline-none cursor-pointer ${statusPill((g.status as string) || 'ACTIVE')}`}
                  >
                    {GUIDE_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--border)] dark:border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Globe className="h-3 w-3 text-[var(--text-secondary)] shrink-0" />
                  {String(g.languages || '').split(',').filter(Boolean).map((l: string, i: number) => (
                    <span key={i} className="rounded-lg border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {l.trim()}
                    </span>
                  ))}
                  {!g.languages && <span className="text-[10px] text-[var(--text-secondary)]">-</span>}
                </div>
                <button
                  onClick={async () => {
                    if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف المرشد؟', 'Supprimer le guide ?', 'Delete guide?'), danger: true })) await remove(g.id as string);
                  }}
                  className="rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
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
}
export default MutawwifManager;
