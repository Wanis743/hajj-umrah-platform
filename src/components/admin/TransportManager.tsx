import { useEffect, useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { useTransportAssignments, useTransportVehicles } from '@/hooks/useDomainResources';
import { useCommandRunner } from '@/hooks/useCommandRunner';
import { transportVehicleCommands, transportAssignmentCommands } from '@/services/domainCommands';
import type { TransportVehicleRow } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { Bus, Clock, MapPin, Plus, Trash2, X, Users, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';

interface GroupOption { id: string; code?: string | null; name?: string | null }
interface VehicleForm {
  bus_number: string; company: string; driver_name: string; driver_phone: string;
  capacity: string; route: string; status: string;
}
interface AssignForm {
  vehicle_id: string; group_id: string; route: string; departure: string;
  destination: string; departure_time: string; status: string;
}


const VEHICLE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'IN_TRANSIT', 'RETIRED'];
const ASSIGNMENT_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'MAINTENANCE': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'IN_TRANSIT': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'RETIRED': return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
    case 'PLANNED': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'COMPLETED': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'CANCELLED': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const inputCls = 'input';
const labelCls = 'block text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1';

export function TransportManager(_props: { vehicles?: TransportVehicleRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: vehicleData, loading, error, refetch: refetchVehicles } = useTransportVehicles();
  const { data: assignments, loading: assignmentsLoading, error: assignmentsError, refetch: refetchAssignments } = useTransportAssignments();
  const { run, error: commandError, clearError, pending } = useCommandRunner();

  const updateAssignment = (id: string, patch: Record<string, unknown>) =>
    run('transport_assignment.update', () => transportAssignmentCommands.update(id, patch), refetchAssignments);

  const removeAssignment = (id: string) =>
    run('transport_assignment.delete', () => transportAssignmentCommands.remove(id), refetchAssignments);

  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<VehicleForm>({
    bus_number: '',
    company: '',
    driver_name: '',
    driver_phone: '',
    capacity: '',
    route: '',
    status: 'ACTIVE',
  });
  const [assignForm, setAssignForm] = useState<AssignForm>({
    vehicle_id: '',
    group_id: '',
    route: '',
    departure: '',
    destination: '',
    departure_time: '',
    status: 'PLANNED',
  });

  useEffect(() => {
    let mounted = true;
    supabase.from('groups').select('id, code, name').then(({ data }) => {
      if (mounted && data) setGroups(data as GroupOption[]);
    });
    return () => {
      mounted = false;
    };
  }, []);


  const set = (key: keyof VehicleForm, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setAssign = (key: keyof AssignForm, value: string) => setAssignForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.bus_number.trim()) return;
    setSaving(true);
    const outcome = await run(
      'transport_vehicle.create',
      () =>
        transportVehicleCommands.create({
          bus_number: form.bus_number.trim(),
          company: form.company.trim(),
          driver_name: form.driver_name.trim(),
          driver_phone: form.driver_phone.trim(),
          capacity: form.capacity ? Number(form.capacity) : null,
          route: form.route.trim(),
          status: form.status,
        }),
      refetchVehicles,
    );
    setSaving(false);
    if (!outcome.ok) return;
    setShowForm(false);
    setForm({ bus_number: '', company: '', driver_name: '', driver_phone: '', capacity: '', route: '', status: 'ACTIVE' });
  };

  const submitAssignment = async () => {
    if (!assignForm.vehicle_id) return;
    const outcome = await run(
      'transport_assignment.create',
      () =>
        transportAssignmentCommands.create({
          vehicle_id: assignForm.vehicle_id,
          group_id: assignForm.group_id || null,
          route: assignForm.route,
          departure: assignForm.departure,
          destination: assignForm.destination,
          departure_time: assignForm.departure_time ? new Date(assignForm.departure_time).toISOString() : null,
          status: assignForm.status,
        }),
      refetchAssignments,
    );
    if (!outcome.ok) return;
    setAssignForm({ vehicle_id: '', group_id: '', route: '', departure: '', destination: '', departure_time: '', status: 'PLANNED' });
  };

  const updateVehicle = (id: string, patch: Record<string, unknown>) =>
    run('transport_vehicle.update', () => transportVehicleCommands.update(id, patch), refetchVehicles);

  const removeVehicle = (id: string) =>
    run('transport_vehicle.delete', () => transportVehicleCommands.remove(id), refetchVehicles);

  const vehicleById = (id?: string | null) => vehicleData.find((v) => v.id === id);
  const groupById = (id?: string | null) => groups.find((g) => g.id === id);
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : '-');


  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      {(commandError || error || assignmentsError) && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300" role="alert">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{commandError || error || assignmentsError}</span>
          {commandError && <button onClick={clearError} className="underline">{t('إخفاء', 'Masquer', 'Dismiss')}</button>}
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Bus className="h-5 w-5 text-[var(--accent)]" />
            {t('إدارة النقل', 'Gestion des Transports', 'Transport Management')}
          </h1>
          <p className="text-[13px] text-[var(--text-muted)]">{t('أسطول المركبات وجدول الإسناد', 'Flotte de véhicules et affectations', 'Vehicle fleet and assignments')}</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="btn btn-primary"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? t('إلغاء', 'Annuler', 'Cancel') : t('إضافة مركبة', 'Ajouter un véhicule', 'Add Vehicle')}
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg p-4 text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}

      {showForm && (
        <div className="card p-5">
          <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white mb-4">{t('مركبة جديدة', 'Nouveau véhicule', 'New Vehicle')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>{t('رقم الحافلة', 'N° bus', 'Bus Number')}</label>
              <input className={inputCls} value={form.bus_number} onChange={(e) => set('bus_number', e.target.value)} placeholder="BUS-001" />
            </div>
            <div>
              <label className={labelCls}>{t('الشركة', 'Société', 'Company')}</label>
              <input className={inputCls} value={form.company} onChange={(e) => set('company', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('اسم السائق', 'Nom du chauffeur', 'Driver Name')}</label>
              <input className={inputCls} value={form.driver_name} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('هاتف السائق', 'Tél. chauffeur', 'Driver Phone')}</label>
              <input className={inputCls} value={form.driver_phone} onChange={(e) => set('driver_phone', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('السعة', 'Capacité', 'Capacity')}</label>
              <input type="number" className={inputCls} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('المسار', 'Route', 'Route')}</label>
              <input className={inputCls} value={form.route} onChange={(e) => set('route', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الحالة', 'Statut', 'Status')}</label>
              <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={submit} disabled={saving || pending || !form.bus_number.trim()} className="btn btn-primary">
              {saving ? t('جاري الحفظ...', 'Enregistrement...', 'Saving...') : t('حفظ', 'Enregistrer', 'Save')}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white mb-4">
            {t('أسطول المركبات', 'Flotte de Véhicules', 'Vehicle Fleet')} ({vehicleData.length})
          </h3>

          {loading ? (
            <div className="p-10 flex justify-center">
              <Spinner />
            </div>
          ) : vehicleData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
              <Bus className="w-12 h-12 mb-2 opacity-20" />
              <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {vehicleData.map((v) => (
                <div key={v.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 border border-[var(--border)] dark:border-[var(--border)] rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/50">
                  <div className="flex items-center gap-4">
                    <div className="bg-brand-500/10 p-3 rounded-full">
                      <Bus className="w-5 h-5 text-brand-500" />
                    </div>
                    <div>
                      <p className="font-bold text-[var(--text-secondary)] dark:text-white">{v.bus_number}</p>
                      <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{v.company} • {t('سعة:', 'Capacité:', 'Capacity:')} {v.capacity ?? '-'}{v.route ? ` • ${v.route}` : ''}</p>
                      <p className="text-[13px] text-[var(--text-muted)]">{v.driver_name || '-'} {v.driver_phone ? `• ${v.driver_phone}` : ''}</p>
                    </div>
                  </div>
                  <div className="mt-3 md:mt-0 flex flex-wrap gap-2 items-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(v.status || '')}`}>{v.status || '-'}</span>
                    <Select
                      className="bg-white dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] dark:text-white"
                      value={v.status || ''}
                      onChange={(e) => updateVehicle(v.id, { status: e.target.value })}
                    >
                      {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                    <button onClick={() => removeVehicle(v.id)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white mb-4">
            {t('جدول الإسناد', 'Programme des Affectations', 'Assignment Schedule')} ({assignments.length})
          </h3>

          <div className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl p-4 mb-4 space-y-3">
            <p className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('إسناد جديد', 'Nouvelle affectation', 'New Assignment')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Select className={inputCls} value={assignForm.vehicle_id} onChange={(e) => setAssign('vehicle_id', e.target.value)}>
                <option value="">{t('المركبة...', 'Véhicule...', 'Vehicle...')}</option>
                {vehicleData.map((v) => <option key={v.id} value={v.id}>{v.bus_number} - {v.company || ''}</option>)}
              </Select>
              <Select className={inputCls} value={assignForm.group_id} onChange={(e) => setAssign('group_id', e.target.value)}>
                <option value="">{t('المجموعة...', 'Groupe...', 'Group...')}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.code || g.name}</option>)}
              </Select>
              <input className={inputCls} value={assignForm.route} onChange={(e) => setAssign('route', e.target.value)} placeholder={t('المسار', 'Route', 'Route')} />
              <input className={inputCls} value={assignForm.departure} onChange={(e) => setAssign('departure', e.target.value)} placeholder={t('من', 'De', 'From')} />
              <input className={inputCls} value={assignForm.destination} onChange={(e) => setAssign('destination', e.target.value)} placeholder={t('إلى', 'Vers', 'To')} />
              <input type="datetime-local" className={inputCls} value={assignForm.departure_time} onChange={(e) => setAssign('departure_time', e.target.value)} />
            </div>
            <button
              onClick={submitAssignment}
              disabled={!assignForm.vehicle_id || pending}
              className="btn btn-primary"
            >
              {t('إضافة الإسناد', 'Ajouter', 'Add Assignment')}
            </button>
          </div>

          {assignmentsLoading ? (
            <div className="p-6 flex justify-center">
              <Spinner />
            </div>
          ) : assignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
              <Clock className="w-12 h-12 mb-2 opacity-20" />
              <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {assignments.map((a) => {
                const v = vehicleById(a.vehicle_id);
                const g = groupById(a.group_id);
                return (
                  <div key={a.id} className="p-4 border border-[var(--border)] dark:border-[var(--border)] rounded-xl">
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="flex items-center gap-1.5 font-bold text-[var(--text-secondary)] dark:text-white">
                          <Bus className="w-4 h-4 text-brand-500" />
                          {v ? v.bus_number : a.vehicle_id?.slice(0, 8)}
                        </span>
                        <span className="flex items-center gap-1 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"><Users className="w-3.5 h-3.5" />{g ? g.code || g.name : '-'}</span>
                        <span className="flex items-center gap-1 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"><MapPin className="w-3.5 h-3.5 text-brand-500" />{a.route}{a.departure ? ` (${a.departure} → ${a.destination || ''})` : ''}</span>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(a.status || '')}`}>{a.status || '-'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      <span>{t('وقت المغادرة', 'Départ', 'Departure')}: {fmt(a.departure_time)}</span>
                      <Select
                        className="bg-white dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] dark:text-white"
                        value={a.status || 'PLANNED'}
                        onChange={(e) => updateAssignment(a.id, { status: e.target.value })}
                      >
                        {ASSIGNMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                      <button onClick={() => removeAssignment(a.id)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
