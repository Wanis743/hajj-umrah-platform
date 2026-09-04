import { useEffect, useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { GenericRow, GroupRow, PilgrimRow } from '@/types/database';
import { roomAllocationCommands } from '@/services/domainCommands';
import { supabase } from '@/lib/supabase';
import { Building2, MapPin, Plus, Trash2, BedDouble } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import GlassDate from '@/components/admin/GlassDate';

const ALLOCATION_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
const ROOM_TYPES = ['QUAD', 'TRIPLE', 'DOUBLE', 'SUITE'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'PENDING': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'CONFIRMED': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'CHECKED_IN': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'CHECKED_OUT': return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
    case 'CANCELLED': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const inputCls = 'input';
const labelCls = 'block text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1';

export function HotelHousingManager() {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: hotels, loading: hotelsLoading } = useSupabaseData<GenericRow>({
    table: 'hotels',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const { data: allocations, loading: allocationsLoading } = useSupabaseData<GenericRow>({
    table: 'room_allocations',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [pilgrims, setPilgrims] = useState<PilgrimRow[]>([]);
  const [form, setForm] = useState<Record<string, string>>({
    hotel_id: '',
    group_id: '',
    pilgrim_id: '',
    room_number: '',
    room_type: 'QUAD',
    check_in: '',
    check_out: '',
    status: 'PENDING',
  });

  useEffect(() => {
    let mounted = true;
    supabase.from('groups').select('id, code, name').then(({ data }) => {
      if (mounted && data) setGroups(data);
    });
    supabase.from('pilgrims').select('id, full_name, passport_number').then(({ data }) => {
      if (mounted && data) setPilgrims(data);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const set = (key: string, value: string) => setForm((f: Record<string, string>) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.hotel_id || !form.room_number.trim()) return;
    await roomAllocationCommands.create({
      hotel_id: form.hotel_id,
      group_id: form.group_id || null,
      pilgrim_id: form.pilgrim_id || null,
      room_number: form.room_number.trim(),
      room_type: form.room_type,
      check_in: form.check_in || null,
      check_out: form.check_out || null,
      status: form.status,
    });
    setForm({ hotel_id: '', group_id: '', pilgrim_id: '', room_number: '', room_type: 'QUAD', check_in: '', check_out: '', status: 'PENDING' });
  };

  const hotelById = (id: string) => hotels.find((h: GenericRow) => h.id === id);
  const groupById = (id: string) => groups.find((g: GroupRow) => g.id === id);
  const pilgrimById = (id: string) => pilgrims.find((p: PilgrimRow) => p.id === id);
  const fmt = (d: string | number | Date | null | undefined) => (d ? new Date(d).toLocaleDateString() : '-');

  const totalRooms = hotels.reduce((s: number, h: GenericRow) => s + Number(h.total_rooms || 0), 0);
  const availableRooms = hotels.reduce((s: number, h: GenericRow) => s + Number(h.available_rooms || 0), 0);
  const occupiedRooms = Math.max(0, totalRooms - availableRooms);

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      <div>
        <h2 className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500"><Building2 className="w-5 h-5" /></span>
          {t('إدارة التسكين الفندقي', 'Hébergement Hôtelier', 'Hotel Housing')}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          {t('تسكين الحجاج في فنادق مكة والمدينة', 'Affectation des pèlerins dans les hôtels', 'Assign pilgrims to rooms in Makkah & Madinah hotels')}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t('إجمالي الفنادق', 'Total hôtels', 'Total Hotels'), value: hotels.length, color: 'text-[var(--text-secondary)] dark:text-white' },
          { label: t('الغرف المشغولة', 'Chambres occupées', 'Occupied Rooms'), value: `${occupiedRooms}/${totalRooms}`, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: t('معدل الإشغال', "Taux d'occupation", 'Occupancy Rate'), value: `${totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0}%`, color: 'text-amber-600 dark:text-amber-400' },
          { label: t('التسكينات', 'Affectations', 'Allocations'), value: allocations.length, color: 'text-blue-600 dark:text-blue-400' },
        ].map((s, i) => (
          <div key={i} className="card px-4 py-3 shadow-sm">
            <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{s.label}</p>
            <p className={`text-xl font-semibold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('الفنادق', 'Hôtels', 'Hotels')}</span>
          <div className="flex-1 h-px bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]" />
        </div>

        {hotelsLoading ? (
          <div className="p-10 flex justify-center">
            <Spinner />
          </div>
        ) : hotels.length === 0 ? (
          <div className="card p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <Building2 className="w-12 h-12 mb-3 opacity-50" />
            <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hotels.map((hotel: GenericRow) => {
              const total = Number(hotel.total_rooms || 0);
              const available = Number(hotel.available_rooms || 0);
              const occupied = Math.max(0, total - available);
              const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
              const cityLabel = hotel.city === 'MADINAH' ? t('المدينة', 'Médine', 'Madinah') : t('مكة', 'Makkah', 'Makkah');
              return (
                <div key={hotel.id} className="card p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-bold text-[var(--text-secondary)] dark:text-white text-sm leading-snug">
                        {String(isAr && (hotel as unknown as Record<string, string>).name_ar ? (hotel as unknown as Record<string, string>).name_ar : (hotel as unknown as Record<string, string>).name)}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] mt-1">
                        <MapPin className="h-3 w-3 text-rose-400 shrink-0" />
                        <span>{hotel.distance_to_haram_m != null ? `${hotel.distance_to_haram_m}m ` : ''}{t('من الحرم', 'du Haram', 'from Haram')}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <span className="rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{cityLabel}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${pct >= 90 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' : pct >= 70 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>
                        {pct}% {t('مأهول', 'occupé', 'Occupied')}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] p-2.5 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      <BedDouble className="h-3 w-3" />
                      <span>{t('الغرف', 'Chambres', 'Rooms')}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      <span>{available} / {total} {t('متاح', 'dispo', 'available')}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('التسكينات', 'Affectations', 'Room Allocations')}</span>
          <div className="flex-1 h-px bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]" />
          <span className="text-xs text-[var(--text-secondary)]">{allocations.length}</span>
        </div>

        <div className="card p-5">
          <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white mb-4">{t('تسكين جديد', 'Nouvelle affectation', 'New Allocation')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>{t('الفندق', 'Hôtel', 'Hotel')}</label>
              <Select className={inputCls} value={form.hotel_id} onChange={(e) => set('hotel_id', e.target.value)}>
                <option value="">{t('الفندق...', 'Hôtel...', 'Hotel...')}</option>
                {hotels.map((h: GenericRow) => <option key={h.id} value={h.id}>{String(h.name || '')}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelCls}>{t('المجموعة', 'Groupe', 'Group')}</label>
              <Select className={inputCls} value={form.group_id} onChange={(e) => set('group_id', e.target.value)}>
                <option value="">{t('المجموعة...', 'Groupe...', 'Group...')}</option>
                {groups.map((g: GroupRow) => <option key={g.id} value={g.id}>{g.code || g.name}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelCls}>{t('الحاج', 'Pèlerin', 'Pilgrim')}</label>
              <Select className={inputCls} value={form.pilgrim_id} onChange={(e) => set('pilgrim_id', e.target.value)}>
                <option value="">{t('الحاج...', 'Pèlerin...', 'Pilgrim...')}</option>
                {pilgrims.map((p: PilgrimRow) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelCls}>{t('رقم الغرفة', 'N° chambre', 'Room Number')}</label>
              <input className={inputCls} value={form.room_number} onChange={(e) => set('room_number', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('نوع الغرفة', 'Type chambre', 'Room Type')}</label>
              <Select className={inputCls} value={form.room_type} onChange={(e) => set('room_type', e.target.value)}>
                {ROOM_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelCls}>{t('الدخول', 'Arrivée', 'Check-in')}</label>
              <GlassDate className={inputCls} value={form.check_in} onChange={(e) => set('check_in', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الخروج', 'Départ', 'Check-out')}</label>
              <GlassDate className={inputCls} value={form.check_out} onChange={(e) => set('check_out', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الحالة', 'Statut', 'Status')}</label>
              <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                {ALLOCATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={submit}
              disabled={!form.hotel_id || !form.room_number.trim()}
              className="btn btn-primary"
            >
              <Plus className="w-4 h-4" />
              {t('إضافة التسكين', 'Ajouter', 'Add Allocation')}
            </button>
          </div>
        </div>

        <div className="card overflow-hidden">
          {allocationsLoading ? (
            <div className="p-10 flex justify-center">
              <Spinner />
            </div>
          ) : allocations.length === 0 ? (
            <div className="p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
              <Building2 className="w-12 h-12 mb-3 opacity-50" />
              <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[920px]">
                <thead>
                  <tr className={`text-[10px] uppercase tracking-wider text-[var(--text-secondary)] dark:text-[var(--text-secondary)] border-b border-[var(--border)] dark:border-[var(--border)] ${isAr ? 'text-end' : 'text-start'}`}>
                    <th className="px-4 py-3">{t('الفندق', 'Hôtel', 'Hotel')}</th>
                    <th className="px-4 py-3">{t('المجموعة', 'Groupe', 'Group')}</th>
                    <th className="px-4 py-3">{t('الحاج', 'Pèlerin', 'Pilgrim')}</th>
                    <th className="px-4 py-3">{t('الغرفة', 'Chambre', 'Room')}</th>
                    <th className="px-4 py-3">{t('النوع', 'Type', 'Type')}</th>
                    <th className="px-4 py-3">{t('الدخول', 'Arrivée', 'Check-in')}</th>
                    <th className="px-4 py-3">{t('الخروج', 'Départ', 'Check-out')}</th>
                    <th className="px-4 py-3">{t('الحالة', 'Statut', 'Status')}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((a: GenericRow) => {
                    const hotel = hotelById(a.hotel_id as string);
                    const group = groupById(a.group_id as string);
                    const pilgrim = pilgrimById(a.pilgrim_id as string);
                    return (
                      <tr key={a.id} className="border-b border-[var(--border)] dark:border-[var(--border)]/50 hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/50">
                        <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-white font-semibold">{String(hotel?.name || '') || '-'}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{group?.code || group?.name || '-'}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{pilgrim?.full_name || '-'}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-white font-mono">{String(a.room_number || '') || '-'}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{String(a.room_type || '') || '-'}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{fmt(a.check_in as string | Date | null | undefined)}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{fmt(a.check_out as string | Date | null | undefined)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(String(a.status || ''))}`}>{String(a.status || '') || '-'}</span>
                            <Select
                              className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] dark:text-white"
                              value={String(a.status || 'PENDING')}
                              onChange={(e) => roomAllocationCommands.update(a.id, { status: e.target.value })}
                            >
                              {ALLOCATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </Select>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => roomAllocationCommands.remove(a.id)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HotelHousingManager;