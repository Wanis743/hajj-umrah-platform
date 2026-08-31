/**
 * One document, everything known about it, and every command that can be run on it.
 *
 * The panel itself is a shell. It loads get_dms_document_360 once, runs commands
 * through useDmsCommand, and reloads the whole composed read after each one -- a
 * deliberate choice over patching state in place, because a single approval moves the
 * review status, appends to the event ledger, and can change a version flag and an
 * extraction job's review_state at the same time. Re-reading is both cheaper to trust
 * and cheaper to write than seven local updates.
 *
 * The sections it composes live in ./DmsDocumentForms, ./DmsDocumentVersions,
 * ./DmsDocumentGraph and ./DmsDocumentAudit, grouped by what they are about: the
 * bytes and what was read out of them, what the document is connected to, and what it
 * is evidence of together with what has happened to it.
 */
import { useEffect, useState } from 'react';
import {
  Archive, ArchiveRestore, Check, Pencil, Play, Plus, ScanText, Send, Undo2, X,
} from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { dmsAnalytics } from '@/services/dmsAnalytics';
import { dmsCommands, type CommandResult } from '@/services/domainCommands';
import { DMS_REVIEW_TRANSITIONS } from '@/types/dms';
import { KeyValue, NoticeBar, Panel, Pill, ReviewStepper } from './atoms';
import { EventLedger, PackagesSection } from './DmsDocumentAudit';
import { MetadataForm, ReasonForm } from './DmsDocumentForms';
import { LinksSection, RelationsSection } from './DmsDocumentGraph';
import { ExtractionSection, VersionsSection } from './DmsDocumentVersions';
import {
  CONFIDENTIALITY_TONE, DASH, actorLabel, daysUntil, expiryTone, fmtDate,
  fmtDateTime, fmtInt, useDmsI18n, useDmsLabels, useDmsRead,
} from './dmsFormat';
import { useDmsCommand } from './useDmsCommand';

