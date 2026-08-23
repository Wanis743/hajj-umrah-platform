import { useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { hotelCommands } from '@/services/domainCommands';
import { Building, MapPin, Star, Plus, Trash2, X } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';

const HOTEL_STATUSES = ['ACTIVE', 'INACTIVE'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'INACTIVE': return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const cityBadge = (city: string) => {
  return city === 'MAKKAH'
    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
};

const inputCls = 'input';
const labelCls = 'block text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1';

type HotelRow = {
      id: string;
      name?: string;
      name_ar?: string;
      city?: string;
      star_rating?: number;
      distance_to_haram_m?: number;
      manager_contact?: string;
      total_rooms?: number | string;
      available_rooms?: number | string;
      rate_sar?: number | string;
      status?: string;
      created_at?: string;
    };
export function HotelManager({ hotels }: { hotels?: HotelRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data, loading, error } = useSupabaseData<HotelRow>({
    table: 'hotels',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: hotels ?? [],
  });

  const [filter, setFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<HotelRow>>({
    name: '',
    name_ar: '',
    city: 'MAKKAH',
    star_rating: '' as unknown as number,
    distance_to_haram_m: '' as unknown as number,
    manager_contact: '',
    total_rooms: '' as unknown as number,
    available_rooms: '' as unknown as number,
    rate_sar: '' as unknown as number,
    status: 'ACTIVE',
  });
  const [occupancyEdits, setOccupancyEdits] = useState<Record<string, Partial<HotelRow>>>({});

  const filteredHotels = filter === 'ALL' ? data : data.filter((h: HotelRow) => h.city === filter);

  const set = (key: keyof HotelRow, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setOcc = (id: string, key: keyof HotelRow, value: string) =>
    setOccupancyEdits((prev) => {
      const current = prev[id] || {};
      const base = data.find((h: HotelRow) => h.id === id) || ({} as Partial<HotelRow>);
      return { ...prev, [id]: { ...base, ...current, [key]: value } };
    });
  const occValue = (id: string, key: keyof HotelRow) => {
    const edit = occupancyEdits[id];
    return edit && edit[key] !== undefined ? String(edit[key]) : String(data.find((h: HotelRow) => h.id === id)?.[key] ?? '');
  };
  const saveOccupancy = async (id: string) => {
    const edit = occupancyEdits[id];
    if (!edit) return;
    await hotelCommands.update(id, {
      total_rooms: edit.total_rooms !== undefined ? Number(edit.total_rooms) : undefined,
      available_rooms: edit.available_rooms !== undefined ? Number(edit.available_rooms) : undefined,
    });
    setOccupancyEdits((prev) => {
      const next = { ...prev };
      delete (next as any)[id];
      return next;
    });
  };

  const submit = async () => {
    if (!(form.name || '').trim()) return;
    setSaving(true);
    await hotelCommands.create({
      name: (form.name || '').trim(),
      name_ar: (form.name_ar || '').trim(),
      city: form.city,
      star_rating: form.star_rating !== ('' as unknown as number) ? Number(form.star_rating) : null,
      distance_to_haram_m: form.distance_to_haram_m !== ('' as unknown as number) ? Number(form.distance_to_haram_m) : null,
      manager_contact: (form.manager_contact || '').trim(),
      total_rooms: form.total_rooms !== '' ? Number(form.total_rooms) : 0,
      available_rooms: form.available_rooms !== '' ? Number(form.available_rooms) : 0,
      rate_sar: form.rate_sar !== '' ? Number(form.rate_sar) : null,
      status: form.status,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ name: '', name_ar: '', city: 'MAKKAH', star_rating: '' as unknown as number, distance_to_haram_m: '' as unknown as number, manager_contact: '', total_rooms: '' as unknown as number, available_rooms: '' as unknown as number, rate_sar: '' as unknown as number, status: 'ACTIVE' });
  };
  const toggleStatus = (hotel: HotelRow) => hotelCommands.update(hotel.id, { status: hotel.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Building className="h-5 w-5 text-[var(--accent)]" />
            {t('إدارة الفنادق', 'Gestion des Hôtels', 'Hotel Management')}
          </h1>
          <p className="text-[13px] text-[var(--text-muted)]">{t('فنادق مكة والمدينة، الغرف المتاحة والحالات', 'Hôtels de Makkah & Madinah, chambres et statuts', 'Makkah & Madinah hotels, rooms and statuses')}</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="btn btn-primary"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? t('إلغاء', 'Annuler', 'Cancel') : t('إضافة فندق', 'Ajouter un hôtel', 'Add Hotel')}
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg p-4 text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}

      <div className="card p-5">
        <div className="flex gap-2 overflow-x-auto">
          {['ALL', 'MAKKAH', 'MADINAH'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                filter === f
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f === 'ALL' ? t('الكل', 'Tous', 'All') : f === 'MAKKAH' ? t('مكة', 'Makkah', 'Makkah') : t('المدينة', 'Madinah', 'Madinah')}
            </button>
          ))}
        </div>
      </div>

      {showForm && (
        <div className="card p-5">
          <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white mb-4">{t('فندق جديد', 'Nouvel hôtel', 'New Hotel')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>{t('الاسم', 'Nom', 'Name')}</label>
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الاسم بالعربية', 'Nom (ar)', 'Name (AR)')}</label>
              <input className={inputCls} value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('المدينة', 'Ville', 'City')}</label>
              <Select className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)}>
                <option value="MAKKAH">MAKKAH</option>
                <option value="MADINAH">MADINAH</option>
              </Select>
            </div>
            <div>
              <label className={labelCls}>{t('التصنيف', 'Étoiles', 'Star Rating')}</label>
              <input type="number" min={1} max={5} className={inputCls} value={form.star_rating} onChange={(e) => set('star_rating', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('البعد عن الحرم (م)', 'Distance Haram (m)', 'Distance to Haram (m)')}</label>
              <input type="number" className={inputCls} value={form.distance_to_haram_m} onChange={(e) => set('distance_to_haram_m', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('جهة الاتصال', 'Contact', 'Manager Contact')}</label>
              <input className={inputCls} value={form.manager_contact} onChange={(e) => set('manager_contact', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('إجمالي الغرف', 'Total chambres', 'Total Rooms')}</label>
              <input type="number" className={inputCls} value={form.total_rooms} onChange={(e) => set('total_rooms', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الغرف المتاحة', 'Chambres dispo.', 'Available Rooms')}</label>
              <input type="number" className={inputCls} value={form.available_rooms} onChange={(e) => set('available_rooms', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('السعر (SAR)', 'Tarif (SAR)', 'Rate (SAR)')}</label>
              <input type="number" className={inputCls} value={form.rate_sar} onChange={(e) => set('rate_sar', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الحالة', 'Statut', 'Status')}</label>
              <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                {HOTEL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={submit} disabled={saving || !(form.name || '').trim()} className="btn btn-primary">
              {saving ? t('جاري الحفظ...', 'Enregistrement...', 'Saving...') : t('حفظ', 'Enregistrer', 'Save')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-10 flex justify-center">
          <Spinner />
        </div>
      ) : filteredHotels.length === 0 ? (
        <div className="card p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          <Building className="w-12 h-12 mb-3 opacity-50" />
          <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredHotels.map((hotel: HotelRow) => {
            const total = Number(hotel.total_rooms || 0);
            const available = Number(hotel.available_rooms || 0);
            const occupied = Math.max(0, total - available);
            const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
            return (
              <div key={hotel.id} className="card p-5 hover:border-brand-500 transition-colors flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">
                      {isAr && hotel.name_ar ? hotel.name_ar : hotel.name}
                    </h2>
                    <div className="flex items-center mt-2 gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${cityBadge(hotel.city || '')}`}>{hotel.city}</span>
                      <div className="flex items-center text-brand-500">
                        {Array.from({ length: Number(hotel.star_rating || 0) }).map((_, i) => (
                          <Star key={i} className="w-3 h-3 fill-current" />
                        ))}
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(hotel.status || '')}`}>{hotel.status || '-'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hotel.distance_to_haram_m != null && (
                      <div className="flex items-center text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-2 py-1 rounded-md">
                        <MapPin className="w-3 h-3" />
                        {hotel.distance_to_haram_m}m
                      </div>
                    )}
                    <button onClick={() => toggleStatus(hotel)} className="px-2 py-1 rounded-lg bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-brand-500 hover:text-black transition-colors">
                      {hotel.status === 'ACTIVE' ? t('تعطيل', 'Désactiver', 'Deactivate') : t('تفعيل', 'Activer', 'Activate')}
                    </button>
                    <button onClick={() => hotelCommands.remove(hotel.id)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-auto space-y-4">
                  <div>
                    <div className="flex justify-between text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-2">
                      <span>{t('نسبة الإشغال', "Taux d'occupation", 'Occupancy')}</span>
                      <span className="font-bold text-[var(--text-secondary)] dark:text-white">{pct}% ({occupied}/{total})</span>
                    </div>
                    <div className="h-2 w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] rounded-full overflow-hidden">
                      <div style={{ width: `${pct}%` }} className={`h-full transition-all ${pct > 90 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] p-2 rounded-lg">
                      <p className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('غرف مخصصة', 'Occupées', 'Occupied')}</p>
                      <p className="font-bold text-[var(--text-secondary)] dark:text-white mt-1">{occupied}</p>
                    </div>
                    <div className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] p-2 rounded-lg">
                      <p className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('متاح', 'Disponible', 'Available')}</p>
                      <p className="font-bold text-[var(--text-secondary)] dark:text-white mt-1">{available}</p>
                    </div>
                    <div className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] p-2 rounded-lg">
                      <p className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('السعر/ليلة', 'Prix/nuit', 'Rate/night')}</p>
                      <p className="font-bold text-[var(--text-secondary)] dark:text-white mt-1">{hotel.rate_sar != null ? `${hotel.rate_sar} SAR` : '-'}</p>
                    </div>
                  </div>

                  <div className="border-t border-[var(--border)] dark:border-[var(--border)] pt-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className={labelCls}>{t('إجمالي الغرف', 'Total chambres', 'Total Rooms')}</label>
                        <input
                          type="number"
                          className={`${inputCls} w-24`}
                          value={occValue(hotel.id, 'total_rooms')}
                          onChange={(e) => setOcc(hotel.id, 'total_rooms', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>{t('الغرف المتاحة', 'Chambres dispo.', 'Available Rooms')}</label>
                        <input
                          type="number"
                          className={`${inputCls} w-24`}
                          value={occValue(hotel.id, 'available_rooms')}
                          onChange={(e) => setOcc(hotel.id, 'available_rooms', e.target.value)}
                        />
                      </div>
                      <button onClick={() => saveOccupancy(hotel.id)} className="btn btn-primary">
                        {t('حفظ', 'Enregistrer', 'Save')}
                      </button>
                    </div>
                    {hotel.manager_contact && (
                      <p className="mt-2 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('جهة الاتصال', 'Contact', 'Contact')}: {hotel.manager_contact}</p>
                    )}
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
