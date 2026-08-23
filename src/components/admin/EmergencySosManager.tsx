import { useEffect, useState, type FormEvent } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { AlertCircle, Send, Trash2, CheckCircle2, MapPin, Clock, ShieldAlert, User, CheckCheck } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { sosCommands } from '@/services/domainCommands';
import { useRealtimeResource } from '@/hooks/useRealtimeResource';
import { supabase } from '@/lib/supabase';
import type { TableRow } from '@/types/database';

type IncidentRow = TableRow<'incidents'> & {
  id: string;
  type?: string | null;
  severity?: string | null;
  description?: string | null;
  location?: string | null;
  status?: string | null;
  created_at?: string | null;
};
type SosEventRow = TableRow<'sos_events'> & {
  id: string;
  status?: string | null;
  pilgrim_name?: string | null;
  message?: string | null;
  location?: string | null;
  created_at?: string | null;
  handled_by?: string | null;
  pilgrim_id?: string | null;
};
type PilgrimRow = TableRow<'pilgrims'> & {
  id: string;
  full_name?: string | null;
  full_name_ar?: string | null;
};

export default function EmergencySosManager(_props: { incidents?: IncidentRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: sosEvents, loading } = useSupabaseData<SosEventRow>({
    table: 'sos_events',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [criticalIncidents, setCriticalIncidents] = useState<Partial<IncidentRow>[]>([]);
  const [pilgrims, setPilgrims] = useState<Pick<PilgrimRow, 'id' | 'full_name' | 'full_name_ar'>[]>([]);
  const [broadcast, setBroadcast] = useState({ pilgrim_id: '', pilgrim_name: '', location: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sentFeedback, setSentFeedback] = useState(false);
  const [busy, setBusy] = useState('');

  const loadCritical = async () => {
    const { data } = await supabase
      .from('incidents')
      .select('id,pilgrim_id,reporter_name,pilgrim_name,type,severity,location,description,status,created_at')
      .eq('severity', 'CRITICAL')
      .order('created_at', { ascending: false })
      .limit(10);
    setCriticalIncidents((data as Partial<IncidentRow>[]) || []);
  };

  useRealtimeResource('incidents', loadCritical);

  useEffect(() => {
    loadCritical();
    const loadPilgrims = async () => {
      const { data } = await supabase.from('pilgrims').select('id, full_name, full_name_ar').order('full_name');
      setPilgrims((data as Pick<PilgrimRow, 'id' | 'full_name' | 'full_name_ar'>[]) || []);
    };
    loadPilgrims();
  }, []);

  const active = sosEvents.filter(s => (s.status || 'SOS') !== 'RESOLVED');
  const acknowledged = sosEvents.filter(s => (s.status || '') === 'ACKNOWLEDGED');
  const resolved = sosEvents.filter(s => (s.status || '') === 'RESOLVED');

  const formatTime = (v?: string | null) => {
    if (!v) return '-';
    return new Date(v).toLocaleString();
  };

  const pilgrimLabel = (p: Pick<PilgrimRow, 'id' | 'full_name' | 'full_name_ar'>) => {
    if (isAr && p.full_name_ar) return `${p.full_name_ar}${p.full_name ? ` - ${p.full_name}` : ''}`;
    return p.full_name || p.full_name_ar || p.id;
  };

  const handleSosCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!broadcast.pilgrim_name.trim() || !broadcast.location.trim()) return;
    setSending(true);
    await sosCommands.create({
      pilgrim_id: broadcast.pilgrim_id || null,
      pilgrim_name: broadcast.pilgrim_name.trim(),
      location: broadcast.location.trim(),
      message: broadcast.message.trim(),
      status: 'SOS',
    });
    setSending(false);
    setBroadcast({ pilgrim_id: '', pilgrim_name: '', location: '', message: '' });
    setSentFeedback(true);
    setTimeout(() => setSentFeedback(false), 4000);
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
          <ShieldAlert className="w-6 h-6 text-rose-500" />
          {t('مركز طوارئ الحجاج والبلاغات الطبية', 'Centre d\'Urgences & Alertes Médicales', 'Emergency SOS & Medical Incident Radar')}
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-white dark:bg-[var(--bg-hover)] px-4 py-3">
          <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('إنذارات نشطة', 'Alertes actives', 'Active Alerts')}</p>
          <p className="text-2xl font-semibold mt-0.5 text-rose-600 dark:text-rose-400">{active.length}</p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-white dark:bg-[var(--bg-hover)] px-4 py-3">
          <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('تم الاعتراف', 'Reconnues', 'Acknowledged')}</p>
          <p className="text-2xl font-semibold mt-0.5 text-amber-600 dark:text-amber-400">{acknowledged.length}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-[var(--bg-hover)] px-4 py-3">
          <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('تم الحل', 'Résolues', 'Resolved')}</p>
          <p className="text-2xl font-semibold mt-0.5 text-emerald-600 dark:text-emerald-400">{resolved.length}</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] dark:text-white mb-3">
          {t('إنذارات SOS النشطة', 'Alertes SOS actives', 'Active SOS Alerts')}
        </h3>
        {loading ? spinner : (
          active.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] card">
              <ShieldAlert className="w-12 h-12 mb-2 opacity-20" />
              <p>{t('لا توجد إنذارات SOS نشطة', 'Aucune alerte SOS active', 'No active SOS alerts')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {active.map(s => (
                <div
                  key={s.id}
                  className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 p-5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                        <AlertCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-rose-500 text-white uppercase animate-pulse">{s.status || 'SOS'}</span>
                        </div>
                        <h4 className="mt-1.5 font-bold text-[var(--text-secondary)] dark:text-white text-sm">
                          <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{s.pilgrim_name}</span>
                        </h4>
                      </div>
                    </div>
                    <span className="text-xs font-semibold whitespace-nowrap text-rose-600 dark:text-rose-400 animate-pulse">
                      {t('نشط', 'Actif', 'ACTIVE')}
                    </span>
                  </div>
                  {s.message && <p className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] leading-relaxed">{s.message}</p>}

                  <div className="space-y-1.5 text-[11px] border-t border-rose-200 dark:border-rose-800/50 pt-2.5 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      <span>{s.location}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      <span>{formatTime(s.created_at)}</span>
                    </div>
                    {s.handled_by && (
                      <div className="flex items-center gap-1.5">
                        <CheckCheck className="h-3 w-3" />
                        <span>{t('عولج بواسطة: ', 'Traité par: ', 'Handled by: ')}{s.handled_by}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(s.status || 'SOS') !== 'ACKNOWLEDGED' && (
                      <button
                        onClick={() => { setBusy(s.id); sosCommands.update(s.id, { status: 'ACKNOWLEDGED', handled_by: 'admin' }).then(() => setBusy('')); }}
                        disabled={busy === s.id}
                        className="flex items-center gap-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50 px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t('اعتراف', 'Accuser réception', 'ACKNOWLEDGE')}
                      </button>
                    )}
                    <button
                      onClick={() => { setBusy(s.id); sosCommands.update(s.id, { status: 'RESOLVED' }).then(() => setBusy('')); }}
                      disabled={busy === s.id}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50 px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t('حل', 'Résoudre', 'RESOLVE')}
                    </button>
                    <button
                      onClick={() => { setBusy(s.id); sosCommands.remove(s.id).then(() => setBusy('')); }}
                      disabled={busy === s.id}
                      className="flex items-center gap-1.5 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50 px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('حذف', 'Supprimer', 'Delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-bold text-[var(--text-secondary)] dark:text-white flex items-center gap-2.5">
          <Send className="h-4 w-4 text-brand-500" />
          {t('إطلاق إنذار SOS', 'Lancer une alerte SOS', 'Dispatch SOS Alert')}
        </h3>
        <form onSubmit={handleSosCreate} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الحاج (اختياري)', 'Pèlerin (optionnel)', 'Pilgrim (optional)')}</label>
            <Select
              value={broadcast.pilgrim_id}
              onChange={e => {
                const p = pilgrims.find(pp => pp.id === e.target.value);
                setBroadcast(b => ({ ...b, pilgrim_id: e.target.value, pilgrim_name: p ? pilgrimLabel(p) : b.pilgrim_name }));
              }}
              className={inputCls}
            >
              <option value="">{t('بدون تحديد', 'Non précisé', 'None')}</option>
              {pilgrims.map(p => (
                <option key={p.id} value={p.id}>{pilgrimLabel(p)}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('اسم الحاج', 'Nom du pèlerin', 'Pilgrim name')}</label>
            <input
              value={broadcast.pilgrim_name}
              onChange={e => setBroadcast(b => ({ ...b, pilgrim_name: e.target.value }))}
              placeholder={t('الاسم الكامل...', 'Nom complet...', 'Full name...')}
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الموقع', 'Lieu', 'Location')}</label>
            <input
              value={broadcast.location}
              onChange={e => setBroadcast(b => ({ ...b, location: e.target.value }))}
              placeholder={t('مكة، منى، عرفة...', 'La Mecque, Mina, Arafat...', 'Mecca, Mina, Arafat...')}
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الرسالة', 'Message', 'Message')}</label>
            <input
              value={broadcast.message}
              onChange={e => setBroadcast(b => ({ ...b, message: e.target.value }))}
              placeholder={t('تفاصيل الحالة...', 'Détails de la situation...', 'Situation details...')}
              className={inputCls}
            />
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-[var(--text-secondary)]">
              {t('سيتم تسجيل الإنذار في جدول sos_events وإظهاره فوراً لكل المشرفين', 'L\'alerte sera enregistrée et visible immédiatement pour tous les superviseurs', 'The alert is written to the sos_events table and visible instantly to all supervisors')}
            </p>
            <button
              type="submit"
              disabled={sending}
              className="btn btn-primary"
            >
              <Send className="h-3.5 w-3.5" />
              {sending ? t('جارٍ الإرسال...', 'Envoi...', 'Sending...') : t('إطلاق الآن', 'Lancer maintenant', 'Dispatch Now')}
            </button>
          </div>
          {sentFeedback && (
            <div className="md:col-span-2 flex items-center gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {t('تم تسجيل إنذار SOS بنجاح', 'Alerte SOS enregistrée avec succès', 'SOS alert recorded successfully')}
            </div>
          )}
        </form>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] dark:text-white mb-3">
          {t('الحوادث الحرجة الأخيرة', 'Incidents critiques récents', 'Recent Critical Incidents')}
        </h3>
        {criticalIncidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] card">
            <ShieldAlert className="w-12 h-12 mb-2 opacity-20" />
            <p>{t('لا توجد حوادث حرجة', 'Aucun incident critique', 'No critical incidents')}</p>
          </div>
        ) : (
          <div className="card divide-y divide-[var(--border-subtle)]">
            {criticalIncidents.map(inc => (
              <div key={inc.id} className="p-4 flex flex-col md:flex-row justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-rose-500 text-white uppercase">CRITICAL</span>
                    <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase">{inc.type}</span>
                    <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                      <Clock className="w-3.5 h-3.5" />
                      {formatTime(inc.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-[var(--text-secondary)] dark:text-white">{inc.description}</p>
                  {inc.location && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      <MapPin className="h-3 w-3" />
                      <span>{inc.location}</span>
                    </div>
                  )}
                </div>
                <span className="self-start rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]">
                  {inc.status || 'DETECTED'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
