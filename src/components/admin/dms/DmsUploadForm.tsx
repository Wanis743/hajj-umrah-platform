/**
 * The upload form. Three server round trips behind one submit button, and the
 * progress line names which one it is on -- a failure at "uploading" and a failure
 * at "finalizing" leave very different states behind, and the person retrying
 * needs to know which happened.
 *
 * Everything the form validates locally (size, mime) the bucket validates again.
 * The point of checking here is not to be the gate; it is to avoid creating a
 * document row that can never be filled.
 */
import { useRef, useState, type DragEvent } from 'react';
import { FileUp, Loader2, Upload, X } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner } from '@/components/admin/ui';
import { uploadDmsDocument, validateDmsFile, type DmsUploadStage } from '@/services/dmsUpload';
import {
  DMS_ALLOWED_MIME, DMS_MAX_BYTES,
  type DmsConfidentiality, type DmsFinalizeResult,
} from '@/types/dms';
import { Field, Panel } from './atoms';
import { fmtBytes, isoToday, useDmsI18n, useDmsLabels } from './dmsFormat';

const CONFIDENTIALITIES: readonly DmsConfidentiality[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

/** Suggestions, not a constraint: document_type is free text in the migration, so a
 *  new kind of paperwork does not need a schema change. */
const TYPE_SUGGESTIONS = [
  'PASSPORT', 'VISA', 'CONTRACT', 'INVOICE', 'RECEIPT', 'LICENCE',
  'INSURANCE', 'MEDICAL', 'VACCINATION', 'AUTHORIZATION', 'CORRESPONDENCE', 'OTHER',
] as const;

export function DmsUploadForm({ documentId, documentTitle, onDone, onCancel }: {
  /** Set to add a version to an existing document rather than create a new one. */
  documentId?: string | null;
  documentTitle?: string | null;
  onDone: (result: DmsFinalizeResult) => void;
  onCancel: () => void;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const inputRef = useRef<HTMLInputElement>(null);
  const isNewVersion = Boolean(documentId);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(documentTitle ?? '');
  const [documentType, setDocumentType] = useState('CONTRACT');
  const [description, setDescription] = useState('');
  const [confidentiality, setConfidentiality] = useState<DmsConfidentiality>('INTERNAL');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [noticeDays, setNoticeDays] = useState('30');
  const [tags, setTags] = useState('');
  const [queueExtraction, setQueueExtraction] = useState(true);

  const [stage, setStage] = useState<DmsUploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = stage !== null && stage !== 'done';

  const pick = (next: File | null) => {
    setError(next ? validateDmsFile(next) : null);
    setFile(next);
    // A filename is a better default title than an empty box, and the user can
    // still overwrite it. Only for a new document: a new version keeps the title.
    if (next && !isNewVersion && !title.trim()) {
      setTitle(next.name.replace(/\.[^.]+$/, ''));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (busy) return;
    pick(e.dataTransfer.files?.[0] ?? null);
  };

  // Title and type are required only when a document is being created; adding a
  // version to an existing one inherits both, which is what the command does too.
  const valid = file !== null
    && validateDmsFile(file) === null
    && (isNewVersion || (title.trim().length > 0 && documentType.trim().length > 0));

  const submit = async () => {
    if (!file || busy) return;
    setError(null);
    const outcome = await uploadDmsDocument({
      file,
      title: title.trim(),
      documentType: documentType.trim().toUpperCase(),
      documentId: documentId ?? null,
      description: description.trim() || null,
      confidentiality,
      issuedOn: issuedOn || null,
      expiresOn: expiresOn || null,
      expiryNoticeDays: Number(noticeDays) || 30,
      tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      queueExtraction,
    }, setStage);

    if (!outcome.ok || !outcome.result) {
      setError(outcome.error ?? t('تعذر الرفع', 'Échec du téléversement', 'Upload failed'));
      setStage(null);
      return;
    }
    onDone(outcome.result);
  };

  const stageLabel: Record<DmsUploadStage, string> = {
    validating: t('التحقق من الملف', 'Vérification', 'Checking the file'),
    hashing: t('حساب البصمة', 'Empreinte SHA-256', 'Computing the SHA-256'),
    reserving: t('تجهيز السجل', 'Réservation', 'Reserving the row'),
    uploading: t('رفع البيانات', 'Téléversement', 'Sending the bytes'),
    finalizing: t('تثبيت النسخة', 'Finalisation', 'Finalising the version'),
    done: t('تم', 'Terminé', 'Done'),
  };

  return (
    <Panel
      title={isNewVersion
        ? t('نسخة جديدة', 'Nouvelle version', 'New version')
        : t('رفع وثيقة', 'Téléverser un document', 'Upload a document')}
      subtitle={isNewVersion && documentTitle
        ? documentTitle
        : t(
          'يُسجَّل الصف أولاً ثم تُرفع البيانات — سياسات التخزين ترفض العكس',
          "La ligne d'abord, les octets ensuite — les politiques de stockage l'imposent",
          'The row is created first and the bytes second; the storage policies refuse the other order',
        )}
      actions={
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost btn-sm">
          <X className="h-3.5 w-3.5" />
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
      }
    >
      {error && <ErrorBanner message={error} />}

      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-subtle)] p-5 text-center"
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={DMS_ALLOWED_MIME.join(',')}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-[var(--text-primary)]">{file.name}</p>
              <p className="text-[12px] text-[var(--text-muted)]">
                {fmtBytes(file.size)} · {file.type || t('نوع غير معروف', 'Type inconnu', 'unknown type')}
              </p>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                className="btn btn-ghost btn-sm mt-1">
                {t('اختيار ملف آخر', 'Changer', 'Choose another')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <FileUp className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
              <p className="text-[13px] text-[var(--text-secondary)]">
                {t('اسحب الملف هنا أو', 'Glissez le fichier ici ou', 'Drop the file here, or')}
              </p>
              <button type="button" onClick={() => inputRef.current?.click()} className="btn btn-primary btn-sm">
                {t('اختيار ملف', 'Choisir un fichier', 'Choose a file')}
              </button>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t('الحد الأقصى', 'Maximum', 'Max')} {fmtBytes(DMS_MAX_BYTES)} · PDF, JPEG, PNG, WEBP, TIFF, DOC, DOCX, XLS, XLSX, TXT, CSV
              </p>
            </div>
          )}
        </div>

        {!isNewVersion && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('العنوان', 'Titre', 'Title')}>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
                  required disabled={busy} />
              </Field>
              <Field label={t('النوع', 'Type', 'Document type')}
                hint={t('نص حر — القائمة اقتراحات', 'Texte libre', 'Free text; the list is suggestions')}>
                <input className="input" value={documentType} list="dms-type-suggestions"
                  onChange={(e) => setDocumentType(e.target.value)} required disabled={busy} />
                <datalist id="dms-type-suggestions">
                  {TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                </datalist>
              </Field>
            </div>

            <Field label={t('الوصف', 'Description', 'Description')}>
              <textarea className="input" rows={2} value={description}
                onChange={(e) => setDescription(e.target.value)} disabled={busy} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('السرية', 'Confidentialité', 'Confidentiality')}>
                <Select className="input" value={confidentiality} disabled={busy}
                  onChange={(e) => setConfidentiality(e.target.value as DmsConfidentiality)}>
                  {CONFIDENTIALITIES.map((c) => (
                    <option key={c} value={c}>{labels.confidentiality[c]}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('تاريخ الإصدار', 'Date d’émission', 'Issued on')}>
                <input type="date" className="input" value={issuedOn} max={isoToday()}
                  onChange={(e) => setIssuedOn(e.target.value)} disabled={busy} />
              </Field>
              <Field label={t('تاريخ الانتهاء', 'Date d’expiration', 'Expires on')}>
                <input type="date" className="input" value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)} disabled={busy} />
              </Field>
              <Field label={t('التنبيه قبل (يوم)', 'Préavis (jours)', 'Notice (days)')}
                hint={t('يُستخدم في مسح الانتهاء', 'Utilisé par le balayage', 'Used by the expiry sweep')}>
                <input type="number" min={0} max={365} className="input" value={noticeDays}
                  onChange={(e) => setNoticeDays(e.target.value)} disabled={busy} />
              </Field>
            </div>

            <Field label={t('الوسوم', 'Étiquettes', 'Tags')}
              hint={t('مفصولة بفواصل', 'Séparées par des virgules', 'Comma separated')}>
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} />
            </Field>
          </>
        )}

        <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
          <input type="checkbox" checked={queueExtraction} disabled={busy}
            onChange={(e) => setQueueExtraction(e.target.checked)} />
          {t('إضافة إلى قائمة الاستخراج', "Mettre en file d'extraction", 'Queue for extraction')}
        </label>

        {stage && (
          <p className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {stageLabel[stage]}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !valid}>
            <Upload className="h-3.5 w-3.5" />
            {isNewVersion
              ? t('رفع النسخة', 'Téléverser la version', 'Upload version')
              : t('رفع', 'Téléverser', 'Upload')}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost btn-sm">
            {t('إلغاء', 'Annuler', 'Cancel')}
          </button>
        </div>
      </form>
    </Panel>
  );
}
