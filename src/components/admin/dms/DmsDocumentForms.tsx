/**
 * The two forms the document panel opens over itself: the reason a reviewer is
 * sending something back, and the metadata edit.
 *
 * They live together because they are the only places in the DMS where a screen
 * composes a payload rather than pressing a button, and both are governed by the
 * same server rule -- what the command will refuse. The reason text cannot be empty
 * and the metadata edit cannot happen while the document is UNDER_REVIEW, in both
 * cases because the RPC raises, not because the form is being polite.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import type { DmsConfidentiality, DmsDocumentRow } from '@/types/dms';
import { Field, Panel } from './atoms';
import { useDmsI18n, useDmsLabels } from './dmsFormat';

const CONFIDENTIALITIES: readonly DmsConfidentiality[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

interface MetadataPatch {
  title?: string | null; description?: string | null; documentType?: string | null;
  confidentiality?: DmsConfidentiality | null; issuedOn?: string | null;
  expiresOn?: string | null; expiryNoticeDays?: number | null; clearExpiry?: boolean;
}

/** REJECTED and CHANGES_REQUESTED both need text, and the server enforces it:
 *  reject_dms_document_command and request_dms_changes_command raise 22023 on an
 *  empty reason, so the submit button stays disabled until there is one. */
export function ReasonForm({ kind, busy, onCancel, onConfirm }: {
  kind: 'REJECT' | 'CHANGES';
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void | Promise<void>;
}) {
  const { t } = useDmsI18n();
  const [text, setText] = useState('');
  const isReject = kind === 'REJECT';
  return (
    <Panel title={isReject
      ? t('سبب الرفض', 'Motif du rejet', 'Rejection reason')
      : t('التعديلات المطلوبة', 'Modifications demandées', 'Requested changes')}
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void onConfirm(text.trim()); }}>
        <Field
          label={isReject ? t('السبب', 'Motif', 'Reason') : t('المطلوب', 'À corriger', 'What to change')}
          hint={t('يظهر لمن أرسل الوثيقة', "Visible par l'auteur", 'Shown to whoever submitted it')}
        >
          <textarea className="input min-h-[64px]" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        <div className="flex items-center gap-2">
          <button type="submit" className={`btn btn-sm ${isReject ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy || text.trim() === ''}>
            {isReject ? t('رفض', 'Rejeter', 'Reject') : t('إرسال الطلب', 'Envoyer', 'Send request')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            {t('إلغاء', 'Annuler', 'Cancel')}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Metadata editing, one named column at a time. The command takes null to mean
 * "leave it alone", which is why clearing the expiry date needs its own boolean --
 * there is no other way to say "set this to null" through a call whose nulls are
 * all no-ops.
 *
 * Refused outright by the server while the document is UNDER_REVIEW: the reviewer
 * has to be looking at the same document the submitter sent.
 */
export function MetadataForm({ doc, busy, onCancel, onSave }: {
  doc: DmsDocumentRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: MetadataPatch, tags: string[] | null) => void | Promise<void>;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const [title, setTitle] = useState(doc.title);
  const [documentType, setDocumentType] = useState(doc.document_type);
  const [description, setDescription] = useState(doc.description ?? '');
  const [confidentiality, setConfidentiality] = useState<DmsConfidentiality>(doc.confidentiality);
  const [issuedOn, setIssuedOn] = useState(doc.issued_on ?? '');
  const [expiresOn, setExpiresOn] = useState(doc.expires_on ?? '');
  const [noticeDays, setNoticeDays] = useState(String(doc.expiry_notice_days));
  const [tags, setTags] = useState(doc.tags.join(', '));

  const locked = doc.review_status === 'UNDER_REVIEW';
  const nextTags = tags.split(',').map((s) => s.trim()).filter(Boolean);
  const tagsChanged = nextTags.join(' ') !== doc.tags.join(' ');

  const submit = () => {
    void onSave({
      title: title.trim() || null,
      documentType: documentType.trim().toUpperCase() || null,
      // description is `coalesce(p_description, description)` server-side, so null
      // means "leave it" and '' means "empty it". Sending it only when it changed
      // keeps an untouched field out of the update entirely.
      description: description !== (doc.description ?? '') ? description : null,
      confidentiality,
      issuedOn: issuedOn || null,
      expiresOn: expiresOn || null,
      expiryNoticeDays: Number(noticeDays) || null,
      clearExpiry: doc.expires_on !== null && expiresOn === '',
    }, tagsChanged ? nextTags : null);
  };

  return (
    <Panel
      title={t('تعديل البيانات', 'Modifier les métadonnées', 'Edit metadata')}
      subtitle={locked
        ? t(
          'الوثيقة قيد المراجعة — اطلب تعديلات أولاً',
          'Document en révision — demandez des modifications',
          'The document is under review; request changes first',
        )
        : undefined}
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('العنوان', 'Titre', 'Title')}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy || locked} />
          </Field>
          <Field label={t('النوع', 'Type', 'Document type')}>
            <input className="input" value={documentType} onChange={(e) => setDocumentType(e.target.value)}
              disabled={busy || locked} />
          </Field>
        </div>
        <Field label={t('الوصف', 'Description', 'Description')}>
          <textarea className="input min-h-[64px]" value={description}
            onChange={(e) => setDescription(e.target.value)} disabled={busy || locked} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('السرية', 'Confidentialité', 'Confidentiality')}>
            <Select className="input" value={confidentiality} disabled={busy || locked}
              onChange={(e) => setConfidentiality(e.target.value as DmsConfidentiality)}>
              {CONFIDENTIALITIES.map((c) => <option key={c} value={c}>{labels.confidentiality[c]}</option>)}
            </Select>
          </Field>
          <Field label={t('تاريخ الإصدار', 'Émis le', 'Issued on')}>
            <input type="date" className="input" value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)} disabled={busy || locked} />
          </Field>
          <Field
            label={t('تاريخ الانتهاء', 'Expire le', 'Expires on')}
            hint={doc.expires_on && expiresOn === ''
              ? t('سيُزال تاريخ الانتهاء', "L'expiration sera retirée", 'The expiry date will be cleared')
              : undefined}
          >
            <input type="date" className="input" value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)} disabled={busy || locked} />
          </Field>
          <Field label={t('التنبيه قبل (يوم)', 'Préavis (jours)', 'Notice (days)')}>
            <input type="number" min={0} max={365} className="input" value={noticeDays}
              onChange={(e) => setNoticeDays(e.target.value)} disabled={busy || locked} />
          </Field>
        </div>
        {/* Tags stay editable while the rest is locked: set_dms_document_tags_command
            has no UNDER_REVIEW guard, because filing a document under a new label is
            not a change to what the reviewer is reading. */}
        <Field label={t('الوسوم', 'Étiquettes', 'Tags')}
          hint={t('مفصولة بفواصل', 'Séparées par des virgules', 'Comma separated')}>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} />
        </Field>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || locked || title.trim() === ''}>
            {t('حفظ', 'Enregistrer', 'Save')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t('إلغاء', 'Annuler', 'Cancel')}
          </button>
        </div>
      </form>
    </Panel>
  );
}
