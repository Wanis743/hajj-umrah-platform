import { useEffect, useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { FileText, Search, Upload, Plus, ExternalLink } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { documentCommands } from '@/services/domainCommands';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { uploadPrivateDocument, createSignedDocumentUrl } from '@/lib/documentUpload';
import GlassDate from '@/components/admin/GlassDate';

const DOC_TYPES = ['PASSPORT', 'ID_CARD', 'PHOTO', 'MEDICAL_CERT', 'VACCINATION', 'VISA', 'OTHER'];
const DOC_STATI = ['REQUIRED', 'RECEIVED', 'VALIDATED', 'REJECTED', 'EXPIRED'];

const STATUS_STYLES: Record<string, string> = {
  REQUIRED: 'bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]',
  RECEIVED: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  VALIDATED: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
  EXPIRED: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
};

const DOC_TYPE_LABELS: Record<string, { ar: string; fr: string; en: string }> = {
  PASSPORT: { ar: 'جواز سفر', fr: 'Passeport', en: 'Passport' },
  ID_CARD: { ar: 'بطاقة هوية', fr: 'ID Card', en: 'ID Card' },
  PHOTO: { ar: 'صورة شخصية', fr: 'Photo', en: 'Photo' },
  MEDICAL_CERT: { ar: 'شهادة طبية', fr: 'Certificat medical', en: 'Medical Certificate' },
  VACCINATION: { ar: 'شهادة تطعيم', fr: 'Vaccination', en: 'Vaccination' },
  VISA: { ar: 'تأشيرة', fr: 'Visa', en: 'Visa' },
  OTHER: { ar: 'أخرى', fr: 'Autre', en: 'Other' },
};

const inputCls = 'input';

type DocumentRow = { id: string; pilgrim_id: string; type: string; status: string; number?: string | null; expiry_date?: string | null; notes?: string | null; file_name?: string | null; storage_path?: string | null; mime_type?: string | null; size_bytes?: number | null };

type PilgrimRow = { id: string; full_name?: string | null; full_name_ar?: string | null };

export function DocumentCenter({ documents: fallback = [] }: { documents?: DocumentRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: documents, loading, refetch } = useSupabaseData<DocumentRow>({
    table: 'documents',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: fallback,
  });

  const [pilgrims, setPilgrims] = useState<PilgrimRow[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    pilgrim_id: '',
    type: 'PASSPORT',
    status: 'REQUIRED',
    number: '',
    expiry_date: '',
    notes: '',
  });

  useEffect(() => {
    supabase.from('pilgrims').select('id, full_name, full_name_ar').then(({ data }) => {
      if (data) setPilgrims(data as PilgrimRow[]);
    });
  }, []);

  const pilgrimMap = new Map(pilgrims.map((p) => [p.id, p]));

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const submit = async () => {
    if (!form.pilgrim_id) return;
    setUploadError(null);
    const result = await documentCommands.create({
      pilgrim_id: form.pilgrim_id,
      type: form.type,
      status: form.status,
      number: form.number || null,
      expiry_date: form.expiry_date || null,
      notes: form.notes || null,
    });
    if (result.error) { setUploadError(result.error.message); return; }
    setForm({ pilgrim_id: '', type: 'PASSPORT', status: 'REQUIRED', number: '', expiry_date: '', notes: '' });
    setShowForm(false);
    await refetch();
  };

  const handleUpload = async (doc: DocumentRow, file: File) => {
    setUploadingFor(doc.id); setUploadError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error('Session expired. Please sign in again.');
      const { data: profile, error: profileError } = await supabase.from('staff_profiles').select('agency_id,branch_uuid').eq('user_id', userId).single();
      if (profileError || !profile?.agency_id || !profile?.branch_uuid) throw new Error('Staff scope is not configured.');
      const uploaded = await uploadPrivateDocument({ file, agencyId: String(profile.agency_id), branchId: String(profile.branch_uuid), pilgrimId: String(doc.pilgrim_id ?? ''), documentType: String(doc.type ?? '') });
      const result = await documentCommands.update(doc.id, { file_name: uploaded.fileName, mime_type: uploaded.mimeType, size_bytes: uploaded.sizeBytes, checksum_sha256: uploaded.checksumSha256, storage_bucket: uploaded.storageBucket, storage_path: uploaded.storagePath, uploaded_at: new Date().toISOString(), uploaded_by: userId, status: 'RECEIVED' });
      if (result.error) throw result.error;
      await refetch();
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'Upload failed'); }
    finally { setUploadingFor(null); }
  };

  const handleView = async (doc: DocumentRow) => {
    if (!doc.storage_path) return;
    try {
      const url = await createSignedDocumentUrl(doc.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'Document access failed'); }
  };

  const stats = {
    total: documents.length,
    validated: documents.filter((d) => d.status === 'VALIDATED').length,
    received: documents.filter((d) => d.status === 'RECEIVED').length,
    rejected: documents.filter((d) => d.status === 'REJECTED').length,
    expired: documents.filter((d) => d.status === 'EXPIRED').length,
  };

  const q = search.toLowerCase();
  const filtered = documents.filter((d) => {
    if (filterStatus !== 'ALL' && d.status !== filterStatus) return false;
    if (!q) return true;
    const p = pilgrimMap.get(String(d.pilgrim_id ?? ''));
    const text = `${d.number || ''} ${d.type || ''} ${p?.full_name || ''} ${p?.full_name_ar || ''}`.toLowerCase();
    return text.includes(q);
  });

  const getName = (id?: string | null) => {
    const p = pilgrimMap.get(String(id ?? ''));
    return p ? (isAr ? p.full_name_ar || p.full_name : p.full_name) : '-';
  };

  const fmtDate = (x?: string | null) => {
    if (!x) return '-';
    const dt = new Date(x);
    if (isNaN(dt.getTime())) return x;
    return dt.toLocaleDateString();
  };

  const expiringSoon = (x?: string | null) => {
    if (!x) return false;
    const dt = new Date(x);
    if (isNaN(dt.getTime())) return false;
    return dt.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
  };

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('مركز الوثائق', 'Centre de documents', 'Document Center')}</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{documents.length} {t('وثيقة', 'documents', 'documents')}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('وثيقة جديدة', 'Nouveau document', 'New Document')}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: t('الإجمالي', 'Total', 'Total'), value: stats.total, color: 'text-[var(--text-secondary)] dark:text-white' },
          { label: t('مستلمة', 'Recus', 'Received'), value: stats.received, color: 'text-blue-500' },
          { label: t('موثقة', 'Valides', 'Validated'), value: stats.validated, color: 'text-emerald-500' },
          { label: t('مرفوضة', 'Refuses', 'Rejected'), value: stats.rejected, color: 'text-rose-500' },
          { label: t('منتهية', 'Expires', 'Expired'), value: stats.expired, color: 'text-red-500' },
        ].map((s, i) => (
          <div key={i} className="card p-4">
            <p className={`text-xl font-semibold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select className={inputCls} value={form.pilgrim_id} onChange={(e) => set('pilgrim_id', e.target.value)}>
              <option value="">{t('الحاج *', 'Pelerin *', 'Pilgrim *')}</option>
              {pilgrims.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} {p.full_name_ar ? '(' + p.full_name_ar + ')' : ''}</option>
              ))}
            </Select>
            <Select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value)}>
              {DOC_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {DOC_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <input className={inputCls} value={form.number} onChange={(e) => set('number', e.target.value)} placeholder={t('رقم الوثيقة', 'Numero', 'Document number')} />
            <GlassDate className={inputCls} value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
            <input className={inputCls} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('ملاحظات', 'Notes', 'Notes')} />
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

      {uploadError && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{uploadError}</div>}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-secondary)] start-3`} />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('بحث بالاسم أو رقم الوثيقة...', 'Rechercher par nom ou numero...', 'Search by name or document number...')}
            className={`w-full rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] py-2.5 text-xs text-[var(--text-secondary)] dark:text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition-all ps-9 pe-4`}
          />
        </div>
        <Select
          value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-3 py-2.5 text-xs text-[var(--text-secondary)] dark:text-white focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="ALL">{t('كل الحالات', 'Tous les statuts', 'All Statuses')}</option>
          {DOC_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner className="p-10" />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <FileText className="h-8 w-8 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-2" />
            <p className="text-sm">{t('لا توجد وثائق', 'Aucun document', 'No documents found')}</p>
          </div>
        ) : (
<div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead>
                <tr className="border-b border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)]/50">
                  <th className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>{t('الحاج', 'Pelerin', 'Pilgrim')}</th>
                  <th className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>{t('النوع', 'Type', 'Type')}</th>
                  <th className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>{t('الرقم', 'Numero', 'Number')}</th>
                  <th className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>{t('انتهاء الصلاحية', 'Expiration', 'Expiry')}</th>
                  <th className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>{t('الحالة', 'Statut', 'Status')}</th>
                  <th className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>{t('ملفات', 'Fichiers', 'Files')}</th>
                  <th className={`px-4 py-3 font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filtered.map((doc) => {
                  const docLabel = DOC_TYPE_LABELS[doc.type as string] || DOC_TYPE_LABELS.OTHER;
                  return (
                    <tr key={doc.id} className="hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/30 transition-colors">
                      <td className="px-4 py-3 font-semibold text-[var(--text-secondary)] dark:text-white whitespace-nowrap">{getName(doc.pilgrim_id as string | null)}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t(docLabel.ar, docLabel.fr, docLabel.en)}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{doc.number || '-'}</td>
                      <td className={`px-4 py-3 ${expiringSoon(doc.expiry_date as string | null) ? 'text-amber-500 font-bold' : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'}`}>
                        {fmtDate(doc.expiry_date as string | null)}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={doc.status || 'REQUIRED'}
                          onChange={(e) => documentCommands.update(doc.id, { status: e.target.value })}
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border-0 outline-none cursor-pointer ${STATUS_STYLES[doc.status as string] || STATUS_STYLES.REQUIRED}`}
                        >
                          {DOC_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        {doc.file_name ? (
                          <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">{doc.file_name}</span>
                        ) : (
                          <label className="flex cursor-pointer items-center gap-1 rounded-lg bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-all">
                            <Upload className="w-3 h-3" />
                            {uploadingFor === doc.id ? t('جارٍ الرفع…', 'Téléchargement…', 'Uploading…') : t('رفع', 'Upload', 'Upload')}
                            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={uploadingFor === doc.id} onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleUpload(doc, file); e.currentTarget.value = ''; }} />
                          </label>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {doc.storage_path ? <button onClick={() => void handleView(doc)} className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-all" aria-label={t('عرض الوثيقة', 'Voir le document', 'View document')}><ExternalLink className="w-3.5 h-3.5" /></button> : <span className="text-[10px] text-[var(--text-muted)]">{t('لا يوجد ملف', 'Aucun fichier', 'No file')}</span>}
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
  );
}
export default DocumentCenter;
