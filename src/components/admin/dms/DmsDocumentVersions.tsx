/**
 * The bytes of a document and what a machine read out of them.
 *
 * These two sit together because they are the same object seen twice: a version is
 * the file as stored, with the digest recorded at finalise time, and an extraction
 * job is a claim about what that file says. Neither is editable -- a version is
 * immutable once finalised, and a field is changed only by a reviewer's decision,
 * which is a command.
 */
import { useState } from 'react';
import { Check, Download, Pencil, X } from 'lucide-react';
import { ErrorBanner } from '@/components/admin/ui';
import { dmsSignedUrl } from '@/services/dmsUpload';
import type { DmsExtractedField, DmsExtractionJob, DmsVersion } from '@/types/dms';
import { ChecksumChip, Panel, Pill } from './atoms';
import {
  DASH, EXTRACTION_TONE, FIELD_REVIEW_TONE, UPLOAD_STATE_TONE,
  fmtBytes, fmtConfidence, fmtDateTime, fmtInt, useDmsI18n, useDmsLabels,
} from './dmsFormat';

export type FieldDecision = 'ACCEPT' | 'CORRECT' | 'REJECT';

/**
 * Every version, newest first, with the digest recorded at finalise time. The
 * download mints a 60-second signed URL and records the issue in the document's own
 * ledger before the URL exists, so a file that leaves through a link somebody
 * pasted elsewhere still has an entry behind it.
 *
 * RESERVED rows have no bytes yet -- a reservation whose PUT never landed -- so they
 * show the state and no download.
 */
