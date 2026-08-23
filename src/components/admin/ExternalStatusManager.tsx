import { useConfirmDialog } from '@/components/ConfirmDialog';
import type React from 'react';
import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { ShieldCheck, CheckCircle2, Clock, AlertTriangle, QrCode, RefreshCw, Search, Rocket, Trash2, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { usePilgrimDirectory, useVisas } from '@/hooks/useDomainResources';
import { useCommandRunner } from '@/hooks/useCommandRunner';
import { visaCommands } from '@/services/domainCommands';
import type { PilgrimRow, VisaRow } from '@/types/database';

const VISIBLE_STAGES = ['SUBMITTED', 'PROCESSING', 'APPROVED', 'ISSUED', 'REJECTED'];

export function ExternalStatusManager(_props: { pilgrims?: PilgrimRow[] }) {
  const confirmDialog = useConfirmDialog();
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: visas, loading, error: visasError, refetch } = useVisas();
  const { data: pilgrims, refetch: refetchPilgrims } = usePilgrimDirectory();
  const { run, error: commandError, clearError, pending } = useCommandRunner();

  const syncAll = async () => {
    await refetch();
    await refetchPilgrims();
  };

  /** Single atomic business command: visa stage + pilgrim status + audit in one transaction. */
  const advanceStage = (visaId: string, toStatus: string) =>
    run('visa.advance_stage', () => visaCommands.advanceStage(visaId, toStatus), syncAll);

  const remove = (id: string) => run('visa.retire', () => visaCommands.remove(id), syncAll);

  const [search, setSearch] = useState('');
  const [advancing, setAdvancing] = useState(false);

  const pilgrimMap = new Map<string, PilgrimRow>(pilgrims.map((p) => [p.id, p]));


  const daysElapsed = (v: VisaRow) => {
    if (v.application_age != null) return Number(v.application_age);
    if (!v.created_at) return 0;
    const dt = new Date(v.created_at);
    if (isNaN(dt.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - dt.getTime()) / (1000 * 3600 * 24)));
  };

  const stats = {
    submitted: visas.filter((v) => v.status === 'SUBMITTED').length,
    processing: visas.filter((v) => v.status === 'PROCESSING').length,
    approved: visas.filter((v) => v.status === 'APPROVED').length,
    issued: visas.filter((v) => v.status === 'ISSUED').length,
    rejected: visas.filter((v) => v.status === 'REJECTED' || v.status === 'CANCELLED').length,
  };

  const totalInPipeline = visas.length;
  const approvalRate = totalInPipeline > 0 ? Math.round(((stats.approved + stats.issued) / totalInPipeline) * 100) : 0;

  const stageMeta: Record<string, { ar: string; fr: string; en: string; color: string; bar: string; icon: React.ComponentType<{ className?: string }> }> = {
    SUBMITTED: { ar: 'مرفوع', fr: 'Soumis', en: 'Submitted', color: 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900', bar: 'bg-blue-500', icon: Clock },
    PROCESSING: { ar: 'قيد المعالجة', fr: 'En traitement', en: 'Processing', color: 'bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-900', bar: 'bg-violet-500', icon: RefreshCw },
    APPROVED: { ar: 'موافقة خارجية (إدخال يدوي)', fr: 'Approuvé (Manuel)', en: 'Externally Approved (Manual Record)', color: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900', bar: 'bg-emerald-500', icon: ShieldCheck },
    ISSUED: { ar: 'تأشيرة صادرة', fr: 'Visa émis', en: 'Visa Issued', color: 'bg-brand-500/15 text-brand-700 dark:text-brand-400 border-brand-200 dark:border-brand-900', bar: 'bg-brand-500', icon: CheckCircle2 },
    REJECTED: { ar: 'مرفوض', fr: 'Rejeté', en: 'Rejected', color: 'bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900', bar: 'bg-rose-500', icon: AlertTriangle },
  };

  const advanceAll = async () => {
    setAdvancing(true);
    const targets = visas.filter((v) => v.status === 'SUBMITTED' || v.status === 'APPROVED');
    for (const v of targets) {
      const next = v.status === 'SUBMITTED' ? 'APPROVED' : 'ISSUED';
      const outcome = await advanceStage(v.id, next);
      if (!outcome.ok) break;
    }
    await syncAll();
    setAdvancing(false);
  };

  const q = search.toLowerCase();
  const filtered = visas.filter((v) => {
    if (!q) return true;
    const p = pilgrimMap.get(v.pilgrim_id ?? '');
    const name = `${p?.full_name || ''} ${p?.full_name_ar || ''} ${v.passport_number || ''}`.toLowerCase();
    return name.includes(q);
  });

  const statusPill = (s: string) => (stageMeta[s] || stageMeta.SUBMITTED).color;

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      {(commandError || visasError) && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300" role="alert">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{commandError || visasError}</span>
          {commandError && <button onClick={clearError} className="underline">{t('إخفاء', 'Masquer', 'Dismiss')}</button>}
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600">
              <ShieldCheck className="h-4 w-4" />
            </span>
            {t('مركز التأشيرات والحالة الخارجية', 'Centre Visas & Statut Externe', 'Visa & External Status Center')}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            {t('متابعة مسار التأشيرة والموافقات الخارجية', 'Suivi du parcours visa et approbations externes', 'Track visa stages & external approvals')}
          </p>
        </div>
        <button
          onClick={advanceAll}
          disabled={advancing || pending || (stats.submitted === 0 && stats.approved === 0)}
          className="btn btn-primary"
        >
          <Rocket className="w-4 h-4" />
          {advancing ? t('جارٍ التحديث...', 'Mise à jour...', 'Updating...') : t('تقدم الدفعة (موافقة → إصدار)', 'Avancer lot (Approuvé → Émis)', 'Advance Batch (Approved → Issued)')}
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-[var(--text-secondary)] dark:text-white flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-500" />
            {t('معدل الموافقة الكلي (نسك / MoFA)', 'Taux d\'approbation global', 'Overall Visa Approval Rate')}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{approvalRate}%</span>
            <span className="flex h-2 w-2 rounded-full bg-brand-500 animate-ping" />
          </div>
        </div>
        <div className="h-2 w-full rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full transition-all duration-1000" style={{ width: `${approvalRate}%` }} />
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] mt-2">
          {stats.issued} {t('تأشيرة مختومة', 'visas tamponnés', 'visas stamped')} · {stats.approved} {t('موافقة خارجية (إدخال يدوي)', 'approbations externes', 'Nusuk status (manual)')}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {VISIBLE_STAGES.map((stage) => {
          const meta = stageMeta[stage];
          const count = stage === 'REJECTED' ? stats.rejected : stats[stage as 'submitted'];
          const pct = totalInPipeline > 0 ? Math.round((count / totalInPipeline) * 100) : 0;
          const Icon = meta.icon;
          return (
            <div key={stage} className={`rounded-lg border p-4 space-y-2 ${meta.color}`}>
              <div className="flex items-center gap-1.5">
                <Icon className="h-4 w-4" />
                <p className="text-[11px] font-bold leading-snug">{t(meta.ar, meta.fr, meta.en)}</p>
              </div>
              <p className="text-2xl font-semibold">{count}</p>
              <div className="h-1 w-full rounded-full bg-current/20 overflow-hidden">
                <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] opacity-70">{pct}% {t('من المجموع', 'du total', 'of total')}</p>
            </div>
          );
        })}
      </div>

      <div className="relative">
        <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)] start-3`} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('البحث بالاسم أو رقم الجواز...', 'Recherche par nom ou passeport...', 'Search by name or passport...')}
          className={`w-full rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-white dark:bg-[var(--bg-hover)] py-2.5 text-xs placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] transition-all ps-9 pe-4`}
        />
      </div>

      <div className="overflow-x-auto card">
        {loading ? (
          <Spinner className="p-10" />
        ) : filtered.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
            <p>{t('لا توجد تأشيرات في المسار', 'Aucun visa dans le parcours', 'No visas in pipeline')}</p>
          </div>
        ) : (
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="bg-[var(--bg-hover)]/80 dark:bg-[var(--bg-hover)]/60 border-b border-[var(--border)] dark:border-[var(--border)]">
                {[t('الحاج', 'Pèlerin', 'Pilgrim'), t('رقم الجواز', 'N° Passeport', 'Passport No.'), t('مرحلة التأشيرة', 'Statut visa', 'Visa Stage'), t('أيام منذ التقديم', 'Jours écoulés', 'Days Elapsed'), t('إجراءات', 'Actions', 'Actions')].map((h, i) => (
                  <th key={i} className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] whitespace-nowrap ${isAr ? 'text-end' : 'text-start'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filtered.slice(0, 25).map((v) => {
                const p = pilgrimMap.get(v.pilgrim_id ?? '');
                const meta = stageMeta[v.status as string] || stageMeta.SUBMITTED;
                const days = daysElapsed(v);
                return (
                  <tr key={v.id} className="hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-bold text-[var(--text-secondary)] dark:text-white">{isAr ? p?.full_name_ar || p?.full_name || '-' : p?.full_name || '-'}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{v.passport_number || p?.passport_number || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 font-bold whitespace-nowrap ${statusPill(v.status || '')}`} style={{ fontSize: '10px' }}>
                        {t(meta.ar, meta.fr, meta.en)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: days > 30 ? '#f43f5e' : days > 15 ? '#f59e0b' : '#10b981' }} />
                        <span className="font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{days} {t('يوم', 'j', 'd')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={async () => {
                          if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف التأشيرة؟', 'Supprimer le visa ?', 'Delete visa?'), danger: true })) {
                            await remove(v.id);
                          }
                        }}
                        className="rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && filtered.length > 25 && (
          <div className="px-4 py-3 border-t border-[var(--border)] dark:border-[var(--border)] text-xs text-[var(--text-secondary)] text-center">
            {t(`عرض 25 من أصل ${filtered.length}`, `25 sur ${filtered.length} affichés`, `Showing 25 of ${filtered.length}`)}
          </div>
        )}
      </div>

      {!loading && visas.length > 0 && (
        <p className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5">
          <QrCode className="h-3 w-3" />
          {t('الحالة الخارجية يتم تسجيلها يدوياً. النظام غير متصل بنظام خارجي تلقائياً.', 'Statut externe est documenté manuellement. Le système ne se connecte pas automatiquement.', 'External status is recorded manually by staff. The system does not connect to external APIs.')}
        </p>
      )}
    </div>
  );
}
export default ExternalStatusManager;