export function DmsDocumentPanel({ documentId, onClose, onChanged, onAddVersion }: {
  documentId: string;
  onClose: () => void;
  /** Called after any write, so the list that opened this panel can refetch. */
  onChanged?: () => void;
  /** Opens the upload form in "add a version" mode, which the parent owns because
   *  the form needs to sit above the list, not inside this panel. */
  onAddVersion?: () => void;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const cmd = useDmsCommand();
  const view = useDmsRead(() => dmsAnalytics.document360(documentId), [documentId]);
  const [reasonFor, setReasonFor] = useState<'REJECT' | 'CHANGES' | null>(null);
  const [editing, setEditing] = useState(false);

  // Reading a document is an event worth keeping, especially a RESTRICTED one.
  // Fire and forget: a failed ledger write must not hide a document the reader is
  // already authorized by RLS to see.
  useEffect(() => { void dmsCommands.recordAccess(documentId, 'VIEWED'); }, [documentId]);

  const after = async () => { view.reload(); onChanged?.(); };

  if (view.loading && !view.data) {
    return <Panel title={t('الوثيقة', 'Document', 'Document')}><Spinner className="p-8" /></Panel>;
  }
  if (!view.data) {
    return (
      <Panel title={t('الوثيقة', 'Document', 'Document')}>
        <ErrorBanner message={view.error ?? t('غير متاح', 'Indisponible', 'Unavailable')} onRetry={view.reload} />
      </Panel>
    );
  }

  const { document: doc, versions, links, relations, events } = view.data;
  const jobs = view.data.extraction_jobs;
  const memberships = view.data.evidence_packages;
  const targets = DMS_REVIEW_TRANSITIONS[doc.review_status];
  const archived = doc.archived_at !== null;

  const act = <T,>(op: () => Promise<CommandResult<T>>, notice: string) => {
    void cmd.run(op, { notice, onSuccess: after });
  };
  const moved = (to: keyof typeof labels.review) =>
    `${labels.review[doc.review_status]} → ${labels.review[to]}`;

  return (
    <div className="space-y-4">
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {view.error && <ErrorBanner message={view.error} onRetry={view.reload} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <Panel
        title={doc.title}
        subtitle={[doc.document_number, doc.document_type].filter(Boolean).join(' · ')}
        actions={
          <>
            {targets.includes('PENDING_REVIEW') && (
              <button type="button" className="btn btn-primary btn-sm" disabled={cmd.busy || versions.length === 0}
                onClick={() => act(() => dmsCommands.submit(doc.id), moved('PENDING_REVIEW'))}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {t('إرسال للمراجعة', 'Envoyer en révision', 'Submit for review')}
              </button>
            )}
            {targets.includes('UNDER_REVIEW') && (
              <button type="button" className="btn btn-primary btn-sm" disabled={cmd.busy}
                onClick={() => act(() => dmsCommands.startReview(doc.id), moved('UNDER_REVIEW'))}>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                {t('بدء المراجعة', 'Commencer la révision', 'Start review')}
              </button>
            )}
            {targets.includes('APPROVED') && (
              <button type="button" className="btn btn-primary btn-sm" disabled={cmd.busy}
                onClick={() => act(() => dmsCommands.approve(doc.id), moved('APPROVED'))}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                {t('اعتماد', 'Approuver', 'Approve')}
              </button>
            )}
            {targets.includes('CHANGES_REQUESTED') && (
              <button type="button" className="btn btn-sm" disabled={cmd.busy}
                onClick={() => setReasonFor(reasonFor === 'CHANGES' ? null : 'CHANGES')}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {t('طلب تعديلات', 'Demander des modifications', 'Request changes')}
              </button>
            )}
            {targets.includes('REJECTED') && (
              <button type="button" className="btn btn-danger btn-sm" disabled={cmd.busy}
                onClick={() => setReasonFor(reasonFor === 'REJECT' ? null : 'REJECT')}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                {t('رفض', 'Rejeter', 'Reject')}
              </button>
            )}
            {targets.includes('DRAFT') && (
              <button type="button" className="btn btn-sm" disabled={cmd.busy}
                onClick={() => act(() => dmsCommands.reopen(doc.id), moved('DRAFT'))}>
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('إرجاع إلى مسودة', 'Rouvrir en brouillon', 'Reopen as draft')}
              </button>
            )}
            <button type="button" className="btn btn-sm" disabled={cmd.busy} onClick={() => setEditing((v) => !v)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              {t('تعديل', 'Modifier', 'Edit')}
            </button>
            {onAddVersion && (
              <button type="button" className="btn btn-sm" disabled={cmd.busy || doc.review_status === 'UNDER_REVIEW'}
                title={doc.review_status === 'UNDER_REVIEW'
                  ? t('لا يمكن إضافة نسخة أثناء المراجعة', 'Impossible pendant la révision', 'Not while it is under review')
                  : undefined}
                onClick={onAddVersion}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('نسخة جديدة', 'Nouvelle version', 'New version')}
              </button>
            )}
            <button type="button" className="btn btn-sm" disabled={cmd.busy || versions.length === 0}
              onClick={() => act(
                () => dmsCommands.queueExtraction(doc.id),
                t('أُضيفت إلى قائمة الاستخراج', "Mise en file d'extraction", 'Queued for extraction'),
              )}>
              <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
              {t('استخراج', 'Extraction', 'Extract')}
            </button>
            <button type="button" className="btn btn-sm" disabled={cmd.busy}
              onClick={() => act(
                () => dmsCommands.archive(doc.id, !archived),
                archived ? t('تم الاسترجاع', 'Restauré', 'Restored') : t('تمت الأرشفة', 'Archivé', 'Archived'),
              )}>
              {archived
                ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
              {archived ? t('استرجاع', 'Restaurer', 'Restore') : t('أرشفة', 'Archiver', 'Archive')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t('إغلاق', 'Fermer', 'Close')}
            </button>
          </>
        }
      >
        <ReviewStepper status={doc.review_status} labels={labels.review} />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue
            label={t('السرية', 'Confidentialité', 'Confidentiality')}
            value={(
              <Pill tone={CONFIDENTIALITY_TONE[doc.confidentiality]}>
                {labels.confidentiality[doc.confidentiality]}
              </Pill>
            )}
          />
          <KeyValue label={t('عدد النسخ', 'Versions', 'Versions')} value={fmtInt(doc.version_count)} mono />
          <KeyValue label={t('تاريخ الإصدار', 'Émis le', 'Issued on')} value={fmtDate(doc.issued_on)} />
          <KeyValue
            label={t('تاريخ الانتهاء', 'Expire le', 'Expires on')}
            value={doc.expires_on ? (
              <span className="flex items-center gap-1.5">
                {fmtDate(doc.expires_on)}
                <Pill tone={expiryTone(daysUntil(doc.expires_on))}>{`${daysUntil(doc.expires_on)}d`}</Pill>
              </span>
            ) : DASH}
          />
          <KeyValue
            label={t('أُرسلت', 'Soumis', 'Submitted')}
            value={doc.submitted_at ? `${fmtDateTime(doc.submitted_at)} · ${actorLabel(doc.submitted_by)}` : DASH}
          />
          <KeyValue
            label={t('المراجع', 'Réviseur', 'Reviewer')}
            value={doc.reviewer_id ? `${actorLabel(doc.reviewer_id)} · ${fmtDateTime(doc.review_started_at)}` : DASH}
          />
          <KeyValue
            label={t('الاعتماد', 'Approbation', 'Approved')}
            value={doc.approved_at ? `${fmtDateTime(doc.approved_at)} · ${actorLabel(doc.approved_by)}` : DASH}
          />
          <KeyValue label={t('الاستبقاء حتى', 'Conservation', 'Retention until')} value={fmtDate(doc.retention_until)} />
        </div>
        {doc.description && (
          <p className="mt-4 text-[13px] text-[var(--text-secondary)]">{doc.description}</p>
        )}
        {doc.review_notes && (
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            <span className="font-medium">{t('ملاحظات المراجعة', 'Notes de révision', 'Review notes')}: </span>
            {doc.review_notes}
          </p>
        )}
        {doc.rejection_reason && (
          <p className="mt-2 text-[12px] text-[var(--danger)]">
            <span className="font-medium">{t('سبب الرفض', 'Motif du rejet', 'Rejection reason')}: </span>
            {doc.rejection_reason}
          </p>
        )}
        {doc.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {doc.tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}
          </div>
        )}
      </Panel>

      {reasonFor && (
        <ReasonForm
          kind={reasonFor}
          busy={cmd.busy}
          onCancel={() => setReasonFor(null)}
          onConfirm={async (text) => {
            const ok = await cmd.run(
              () => (reasonFor === 'REJECT'
                ? dmsCommands.reject(doc.id, text)
                : dmsCommands.requestChanges(doc.id, text)),
              {
                notice: moved(reasonFor === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED'),
                onSuccess: after,
              },
            );
            if (ok) setReasonFor(null);
          }}
        />
      )}

      {editing && (
        <MetadataForm
          doc={doc}
          busy={cmd.busy}
          onCancel={() => setEditing(false)}
          onSave={async (patch, tags) => {
            const ok = await cmd.run(() => dmsCommands.updateMetadata(doc.id, patch), {
              notice: t('تم التحديث', 'Mis à jour', 'Updated'),
              onSuccess: async () => {
                // Tags are a text[] and need their own command; only send it when the
                // list actually changed, so an untouched field is not an event.
                if (tags !== null) await dmsCommands.setTags(doc.id, tags);
                await after();
              },
            });
            if (ok) setEditing(false);
          }}
        />
      )}

      <VersionsSection documentId={doc.id} versions={versions} />

      <ExtractionSection jobs={jobs} busy={cmd.busy} onReview={async (fieldId, action, value) => {
        await cmd.run(() => dmsCommands.reviewExtractedField(fieldId, action, value), { onSuccess: after });
      }} />

      <div className="grid gap-4 lg:grid-cols-2">
        <LinksSection
          links={links}
          busy={cmd.busy}
          onAdd={async (entityType, entityId, relation, note) => cmd.run(
            () => dmsCommands.link(doc.id, entityType, entityId, relation, note),
            { notice: t('تم الربط', 'Lié', 'Linked'), onSuccess: after },
          )}
          onRemove={async (linkId) => {
            await cmd.run(() => dmsCommands.unlink(linkId), {
              notice: t('تم فك الربط', 'Lien retiré', 'Link removed'), onSuccess: after,
            });
          }}
        />
        <RelationsSection
          documentId={doc.id}
          relations={relations}
          busy={cmd.busy}
          onAdd={async (toId, relation) => cmd.run(
            () => dmsCommands.relate(doc.id, toId, relation),
            { notice: t('تمت الإضافة', 'Ajouté', 'Added'), onSuccess: after },
          )}
          onRemove={async (relationId) => {
            await cmd.run(() => dmsCommands.unrelate(relationId), {
              notice: t('تمت الإزالة', 'Retiré', 'Removed'), onSuccess: after,
            });
          }}
        />
      </div>

      <PackagesSection memberships={memberships} currentVersionId={doc.current_version_id} />
      <EventLedger events={events} />
    </div>
  );
}