export function VersionsSection({ documentId, versions }: { documentId: string; versions: DmsVersion[] }) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const download = async (v: DmsVersion) => {
    setBusyId(v.id);
    setError(null);
    const { url, error: failure } = await dmsSignedUrl(documentId, v.storage_path);
    setBusyId(null);
    if (failure !== null || url === null) {
      setError(failure ?? t('تعذر إنشاء الرابط', 'Lien indisponible', 'Could not create the link'));
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Panel
      title={t('النسخ', 'Versions', 'Versions')}
      subtitle={t(
        'الرابط صالح 60 ثانية ويُسجَّل قبل إنشائه',
        'Le lien vaut 60 secondes et est journalisé avant d’exister',
        'The link lasts 60 seconds and is logged before it is minted',
      )}
    >
      {error && <ErrorBanner message={error} />}
      {versions.length === 0 ? (
        <p className="py-4 text-[13px] text-[var(--text-muted)]">
          {t('لا توجد نسخة بعد', 'Aucune version', 'No version yet')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                <th className="end">#</th>
                <th>{t('الحالة', 'État', 'State')}</th>
                <th>{t('الملف', 'Fichier', 'File')}</th>
                <th className="end">{t('الحجم', 'Taille', 'Size')}</th>
                <th>SHA-256</th>
                <th>{t('الرفع', 'Téléversé', 'Uploaded')}</th>
                <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="end tabular text-end">
                    {v.version_number}
                    {v.is_current && <Pill tone="good">{t('حالية', 'Actuelle', 'Current')}</Pill>}
                  </td>
                  <td><Pill tone={UPLOAD_STATE_TONE[v.upload_state]}>{labels.uploadState[v.upload_state]}</Pill></td>
                  <td className="text-[12px]">
                    <p className="text-[var(--text-primary)]">{v.original_filename ?? DASH}</p>
                    <p className="text-[var(--text-muted)]">{v.mime_type ?? DASH}</p>
                  </td>
                  <td className="end tabular text-end text-[12px]">{fmtBytes(v.size_bytes)}</td>
                  <td><ChecksumChip hash={v.checksum_sha256} /></td>
                  <td className="whitespace-nowrap text-[12px]">{fmtDateTime(v.uploaded_at)}</td>
                  <td className="end">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyId === v.id || v.upload_state === 'RESERVED' || v.upload_state === 'FAILED'}
                      onClick={() => { void download(v); }}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('تنزيل', 'Télécharger', 'Download')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * Extraction jobs and their fields. The engine proposes; a human decides. Accepting
 * keeps the extracted value, correcting replaces it with the one typed here, and
 * rejecting nulls it -- and the job's review_state is recomputed from its fields on
 * every decision, which is why the whole panel reloads after one.
 */
export function ExtractionSection({ jobs, busy, onReview }: {
  jobs: DmsExtractionJob[];
  busy: boolean;
  onReview: (fieldId: string, action: FieldDecision, value: string | null) => Promise<void>;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  if (jobs.length === 0) {
    return (
      <Panel title={t('الاستخراج', 'Extraction', 'Extraction')}>
        <p className="py-4 text-[13px] text-[var(--text-muted)]">
          {t('لا توجد مهمة استخراج', "Aucun travail d'extraction", 'No extraction job')}
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      title={t('الاستخراج', 'Extraction', 'Extraction')}
      subtitle={t(
        'المحرك يقترح والمراجع يقرر',
        'Le moteur propose, le réviseur décide',
        'The engine proposes; a reviewer decides',
      )}
    >
      <div className="space-y-4">
        {jobs.map((job) => (
          <div key={job.id} className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <Pill tone={EXTRACTION_TONE[job.status]}>{labels.extraction[job.status]}</Pill>
              <span className="font-medium text-[var(--text-primary)]">{job.engine}</span>
              <span>{t('الثقة', 'Confiance', 'Confidence')}: {fmtConfidence(job.confidence)}</span>
              <span>{t('المحاولات', 'Tentatives', 'Attempts')}: {fmtInt(job.attempts)}</span>
              <span>{t('المراجعة', 'Révision', 'Review')}: {job.review_state}</span>
              <span className="text-[var(--text-muted)]">
                {fmtDateTime(job.finished_at ?? job.started_at ?? job.created_at)}
              </span>
            </div>
            {job.error_message && <p className="mt-2 text-[12px] text-[var(--danger)]">{job.error_message}</p>}
            {job.fields.length === 0 ? (
              <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                {t('لا توجد حقول', 'Aucun champ', 'No fields')}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>{t('الحقل', 'Champ', 'Field')}</th>
                      <th>{t('القيمة', 'Valeur', 'Value')}</th>
                      <th className="end">{t('الثقة', 'Confiance', 'Confidence')}</th>
                      <th>{t('القرار', 'Décision', 'Decision')}</th>
                      <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.fields.map((field) => (
                      <FieldRow key={field.id} field={field} busy={busy}
                        labels={labels.fieldReview} onReview={onReview} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FieldRow({ field, busy, labels, onReview }: {
  field: DmsExtractedField;
  busy: boolean;
  labels: Record<DmsExtractedField['review_state'], string>;
  onReview: (fieldId: string, action: FieldDecision, value: string | null) => Promise<void>;
}) {
  const { t } = useDmsI18n();
  const [correcting, setCorrecting] = useState(false);
  const [draft, setDraft] = useState(field.value ?? field.raw_value ?? '');

  return (
    <tr>
      <td className="text-[12px]">
        <p className="font-medium text-[var(--text-primary)]">{field.field_label ?? field.field_key}</p>
        <p className="text-[var(--text-muted)] tabular">
          {field.field_key}
          {field.page_number !== null && ` · p.${field.page_number}`}
        </p>
      </td>
      <td className="text-[12px]">
        {correcting ? (
          <input className="input w-full" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            aria-label={`${field.field_key} ${t('القيمة المصححة', 'valeur corrigée', 'corrected value')}`} />
        ) : (
          <>
            <p className="text-[var(--text-primary)]">{field.value ?? DASH}</p>
            {/* The engine's original reading stays visible after a correction: the
                point of recording raw_value is that somebody can see what was
                changed and why. */}
            {field.raw_value !== null && field.raw_value !== field.value && (
              <p className="text-[var(--text-muted)] line-through">{field.raw_value}</p>
            )}
          </>
        )}
      </td>
      <td className="end tabular text-end text-[12px]">{fmtConfidence(field.confidence)}</td>
      <td><Pill tone={FIELD_REVIEW_TONE[field.review_state]}>{labels[field.review_state]}</Pill></td>
      <td className="end">
        <div className="flex items-center justify-end gap-1.5">
          {correcting ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || draft.trim() === ''}
                aria-label={`${t('حفظ', 'Enregistrer', 'Save')} ${field.field_key}`}
                onClick={() => { void onReview(field.id, 'CORRECT', draft.trim()).then(() => setCorrecting(false)); }}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                aria-label={t('إلغاء', 'Annuler', 'Cancel')}
                onClick={() => setCorrecting(false)}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm" disabled={busy}
                aria-label={`${t('قبول', 'Accepter', 'Accept')} ${field.field_key}`}
                onClick={() => { void onReview(field.id, 'ACCEPT', null); }}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-sm" disabled={busy}
                aria-label={`${t('تصحيح', 'Corriger', 'Correct')} ${field.field_key}`}
                onClick={() => setCorrecting(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-sm" disabled={busy}
                aria-label={`${t('رفض', 'Rejeter', 'Reject')} ${field.field_key}`}
                onClick={() => { void onReview(field.id, 'REJECT', null); }}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
