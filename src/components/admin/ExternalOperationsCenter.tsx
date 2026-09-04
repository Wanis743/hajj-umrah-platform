import React, { useState, useMemo } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { externalOperationCommands } from '@/services/domainCommands';
import { reportError } from '@/lib/logger';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, AlertTriangle, Clock, ExternalLink, Building2, Plane, Hotel, Bus, Shield, Landmark, Globe, Search, ChevronDown, ChevronRight, RefreshCw, Paperclip, AlertCircle } from 'lucide-react';
import type { ExternalOperationRow } from '@/types/database';
import { Spinner } from '@/components/admin/ui';

// Status colors
const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED:    'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
  READY:          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SUBMITTED:      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  UNDER_REVIEW:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  ACTION_REQUIRED:'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  APPROVED:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  REJECTED:       'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  COMPLETED:      'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  CANCELLED:      'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400',
};

const PROVIDER_ICONS: Record<string, React.FC<{ className?: string }>> = {
  NUSUK: Globe, AIRLINE: Plane, HOTEL: Hotel,
  TRANSPORT: Bus, INSURANCE: Shield, BANK: Landmark,
  GOVT: Building2, OTHER: ExternalLink,
};

const PROVIDER_COLORS: Record<string, string> = {
  NUSUK: 'text-emerald-600', AIRLINE: 'text-blue-600',
  HOTEL: 'text-amber-600', TRANSPORT: 'text-purple-600',
  INSURANCE: 'text-teal-600', BANK: 'text-green-600',
  GOVT: 'text-red-600', OTHER: 'text-slate-500',
};

const STATUS_NEXT: Record<string, string> = {
  NOT_STARTED: 'READY',
  READY: 'SUBMITTED',
  SUBMITTED: 'UNDER_REVIEW',
  UNDER_REVIEW: 'APPROVED',
  ACTION_REQUIRED: 'SUBMITTED',
  APPROVED: 'COMPLETED',
};

