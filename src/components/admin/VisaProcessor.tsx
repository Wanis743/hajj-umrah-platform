import { useConfirmDialog } from '@/components/ConfirmDialog';
import Select from '@/components/admin/GlassSelect';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { visaCommands } from '@/services/domainCommands';
import type { VisaRow, PilgrimRow } from '@/types/database';
import { supabase } from '@/lib/supabase';

const VISA_STATI = [
  'NOT_STARTED', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_PARTIAL', 'DOCUMENTS_COMPLETE',
  'UNDER_REVIEW', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING',
  'ADDITIONAL_INFO_REQUIRED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED',
];

const STATUS_BADGE: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  ISSUED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  CANCELLED: 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]',
  SUBMITTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  PROCESSING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  UNDER_REVIEW: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  READY_FOR_SUBMISSION: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  DOCUMENTS_REQUIRED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  DOCUMENTS_PARTIAL: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  DOCUMENTS_COMPLETE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  ADDITIONAL_INFO_REQUIRED: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  NOT_STARTED: 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]',
};

const inputCls = 'input';

export const VisaProcessor: React.FC<{ visas?: VisaRow[] }> = ({ visas: fallback = [] }) => {
  const confirmDialog = useConfirmDialog();
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: visas, loading } = useSupabaseData<VisaRow>({
    table: 'visas',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: fallback,
  });

  const [pilgrims, setPilgrims] = useState<PilgrimRow[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ pilgrim_id: '', status: 'NOT_STARTED', passport_number: '', sla: '', missing_documents: '' });

  useEffect(() => {
    supabase.from('pilgrims').select('id, full_name, full_name_ar, passport_number, visa_status').then(({ data }) => {
      if (data) setPilgrims(data);
    });
  }, []);

  const pilgrimMap = new Map(pilgrims.map((p: PilgrimRow) => [p.id, p]));
  const withoutVisa = pilgrims.filter((p: PilgrimRow) => !visas.some((v: VisaRow) => v.pilgrim_id === p.id));

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  

  const submit = async () => {
    if (!form.pilgrim_id) return;
    const missing = form.missing_documents.split(',').map((s) => s.trim()).filter(Boolean);
    const res = await visaCommands.create({
      pilgrim_id: form.pilgrim_id,
      status: form.status,
      passport_number: form.passport_number,
      sla: form.sla ? Number(form.sla) : null,
      missing_documents: missing,
    });
    if (res.success && res.data?.id) await visaCommands.advanceStage(res.data.id, form.status);
    
    setForm({ pilgrim_id: '', status: 'NOT_STARTED', passport_number: '', sla: '', missing_documents: '' });
    setShowForm(false);
  };

  const changeStatus = async (visa: VisaRow, status: string) => {
    await visaCommands.update(visa.id, { status });
    
  };

  const stats = {
    total: visas.length,
    approved: visas.filter((v: VisaRow) => v.status === 'APPROVED' || v.status === 'ISSUED').length,
    pending: visas.filter((v: VisaRow) => ['READY_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING', 'UNDER_REVIEW'].includes(v.status || "")).length,
    rejected: visas.filter((v: VisaRow) => v.status === 'REJECTED' || v.status === 'CANCELLED').length,
  };

  const clearanceRate = stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0;

  const pipelineStages = ['NOT_STARTED', 'DOCUMENTS_*', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING', 'APPROVED', 'ISSUED', 'REJECTED'];

  const filtered = filter === 'ALL' ? visas : visas.filter((v: VisaRow) => v.status === filter);

  const getName = (id?: string | null) => {
    if (!id) return '-';
    const p = pilgrimMap.get(id);
    return p ? (isAr && p.full_name_ar ? p.full_name_ar : p.full_name || '') : '-';
  };

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('معالجة التأشيرات', 'Traitement des visas', 'Visa Processing')}</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{visas.length} {t('تأشيرة', 'visas', 'visas')}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('تأشيرة جديدة', 'Nouveau visa', 'New Visa')}
        </button>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select className={inputCls} value={form.pilgrim_id} onChange={(e) => set('pilgrim_id', e.target.value)}>
              <option value="">{t('حاج بدون تأشيرة *', 'Pèlerin sans visa *', 'Pilgrim without visa *')}</option>
              {withoutVisa.map((p: PilgrimRow) => (
                <option key={p.id} value={p.id}>{p.full_name} - {p.passport_number || ''}</option>
              ))}
            </Select>
            <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {VISA_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <input className={inputCls} value={form.passport_number} onChange={(e) => set('passport_number', e.target.value)} placeholder={t('رقم الجواز', 'N° passeport', 'Passport number')} />
            <input className={inputCls} type="number" value={form.sla} onChange={(e) => set('sla', e.target.value)} placeholder={t('SLA (أيام)', 'SLA (jours)', 'SLA (days)')} />
            <input className={inputCls} value={form.missing_documents} onChange={(e) => set('missing_documents', e.target.value)} placeholder={t('وثائق ناقصة (فاصلة)', 'Docs manquants (virgule)', 'Missing documents (comma)')} />
          </div>
          <div className="flex gap-2">
            <button onClick={submit} disabled={!form.pilgrim_id} className="btn btn-primary flex-1">
              {t('حفظ', 'Enregistrer', 'Save')}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-md bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-5 py-2 text-sm font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)] transition-all">
              {t('إلغاء', 'Annuler', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">{t('تقدم التأشيرات', 'Progression des visas', 'Visa Pipeline')}</h2>
        <div className="flex h-4 rounded-full overflow-hidden mb-3 bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]">
          {pipelineStages.map((stage) => {
            const count = stage === 'DOCUMENTS_*'
              ? visas.filter((v: VisaRow) => ['DOCUMENTS_REQUIRED', 'DOCUMENTS_PARTIAL', 'DOCUMENTS_COMPLETE'].includes(v.status || "")).length
              : visas.filter((v: VisaRow) => v.status === stage).length;
            const w = stats.total > 0 ? (count / stats.total) * 100 : 0;
            const colors: Record<string, string> = {
              NOT_STARTED: 'bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]',
              'DOCUMENTS_*': 'bg-amber-400',
              READY_FOR_SUBMISSION: 'bg-amber-500',
              SUBMITTED: 'bg-blue-400',
              PROCESSING: 'bg-violet-400',
              APPROVED: 'bg-emerald-500',
              ISSUED: 'bg-emerald-600',
              REJECTED: 'bg-rose-500',
            };
            return w > 0 ? <div key={stage} style={{ width: `${w}%` }} className={colors[stage]} title={`${stage}: ${count}`} /> : null;
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> {t('مقبول', 'Approuvé', 'Approved')} ({stats.approved})</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"></span> {t('قيد المعالجة', 'En cours', 'Processing')} ({stats.pending})</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span> {t('مرفوض', 'Rejeté', 'Rejected')} ({stats.rejected})</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400"></span> {t('وثائق', 'Documents', 'Documents')} ({visas.filter((v: VisaRow) => v.status?.startsWith('DOCUMENTS')).length})</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: t('الإجمالي', 'Total', 'Total'), value: stats.total, color: 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]' },
          { label: t('معدل القبول', 'Taux approbation', 'Clearance Rate'), value: `${clearanceRate}%`, color: 'text-emerald-500' },
          { label: t('قيد المعالجة', 'En cours', 'Processing'), value: stats.pending, color: 'text-blue-500' },
          { label: t('مرفوض', 'Rejeté', 'Rejected'), value: stats.rejected, color: 'text-rose-500' },
        ].map((stat, idx) => (
          <div key={idx} className="card p-5">
            <p className="text-[13px] text-[var(--text-muted)]">{stat.label}</p>
            <p className={`text-xl font-semibold mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['ALL', 'NOT_STARTED', 'DOCUMENTS_*', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING', 'APPROVED', 'ISSUED', 'REJECTED'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                filter === f ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f === 'ALL' ? t('الكل', 'Tous', 'All') : f === 'DOCUMENTS_*' ? t('الوثائق', 'Documents', 'Docs') : f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner className="p-10" />
        ) : filtered.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
            <p>{t('لا توجد تأشيرات', 'Aucun visa', 'No visas found')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] border-b border-[var(--border)] dark:border-[var(--border)]">
                <tr>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الحاج', 'Pèlerin', 'Pilgrim')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الجواز', 'Passeport', 'Passport')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الحالة', 'Statut', 'Status')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الوثائق الناقصة', 'Docs manquants', 'Missing docs')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('SLA', 'SLA', 'SLA')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v: VisaRow) => (
                  <tr key={v.id} className="border-b border-[var(--border)] dark:border-[var(--border)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/50 transition-colors">
                    <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-white font-medium whitespace-nowrap">{getName(v.pilgrim_id)}</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{v.passport_number || '-'}</td>
                    <td className="px-4 py-3">
                      <Select
                        value={v.status || 'NOT_STARTED'}
                        onChange={(e) => changeStatus(v, e.target.value)}
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border-0 outline-none cursor-pointer min-w-[110px] ${STATUS_BADGE[v.status as string] || STATUS_BADGE.NOT_STARTED}`}
                      >
                        {VISA_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {Array.isArray(v.missing_documents) && v.missing_documents.length > 0
                        ? v.missing_documents.join(', ')
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{v.sla != null ? `${v.sla} ${t('يوم', 'j', 'd')}` : '-'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={async () => {
                          if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف التأشيرة؟', 'Supprimer le visa ?', 'Delete visa?'), danger: true })) {
                            await visaCommands.remove(v.id);
                            
                          }
                        }}
                        className="rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};