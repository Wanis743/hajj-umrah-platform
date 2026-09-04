import type { GroupRow } from '@/types/database';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import Select from '@/components/admin/GlassSelect';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Users, Calendar, ShieldAlert, Plus, Trash2, AlertCircle, User } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { groupCommands } from '@/services/domainCommands';
import { supabase } from '@/lib/supabase';
import GlassDate from '@/components/admin/GlassDate';


const GROUP_STATI = ['FORMING', 'READY', 'DEPARTED', 'IN_SAUDI', 'RETURNED', 'CLOSED'];

const STATUS_BADGE: Record<string, string> = {
  FORMING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  READY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  DEPARTED: 'bg-brand-500/20 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400',
  IN_SAUDI: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  RETURNED: 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]',
  CLOSED: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
};

const inputCls = 'input';
export function GroupManager({ groups: fallback = [] }: { groups?: GroupRow[] }) {
  const confirmDialog = useConfirmDialog();
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const { data: groups, loading } = useSupabaseData<GroupRow>({
    table: 'groups',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: fallback,
  });
  const [packages, setPackages] = useState<GroupRow[]>([]);
  const [guides, setGuides] = useState<GroupRow[]>([]);
    const [, setActiveGroupId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    package_id: '',
    leader_name: '',
    leader_phone: '',
    max_capacity: '',
    departure_date: '',
    return_date: '',
    status: 'FORMING',
  });

  useEffect(() => {
    supabase.from('packages').select('id,code,name,name_ar,name_fr,price_sar,price_dzd,seats_available,status').then(({ data }) => { if (data) setPackages(data as unknown as GroupRow[]); });
    supabase.from('mutawwif_guides').select('id,name,name_ar,phone,languages,rating').then(({ data }) => { if (data) setGuides(data as unknown as GroupRow[]); });
  }, []);
  const packageMap = new Map(packages.map((p: GroupRow) => [p.id, p]));
  const guideMap = new Map(guides.map((g: GroupRow) => [g.id, g]));

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.code.trim()) return;
    await groupCommands.create({
      code: form.code,
      name: form.name,
      package_id: form.package_id || null,
      leader_name: form.leader_name,
      leader_phone: form.leader_phone,
      max_capacity: form.max_capacity ? Number(form.max_capacity) : null,
      departure_date: form.departure_date || null,
      return_date: form.return_date || null,
      status: form.status,
    });
    setForm({ code: '', name: '', package_id: '', leader_name: '', leader_phone: '', max_capacity: '', departure_date: '', return_date: '', status: 'FORMING' });
    setShowForm(false);
  };

  const ready = (id: string) => {
    const g = groups.find((x: GroupRow) => x.id === id);
    if (g && g.status === 'FORMING') groupCommands.update(id, { status: 'READY' });
  };

  const fmtDate = (d?: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString();
  };

  const daysLeft = (d?: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '-';
    const diff = dt.getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 3600 * 24));
    return days > 0 ? days : 0;
  };

  const readinessColor = (v: number) => (v > 80 ? 'text-emerald-500' : v > 50 ? 'text-amber-500' : 'text-rose-500');

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('إدارة الأفواج', 'Gestion des Groupes', 'Group Manager')}</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{groups.length} {t('فوج', 'groupes', 'groups')}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('فوج جديد', 'Nouveau groupe', 'New Group')}
        </button>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className={inputCls} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder={t('رمز الفوج *', 'Code groupe *', 'Group code *')} />
            <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('اسم الفوج', 'Nom du groupe', 'Group name')} />
            <Select className={inputCls} value={form.package_id} onChange={(e) => set('package_id', e.target.value)}>
              <option value="">{t('الباقة', 'Forfait', 'Package')}</option>
              {packages.map((p: GroupRow) => (
                <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
              ))}
            </Select>
            <input className={inputCls} value={form.leader_name} onChange={(e) => set('leader_name', e.target.value)} placeholder={t('اسم القائد', 'Nom du chef', 'Leader name')} />
            <input className={inputCls} value={form.leader_phone} onChange={(e) => set('leader_phone', e.target.value)} placeholder={t('هاتف القائد', 'Téléphone chef', 'Leader phone')} />
            <input className={inputCls} type="number" value={form.max_capacity} onChange={(e) => set('max_capacity', e.target.value)} placeholder={t('الحد الأقصى', 'Capacité max', 'Max capacity')} />
            <GlassDate className={inputCls} value={form.departure_date} onChange={(e) => set('departure_date', e.target.value)} />
            <GlassDate className={inputCls} value={form.return_date} onChange={(e) => set('return_date', e.target.value)} />
            <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {GROUP_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
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
      ) : groups.length === 0 ? (
        <div className="card p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
          <p>{t('لا توجد أفواج', 'Aucun groupe', 'No groups found')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map((group: GroupRow) => {
            const readiness = Number(group.readiness_score || 0);
            const pkg = packageMap.get(group.package_id || '');
            const guide = guideMap.get(group.guide_id || '');
            return (
              <div key={group.id} className="card p-5 hover:border-brand-500 transition-colors cursor-pointer" onClick={(e) => {
        // Only open side sheet if clicking on the card itself, not the action buttons inside
        const target = e.target as HTMLElement;
        if (target.tagName.toLowerCase() !== 'button' && target.tagName.toLowerCase() !== 'select') {
          setActiveGroupId(group.id);
        }
    }}>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white uppercase">{String(group.code || "") || '-'}</h3>
                    <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{String(group.name || "") || '-'}</p>
                    {pkg && <p className="text-[10px] text-brand-600 dark:text-brand-400 font-bold mt-1">{pkg.code} - {isAr ? pkg.name_ar || pkg.name : pkg.name}</p>}
                    <Select
                      value={String(group.status || "") || 'FORMING'}
                      onChange={(e) => groupCommands.update(group.id, { status: e.target.value })}
                      className={`mt-2 rounded-full px-2.5 py-0.5 text-[10px] font-bold border-0 outline-none cursor-pointer ${STATUS_BADGE[String(group.status || "") as string] || STATUS_BADGE.FORMING}`}
                    >
                      {GROUP_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                  <div className="text-center">
                    <div className={`text-xl font-semibold ${readinessColor(readiness)}`}>{readiness}%</div>
                    <div className="text-[9px] text-[var(--text-secondary)]">{t('الجاهزية', 'Prêt', 'Readiness')}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center text-sm">
                    <Calendar className="w-4 h-4 text-[var(--text-secondary)] ltr:me-2 rtl:ms-2" />
                    <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex-1">{t('المغادرة', 'Départ', 'Departure')}:</span>
                    <span className="text-[var(--text-secondary)] dark:text-white font-medium">{fmtDate(group.departure_date || undefined)}</span>
                  </div>
                  <div className="flex items-center text-sm">
                    <Calendar className="w-4 h-4 text-[var(--text-secondary)] ltr:me-2 rtl:ms-2" />
                    <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex-1">{t('العودة', 'Retour', 'Return')}:</span>
                    <span className="text-[var(--text-secondary)] dark:text-white font-medium">{fmtDate(group.return_date || undefined)}</span>
                  </div>
                  <div className="flex items-center text-sm">
                    <Users className="w-4 h-4 text-[var(--text-secondary)] ltr:me-2 rtl:ms-2" />
                    <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex-1">{t('السعة', 'Capacité', 'Capacity')}:</span>
                    <span className="text-[var(--text-secondary)] dark:text-white font-medium">{Number(group.current_capacity || 0)} / {group.max_capacity || '-'}</span>
                  </div>
                  <div className="flex items-center text-sm">
                    <User className="w-4 h-4 text-[var(--text-secondary)] ltr:me-2 rtl:ms-2" />
                    <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex-1">{t('القائد', 'Chef', 'Leader')}:</span>
                    <span className="text-[var(--text-secondary)] dark:text-white font-medium">{String(group.leader_name || '') || '-'}</span>
                  </div>
                  <div className="flex items-center text-sm">
                    <ShieldAlert className="w-4 h-4 text-[var(--text-secondary)] ltr:me-2 rtl:ms-2" />
                    <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex-1">{t('المرشد', 'Guide', 'Guide')}:</span>
                    <span className="text-[var(--text-secondary)] dark:text-white font-medium">{guide ? guide.name : t('غير معين', 'Non assigné', 'Unassigned')}</span>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-[var(--border)] dark:border-[var(--border)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('أيام للمغادرة', 'Jours restants', 'Days left')}</span>
                    <span className="text-sm font-bold text-[var(--text-secondary)] dark:text-white">{daysLeft(group.departure_date || undefined)}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {String(group.status || "") === 'FORMING' && (
                      <button onClick={() => ready(group.id)} className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-all">
                        {t('جاهز', 'Prêt', 'Mark Ready')}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف الفوج؟', 'Supprimer le groupe ?', 'Delete group?'), danger: true })) await groupCommands.remove(group.id);
                      }}
                      className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
                    >
                      <Trash2 className="w-3 h-3 inline ltr:me-1 rtl:ms-1" />{t('حذف', 'Suppr.', 'Delete')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
