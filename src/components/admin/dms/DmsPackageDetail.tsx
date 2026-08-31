/**
 * One evidence package: what is in it, whether the seal still holds, and the writes
 * that can change either.
 *
 * The seal is the point of the screen. private.dms_package_digest hashes the members
 * in sequence order as document_id:version_id:checksum, and sealing stores that
 * digest while verifying recomputes it from the same function -- so a seal and a
 * verification cannot disagree about what the package contained. `matches` is a
 * fact, not an opinion, and drift is named per document rather than counted: a
 * reviewer needs to know which member moved, not how many did.
 *
 * Every gate below is the server's, mirrored so an impossible action is absent
 * rather than refused:
 *   OPEN only     — add, remove, edit, void, delete
 *   not empty     — seal (and delete refuses while any member remains)
 *   all APPROVED  — seal, `These documents are not approved: …`
 * Verify has no gate at all, which is deliberate: verifying a broken seal is the
 * moment it matters most.
 */
import { useState } from 'react';
import {
  Ban, Lock, Pencil, Plus, Search, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { ErrorBanner } from '@/components/admin/ui';
import { dmsCommands } from '@/services/domainCommands';
import type {
  DmsEvidencePackage, DmsPackageDocument, DmsPackageVerification,
} from '@/types/dms';
import { ChecksumChip, Field, NoticeBar, Panel, Pill, SealBadge } from './atoms';
import {
  DASH, PACKAGE_TONE, REVIEW_TONE, actorLabel, fmtDateTime, fmtInt,
  useDmsI18n, useDmsLabels,
} from './dmsFormat';
import { PackageForm } from './DmsPackageForms';
import { useDmsDocumentRows } from './dmsRows';
import { useDmsCommand } from './useDmsCommand';

/**
 * The member list. `sequence_no` is the order the digest is computed in, so it is
 * shown rather than hidden: two packages with the same documents in a different
 * order have different seals, and that is correct — the record is the ordered set.
 *
 * `checksum_sha256` here is the snapshot taken when the document was added, not the
 * version's live value. When they differ, the document drifted, which is precisely
 * what verification reports.
 */
function MemberTable({ documents, canEdit, busy, onRemove }: {
  documents: readonly DmsPackageDocument[];
  canEdit: boolean;
  busy: boolean;
  onRemove: (documentId: string) => void;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();

  if (documents.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
        {t('لا وثائق في هذه الحزمة', 'Aucun document', 'No documents in this package')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[760px]">
        <thead>
          <tr>
            <th className="end">#</th>
            <th>{t('الوثيقة', 'Document', 'Document')}</th>
            <th>{t('المراجعة', 'Révision', 'Review')}</th>
            <th>{t('البصمة المسجلة', 'Empreinte scellée', 'Recorded digest')}</th>
            {canEdit && <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.document_id}>
              <td className="end tabular text-end text-[12px] text-[var(--text-muted)]">
                {d.sequence_no ?? DASH}
              </td>
              <td>
                <p className="font-medium text-[var(--text-primary)]">{d.title}</p>
                <p className="text-[11px] text-[var(--text-muted)] tabular">{d.document_number ?? DASH}</p>
              </td>
              <td>
                <Pill tone={REVIEW_TONE[d.review_status]}>{labels.review[d.review_status]}</Pill>
              </td>
              <td><ChecksumChip hash={d.checksum_sha256} label={t('البصمة', 'Empreinte', 'Digest')} /></td>
              {canEdit && (
                <td className="end">
                  <button type="button" className="btn btn-sm" disabled={busy}
                    onClick={() => onRemove(d.document_id)}
                    aria-label={`${t('إزالة', 'Retirer', 'Remove')} ${d.title}`}
                    title={t('إزالة من الحزمة', 'Retirer du dossier', 'Remove from the package')}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Adding a member. The picker searches the library the reviewer can already see —
 * the same RLS-protected read the library screen uses — and refuses locally only on
 * the one condition the server states as a data fact rather than a rule: a document
 * with no uploaded version has no bytes to seal, so it cannot be included
 * (`This document has no uploaded version to include`).
 *
 * A non-APPROVED document *can* be added; it just blocks the seal until it is
 * approved. That is the server's shape, so the picker shows the state instead of
 * hiding the row.
 */
function DocumentPicker({ excludeIds, busy, onAdd }: {
  excludeIds: ReadonlySet<string>;
  busy: boolean;
  onAdd: (documentId: string) => void;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const [term, setTerm] = useState('');
  const rows = useDmsDocumentRows({ term, limit: 25 });
  const candidates = rows.data.filter((d) => !excludeIds.has(d.id)).slice(0, 8);

  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
          aria-hidden="true" />
        <input className="input w-full ps-8" value={term} onChange={(e) => setTerm(e.target.value)}
          placeholder={t('أضف وثيقة…', 'Ajouter un document…', 'Add a document…')}
          aria-label={t('بحث في الوثائق', 'Rechercher un document', 'Search documents')} />
      </div>
      {rows.error && <p className="mt-2 text-[12px] text-[var(--danger)]">{rows.error}</p>}
      <ul className="mt-2 space-y-1">
        {candidates.length === 0 ? (
          <li className="py-2 text-center text-[12px] text-[var(--text-muted)]">
            {t('لا نتائج', 'Aucun résultat', 'No matches')}
          </li>
        ) : candidates.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-[var(--bg-hover)]">
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-[var(--text-primary)]">{d.title}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] tabular">
                {d.document_number ?? DASH}
                <Pill tone={REVIEW_TONE[d.review_status]}>{labels.review[d.review_status]}</Pill>
              </span>
            </span>
            <button type="button" className="btn btn-sm shrink-0"
              disabled={busy || d.version_count === 0}
              title={d.version_count === 0
                ? t('لا نسخة مرفوعة', 'Aucune version téléversée', 'No uploaded version')
                : t('إضافة', 'Ajouter', 'Add')}
              aria-label={`${t('إضافة', 'Ajouter', 'Add')} ${d.title}`}
              onClick={() => onAdd(d.id)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The verification result, shown only after somebody asked for it.
 *
 * Both digests are printed, not just the verdict: `matches` is the server comparing
 * them, and a reader who wants to check that comparison by hand should be able to.
 * The drift list is the useful part when they differ — each row is a member whose
 * current version or checksum is no longer the one the seal covered.
 */
function VerificationReport({ result }: { result: DmsPackageVerification }) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();

  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-[var(--text-primary)]">
          {result.matches
            ? t('الختم سليم', 'Le sceau est intact', 'The seal holds')
            : result.status === 'SEALED'
              ? t('الختم لم يطابق', 'Le sceau ne correspond plus', 'The seal no longer matches')
              : t('الحزمة غير مختومة', 'Dossier non scellé', 'This package is not sealed')}
        </p>
        <SealBadge matches={result.status === 'SEALED' ? result.matches : null}
          label={(ok) => (ok
            ? t('مطابق', 'Correspond', 'Matches')
            : t('غير مطابق', 'Ne correspond pas', 'Does not match'))} />
      </div>
      <div className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2">
        <span className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">{t('المسجلة', 'Scellée', 'Sealed')}</span>
          <ChecksumChip hash={result.seal_checksum} label={t('البصمة المسجلة', 'Empreinte scellée', 'Sealed digest')} />
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">{t('المحسوبة الآن', 'Recalculée', 'Recomputed')}</span>
          <ChecksumChip hash={result.recomputed_checksum}
            label={t('البصمة المحسوبة', 'Empreinte recalculée', 'Recomputed digest')} />
        </span>
      </div>
      {result.drift.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {result.drift.map((d) => (
            <li key={d.document_id} className="rounded bg-[var(--bg-subtle)] p-2 text-[12px]">
              <p className="font-medium text-[var(--text-primary)]">
                {d.title}
                <span className="ms-1.5 text-[11px] text-[var(--text-muted)] tabular">
                  {d.document_number ?? DASH}
                </span>
                <Pill tone={REVIEW_TONE[d.review_status]}>{labels.review[d.review_status]}</Pill>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                {d.sealed_version_id !== d.current_version_id
                  ? t('نسخة أحدث', 'Version plus récente', 'A newer version is current')
                  : t('البصمة تغيّرت', 'Empreinte modifiée', 'The recorded digest changed')}
                <ChecksumChip hash={d.sealed_checksum} label={t('المسجلة', 'Scellée', 'Sealed')} />
                <span aria-hidden="true">→</span>
                <ChecksumChip hash={d.current_checksum} label={t('الحالية', 'Actuelle', 'Current')} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The package, its members, and its writes.
 *
 * Owns its own command state rather than borrowing the list's, so a refusal appears
 * next to the package it was about — `An empty evidence package cannot be sealed`
 * belongs under the package, not at the top of a table of twelve of them.
 *
 * Sealing and deleting are two-click rather than window.confirm: a seal is
 * irreversible by design (there is no unseal — VOID is reachable only from OPEN)
 * and a delete removes the row.
 */
export function DmsPackageDetail({ pkg, onChanged, onClose }: {
  pkg: DmsEvidencePackage;
  /** Called after any write, so the list above can refetch. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const cmd = useDmsCommand();
  const [verification, setVerification] = useState<DmsPackageVerification | null>(null);
  const [confirmSeal, setConfirmSeal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [voidReason, setVoidReason] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);

  const isOpen = pkg.status === 'OPEN';
  const memberIds = new Set(pkg.documents.map((d) => d.document_id));
  const notApproved = pkg.documents.filter((d) => d.review_status !== 'APPROVED');
  // Sealing needs every member APPROVED *and* every member's bytes measured. Only
  // the first is predicted here: review_status in this payload is the document's
  // live value, while checksum_sha256 is the snapshot taken when it was added, so
  // treating a null there as unsealable would hide a seal the server would allow.
  const sealable = isOpen && pkg.documents.length > 0 && notApproved.length === 0;

  const after = async () => { setVerification(null); onChanged(); };

  const setMember = (documentId: string, include: boolean) => {
    void cmd.run(() => dmsCommands.setPackageDocument(pkg.id, documentId, include), {
      notice: include ? t('أُضيفت', 'Ajouté', 'Added') : t('أُزيلت', 'Retiré', 'Removed'),
      onSuccess: after,
    });
  };

  const seal = () => {
    void cmd.run(() => dmsCommands.sealPackage(pkg.id), {
      onSuccess: (data) => {
        setConfirmSeal(false);
        cmd.setNotice(t(
          `تم الختم على ${data?.document_count ?? pkg.document_count} وثيقة`,
          `Scellé sur ${data?.document_count ?? pkg.document_count} document(s)`,
          `Sealed over ${data?.document_count ?? pkg.document_count} document(s)`,
        ));
        void after();
      },
    });
  };

  const verify = () => {
    void cmd.run(() => dmsCommands.verifyPackage(pkg.id), {
      onSuccess: (data) => { setVerification(data); },
    });
  };

  return (
    <Panel
      title={pkg.name}
      subtitle={[pkg.reference, pkg.purpose].filter(Boolean).join(' · ') || undefined}
      actions={
        <>
          <Pill tone={PACKAGE_TONE[pkg.status]}>{labels.packageStatus[pkg.status]}</Pill>
          <SealBadge matches={pkg.seal_matches}
            label={(ok) => (ok
              ? t('الختم سليم', 'Sceau intact', 'Seal holds')
              : t('الختم مكسور', 'Sceau rompu', 'Seal broken'))} />
          {isOpen && (
            <button type="button" className="btn btn-sm" disabled={cmd.busy}
              onClick={() => setPicking((v) => !v)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('إضافة وثيقة', 'Ajouter', 'Add document')}
            </button>
          )}
          {isOpen && (
            <button type="button" className="btn btn-sm" disabled={cmd.busy}
              onClick={() => setEditing((v) => !v)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              {t('تعديل', 'Modifier', 'Edit')}
            </button>
          )}
          {isOpen && (
            <button type="button" className={`btn btn-sm ${confirmSeal ? 'btn-danger' : 'btn-primary'}`}
              disabled={cmd.busy || !sealable}
              title={pkg.documents.length === 0
                ? t('الحزمة فارغة', 'Dossier vide', 'The package is empty')
                : notApproved.length > 0
                  ? t('كل الوثائق يجب أن تكون معتمدة', 'Tous les documents doivent être approuvés', 'Every document must be approved')
                  : t('يثبّت النسخ الحالية ويحفظ بصمة عليها', 'Fige les versions et enregistre une empreinte', 'Freezes the current versions and records a digest')}
              onClick={() => { if (confirmSeal) { seal(); return; } setConfirmSeal(true); }}>
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              {confirmSeal ? t('تأكيد الختم', 'Confirmer', 'Confirm seal') : t('ختم', 'Sceller', 'Seal')}
            </button>
          )}
          {/* No gate: verifying a broken seal is when it matters most. */}
          <button type="button" className="btn btn-sm" disabled={cmd.busy} onClick={verify}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('تحقّق', 'Vérifier', 'Verify')}
          </button>
          {isOpen && (
            <button type="button" className="btn btn-sm" disabled={cmd.busy}
              onClick={() => setVoidReason(voidReason === null ? '' : null)}>
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              {t('إلغاء الحزمة', 'Annuler', 'Void')}
            </button>
          )}
          {isOpen && pkg.documents.length === 0 && (
            <button type="button" className={`btn btn-sm ${confirmDelete ? 'btn-danger' : ''}`}
              disabled={cmd.busy}
              onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return; }
                void cmd.run(() => dmsCommands.removePackage(pkg.id), {
                  onSuccess: () => { onClose(); onChanged(); },
                });
              }}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {confirmDelete ? t('تأكيد', 'Confirmer', 'Confirm') : t('حذف', 'Supprimer', 'Delete')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t('إغلاق', 'Fermer', 'Close')}
          </button>
        </>
      }
    >
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="grid gap-3 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <span>
          <span className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('الوثائق', 'Documents', 'Documents')}
          </span>
          <span className="tabular text-[var(--text-primary)]">{fmtInt(pkg.document_count)}</span>
        </span>
        <span>
          <span className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('الختم', 'Scellé le', 'Sealed')}
          </span>
          <span className="text-[var(--text-primary)]">
            {pkg.sealed_at ? `${fmtDateTime(pkg.sealed_at)} · ${actorLabel(pkg.sealed_by)}` : DASH}
          </span>
        </span>
        <span>
          <span className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('بصمة الختم', 'Empreinte', 'Seal digest')}
          </span>
          <ChecksumChip hash={pkg.seal_checksum} label={t('بصمة الختم', 'Empreinte du sceau', 'Seal digest')} />
        </span>
        <span>
          <span className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('أُنشئت', 'Créé', 'Created')}
          </span>
          <span className="text-[var(--text-primary)]">
            {`${fmtDateTime(pkg.created_at)} · ${actorLabel(pkg.created_by)}`}
          </span>
        </span>
      </div>

      {pkg.notes && <p className="mt-3 text-[12px] text-[var(--text-secondary)]">{pkg.notes}</p>}

      {notApproved.length > 0 && isOpen && (
        <p className="mt-3 text-[12px] text-[var(--warning)]">
          {t(
            `${notApproved.length} وثيقة غير معتمدة تمنع الختم`,
            `${notApproved.length} document(s) non approuvé(s) empêchent le scellement`,
            `${notApproved.length} document(s) are not approved, which blocks the seal`,
          )}
        </p>
      )}
      {pkg.drifted_documents > 0 && (
        <p className="mt-2 text-[12px] text-[var(--danger)]">
          {t(
            `${pkg.drifted_documents} وثيقة لم تعد على النسخة المختومة`,
            `${pkg.drifted_documents} document(s) ne sont plus sur la version scellée`,
            `${pkg.drifted_documents} member(s) are no longer on the version that was sealed`,
          )}
        </p>
      )}

      {editing && (
        <div className="mt-4">
          <PackageForm
            pkg={pkg}
            busy={cmd.busy}
            onCancel={() => setEditing(false)}
            onSave={async (draft) => {
              const ok = await cmd.run(() => dmsCommands.updatePackage(pkg.id, draft), {
                notice: t('تم التحديث', 'Mis à jour', 'Updated'), onSuccess: after,
              });
              if (ok) setEditing(false);
            }}
          />
        </div>
      )}

      {voidReason !== null && (
        <form
          className="mt-4 space-y-2 rounded-lg border border-[var(--border)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void cmd.run(() => dmsCommands.voidPackage(pkg.id, voidReason.trim()), {
              notice: t('أُلغيت الحزمة', 'Dossier annulé', 'Package voided'),
              onSuccess: async () => { setVoidReason(null); await after(); },
            });
          }}
        >
          <Field
            label={t('سبب الإلغاء', "Motif de l'annulation", 'Reason for voiding')}
            hint={t('يُضاف إلى ملاحظات الحزمة', 'Ajouté aux notes du dossier', "Appended to the package's notes")}
          >
            <input className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
              disabled={cmd.busy} autoFocus />
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-danger btn-sm"
              disabled={cmd.busy || voidReason.trim() === ''}>
              {t('إلغاء الحزمة', 'Annuler le dossier', 'Void package')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={cmd.busy}
              onClick={() => setVoidReason(null)}>
              {t('تراجع', 'Retour', 'Cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4">
        <MemberTable documents={pkg.documents} canEdit={isOpen} busy={cmd.busy}
          onRemove={(documentId) => setMember(documentId, false)} />
      </div>

      {picking && isOpen && (
        <DocumentPicker excludeIds={memberIds} busy={cmd.busy}
          onAdd={(documentId) => setMember(documentId, true)} />
      )}

      {verification && <VerificationReport result={verification} />}
    </Panel>
  );
}



