import type { FlightRow } from '@/types/database';
import { useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { flightCommands } from '@/services/domainCommands';
import { Plane, AlertCircle, Clock, CheckCircle, Plus, Trash2, X } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';

const FLIGHT_STATUSES = ['SCHEDULED', 'BOARDING', 'DEPARTED', 'LANDED', 'DELAYED', 'CANCELLED'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'SCHEDULED': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'BOARDING': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'DEPARTED': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'LANDED': return 'bg-emerald-500/20 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'DELAYED': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    case 'CANCELLED': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const inputCls = 'input';
const labelCls = 'block text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1';
export function FlightManager({ flights }: { flights?: FlightRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const { data, loading, error } = useSupabaseData<FlightRow>({
    table: 'flights',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: flights ?? [],
  });

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<FlightRow>>({
    flight_number: '',
    carrier: '',
    departure_airport: '',
    arrival_airport: '',
    scheduled_departure: '',
    scheduled_arrival: '',
    status: 'SCHEDULED',
    terminal: '',
    gate: '',
  });

  const stats = {
    total: data.length,
    scheduled: data.filter((f: FlightRow) => f.status === 'SCHEDULED').length,
    departed: data.filter((f: FlightRow) => f.status === 'DEPARTED').length,
    delayed: data.filter((f: FlightRow) => f.status === 'DELAYED').length,
  };
  const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : '-');

  const submit = async () => {
    if (!(form.flight_number || '').trim()) return;
    setSaving(true);
    await flightCommands.create({
      flight_number: (form.flight_number || '').trim(),
      carrier: (form.carrier || '').trim(),
      departure_airport: (form.departure_airport || '').trim(),
      arrival_airport: (form.arrival_airport || '').trim(),
      scheduled_departure: form.scheduled_departure ? new Date(form.scheduled_departure).toISOString() : null,
      scheduled_arrival: form.scheduled_arrival ? new Date(form.scheduled_arrival).toISOString() : null,
      status: form.status,
      terminal: (form.terminal || '').trim(),
      gate: (form.gate || '').trim(),
    });
    setSaving(false);
    setShowForm(false);
    setForm({
      flight_number: '',
      carrier: '',
      departure_airport: '',
      arrival_airport: '',
      scheduled_departure: '',
      scheduled_arrival: '',
      status: 'SCHEDULED',
      terminal: '',
      gate: '',
    });
  };
  const set = (key: string, value: string) => setForm((f: Partial<FlightRow>) => ({ ...f, [key]: value }));

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Plane className="h-5 w-5 text-[var(--accent)]" />
            {t('إدارة الرحلات', 'Gestion des Vols', 'Flight Management')}
          </h1>
          <p className="text-[13px] text-[var(--text-muted)]">{t('إدارة رحلات الطيران، المواعيد والحالات', 'Gérez les vols, horaires et statuts', 'Manage flights, schedules and statuses')}</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="btn btn-primary"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? t('إلغاء', 'Annuler', 'Cancel') : t('إضافة رحلة', 'Ajouter un vol', 'Add Flight')}
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg p-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {showForm && (
        <div className="card p-5">
          <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white mb-4">{t('رحلة جديدة', 'Nouveau vol', 'New Flight')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>{t('رقم الرحلة', 'N° vol', 'Flight Number')}</label>
              <input className={inputCls} value={form.flight_number || ''} onChange={(e) => set('flight_number', e.target.value)} placeholder="AH1000" />
            </div>
            <div>
              <label className={labelCls}>{t('شركة الطيران', 'Compagnie', 'Carrier')}</label>
              <input className={inputCls} value={form.carrier || ''} onChange={(e) => set('carrier', e.target.value)} placeholder="Air Algérie" />
            </div>
            <div>
              <label className={labelCls}>{t('مطار المغادرة', 'Aéroport départ', 'Departure Airport')}</label>
              <input className={inputCls} value={form.departure_airport || ''} onChange={(e) => set('departure_airport', e.target.value)} placeholder="ALG" />
            </div>
            <div>
              <label className={labelCls}>{t('مطار الوصول', 'Aéroport arrivée', 'Arrival Airport')}</label>
              <input className={inputCls} value={form.arrival_airport || ''} onChange={(e) => set('arrival_airport', e.target.value)} placeholder="JED" />
            </div>
            <div>
              <label className={labelCls}>{t('المغادرة المجدولة', 'Départ prévu', 'Scheduled Departure')}</label>
              <input type="datetime-local" className={inputCls} value={form.scheduled_departure || ''} onChange={(e) => set('scheduled_departure', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الوصول المجدول', 'Arrivée prévue', 'Scheduled Arrival')}</label>
              <input type="datetime-local" className={inputCls} value={form.scheduled_arrival || ''} onChange={(e) => set('scheduled_arrival', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('الحالة', 'Statut', 'Status')}</label>
              <Select className={inputCls} value={form.status || 'SCHEDULED'} onChange={(e) => set('status', e.target.value)}>
                {FLIGHT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelCls}>{t('الصالة', 'Terminal', 'Terminal')}</label>
              <input className={inputCls} value={form.terminal || ''} onChange={(e) => set('terminal', e.target.value)} placeholder="T1" />
            </div>
            <div>
              <label className={labelCls}>{t('البوابة', 'Porte', 'Gate')}</label>
              <input className={inputCls} value={form.gate || ''} onChange={(e) => set('gate', e.target.value)} placeholder="A12" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={submit}
              disabled={saving || !(form.flight_number || '').trim()}
              className="btn btn-primary"
            >
              {saving ? t('جاري الحفظ...', 'Enregistrement...', 'Saving...') : t('حفظ', 'Enregistrer', 'Save')}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { icon: Plane, label: t('الإجمالي', 'Total', 'Total'), value: stats.total, color: 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]' },
          { icon: Clock, label: t('مجدول', 'Programmé', 'Scheduled'), value: stats.scheduled, color: 'text-blue-500' },
          { icon: CheckCircle, label: t('غادر', 'Parti', 'Departed'), value: stats.departed, color: 'text-emerald-500' },
          { icon: AlertCircle, label: t('متأخر', 'Retardé', 'Delayed'), value: stats.delayed, color: 'text-rose-500' },
        ].map((stat, idx) => (
          <div key={idx} className="card p-5 flex items-center gap-4">
            <div className={`p-3 rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] ${stat.color}`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[13px] text-[var(--text-muted)]">{stat.label}</p>
              <p className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="p-10 flex justify-center">
          <Spinner />
        </div>
      ) : data.length === 0 ? (
        <div className="card p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          <Plane className="w-12 h-12 mb-3 opacity-50" />
          <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((flight: FlightRow) => (
            <div key={flight.id} className="card p-5 hover:border-brand-500 transition-colors">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] flex items-center justify-center text-brand-500">
                    <Plane className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--text-secondary)] dark:text-white font-mono">{(flight.flight_number || "")}</h3>
                    <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{(flight.carrier || "")}</p>
                  </div>
                </div>

                <div className="flex-1 flex items-center justify-center px-4 w-full">
                  <div className="flex items-center w-full max-w-md">
                    <div className="text-center w-24 sm:w-28">
                      <p className="text-sm font-bold text-[var(--text-secondary)] dark:text-white leading-snug">{fmt(flight.scheduled_departure)}</p>
                      <p className="text-[13px] text-[var(--text-muted)]">{(flight.departure_airport || "")}</p>
                    </div>
                    <div className="flex-1 px-3 sm:px-4 relative">
                      <div className="h-0.5 bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] w-full rounded-full"></div>
                      <Plane className="absolute top-1/2 left-1/2 transform -translate-y-1/2 -translate-x-1/2 w-4 h-4 text-brand-500" />
                    </div>
                    <div className="text-center w-24 sm:w-28">
                      <p className="text-sm font-bold text-[var(--text-secondary)] dark:text-white leading-snug">{fmt(flight.scheduled_arrival)}</p>
                      <p className="text-[13px] text-[var(--text-muted)]">{(flight.arrival_airport || "")}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                  {flight.terminal && <span className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('صالة', 'Terminal', 'Terminal')} {flight.terminal}{flight.gate ? ` / ${flight.gate}` : ''}</span>}
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge((flight.status || "") || '')}`}>{(flight.status || "") || '-'}</span>
                  <Select
                    className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] dark:text-white focus:outline-none"
                    value={(flight.status || "") || ''}
                    onChange={(e) => flightCommands.update(flight.id, { status: e.target.value })}
                  >
                    {FLIGHT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <button
                    onClick={() => flightCommands.remove(flight.id)}
                    className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    title={t('حذف', 'Supprimer', 'Delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
