import { useConfirmDialog } from '@/components/ConfirmDialog';
import Select from '@/components/admin/GlassSelect';
import { useState, useMemo } from 'react';
import { PackageCheck, Search, Users, TrendingUp, DollarSign, Plus, Trash2, Pencil } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { GenericRow } from '@/types/database';
import { packageCommands } from '@/services/domainCommands';

interface Props {
  packages?: GenericRow[];
  bookingCounts?: Record<string, number>;
}

const STATUSES = ['DRAFT', 'ACTIVE', 'SOLD_OUT', 'ARCHIVED'];

const statusBadge = (s: string) => {
  switch (s) {
    case 'ACTIVE': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'SOLD_OUT': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    case 'DRAFT': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const EMPTY = { code: '', name: '', name_ar: '', name_fr: '', description: '', price_dzd: 0, price_sar: 0, duration_days: 15, start_date: '', end_date: '', seats_available: 50, status: 'ACTIVE' };

type PackageRow = {
  id?: string;
  code?: string;
  name?: string;
  name_ar?: string;
  name_fr?: string;
  description?: string;
  price_dzd?: number;
  price_sar?: number;
  duration_days?: number;
  start_date?: string;
  end_date?: string;
  seats_available?: number;
  status?: string;
  [key: string]: string | number | undefined;
};
export default function PackageManager({ packages: propPackages = [], bookingCounts = {} }: Props) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const { data: packages, loading } = useSupabaseData<GenericRow>({
    table: 'packages',
    orderBy: { column: 'created_at', ascending: true },
    fallbackData: propPackages,  
  });

  const confirmDialog = useConfirmDialog();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GenericRow | null>(null);
  const [form, setForm] = useState<PackageRow>(EMPTY);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return packages;
    const q = search.toLowerCase();
    return packages.filter((p: GenericRow) =>
      ((p.name as string) || '').toLowerCase().includes(q) ||
      ((p.name_ar as string) || '').includes(q) ||
      ((p.name_fr as string) || '').toLowerCase().includes(q) ||
      ((p.code as string) || '').toLowerCase().includes(q)
    );
  }, [packages, search]);

  const totalCapacity = packages.reduce((s: number, p: GenericRow) => s + Number(p.seats_available || 0), 0);
  const startAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const startEdit = (p: GenericRow) => {
    setEditing(p);
    setForm({
      code: (p.code as string) || '', name: (p.name as string) || '', name_ar: (p.name_ar as string) || '', name_fr: (p.name_fr as string) || '',
      description: (p.description as string) || '', price_dzd: Number(p.price_dzd || 0), price_sar: Number(p.price_sar || 0),
      duration_days: Number(p.duration_days || 15), start_date: ((p.start_date as string) || '').slice(0, 10), end_date: ((p.end_date as string) || '').slice(0, 10),
      seats_available: Number(p.seats_available || 0), status: (p.status as string) || 'ACTIVE',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name) return;
    setBusy(true);
    const payload = {
      ...form,
      price_dzd: Number(form.price_dzd || 0),
      price_sar: Number(form.price_sar || 0),
      duration_days: Number(form.duration_days || 15),
      seats_available: Number(form.seats_available || 0),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    };
    if (editing) await packageCommands.update(editing.id, payload);
    else await packageCommands.create(payload);
    setBusy(false);
    setShowForm(false);
  };

  const input = (key: string) => (
    <input
      type={['price_dzd', 'price_sar', 'duration_days', 'seats_available'].includes(key) ? 'number' : key === 'start_date' || key === 'end_date' ? 'date' : 'text'}
      value={form[key]}
      onChange={e => setForm((f: PackageRow) => ({ ...f, [key]: e.target.value }))}
      className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-3 py-2 text-xs"
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-secondary)] start-3`} />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('بحث في الباقات...', 'Rechercher forfaits...', 'Search packages...')}
              className={`w-full max-w-sm rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] py-2.5 text-xs text-[var(--text-secondary)] dark:text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] ps-9 pe-4`}
            />
          </div>
        </div>
        <button
          onClick={startAdd}
          className="btn btn-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('باقة جديدة', 'Nouveau forfait', 'New Package')}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('إجمالي الباقات', 'Total forfaits', 'Total Packages'), value: packages.length, icon: PackageCheck, color: 'text-brand-500' },
          { label: t('السعة الإجمالية', 'Capacité totale', 'Total Capacity'), value: totalCapacity, icon: Users, color: 'text-blue-500' },
          { label: t('نشطة', 'Actifs', 'Active'), value: packages.filter((p: GenericRow) => p.status === 'ACTIVE').length, icon: TrendingUp, color: 'text-emerald-500' },
          { label: t('متوسط السعر DZD', 'Prix moy. DZD', 'Avg DZD'), value: packages.length ? Math.round(packages.reduce((s: number, p: GenericRow) => s + Number(p.price_dzd || 0), 0) / packages.length).toLocaleString() : 0, icon: DollarSign, color: 'text-amber-500' },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="card p-4">
              <Icon className={`h-4 w-4 ${s.color} mb-2`} />
              <p className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white">{s.value}</p>
              <p className="text-[10px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-1">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-lg border border-brand-500/40 bg-white dark:bg-[var(--bg-hover)] p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('الرمز', 'Code', 'Code')}</label>
              {input('code')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('الاسم', 'Nom', 'Name')} *</label>
              {input('name')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('الاسم بالعربية', 'Nom AR', 'Name AR')}</label>
              {input('name_ar')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('الاسم بالفرنسية', 'Nom FR', 'Name FR')}</label>
              {input('name_fr')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('السعر DZD', 'Prix DZD', 'Price DZD')}</label>
              {input('price_dzd')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('السعر SAR', 'Prix SAR', 'Price SAR')}</label>
              {input('price_sar')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('المدة (أيام)', 'Durée (jours)', 'Duration (days)')}</label>
              {input('duration_days')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('المقاعد', 'Places', 'Seats')}</label>
              {input('seats_available')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('البداية', 'Début', 'Start')}</label>
              {input('start_date')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('النهاية', 'Fin', 'End')}</label>
              {input('end_date')}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('الحالة', 'Statut', 'Status')}</label>
              <Select value={form.status} onChange={e => setForm((f: PackageRow) => ({ ...f, status: e.target.value }))} className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-3 py-2 text-xs">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">{t('الوصف', 'Description', 'Description')}</label>
              <input type="text" value={form.description} onChange={e => setForm((f: PackageRow) => ({ ...f, description: e.target.value }))} className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-3 py-2 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]">
              {t('إلغاء', 'Annuler', 'Cancel')}
            </button>
            <button onClick={save} disabled={busy} className="btn btn-primary">
              {busy ? '...' : editing ? t('حفظ', 'Enregistrer', 'Save') : t('إضافة', 'Ajouter', 'Add')}
            </button>
          </div>
        </div>
      )}

      {/* Package Cards */}
      {loading ? (
        <Spinner className="p-10" />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-lg border border-dashed border-[var(--border)] dark:border-[var(--border)]">
          <PackageCheck className="h-8 w-8 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-2" />
          <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('لا توجد باقات', 'Aucun forfait', 'No packages found')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((pkg: GenericRow) => {
            const isExpanded = expandedId === pkg.id;
            const booked = Number(bookingCounts[pkg.id] || 0);
            const capacity = Number((pkg.seats_available as number) || 0);
            const occupancy = capacity > 0 ? Math.round((booked / capacity) * 100) : 0;

            return (
              <div key={pkg.id} className="card overflow-hidden">
                <div className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/30 transition-colors">
                  <div className={`flex-1 ${isAr ? 'text-end' : 'text-start'} min-w-0`}>
                    <p className="text-sm font-semibold text-[var(--text-secondary)] dark:text-white truncate flex items-center gap-2">
                      {isAr ? (pkg.name_ar as string) || (pkg.name as string) : isFr ? (pkg.name_fr as string) || (pkg.name as string) : (pkg.name as string)}
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${statusBadge((pkg.status as string) as string)}`}>{(pkg.status as string)}</span>
                    </p>
                    <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5">
                      {Number(pkg.price_dzd || 0).toLocaleString()} DZD · {Number(pkg.price_sar || 0).toLocaleString()} SAR · {(pkg.code as string)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className={isAr ? 'text-start' : 'text-end'}>
                      <p className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{booked}/{capacity}</p>
                      <div className="w-20 h-1.5 rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] mt-1">
                        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${Math.min(occupancy, 100)}%` }} />
                      </div>
                    </div>
                    <button onClick={() => startEdit(pkg)} className="p-1.5 text-[var(--text-secondary)] hover:text-brand-500 transition-colors" title={t('تعديل', 'Modifier', 'Edit')}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={async () => { if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف هذه الباقة؟', 'Supprimer ce forfait ?', 'Delete this package?'), danger: true })) await packageCommands.remove(pkg.id); }} className="p-1.5 text-[var(--text-secondary)] hover:text-rose-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setExpandedId(isExpanded ? null : pkg.id)} className="p-1.5 text-[var(--text-secondary)] hover:text-brand-500 transition-colors">
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-4 pt-0 border-t border-[var(--border)] dark:border-[var(--border)]">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                      <div>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase mb-2">{t('تفاصيل', 'Détails', 'Details')}</p>
                        <div className="space-y-1.5 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                          <p>{t('المدة:', 'Durée:', 'Duration:')} {(pkg.duration_days as number)} {t('أيام', 'jours', 'days')}</p>
                          <p>{t('الصلاحية:', 'Validité:', 'Validity:')} {((pkg.start_date as string) || '').slice(0, 10) || '-'} → {((pkg.end_date as string) || '').slice(0, 10) || '-'}</p>
                          <p>{t('المقاعد المتاحة:', 'Places dispo:', 'Seats available:')} {(pkg.seats_available as number)}</p>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase mb-2">{t('الوصف', 'Description', 'Description')}</p>
                        <p className="text-[13px] text-[var(--text-muted)]">{(pkg.description as string) || '-'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}