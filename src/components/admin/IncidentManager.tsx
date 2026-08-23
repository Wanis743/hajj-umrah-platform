
import { reportError } from '@/lib/logger';
import Select from '@/components/admin/GlassSelect';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { AlertTriangle, LifeBuoy, MapPin, Clock, Trash2, CheckCircle2, Phone, Mail, Users, Package } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { incidentCommands } from '@/services/domainCommands';
import { useRealtimeResource } from '@/hooks/useRealtimeResource';
import { supabase } from '@/lib/supabase';
import type { TableRow } from '@/types/database';

type IncidentRow = { id: string; severity?: string; status?: string; type?: string; created_at?: string; description?: string; location?: string; reporter_name?: string; pilgrim_id?: string; resolution?: string; title?: string; phone?: string; email?: string; };
type ReservationRow = { id: string; reference?: string; package_name?: string; name?: string; status?: string; created_at?: string; reservation_date?: string; user_name?: string; phone?: string; email?: string; group_size?: number; package_tier?: string; notes?: string; total_price?: number; travelers?: number; start_date?: string; };
type PilgrimRow = TableRow<'pilgrims'>;

const INCIDENT_STATUSES = ['DETECTED', 'ACKNOWLEDGED', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function IncidentManager(_props: { incidents?: IncidentRow[]; tickets?: unknown[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const [activeTab, setActiveTab] = useState<'INCIDENTS' | 'REQUESTS'>('INCIDENTS');
  const [pilgrims, setPilgrims] = useState<Pick<PilgrimRow, 'id' | 'full_name' | 'full_name_ar'>[]>([]);
  const [resolutionTexts, setResolutionTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const { data: incidents, loading } = useSupabaseData<IncidentRow>({
    table: 'incidents',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [requests, setRequests] = useState<Partial<ReservationRow>[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

  const [form, setForm] = useState({ type: '', severity: 'MEDIUM', description: '', location: '', reporter_name: '', pilgrim_id: '' });

  const loadRequests = async () => {
    try {
      const { data } = await supabase
        .from('reservations')
        .select('id,reference,package_id,package_name,start_date,end_date,travelers,name,phone,email,status,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      setRequests((data as Partial<ReservationRow>[]) || []);
    } catch {
      setRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  };

  useRealtimeResource('reservations', loadRequests);

  useEffect(() => {
    loadRequests();
    const loadPilgrims = async () => {
      const { data } = await supabase.from('pilgrims').select('id, full_name, full_name_ar').order('full_name');
      setPilgrims((data as Pick<PilgrimRow, 'id' | 'full_name' | 'full_name_ar'>[]) || []);
    };
    loadPilgrims();
  }, []);

  const formatDate = (v?: string | null) => {
    if (!v) return '-';
    return new Date(v).toLocaleString();
  };

  const getSeverityPill = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-rose-500 text-white';
      case 'HIGH': return 'bg-orange-500 text-white';
      case 'MEDIUM': return 'bg-amber-500 text-black';
      default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'RESOLVED': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'CLOSED': return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
      case 'INVESTIGATING': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'CONTAINED': return 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400';
      case 'ACKNOWLEDGED': return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400';
      default: return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    }
  };

  const pilgrimLabel = (p: Pick<PilgrimRow, 'id' | 'full_name' | 'full_name_ar'>) => {
    if (isAr && p.full_name_ar) return `${p.full_name_ar}${p.full_name ? ` - ${p.full_name}` : ''}`;
    return p.full_name || p.full_name_ar || p.id;
  };

  const pilgrimName = (id?: string | null) => {
    if (!id) return '';
    const p = pilgrims.find(pp => pp.id === id);
    return p ? pilgrimLabel(p) : '';
  };

  const setFormField = (key: keyof typeof form, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.type.trim() || !form.description.trim()) return;
    await incidentCommands.create({
      type: form.type.trim(),
      severity: form.severity,
      status: 'DETECTED',
      description: form.description.trim(),
      location: form.location.trim(),
      reporter_name: form.reporter_name.trim(),
      pilgrim_id: form.pilgrim_id || null,
    });
    setForm({ type: '', severity: 'MEDIUM', description: '', location: '', reporter_name: '', pilgrim_id: '' });
  };

  const handleResolve = async (id: string) => {
    setBusy(id);
    await incidentCommands.update(id, {
      status: 'RESOLVED',
      resolution: (resolutionTexts[id] || '').trim() || t('تم الحل من قبل الإدارة', "Résolu par l'administration", 'Resolved by admin'),
      resolved_at: new Date().toISOString(),
    });
    setBusy('');
    setResolutionTexts(prev => ({ ...prev, [id]: '' }));
  };


  const handleDeleteRequest = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc('cancel_reservation_request', { p_reservation_id: id, p_reason: 'Deleted by staff' });
    if (error) reportError('incident.mutation', error);
    setBusy('');
    loadRequests();
  };

  const inputCls = 'input';

  const spinner = (
    <div className="p-10 flex justify-center">
      <Spinner />
    </div>
  );

  return (
    <div className={"space-y-6 " + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-rose-500" />
          {t('إدارة الحوادث والدعم', 'Gestion des Incidents et Support', 'Incident & Support Management')}
        </h1>
      </div>

      <div className="flex border-b border-[var(--border)] dark:border-[var(--border)]">
        <button
          onClick={() => setActiveTab('INCIDENTS')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'INCIDENTS'
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)] dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)]'
          }`}
        >
          {t('الحوادث', 'Incidents', 'Incidents')} ({incidents.length})
        </button>
        <button
          onClick={() => setActiveTab('REQUESTS')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'REQUESTS'
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)] dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)]'
          }`}
        >
          {t('طلبات الدعم', 'Demandes de support', 'Support Requests')} ({requests.length})
        </button>
      </div>

      {activeTab === 'INCIDENTS' && (
        loading ? spinner : (
          <div className="card p-5 space-y-5">
            <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4 bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] rounded-xl border border-[var(--border)] dark:border-[var(--border)]">
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('النوع', 'Type', 'Type')}</label>
                <input
                  value={form.type}
                  onChange={e => setFormField('type', e.target.value)}
                  placeholder={t('حادث، إصابة، فقدان...', "Incident, blessure, perdu...", 'Incident, injury, lost...')}
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الخطورة', 'Sévérité', 'Severity')}</label>
                <Select value={form.severity} onChange={e => setFormField('severity', e.target.value)} className={inputCls}>
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الحاج (اختياري)', 'Pèlerin (optionnel)', 'Pilgrim (optional)')}</label>
                <Select value={form.pilgrim_id} onChange={e => setFormField('pilgrim_id', e.target.value)} className={inputCls}>
                  <option value="">{t('بدون تحديد', 'Non précisé', 'None')}</option>
                  {pilgrims.map(p => (
                    <option key={p.id} value={p.id}>{pilgrimLabel(p)}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الموقع', 'Lieu', 'Location')}</label>
                <input
                  value={form.location}
                  onChange={e => setFormField('location', e.target.value)}
                  placeholder={t('مكة، منى، عرفة...', 'La Mecque, Mina, Arafat...', 'Mecca, Mina, Arafat...')}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('اسم المبلغ', 'Nom du rapporteur', 'Reporter name')}</label>
                <input
                  value={form.reporter_name}
                  onChange={e => setFormField('reporter_name', e.target.value)}
                  placeholder={t('اسم المرشد أو المسؤول', 'Nom du guide ou responsable', 'Guide or staff name')}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الوصف', 'Description', 'Description')}</label>
                <input
                  value={form.description}
                  onChange={e => setFormField('description', e.target.value)}
                  placeholder={t('تفاصيل الحادث...', "Détails de l'incident...", 'Incident details...')}
                  className={inputCls}
                  required
                />
              </div>
              <div className="md:col-span-2 lg:col-span-3 flex justify-end">
                <button type="submit" className="btn btn-primary">
                  <AlertTriangle className="w-4 h-4" />
                  {t('إضافة حادث', 'Ajouter un incident', 'Add Incident')}
                </button>
              </div>
            </form>

            {incidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                <AlertTriangle className="w-12 h-12 mb-2 opacity-20" />
                <p>{t('لا توجد حوادث', 'Aucun incident', 'No incidents reported')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {incidents.map(inc => (
                  <div key={inc.id} className="p-4 border border-[var(--border)] dark:border-[var(--border)] rounded-xl hover:border-brand-500 transition-colors">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getSeverityPill(inc.severity || '')}`}>{inc.severity || 'MEDIUM'}</span>
                      <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase">{inc.type}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getStatusColor(inc.status || '')}`}>{inc.status || 'DETECTED'}</span>
                      <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(inc.created_at || '')}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-[var(--text-secondary)] dark:text-white">{inc.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {inc.location && (
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{inc.location}</span>
                      )}
                      {inc.reporter_name && (
                        <span>{t('المبلغ: ', 'Rapporté par: ', 'Reporter: ')}{inc.reporter_name}</span>
                      )}
                      {pilgrimName(inc.pilgrim_id) && (
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{pilgrimName(inc.pilgrim_id)}</span>
                      )}
                    </div>
                    {inc.status === 'RESOLVED' && inc.resolution && (
                      <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {t('الحل: ', 'Résolution: ', 'Resolution: ')}{inc.resolution}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Select
                        value={inc.status || 'DETECTED'}
                        onChange={(e) => incidentCommands.update(inc.id, { status: e.target.value })}
                        className="rounded-lg border border-[var(--border)] dark:border-[var(--border)] bg-white dark:bg-[var(--bg-hover)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] dark:text-white focus:outline-none focus:border-[var(--accent)]"
                      >
                        {INCIDENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </Select>
                      {inc.status !== 'RESOLVED' && inc.status !== 'CLOSED' && (
                        <>
                          <input
                            value={resolutionTexts[inc.id] || ''}
                            onChange={e => setResolutionTexts(prev => ({ ...prev, [inc.id]: e.target.value }))}
                            placeholder={t('سبب الحل...', 'Résolution...', 'Resolution...')}
                            className="w-full sm:w-48 rounded-lg border border-[var(--border)] dark:border-[var(--border)] bg-white dark:bg-[var(--bg-hover)] px-3 py-1.5 text-xs text-[var(--text-secondary)] dark:text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]"
                          />
                          <button
                            onClick={() => handleResolve(inc.id)}
                            disabled={busy === inc.id}
                            className="flex items-center gap-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {t('حل', 'Résoudre', 'Resolve')}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => incidentCommands.remove(inc.id)}
                        disabled={busy === inc.id}
                        className="flex items-center gap-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t('إلغاء الطلب', 'Annuler la demande', 'Cancel request')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {activeTab === 'REQUESTS' && (
        requestsLoading ? spinner : (
          <div className="card p-5">
            {requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                <LifeBuoy className="w-12 h-12 mb-2 opacity-20" />
                <p>{t('لا توجد طلبات دعم معلقة', "Aucune demande de support en attente", 'No pending support requests')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map(r => (
                  <div key={r.id} className="p-4 border border-[var(--border)] dark:border-[var(--border)] rounded-xl hover:border-brand-500 transition-colors">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-[var(--text-secondary)] dark:text-white">{r.name}</h4>
                      <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 uppercase">{r.status || 'pending'}</span>
                      {r.reference && <span className="text-xs text-[var(--text-secondary)] font-mono">{r.reference}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {r.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{r.phone}</span>}
                      {r.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{r.email}</span>}
                      {r.package_name && (
                        <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" />{r.package_name}</span>
                      )}
                      {r.travelers && (
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{r.travelers} {t('حاج', 'pèlerin(s)', 'pilgrim(s)')}</span>
                      )}
                      {r.start_date && <span>{new Date(r.start_date).toLocaleDateString()}</span>}
                    </div>
                    {String(r.notes || '') && <p className="mt-1.5 text-xs text-[var(--text-secondary)] italic">{String(r.notes || '')}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t('التأكيد يتم عبر مدير الحجوزات لضمان الحجز والدفع ذريًا', 'La confirmation se fait via le gestionnaire pour garantir une transaction atomique', 'Confirm in Booking Manager to keep booking and payment atomic')}
                      </div>
                      <button
                        onClick={() => handleDeleteRequest(r.id || '')}
                        disabled={busy === r.id}
                        className="flex items-center gap-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50 px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t('إلغاء الطلب', 'Annuler la demande', 'Cancel request')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
