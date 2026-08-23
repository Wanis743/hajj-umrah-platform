import { useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { useFlights, useTransportAssignments, useTransportVehicles } from '@/hooks/useDomainResources';
import { useCommandRunner } from '@/hooks/useCommandRunner';
import { transportAssignmentCommands } from '@/services/domainCommands';
import type { FlightRow, TransportAssignmentRow, TransportVehicleRow } from '@/types/database';
import { Plane, Bus, MapPin, Phone, Plus, Trash2, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';

interface AssignmentForm {
  vehicle_id: string;
  route: string;
  departure: string;
  destination: string;
  departure_time: string;
  status: string;
}


const ASSIGNMENT_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'SCHEDULED':
    case 'PLANNED': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'BOARDING':
    case 'ACTIVE': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'DEPARTED':
    case 'COMPLETED': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'LANDED': return 'bg-emerald-500/20 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'DELAYED': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    case 'CANCELLED': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

export function FlightLogisticsManager(_props: { flights?: FlightRow[]; buses?: TransportVehicleRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: flightData, loading: flightsLoading, error: flightsError } = useFlights();
  const { data: assignments, loading: assignmentsLoading, error: assignmentsError, refetch: refetchAssignments } = useTransportAssignments();
  const { data: vehicles, loading: vehiclesLoading } = useTransportVehicles();
  const { run, error: commandError, clearError, pending } = useCommandRunner();

  const updateAssignment = (id: string, patch: Record<string, unknown>) =>
    run('transport_assignment.update', () => transportAssignmentCommands.update(id, patch), refetchAssignments);

  const removeAssignment = (id: string) =>
    run('transport_assignment.delete', () => transportAssignmentCommands.remove(id), refetchAssignments);

  const [assignmentForms, setAssignmentForms] = useState<Record<string, AssignmentForm>>({});

  const getForm = (flightId: string): AssignmentForm => {
    const existing = assignmentForms[flightId];
    if (!existing) {
      const flight = flightData.find((f) => f.id === flightId);
      return {
        vehicle_id: '',
        route: flight?.flight_number || '',
        departure: flight?.departure_airport || '',
        destination: flight?.arrival_airport || '',
        departure_time: '',
        status: 'PLANNED',
      };
    }
    return existing;
  };

  const form = (flightId: string) => getForm(flightId);
  const setIntoForm = (flightId: string, key: keyof AssignmentForm, value: string) => {
    setAssignmentForms((prev) => ({ ...prev, [flightId]: { ...getForm(flightId), [key]: value } }));
  };

  const submitAssignment = async (flightId: string) => {
    const f = getForm(flightId);
    if (!f.vehicle_id) return;
    const outcome = await run(
      'transport_assignment.create',
      () =>
        transportAssignmentCommands.create({
          vehicle_id: f.vehicle_id,
          route: f.route,
          departure: f.departure,
          destination: f.destination,
          departure_time: f.departure_time ? new Date(f.departure_time).toISOString() : null,
          status: 'PLANNED',
        }),
      refetchAssignments,
    );
    if (!outcome.ok) return;
    setAssignmentForms((prev) => {
      const next = { ...prev };
      delete next[flightId];
      return next;
    });
  };

  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : '-');
  const timeOnly = (d?: string | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--');

  const flightAssignments = (flight: FlightRow): TransportAssignmentRow[] =>
    assignments.filter((a) => a.route === flight.flight_number);
  const vehicleById = (id?: string | null) => vehicles.find((v) => v.id === id);

  const scheduled = flightData.filter((f) => f.status === 'SCHEDULED').length;
  const delayed = flightData.filter((f) => f.status === 'DELAYED').length;

  const activeVehicles = vehicles.filter((v) => v.status === 'ACTIVE' || v.status === 'IN_TRANSIT').length;

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      <div>
        <h2 className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950/30 text-brand-500"><Plane className="w-5 h-5" /></span>
          {t('لوجستيات الطيران والنقل', 'Logistique Vols & Transport', 'Flight & Transport Logistics')}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          {t('تتبع الرحلات وإسناد المركبات لكل مسار', 'Suivi des vols et affectation des véhicules', 'Track flights and assign vehicles per route')}
        </p>
      </div>

      {(commandError || flightsError || assignmentsError) && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300" role="alert">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{commandError || flightsError || assignmentsError}</span>
          {commandError && (
            <button onClick={clearError} className="underline">{t('إخفاء', 'Masquer', 'Dismiss')}</button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t('إجمالي الرحلات', 'Total vols', 'Total Flights'), value: flightData.length, color: 'text-[var(--text-secondary)] dark:text-white' },
          { label: t('في الموعد', "À l'heure", 'On Schedule'), value: scheduled, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: t('متأخرة', 'En retard', 'Delayed'), value: delayed, color: 'text-rose-600 dark:text-rose-400' },
          { label: t('مركبات نشطة', 'Véhicules actifs', 'Active Vehicles'), value: `${activeVehicles}/${vehicles.length}`, color: 'text-emerald-600 dark:text-emerald-400' },
        ].map((s, i) => (
          <div key={i} className="card px-4 py-3 shadow-sm">
            <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{s.label}</p>
            <p className={`text-xl font-semibold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            {t('الرحلات', 'Vols', 'Flights')}
          </span>
          <div className="flex-1 h-px bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]" />
        </div>

        {flightsLoading ? (
          <div className="p-10 flex justify-center">
            <Spinner />
          </div>
        ) : flightData.length === 0 ? (
          <div className="card p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <Plane className="w-12 h-12 mb-3 opacity-50" />
            <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
          </div>
        ) : (
          flightData.map((flight) => {
            const flAssignments = flightAssignments(flight);
            const formState = form(flight.id);
            return (
              <div key={flight.id} className="card p-5 space-y-4">
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(flight.status || '')}`}>{flight.status || '-'}</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">{flight.carrier}</span>
                    </div>
                    <h4 className="font-semibold text-[var(--text-secondary)] dark:text-white text-base font-mono">{flight.flight_number}</h4>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-1">
                      <span className="font-semibold">{flight.departure_airport}</span>
                      <span className="text-[var(--text-secondary)]">→</span>
                      <span className="font-semibold">{flight.arrival_airport}</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] text-start md:text-end">
                    <p><span className="text-[var(--text-secondary)]">{t('مغادرة', 'Départ', 'Departure')}: </span><span className="font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{fmt(flight.scheduled_departure)}</span></p>
                    <p><span className="text-[var(--text-secondary)]">{t('وصول', 'Arrivée', 'Arrival')}: </span><span className="font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{fmt(flight.scheduled_arrival)}</span></p>
                    <p><span className="text-[var(--text-secondary)]">{t('صالة', 'Terminal', 'Terminal')}: </span><span className="font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{flight.terminal || '-'}{flight.gate ? ` / ${flight.gate}` : ''}</span></p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {['SCHEDULED', 'BOARDING', 'DEPARTED', 'LANDED'].map((step, idx) => {
                    const reached = ['SCHEDULED', 'BOARDING', 'DEPARTED', 'LANDED'].indexOf(flight.status || '') >= idx;
                    return (
                      <div key={step} className="flex items-center flex-1">
                        <div className={`h-2 w-2 rounded-full ${reached ? 'bg-brand-500' : 'bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]'}`}></div>
                        {idx < 3 && <div className={`flex-1 h-0.5 ${['SCHEDULED', 'BOARDING', 'DEPARTED', 'LANDED'].indexOf(flight.status || '') > idx ? 'bg-brand-500' : 'bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]'}`}></div>}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-[var(--border)] dark:border-[var(--border)] pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-bold text-[var(--text-secondary)] dark:text-white">
                      {t('إسناد المركبات', 'Affectations véhicules', 'Vehicle Assignments')} ({flAssignments.length})
                    </h5>
                    <span className="text-[10px] text-[var(--text-secondary)]">{t('المركبات', 'Véhicules', 'Vehicles')}: {vehicles.length}</span>
                  </div>

                  {vehiclesLoading ? null : (
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <Select className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] dark:text-white" value={formState.vehicle_id} onChange={(e) => setIntoForm(flight.id, 'vehicle_id', e.target.value)}>
                        <option value="">{t('المركبة...', 'Véhicule...', 'Vehicle...')}</option>
                        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.bus_number} - {v.company || ''}</option>)}
                      </Select>
                      <input className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] dark:text-white" value={formState.route} onChange={(e) => setIntoForm(flight.id, 'route', e.target.value)} placeholder={t('المسار', 'Route', 'Route')} />
                      <input className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] dark:text-white" value={formState.departure} onChange={(e) => setIntoForm(flight.id, 'departure', e.target.value)} placeholder={t('من', 'De', 'From')} />
                      <input className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] dark:text-white" value={formState.destination} onChange={(e) => setIntoForm(flight.id, 'destination', e.target.value)} placeholder={t('إلى', 'Vers', 'To')} />
                      <div className="flex gap-2">
                        <input type="datetime-local" className="flex-1 bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] dark:text-white" value={formState.departure_time} onChange={(e) => setIntoForm(flight.id, 'departure_time', e.target.value)} />
                        <button
                          onClick={() => submitAssignment(flight.id)}
                          disabled={!formState.vehicle_id || pending}
                          className="btn btn-primary"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {assignmentsLoading ? (
                    <div className="p-6 flex justify-center">
                      <Spinner />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {flAssignments.length === 0 ? (
                        <p className="text-[13px] text-[var(--text-muted)]">{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
                      ) : (
                        flAssignments.map((a) => {
                          const v = vehicleById(a.vehicle_id);
                          return (
                            <div key={a.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 border border-[var(--border)] dark:border-[var(--border)] rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/50">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                                <span className="flex items-center gap-1 font-bold text-[var(--text-secondary)] dark:text-white"><Bus className="w-3.5 h-3.5 text-brand-500" />{v ? `${v.bus_number} - ${v.driver_name || ''}` : a.vehicle_id?.slice(0, 8)}</span>
                                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{a.departure} → {a.destination}</span>
                                <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{timeOnly(a.departure_time)}</span>
                                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(a.status || '')}`}>{a.status || '-'}</span>
                              </div>
                              <div className="flex items-center gap-2">
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
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default FlightLogisticsManager;