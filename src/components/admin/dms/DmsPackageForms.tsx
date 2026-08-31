/**
 * The evidence-package form, shared by create and edit because they are the same
 * four fields and the same server rule.
 *
 * `create_dms_evidence_package_command` and `update_dms_evidence_package_command`
 * both raise 22023 on a blank name (`An evidence package needs a name`), so the
 * submit button is gated on it rather than the exception being translated back. The
 * edit command additionally refuses anything that is not OPEN — the caller decides
 * whether to offer the form at all, since a SEALED package's fields are part of the
 * record the seal covers.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import type { DmsEvidencePackage } from '@/types/dms';
import { Field, Panel } from './atoms';
import { useDmsI18n } from './dmsFormat';

export interface PackageDraft {
  name: string;
  reference: string | null;
  purpose: string | null;
  notes: string | null;
}

export function PackageForm({ pkg, busy, onCancel, onSave }: {
  /** Absent when creating. */
  pkg?: DmsEvidencePackage;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: PackageDraft) => void | Promise<void>;
}) {
  const { t } = useDmsI18n();
  const [name, setName] = useState(pkg?.name ?? '');
  const [reference, setReference] = useState(pkg?.reference ?? '');
  const [purpose, setPurpose] = useState(pkg?.purpose ?? '');
  const [notes, setNotes] = useState(pkg?.notes ?? '');

  return (
    <Panel
      title={pkg
        ? t('تعديل الحزمة', 'Modifier le dossier', 'Edit package')
        : t('حزمة أدلة جديدة', 'Nouveau dossier de preuves', 'New evidence package')}
      subtitle={t(
        'الحزمة تُنشأ مفتوحة، ثم تُضاف الوثائق، ثم تُختم',
        'Créé ouvert, on ajoute les documents, puis on scelle',
        'Created open, filled with documents, then sealed',
      )}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            name: name.trim(),
            reference: reference.trim() || null,
            purpose: purpose.trim() || null,
            notes: notes.trim() || null,
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('الاسم', 'Nom', 'Name')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
              disabled={busy} autoFocus />
          </Field>
          <Field
            label={t('المرجع', 'Référence', 'Reference')}
            hint={t('رقم الملف أو القضية', 'Numéro de dossier', 'File or case number')}
          >
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)}
              disabled={busy} />
          </Field>
        </div>
        <Field label={t('الغرض', 'Objet', 'Purpose')}>
          <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t('ملاحظات', 'Notes', 'Notes')}>
          <textarea className="input min-h-[56px]" value={notes}
            onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </Field>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || name.trim() === ''}>
            {pkg ? t('حفظ', 'Enregistrer', 'Save') : t('إنشاء', 'Créer', 'Create')}
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
