/**
 * The document library: one filtered list over dms_documents, the upload form, and
 * the row actions that do not need the whole 360 view open.
 *
 * The list is a direct read of the RLS-protected table (see ./dmsRows); every
 * button is a command RPC. Submit appears only where DMS_REVIEW_TRANSITIONS says
 * the move exists, so the screen greys out what the state machine would refuse
 * instead of sending it and translating the exception back.
 *
 * Selecting a row opens DmsDocumentPanel below the table, the same way
 * CrmCustomersPanel opens the customer 360 -- one screen, not a route.
 */
import { useMemo, useState } from 'react';
import { Plus, Search, Send, Trash2 } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner, TableEmpty } from '@/components/admin/ui';
import { dmsCommands } from '@/services/domainCommands';
import { DMS_REVIEW_TRANSITIONS, type DmsDocumentRow, type DmsReviewStatus } from '@/types/dms';
import { NoticeBar, Panel, Pill } from './atoms';
import { DmsDocumentPanel } from './DmsDocumentPanel';
import { DmsUploadForm } from './DmsUploadForm';
import {
  CONFIDENTIALITY_TONE, DASH, REVIEW_TONE, daysUntil, expiryTone,
  fmtDate, fmtInt, useDmsI18n, useDmsLabels,
} from './dmsFormat';
import { useDmsDocumentRows } from './dmsRows';
import { useDmsCommand } from './useDmsCommand';

const FILTER_STATUSES: readonly DmsReviewStatus[] = [
  'DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED',
  'CHANGES_REQUESTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED',
];

/** DRAFT and CHANGES_REQUESTED are the two states whose only legal move is
 *  PENDING_REVIEW, so the row can offer submit without asking the server first. */
function canSubmit(status: DmsReviewStatus): boolean {
  return DMS_REVIEW_TRANSITIONS[status].includes('PENDING_REVIEW');
}

