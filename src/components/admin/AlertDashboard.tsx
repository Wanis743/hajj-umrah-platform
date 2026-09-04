import { useState, type FormEvent } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { Bell, ShieldAlert, Check, Trash2, Plus } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';

const FILTERS = ['ALL', 'INFO', 'WARNING', 'CRITICAL'];
const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];

interface AlertRow {
  id: string;
  type?: string;
  severity?: string;
  message?: string;
  acknowledged?: boolean;
  acknowledged_at?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export function AlertDashboard(_props: { alerts?: AlertRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: alerts, loading, insert, update, remove } = useSupabaseData<AlertRow>({
    table: 'alerts',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [filter, setFilter] = useState('ALL');
  const [form, setForm] = useState({ type: '', severity: 'WARNING', message: '' });

  const filtered = alerts.filter(a => filter === 'ALL' || a.severity === filter);

  const getAlertStyles = (severity?: string) => {
    switch (severity) {
      case 'CRITICAL': return 'border-s-4 border-rose-500 bg-rose-50 dark:bg-rose-950/20';
      case 'WARNING': return 'border-s-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20';
      case 'INFO': return 'border-s-4 border-blue-500 bg-blue-50 dark:bg-blue-950/20';
      default: return 'border-s-4 border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]';
    }
  };

  const getSeverityPill = (severity?: string) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-rose-500 text-white';
      case 'WARNING': return 'bg-amber-500 text-black';
      default: return 'bg-blue-500 text-white';
    }
  };

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.type.trim() || !form.message.trim()) return;
    await insert({
      type: form.type.trim(),
      severity: form.severity,
      message: form.message.trim(),
      acknowledged: false,
      acknowledged_at: null,
    });
    setForm({ type: '', severity: 'WARNING', message: '' });
  };

  const handleToggleAck = async (alert: AlertRow) => {
    if (alert.acknowledged) {
      await update(alert.id, { acknowledged: false, acknowledged_at: null });
    } else {
      await update(alert.id, { acknowledged: true, acknowledged_at: new Date().toISOString() });
    }
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
          <Bell className="h-5 w-5 text-[var(--accent)]" />
          {t('لوحة التنبيهات', 'Tableau des Alertes', 'Alert Dashboard')}
        </h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
              filter === f
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--bg-hover)]'
            }`}
          >
            {f === 'ALL' ? t('الكل', 'Tous', 'All') : f}
          </button>
        ))}
      </div>

      <div className="card p-5 space-y-4">
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] rounded-xl border border-[var(--border)] dark:border-[var(--border)]">
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('النوع', 'Type', 'Type')}</label>
            <input
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              placeholder={t('حجز، تأشيرة، دفع...', 'Réservation, visa, paiement...', 'Booking, visa, payment...')}
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الخطورة', 'Sévérité', 'Severity')}</label>
            <Select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className={inputCls}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">{t('الرسالة', 'Message', 'Message')}</label>
            <input
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              placeholder={t('نص التنبيه...', "Texte de l'alerte...", 'Alert message...')}
              className={inputCls}
              required
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" className="btn btn-primary">
              <Plus className="w-4 h-4" />
              {t('إضافة تنبيه', 'Ajouter une alerte', 'Add Alert')}
            </button>
          </div>
        </form>

        {loading ? spinner : (
          filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
              <ShieldAlert className="w-12 h-12 mb-2 opacity-20" />
              <p>{t('لا توجد تنبيهات', 'Aucune alerte', 'No alerts')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(alert => (
                <div key={alert.id} className={`p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 ${getAlertStyles(alert.severity)}`}>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${getSeverityPill(alert.severity)}`}>{alert.severity}</span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-white/50 dark:bg-black/20 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                        {alert.type}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">
                        {alert.created_at ? new Date(alert.created_at).toLocaleString() : ''}
                      </span>
                      {alert.acknowledged && (
                        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          {t('مؤكد', 'Confirmée', 'Acknowledged')}
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-[var(--text-secondary)] dark:text-white">{alert.message}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleAck(alert)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                        alert.acknowledged
                          ? 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--bg-hover)]'
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      {alert.acknowledged ? t('إلغاء الاعتراف', 'Déconfirmer', 'Undo') : t('اعتراف', 'Confirmer', 'Acknowledge')}
                    </button>
                    <button
                      onClick={() => remove(alert.id)}
                      className="p-2 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