// SLA Timer component
function SLATimer({ deadline, status }: { deadline: string | null | undefined; status: string }) {
  if (!deadline || ['COMPLETED','CANCELLED','REJECTED'].includes(status)) return null;
  const msLeft = new Date(deadline).getTime() - Date.now();
  const hoursLeft = Math.floor(msLeft / 3600000);
  const isOverdue = msLeft < 0;
  const isWarning = msLeft < 24 * 3600000 && msLeft > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      isOverdue ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' :
      isWarning ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                  'bg-slate-100 text-slate-600 dark:bg-slate-700/30 dark:text-slate-400'
    }`}>
      <Clock className="w-2.5 h-2.5" />
      {isOverdue ? `+${Math.abs(hoursLeft)}h` : `${hoursLeft}h`}
    </span>
  );
}

// Evidence badge
function EvidenceBadge({ status }: { status: string }) {
  if (status === 'VERIFIED') return <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded dark:bg-emerald-900/30 dark:text-emerald-300">✓ Verified</span>;
  if (status === 'ATTACHED') return <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded dark:bg-blue-900/30 dark:text-blue-300"><Paperclip className="inline w-2.5 h-2.5" /></span>;
  return <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded dark:bg-rose-900/30 dark:text-rose-300">✕ Missing</span>;
}

// Form state type
interface FormState {
  provider: string;
  operation_type: string;
  pilgrim_id: string;
  group_id: string;
  internal_status: string;
  external_reference: string;
  sla_hours: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  provider: 'NUSUK', operation_type: '', pilgrim_id: '',
  group_id: '', internal_status: 'NOT_STARTED',
  external_reference: '', sla_hours: '72', notes: '',
};

export function ExternalOperationsCenter() {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => isAr ? ar : isFr ? fr : en;
  const confirmDialog = useConfirmDialog();

  const { data: ops, loading, refetch } = useSupabaseData<ExternalOperationRow>({
    table: 'external_operations',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [filterProvider, setFilterProvider] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  // Stats
  const stats = useMemo(() => ({
    total: ops.length,
    slaOverdue: ops.filter(o =>
      o.sla_deadline && new Date(o.sla_deadline) < new Date() &&
      !['COMPLETED','CANCELLED','REJECTED'].includes(o.internal_status)
    ).length,
    missingEvidence: ops.filter(o =>
      o.evidence_status === 'PENDING' &&
      !['NOT_STARTED','CANCELLED'].includes(o.internal_status)
    ).length,
    actionRequired: ops.filter(o => o.internal_status === 'ACTION_REQUIRED').length,
    completed: ops.filter(o => o.internal_status === 'COMPLETED').length,
  }), [ops]);

  // Filtered list
  const displayOps = useMemo(() => {
    let list = ops;
    if (filterProvider !== 'ALL') list = list.filter(o => o.provider === filterProvider);
    if (filterStatus !== 'ALL') list = list.filter(o => o.internal_status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(o =>
        o.operation_type?.toLowerCase().includes(q) ||
        o.external_reference?.toLowerCase().includes(q) ||
        o.notes?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [ops, filterProvider, filterStatus, search]);

  const handleCreate = async () => {
    if (!form.operation_type.trim()) { setError(t('أدخل نوع العملية', 'Entrez le type', 'Enter operation type')); return; }
    setSubmitting(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        provider: form.provider,
        operation_type: form.operation_type,
        internal_status: form.internal_status,
        sla_hours: form.sla_hours ? parseInt(form.sla_hours) : null,
        notes: form.notes || null,
        external_reference: form.external_reference || null,
      };
      if (form.pilgrim_id) payload.pilgrim_id = form.pilgrim_id;
      if (form.group_id) payload.group_id = form.group_id;
      const result = await externalOperationCommands.create(payload);
      if (!result.success) throw new Error(result.error?.user_safe_message ?? 'Failed to create');
      setShowForm(false);
      setForm(EMPTY_FORM);
      await refetch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
      reportError('externalOps.create', e);
    } finally { setSubmitting(false); }
  };

  const handleAdvanceStatus = async (op: ExternalOperationRow) => {
    const next = STATUS_NEXT[op.internal_status];
    if (!next) return;
    setAdvancingId(op.id);
    try {
      const result = await externalOperationCommands.update(op.id, { internal_status: next });
      if (!result.success) throw new Error(result.error?.user_safe_message);
      await refetch();
    } catch (e: unknown) {
      reportError('externalOps.advance', e);
    } finally { setAdvancingId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({
      title: t('حذف العملية', 'Supprimer', 'Delete operation'),
      message: t('هل أنت متأكد؟', 'Êtes-vous sûr?', 'Are you sure?'), danger: true,
    }))) return;
    const result = await externalOperationCommands.remove(id);
    if (!result.success) reportError('externalOps.delete', new Error(result.error?.message));
    else await refetch();
  };

  const providers = ['ALL','NUSUK','AIRLINE','HOTEL','TRANSPORT','INSURANCE','BANK','GOVT','OTHER'];
  const statuses = ['ALL','NOT_STARTED','READY','SUBMITTED','UNDER_REVIEW','ACTION_REQUIRED','APPROVED','REJECTED','COMPLETED','CANCELLED'];

  const statusLabel = (s: string) => ({
    NOT_STARTED: t('لم يبدأ','Non commencé','Not Started'),
    READY: t('جاهز','Prêt','Ready'),
    SUBMITTED: t('مقدم','Soumis','Submitted'),
    UNDER_REVIEW: t('قيد المراجعة','En cours','Under Review'),
    ACTION_REQUIRED: t('يتطلب تدخل','Action requise','Action Required'),
    APPROVED: t('موافق عليه','Approuvé','Approved'),
    REJECTED: t('مرفوض','Rejeté','Rejected'),
    COMPLETED: t('مكتمل','Terminé','Completed'),
    CANCELLED: t('ملغي','Annulé','Cancelled'),
  } as Record<string,string>)[s] ?? s;

  const advanceLabel = (s: string) => ({
    NOT_STARTED: t('جاهز →','Prêt →','Mark Ready'),
    READY: t('تقديم →','Soumettre →','Submit'),
    SUBMITTED: t('قيد المراجعة →','En révision →','Under Review'),
    UNDER_REVIEW: t('موافقة →','Approuver →','Approve'),
    ACTION_REQUIRED: t('إعادة تقديم →','Resoumettre →','Resubmit'),
    APPROVED: t('إكمال →','Compléter →','Complete'),
  } as Record<string,string>)[s] ?? '';

  return (
    <div className={`space-y-5 ${isAr ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] dark:text-white">
            {t('مركز العمليات الخارجية','Centre Opérations Externes','External Operations Center')}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            {t('تتبع وتوثّق كل العمليات مع الجهات الخارجية','Suivre toutes les opérations externes','Track and document all external platform operations')}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refetch()} className="btn btn-ghost btn-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => { setShowForm(true); setError(null); }} className="btn btn-primary btn-sm gap-1">
            <Plus className="w-4 h-4" />
            {t('عملية جديدة','Nouvelle opération','New Operation')}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t('إجمالي','Total','Total'), value: stats.total, color: 'text-slate-600 dark:text-slate-300' },
          { label: t('SLA متجاوز','SLA dépassé','SLA Overdue'), value: stats.slaOverdue, color: stats.slaOverdue > 0 ? 'text-rose-600' : 'text-slate-400' },
          { label: t('إثبات مفقود','Evidence manquante','Missing Evidence'), value: stats.missingEvidence, color: stats.missingEvidence > 0 ? 'text-amber-600' : 'text-slate-400' },
          { label: t('يتطلب تدخل','Action requise','Action Required'), value: stats.actionRequired, color: stats.actionRequired > 0 ? 'text-rose-600' : 'text-slate-400' },
        ].map((s, i) => (
          <div key={i} className="card p-4">
            <p className="text-xs text-[var(--text-secondary)]">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 -translate-y-1/2 ltr:left-3 rtl:right-3 w-4 h-4 text-[var(--text-secondary)]" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('بحث...','Rechercher...','Search...')}
              className="ps-9 pe-4 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-hover)] text-sm w-56"
            />
          </div>
          <select
            value={filterProvider} onChange={e => setFilterProvider(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm"
          >
            {providers.map(p => <option key={p} value={p}>{p === 'ALL' ? t('كل الجهات','Tous','All Providers') : p}</option>)}
          </select>
          <select
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm"
          >
            {statuses.map(s => <option key={s} value={s}>{s === 'ALL' ? t('كل الحالات','Tous','All Statuses') : statusLabel(s)}</option>)}
          </select>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="card p-5 border-2 border-[var(--accent)]/30 space-y-4">
          <h3 className="font-semibold text-[var(--text-primary)] dark:text-white">
            {t('إضافة عملية خارجية','Nouvelle opération externe','New External Operation')}
          </h3>
          {error && (
            <div className="flex gap-2 text-sm text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('الجهة','Prestataire','Provider')}</label>
              <select value={form.provider} onChange={e => setForm(f => ({...f, provider: e.target.value}))}
                className="input w-full">
                {['NUSUK','AIRLINE','HOTEL','TRANSPORT','INSURANCE','BANK','GOVT','OTHER'].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('نوع العملية','Type d\'opération','Operation Type')} *</label>
              <input value={form.operation_type} onChange={e => setForm(f => ({...f, operation_type: e.target.value}))}
                placeholder={t('مثال: طلب تأشيرة','Ex: Demande de visa','e.g. Visa Application')}
                className="input w-full" />
            </div>
            <div>
              <label className="label">{t('الحالة الأولية','Statut initial','Initial Status')}</label>
              <select value={form.internal_status} onChange={e => setForm(f => ({...f, internal_status: e.target.value}))}
                className="input w-full">
                {['NOT_STARTED','READY','SUBMITTED'].map(s => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('رقم الحالة الخارجية','Référence externe','External Reference')}</label>
              <input value={form.external_reference} onChange={e => setForm(f => ({...f, external_reference: e.target.value}))}
                placeholder="e.g. NS-2026-12345"
                className="input w-full" />
            </div>
            <div>
              <label className="label">{t('SLA (ساعة)','SLA (heures)','SLA (hours)')}</label>
              <input type="number" value={form.sla_hours} onChange={e => setForm(f => ({...f, sla_hours: e.target.value}))}
                className="input w-full" min="1" max="720" />
            </div>
            <div>
              <label className="label">{t('ملاحظات','Notes','Notes')}</label>
              <input value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                className="input w-full" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }} className="btn btn-ghost btn-sm">
              {t('إلغاء','Annuler','Cancel')}
            </button>
            <button onClick={() => void handleCreate()} disabled={submitting} className="btn btn-primary btn-sm">
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : t('حفظ','Enregistrer','Save')}
            </button>
          </div>
        </div>
      )}

      {/* Operations Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <Spinner className="p-10" />
        ) : displayOps.length === 0 ? (
          <div className="p-10 text-center text-[var(--text-secondary)]">
            <Globe className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>{t('لا توجد عمليات','Aucune opération','No operations found')}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {displayOps.map(op => {
              const ProviderIcon = PROVIDER_ICONS[op.provider] ?? ExternalLink;
              const isExpanded = expandedId === op.id;
              const nextStatus = STATUS_NEXT[op.internal_status];
              return (
                <div key={op.id}>
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : op.id)}
                    className="flex items-center gap-3 px-5 py-4 hover:bg-[var(--bg-hover)]/50 cursor-pointer transition-colors"
                  >
                    <ProviderIcon className={`w-5 h-5 shrink-0 ${PROVIDER_COLORS[op.provider]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-[var(--text-primary)] dark:text-white">{op.operation_type}</span>
                        <span className="text-xs text-[var(--text-secondary)]">{op.provider}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[op.internal_status]}`}>
                          {statusLabel(op.internal_status)}
                        </span>
                        <EvidenceBadge status={op.evidence_status} />
                        <SLATimer deadline={op.sla_deadline} status={op.internal_status} />
                      </div>
                      {op.external_reference && (
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                          {t('رقم','Réf','Ref')}: {op.external_reference}
                        </p>
                      )}
                    </div>
                    {nextStatus && (
                      <button
                        onClick={e => { e.stopPropagation(); void handleAdvanceStatus(op); }}
                        disabled={advancingId === op.id}
                        className="btn btn-ghost btn-sm text-xs shrink-0"
                      >
                        {advancingId === op.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : advanceLabel(op.internal_status)}
                      </button>
                    )}
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-5 pb-4 bg-[var(--bg-hover)]/30 space-y-3">
                      {/* Nusuk Warning */}
                      {op.provider === 'NUSUK' && op.internal_status === 'APPROVED' && (
                        <div className="rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          {t(
                            'تنبيه: حالة “موافق” وثّقها الموظّف — النظام لا يتصل بمنصة نسك آلياً. يُرجى إرفاق إثبات الموافقة.',
                            'Attention: Statut "Approuvé" documenté par l\'agent. Le système ne contacte pas d\'API externe automatiquement.',
                            'Note: “Approved” status was documented by staff — system does not connect to external APIs automatically. Please attach evidence.'
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div><span className="text-[var(--text-secondary)]">{t('الجهة','Prestataire','Provider')}:</span> <span className="font-medium">{op.provider}</span></div>
                        <div><span className="text-[var(--text-secondary)]">{t('الحالة','Statut','Status')}:</span> <span className="font-medium">{statusLabel(op.internal_status)}</span></div>
                        {op.sla_deadline && <div><span className="text-[var(--text-secondary)]">{t('SLA','SLA','SLA')}:</span> <span className="font-medium">{new Date(op.sla_deadline).toLocaleString()}</span></div>}
                        {op.submitted_at && <div><span className="text-[var(--text-secondary)]">{t('تم التقديم','Soumis','Submitted')}:</span> <span className="font-medium">{new Date(op.submitted_at).toLocaleDateString()}</span></div>}
                        {op.external_reference && <div><span className="text-[var(--text-secondary)]">{t('رقم خارجي','Réf ext.','Ext Ref')}:</span> <span className="font-medium font-mono">{op.external_reference}</span></div>}
                        <div><span className="text-[var(--text-secondary)]">{t('الإثبات','Evidence','Evidence')}:</span> <EvidenceBadge status={op.evidence_status} /></div>
                      </div>

                      {op.notes && (
                        <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-hover)] rounded-lg p-2">{op.notes}</p>
                      )}

                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => void handleDelete(op.id)}
                          className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs"
                        >
                          {t('حذف','Supprimer','Delete')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