export function DmsLibraryPanel() {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const cmd = useDmsCommand();

  const [status, setStatus] = useState<DmsReviewStatus | 'ALL'>('ALL');
  const [term, setTerm] = useState('');
  const [uploading, setUploading] = useState(false);
  const [versionFor, setVersionFor] = useState<DmsDocumentRow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const rows = useDmsDocumentRows({ reviewStatus: status, term });

  const selected = useMemo(
    () => rows.data.find((d) => d.id === selectedId) ?? null,
    [rows.data, selectedId],
  );

  const submit = async (doc: DmsDocumentRow) => {
    await cmd.run(() => dmsCommands.submit(doc.id), {
      notice: `${doc.document_number ?? doc.title} → ${labels.review.PENDING_REVIEW}`,
      onSuccess: async () => { await rows.refetch(); },
    });
  };

  const remove = async (doc: DmsDocumentRow) => {
    await cmd.run(() => dmsCommands.removeDocument(doc.id), {
      notice: t('تم الحذف', 'Supprimé', 'Deleted'),
      onSuccess: async (data) => {
        setPendingDelete(null);
        if (selectedId === doc.id) setSelectedId(null);
        // The bytes outlive the row on purpose: no storage policy can authorize
        // deleting an object whose version row is gone, so the command files them
        // for the janitor and says how many.
        if (data && data.orphaned_objects > 0) {
          cmd.setNotice(t(
            `تم الحذف — ${data.orphaned_objects} ملف في قائمة التنظيف`,
            `Supprimé — ${data.orphaned_objects} objet(s) en file de nettoyage`,
            `Deleted — ${data.orphaned_objects} object(s) queued for cleanup`,
          ));
        }
        await rows.refetch();
      },
    });
  };

  return (
    <div className="space-y-4">
      {rows.error && <ErrorBanner message={rows.error} onRetry={() => { void rows.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      {uploading && (
        <DmsUploadForm
          onCancel={() => setUploading(false)}
          onDone={(result) => {
            setUploading(false);
            cmd.setNotice(t(
              `تم الرفع — النسخة ${result.version_number}`,
              `Téléversé — version ${result.version_number}`,
              `Uploaded — version ${result.version_number}`,
            ));
            setSelectedId(result.document_id);
            void rows.refetch();
          }}
        />
      )}

      {versionFor && (
        <DmsUploadForm
          documentId={versionFor.id}
          documentTitle={versionFor.title}
          onCancel={() => setVersionFor(null)}
          onDone={(result) => {
            setVersionFor(null);
            cmd.setNotice(t(
              `النسخة ${result.version_number} — ${labels.review[result.review_status]}`,
              `Version ${result.version_number} — ${labels.review[result.review_status]}`,
              `Version ${result.version_number} — ${labels.review[result.review_status]}`,
            ));
            setSelectedId(result.document_id);
            void rows.refetch();
          }}
        />
      )}

      <Panel
        title={t('مكتبة الوثائق', 'Bibliothèque', 'Document library')}
        subtitle={t(
          'الصف أولاً ثم البيانات — والحذف يترك الملفات في قائمة تنظيف',
          'La ligne puis les octets — la suppression laisse les objets en file de nettoyage',
          'Row first, bytes second — and a delete leaves the objects in a cleanup queue',
        )}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t('بحث…', 'Rechercher…', 'Search…')}
                aria-label={t('بحث', 'Rechercher', 'Search')}
                className="input w-44 ps-8"
              />
            </div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as DmsReviewStatus | 'ALL')}
              className="input w-auto"
              aria-label={t('حالة المراجعة', 'Statut de révision', 'Review status')}
            >
              <option value="ALL">{t('كل الحالات', 'Tous les statuts', 'All statuses')}</option>
              {FILTER_STATUSES.map((s) => <option key={s} value={s}>{labels.review[s]}</option>)}
            </Select>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setUploading((v) => !v)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('رفع وثيقة', 'Téléverser', 'Upload')}
            </button>
          </>
        }
      >
        {rows.loading && rows.data.length === 0 ? (
          <Spinner className="p-8" />
        ) : rows.data.length === 0 ? (
          <TableEmpty query={term || undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[980px]">
              <thead>
                <tr>
                  <th>{t('الوثيقة', 'Document', 'Document')}</th>
                  <th>{t('النوع', 'Type', 'Type')}</th>
                  <th>{t('المراجعة', 'Révision', 'Review')}</th>
                  <th>{t('السرية', 'Confidentialité', 'Confidentiality')}</th>
                  <th className="end">{t('النسخ', 'Versions', 'Versions')}</th>
                  <th>{t('الانتهاء', 'Expiration', 'Expires')}</th>
                  <th>{t('آخر تحديث', 'Mis à jour', 'Updated')}</th>
                  <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.data.map((doc) => {
                  const remaining = daysUntil(doc.expires_on);
                  return (
                    <tr key={doc.id} className={doc.id === selectedId ? 'bg-[var(--bg-hover)]' : undefined}>
                      <td>
                        <p className="font-medium text-[var(--text-primary)]">{doc.title}</p>
                        <p className="text-[11px] text-[var(--text-muted)] tabular">
                          {doc.document_number ?? DASH}
                          {doc.archived_at && ` · ${t('مؤرشف', 'Archivé', 'Archived')}`}
                        </p>
                      </td>
                      <td className="text-[12px]">{doc.document_type}</td>
                      <td><Pill tone={REVIEW_TONE[doc.review_status]}>{labels.review[doc.review_status]}</Pill></td>
                      <td>
                        <Pill tone={CONFIDENTIALITY_TONE[doc.confidentiality]}>
                          {labels.confidentiality[doc.confidentiality]}
                        </Pill>
                      </td>
                      <td className="end tabular text-end">{fmtInt(doc.version_count)}</td>
                      <td className="whitespace-nowrap text-[12px]">
                        {doc.expires_on ? (
                          <span className="flex items-center gap-1.5">
                            {fmtDate(doc.expires_on)}
                            <Pill tone={expiryTone(remaining)}>
                              {remaining !== null && remaining < 0
                                ? t('منتهي', 'Expiré', 'Overdue')
                                : `${remaining}d`}
                            </Pill>
                          </span>
                        ) : DASH}
                      </td>
                      <td className="whitespace-nowrap text-[12px]">{fmtDate(doc.updated_at)}</td>
                      <td className="end">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setSelectedId(doc.id === selectedId ? null : doc.id)}
                          >
                            {doc.id === selectedId ? t('إغلاق', 'Fermer', 'Close') : t('عرض', 'Ouvrir', 'Open')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={cmd.busy || !canSubmit(doc.review_status) || doc.version_count === 0}
                            title={t('إرسال للمراجعة', 'Envoyer en révision', 'Submit for review')}
                            aria-label={`${t('إرسال للمراجعة', 'Envoyer en révision', 'Submit for review')} ${doc.title}`}
                            onClick={() => { void submit(doc); }}
                          >
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${pendingDelete === doc.id ? 'btn-danger' : ''}`}
                            disabled={cmd.busy}
                            aria-label={
                              pendingDelete === doc.id
                                ? `${t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm delete')} ${doc.title}`
                                : `${t('حذف', 'Supprimer', 'Delete')} ${doc.title}`
                            }
                            onClick={() => {
                              // Two clicks, not window.confirm: the second click is
                              // the confirmation.
                              if (pendingDelete === doc.id) { void remove(doc); return; }
                              setPendingDelete(doc.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {pendingDelete === doc.id && t('تأكيد', 'Confirmer', 'Confirm')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <DmsDocumentPanel
          documentId={selected.id}
          onClose={() => setSelectedId(null)}
          onChanged={() => { void rows.refetch(); }}
          onAddVersion={() => setVersionFor(selected)}
        />
      )}
    </div>
  );
}
