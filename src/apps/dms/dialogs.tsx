/**
 * Every question this app asks, and the fourteen shapes an answer arrives in.
 *
 * `shell.ts` holds the fourteen-member `DmsDialog` union and the twelve `commit*` guards that
 * decide whether an answer is sendable. This file is the other half — the controls a person
 * types into, one branch per member, behind a single exported host. `App.tsx` mounts
 * `<DmsDialogHost shell={shell} />` once and never asks which dialog is open.
 *
 * Named `DmsDialogHost` and not `DmsDialogs` because `shell.ts` already exports an interface by
 * that name. CRM reached the same collision first and resolved it the same way.
 *
 * One rule governs the whole file, and it is why `disabled` is threaded through the shared
 * frame rather than computed inside it: **a dialog's primary button is dark under exactly the
 * condition its commit refuses.** `commitRelate` refuses a blank target and refuses a document
 * related to itself, so the Relate button is dark under precisely those two conditions.
 * Anything looser and a click does nothing while the dialog stays open, which reads as a broken
 * app; anything tighter and a reviewer is locked out of an answer the server would have taken.
 * Three commits deliberately carry no guard at all — `metadata`, `tags` and `failJob` — so
 * their buttons are never dark: an emptied tag box is a real instruction, and "it did not
 * work" is a complete statement.
 *
 * Upload is the case that earns the rule. Its predicate is `toUploadDraft(form) === null` — the
 * converter itself, not a re-reading of it — because two fields are required and only the
 * converter knows which: the bytes, and the document type the whole library sorts by. A
 * hand-written `form.file === null` would have shipped a live Upload button that silently did
 * nothing for a workspace that had not yet chosen a filing type.
 *
 * Six of the fourteen collect one string and nothing else, and the union gives all six the same
 * key, `text`. They share one component and one setter — `Words` below — differing only in the
 * verb on the button, whether an empty answer is refusable, and whether the string is prose, a
 * line, or a value copied off a document.
 *
 * Two of the fourteen ask nothing. `preview` and `verify` are readings: they carry no primary
 * button, their one button says *Close* rather than *Cancel*, and neither can re-request,
 * because `DmsShell` deliberately withholds `setPreview` and `setVerify` — the command path
 * owns those, and a dialog that could refetch would be a second way to spend a syscall.
 */
import { useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { Copy, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  fmt,
  InfoBar,
  Input,
  PropertyRow,
  Select,
  Spinner,
  TextArea,
  useLocale,
  type Localized,
  type SelectOption,
} from '@/platform/sdk';
import { Hash, Stack, StateChip } from './cells';
import {
  CONFIDENTIALITY_LABEL,
  DOC_RELATION_LABEL,
  LINK_ENTITY_LABEL,
  LINK_RELATION_LABEL,
  REVIEW_LABEL,
} from './labels';
import { REVIEW_TONE } from './tones';
import {
  toUploadDraft,
  type DmsShell,
  type LinkForm,
  type MetaForm,
  type PackForm,
  type RelateForm,
  type UploadForm,
} from './shell';
import {
  DMS_ALLOWED_MIME,
  DMS_MAX_BYTES,
  type DmsDrift,
  type DmsVerification,
} from './types';
import type { DmsBusy } from './actions';

/**
 * A label table, offered as a select.
 *
 * The table *is* the option list. `labels.ts` authors each `Record` in the migration's own order
 * — `LINK_ENTITY_LABEL`'s doc says so in as many words — and `Object.keys` returns non-numeric
 * keys in insertion order, so the file that translates a union is also the file that orders it.
 * Nothing here can fall out of step with the union: those tables are exhaustive over it, so a
 * relation added to a CHECK constraint appears in this select the moment somebody translates it,
 * and one that is never translated fails typecheck in `labels.ts` rather than quietly going
 * unofferable here.
 *
 * `t` is applied at this call rather than by the control because `SelectOption.label` is a
 * `string`, not a `ReactNode`.
 */
function choices<K extends string>(
  table: Readonly<Record<K, Localized>>,
  t: (text: Localized) => string,
): readonly SelectOption[] {
  return Object.keys(table).map((key) => ({ value: key, label: t(table[key as K]) }));
}

/**
 * What a `<select>` hands back, narrowed to the union it was built from.
 *
 * `Select.onChange` yields a bare `string` and the form fields these write into are typed
 * unions, so something has to bridge the two. The membership test can never actually fail — the
 * only values in the control are the keys `choices` just read off the same table — so this is
 * not defensive code. It is here so that no bare cast is written on a form patch, which is the
 * one place a genuinely wrong token would stay invisible until Postgres refused the insert.
 */
function oneOf<K extends string>(
  table: Readonly<Record<K, unknown>>,
  value: string,
  fallback: K,
): K {
  return Object.prototype.hasOwnProperty.call(table, value) ? (value as K) : fallback;
}

interface AskProps {
  readonly shell: DmsShell;
  readonly title: string;
  /** The verb on the primary button — *Upload*, *Reject*, *Seal*. Never *OK*. */
  readonly action: string;
  /** The one commit this dialog owns, so a slow sibling cannot make this button spin. */
  readonly commit: DmsBusy;
  readonly onCommit: () => void;
  /**
   * The commit's own refusal, passed in rather than re-derived here. See the file header: this
   * is the whole discipline, and every branch below quotes its guard from `useDmsCommits`.
   */
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /** 560px, for the two forms that hold more than four inputs. */
  readonly wide?: boolean;
  readonly children: ReactNode;
}

/**
 * The frame the twelve committing dialogs share.
 *
 * `secondaryLabel` is passed everywhere. The SDK's default is the English literal `'Cancel'`,
 * which is the right word in exactly one of this app's three languages.
 */
function Ask({ shell, title, action, commit, onCommit, disabled, danger, wide, children }: AskProps) {
  const { tr } = useLocale();
  return (
    <Dialog
      open
      title={title}
      width={wide === true ? 560 : undefined}
      onClose={shell.closeDialog}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: action,
        onClick: onCommit,
        disabled,
        busy: shell.busy === commit,
        danger,
      }}
    >
      <div style={{ display: 'grid', gap: 10 }}>{children}</div>
    </Dialog>
  );
}

interface ShowProps {
  readonly shell: DmsShell;
  readonly title: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}

/**
 * A dialog with nothing to agree to.
 *
 * The two readings carry no primary button, so their one button says *Close* — there is nothing
 * to cancel. Escape closes it too, which the SDK's `Dialog` already handles.
 */
function Show({ shell, title, wide, children }: ShowProps) {
  const { tr } = useLocale();
  return (
    <Dialog
      open
      title={title}
      width={wide === true ? 560 : undefined}
      onClose={shell.closeDialog}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
    >
      <div style={{ display: 'grid', gap: 10 }}>{children}</div>
    </Dialog>
  );
}

/** How the one string is typed: prose, a line, or a value read off a document. */
type Box = 'prose' | 'line' | 'code';

interface WordsProps {
  readonly shell: DmsShell;
  readonly title: string;
  readonly action: string;
  readonly commit: DmsBusy;
  readonly onCommit: () => void;
  readonly label: string;
  readonly hint?: string;
  readonly text: string;
  /** Whether the commit refuses an empty string. Three of the six do not. */
  readonly required: boolean;
  readonly box: Box;
  readonly danger?: boolean;
  /**
   * What is being acted on, named above the control.
   *
   * The other eight dialogs open with a `PropertyRow` holding the record's name, and these six
   * would be the only ones that do not — which matters most exactly where it is missing, on the
   * three that refuse a document or void a dossier. A blank value draws nothing rather than a
   * row with a dash in it: an engine that never named itself is not worth a line.
   */
  readonly record?: { readonly label: string; readonly value: string };
}

/**
 * The six dialogs that collect one string.
 *
 * Tags, a rejection reason, the changes being asked for, why a package was voided, a corrected
 * field value, and why an extraction run is being written off. The union gives all six the same
 * `text` key, so `shell.setText` serves all six and each setter re-checks its own member inside
 * the updater — a keystroke in flight when the dialog changed would otherwise write a rejection
 * reason into a package's name.
 *
 * `onEnter` commits from the two single-line boxes. It is wired unconditionally: the commit
 * re-checks its own guard, so Enter on an empty required box is a no-op that leaves the dialog
 * standing, which is the same answer as a dark button.
 */
function Words(props: WordsProps) {
  const { shell, text, required, box, onCommit, record } = props;
  return (
    <Ask
      shell={shell}
      title={props.title}
      action={props.action}
      commit={props.commit}
      onCommit={onCommit}
      disabled={required && text.trim() === ''}
      danger={props.danger}
    >
      {record === undefined || record.value === '' ? null : (
        <PropertyRow label={record.label}>{record.value}</PropertyRow>
      )}
      <Field label={props.label} hint={props.hint} required={required}>
        {box === 'prose' ? (
          <TextArea value={text} onChange={shell.setText} rows={3} />
        ) : (
          <Input
            value={text}
            onChange={shell.setText}
            mono={box === 'code'}
            onEnter={onCommit}
            onEscape={shell.closeDialog}
          />
        )}
      </Field>
    </Ask>
  );
}

/** Two short inputs on one line, so a form of ten controls is not a column of ten. */
function Pair({ children }: { readonly children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}

interface UploadProps {
  readonly shell: DmsShell;
  readonly form: UploadForm;
}

/**
 * Bytes arriving, either as a new document or as the next version of one.
 *
 * One form serves both because the kernel has one path for both: `documentId` set means the
 * bytes join an existing document's history, and `newVersionForm` has already copied that
 * document's type, confidentiality and dates forward so the reviewer confirms rather than
 * retypes. Only the title of the dialog and the verb on the button distinguish the two.
 *
 * `accept` advises and does not refuse. `DMS_ALLOWED_MIME` is the picker's filter, not a
 * validation — the kernel's `docs.upload` deliberately carries no allow-list because the bucket
 * owns that decision, and the same is true of the size: an oversize file gets a warning here and
 * a refusal from the bucket, not a dark button, because the button's one predicate is the
 * commit's and `toUploadDraft` does not weigh bytes.
 *
 * The raw `<input type="file">` is not an SDK control because there is no SDK control for it:
 * `InputProps.onChange` is `(next: string) => void`, and a file is not a string. The DOM `File`
 * is licensed against the ambient-capability wall by `actions.ts`, which says so at the syscall.
 */
function UploadDialog({ shell, form }: UploadProps) {
  const { lang, t, tr } = useLocale();
  const version = form.documentId !== null;
  const oversize = form.file !== null && form.file.size > DMS_MAX_BYTES;
  return (
    <Ask
      shell={shell}
      title={
        version
          ? tr('نسخة جديدة', 'Nouvelle version', 'New version')
          : tr('رفع مستند', 'Téléverser un document', 'Upload document')
      }
      action={version ? tr('إضافة النسخة', 'Ajouter', 'Add version') : tr('رفع', 'Téléverser', 'Upload')}
      commit="upload"
      onCommit={shell.commitUpload}
      disabled={toUploadDraft(form) === null}
      wide
    >
      <Field
        label={tr('الملف', 'Fichier', 'File')}
        required
        hint={
          form.file === null
            ? tr(
                `الحجم الأقصى ${fmt.bytes(DMS_MAX_BYTES, lang)}`,
                `Taille maximale ${fmt.bytes(DMS_MAX_BYTES, lang)}`,
                `Maximum ${fmt.bytes(DMS_MAX_BYTES, lang)}`,
              )
            : `${form.file.name} · ${fmt.bytes(form.file.size, lang)}`
        }
      >
        <input
          type="file"
          accept={DMS_ALLOWED_MIME.join(',')}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            shell.setUpload({ file: event.target.files?.[0] ?? null })
          }
          style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}
        />
      </Field>
      {oversize ? (
        <InfoBar tone="warning" title={tr('ملف كبير', 'Fichier volumineux', 'Large file')}>
          {tr(
            'قد يرفض المخزن هذا الحجم.',
            'Le stockage peut refuser cette taille.',
            'Storage may refuse a file this size.',
          )}
        </InfoBar>
      ) : null}
      <Field
        label={tr('العنوان', 'Titre', 'Title')}
        hint={tr('يُؤخذ من اسم الملف', 'Repris du nom du fichier', 'Defaults to the file name')}
      >
        <Input
          value={form.title}
          onChange={(next) => shell.setUpload({ title: next })}
          placeholder={form.file === null ? '' : form.file.name}
        />
      </Field>
      <Field label={tr('نوع المستند', 'Type de document', 'Document type')} required>
        <Input
          value={form.documentType}
          onChange={(next) => shell.setUpload({ documentType: next })}
          placeholder="PASSPORT_SCAN"
        />
      </Field>
      <Pair>
        <Field label={tr('السرية', 'Confidentialité', 'Confidentiality')}>
          <Select
            value={form.confidentiality}
            onChange={(next) =>
              shell.setUpload({ confidentiality: oneOf(CONFIDENTIALITY_LABEL, next, 'INTERNAL') })
            }
            options={choices(CONFIDENTIALITY_LABEL, t)}
          />
        </Field>
        <Field label={tr('تنبيه قبل (أيام)', 'Préavis (jours)', 'Notice (days)')}>
          <Input
            value={form.noticeDays}
            onChange={(next) => shell.setUpload({ noticeDays: next })}
            type="number"
            min={0}
          />
        </Field>
      </Pair>
      <Pair>
        <Field label={tr('تاريخ الإصدار', 'Date d’émission', 'Issued on')}>
          <Input
            value={form.issuedOn}
            onChange={(next) => shell.setUpload({ issuedOn: next })}
            type="date"
          />
        </Field>
        <Field label={tr('تاريخ الانتهاء', 'Date d’expiration', 'Expires on')}>
          <Input
            value={form.expiresOn}
            onChange={(next) => shell.setUpload({ expiresOn: next })}
            type="date"
          />
        </Field>
      </Pair>
      <Field label={tr('الوسوم', 'Étiquettes', 'Tags')} hint={tr('مفصولة بفواصل', 'Séparées par des virgules', 'Comma separated')}>
        <Input value={form.tags} onChange={(next) => shell.setUpload({ tags: next })} />
      </Field>
      <Field label={tr('الوصف', 'Description', 'Description')}>
        <TextArea value={form.description} onChange={(next) => shell.setUpload({ description: next })} rows={2} />
      </Field>
      <Checkbox
        checked={form.queueExtraction}
        onChange={(next) => shell.setUpload({ queueExtraction: next })}
        label={tr('أضف إلى طابور الاستخراج', 'Mettre en file d’extraction', 'Queue for extraction')}
      />
    </Ask>
  );
}

interface MetaProps {
  readonly shell: DmsShell;
  readonly form: MetaForm;
  /** The document's current title, for the heading. `form.title` is the edit in progress. */
  readonly name: string;
}

/**
 * Editing what a document says about itself.
 *
 * The Save button is never dark, because `commitMetadata` refuses nothing: `toMetadataDraft`
 * sends only the fields that hold something, an emptied box is a real instruction to clear that
 * field, and a form where nothing changed is a no-op the server absorbs. There is no answer this
 * dialog can hold that its commit would turn away.
 *
 * `clearExpiry` beats a typed date, and the date input goes dark to say so — `toMetadataDraft`
 * sends `expiresOn: undefined` the moment the box is ticked. Two live controls that disagreed
 * about whether this document expires would be a contradiction the reviewer could not see.
 */
function MetadataDialog({ shell, form, name }: MetaProps) {
  const { t, tr } = useLocale();
  return (
    <Ask
      shell={shell}
      title={tr('تعديل البيانات', 'Modifier les métadonnées', 'Edit metadata')}
      action={tr('حفظ', 'Enregistrer', 'Save')}
      commit="metadata"
      onCommit={shell.commitMetadata}
      wide
    >
      <PropertyRow label={tr('المستند', 'Document', 'Document')}>{name}</PropertyRow>
      <Field label={tr('العنوان', 'Titre', 'Title')}>
        <Input value={form.title} onChange={(next) => shell.setMeta({ title: next })} />
      </Field>
      <Pair>
        <Field label={tr('نوع المستند', 'Type de document', 'Document type')}>
          <Input value={form.documentType} onChange={(next) => shell.setMeta({ documentType: next })} />
        </Field>
        <Field label={tr('السرية', 'Confidentialité', 'Confidentiality')}>
          <Select
            value={form.confidentiality}
            onChange={(next) =>
              shell.setMeta({ confidentiality: oneOf(CONFIDENTIALITY_LABEL, next, 'INTERNAL') })
            }
            options={choices(CONFIDENTIALITY_LABEL, t)}
          />
        </Field>
      </Pair>
      <Pair>
        <Field label={tr('تاريخ الإصدار', 'Date d’émission', 'Issued on')}>
          <Input value={form.issuedOn} onChange={(next) => shell.setMeta({ issuedOn: next })} type="date" />
        </Field>
        <Field label={tr('تنبيه قبل (أيام)', 'Préavis (jours)', 'Notice (days)')}>
          <Input
            value={form.noticeDays}
            onChange={(next) => shell.setMeta({ noticeDays: next })}
            type="number"
            min={0}
          />
        </Field>
      </Pair>
      <Field label={tr('تاريخ الانتهاء', 'Date d’expiration', 'Expires on')}>
        <Input
          value={form.expiresOn}
          onChange={(next) => shell.setMeta({ expiresOn: next })}
          type="date"
          disabled={form.clearExpiry}
        />
      </Field>
      <Checkbox
        checked={form.clearExpiry}
        onChange={(next) => shell.setMeta({ clearExpiry: next })}
        label={tr('هذا المستند لا ينتهي', 'Ce document n’expire pas', 'This document does not expire')}
      />
      <Field label={tr('الوصف', 'Description', 'Description')}>
        <TextArea value={form.description} onChange={(next) => shell.setMeta({ description: next })} rows={2} />
      </Field>
    </Ask>
  );
}

interface LinkProps {
  readonly shell: DmsShell;
  readonly form: LinkForm;
  readonly name: string;
}

/**
 * Attaching a document to something else in the business.
 *
 * Seventeen entity types, in the order the migration's CHECK constraint lists them, and six
 * relations. The id is typed rather than picked because this app cannot see the other seventeen
 * tables — the broker exposes DMS's own views and nothing else, so a booking is a UUID here and
 * the reviewer copies it from the app that owns it. That is also why the field is `mono`: it is a
 * value carried from somewhere, not a phrase.
 *
 * The relation is what the rest of the platform reads. `EVIDENCE_FOR` on a payment is what makes
 * a receipt show up as proof rather than as an attachment, so the default is the weakest of the
 * six — `ABOUT` claims nothing the reviewer did not say.
 */
function LinkDialog({ shell, form, name }: LinkProps) {
  const { t, tr } = useLocale();
  return (
    <Ask
      shell={shell}
      title={tr('ربط بكيان', 'Lier à une entité', 'Link to entity')}
      action={tr('ربط', 'Lier', 'Link')}
      commit="link"
      onCommit={shell.commitLink}
      disabled={form.entityId.trim() === ''}
    >
      <PropertyRow label={tr('المستند', 'Document', 'Document')}>{name}</PropertyRow>
      <Pair>
        <Field label={tr('نوع الكيان', 'Type d’entité', 'Entity type')}>
          <Select
            value={form.entityType}
            onChange={(next) => shell.setLink({ entityType: oneOf(LINK_ENTITY_LABEL, next, 'booking') })}
            options={choices(LINK_ENTITY_LABEL, t)}
          />
        </Field>
        <Field label={tr('العلاقة', 'Relation', 'Relation')}>
          <Select
            value={form.relation}
            onChange={(next) => shell.setLink({ relation: oneOf(LINK_RELATION_LABEL, next, 'ABOUT') })}
            options={choices(LINK_RELATION_LABEL, t)}
          />
        </Field>
      </Pair>
      <Field
        label={tr('معرّف الكيان', 'Identifiant', 'Entity id')}
        required
        hint={tr('يُنسخ من التطبيق المالك', 'Copié depuis l’application propriétaire', 'Copied from the owning app')}
      >
        <Input
          value={form.entityId}
          onChange={(next) => shell.setLink({ entityId: next })}
          mono
          placeholder="00000000-0000-0000-0000-000000000000"
          onEnter={shell.commitLink}
          onEscape={shell.closeDialog}
        />
      </Field>
      <Field label={tr('ملاحظة', 'Note', 'Note')}>
        <Input value={form.note} onChange={(next) => shell.setLink({ note: next })} />
      </Field>
    </Ask>
  );
}

interface RelateProps {
  readonly shell: DmsShell;
  readonly form: RelateForm;
  /** This document's own id — the one target the commit refuses. */
  readonly id: string;
  readonly name: string;
}

/**
 * Pointing one document at another.
 *
 * Two refusals, both quoted from `commitRelate`: a blank target, and this document itself. The
 * second is why `id` is a prop rather than something the form carries — a document that supersedes
 * itself would pass every CHECK constraint in the migration and read as a cycle forever after, so
 * the dialog marks the box invalid and says which mistake it is rather than only going dark.
 *
 * `SUPERSEDES` is the one relation the server acts on: `relateDocuments` moves the target to
 * `SUPERSEDED` when it is chosen, and the other six are recorded and nothing more. The hint says
 * so, because the difference between "this replaces that" and "this supports that" is a review
 * state the reviewer cannot take back from here.
 */
function RelateDialog({ shell, form, id, name }: RelateProps) {
  const { t, tr } = useLocale();
  const target = form.toDocumentId.trim();
  const self = target !== '' && target === id;
  return (
    <Ask
      shell={shell}
      title={tr('ربط بمستند', 'Lier à un document', 'Relate to document')}
      action={tr('ربط', 'Lier', 'Relate')}
      commit="relate"
      onCommit={shell.commitRelate}
      disabled={target === '' || self}
    >
      <PropertyRow label={tr('المستند', 'Document', 'Document')}>{name}</PropertyRow>
      <Field
        label={tr('المستند الهدف', 'Document cible', 'Target document')}
        required
        hint={
          self
            ? tr(
                'لا يمكن ربط مستند بنفسه.',
                'Un document ne peut pas être lié à lui-même.',
                'A document cannot be related to itself.',
              )
            : tr('معرّف المستند', 'Identifiant du document', 'Document id')
        }
      >
        <Input
          value={form.toDocumentId}
          onChange={(next) => shell.setRelate({ toDocumentId: next })}
          mono
          invalid={self}
          placeholder="00000000-0000-0000-0000-000000000000"
          onEnter={shell.commitRelate}
          onEscape={shell.closeDialog}
        />
      </Field>
      <Field
        label={tr('العلاقة', 'Relation', 'Relation')}
        hint={tr(
          'يضع «يحل محل» المستند الهدف في حالة مُستبدل.',
          '« Remplace » fait passer la cible à l’état remplacé.',
          'Choosing supersedes moves the target to superseded.',
        )}
      >
        <Select
          value={form.relation}
          onChange={(next) => shell.setRelate({ relation: oneOf(DOC_RELATION_LABEL, next, 'SUPPORTS') })}
          options={choices(DOC_RELATION_LABEL, t)}
        />
      </Field>
      <Field label={tr('ملاحظة', 'Note', 'Note')}>
        <Input value={form.note} onChange={(next) => shell.setRelate({ note: next })} />
      </Field>
    </Ask>
  );
}

interface PackProps {
  readonly shell: DmsShell;
  readonly form: PackForm;
  /** Null while creating a package; the package's id while editing one. */
  readonly id: string | null;
}

/**
 * A dossier — the thing that gets sealed and handed to a ministry.
 *
 * One form for both verbs, because a package holds four strings whether it is being created or
 * corrected. The name is the only one the commit insists on, and only when creating: `createPackage`
 * has nothing to file the dossier under without it, while `updatePackage` treats a blank box as
 * "leave it as it was" and the hint says so rather than letting a reviewer wonder whether an empty
 * field is about to erase the name.
 */
function PackageDialog({ shell, form, id }: PackProps) {
  const { tr } = useLocale();
  const creating = id === null;
  return (
    <Ask
      shell={shell}
      title={creating ? tr('حزمة جديدة', 'Nouveau dossier', 'New package') : tr('تعديل الحزمة', 'Modifier le dossier', 'Edit package')}
      action={creating ? tr('إنشاء', 'Créer', 'Create') : tr('حفظ', 'Enregistrer', 'Save')}
      commit="package"
      onCommit={shell.commitPackage}
      disabled={creating && form.name.trim() === ''}
    >
      <Field
        label={tr('الاسم', 'Nom', 'Name')}
        required={creating}
        hint={creating ? undefined : tr('اتركه فارغًا لعدم التغيير', 'Laisser vide pour ne pas changer', 'Leave blank to keep it')}
      >
        <Input
          value={form.name}
          onChange={(next) => shell.setPack({ name: next })}
          onEnter={shell.commitPackage}
          onEscape={shell.closeDialog}
        />
      </Field>
      <Pair>
        <Field label={tr('الغرض', 'Objet', 'Purpose')}>
          <Input value={form.purpose} onChange={(next) => shell.setPack({ purpose: next })} />
        </Field>
        <Field label={tr('المرجع', 'Référence', 'Reference')}>
          <Input value={form.reference} onChange={(next) => shell.setPack({ reference: next })} mono />
        </Field>
      </Pair>
      <Field label={tr('ملاحظات', 'Notes', 'Notes')}>
        <TextArea value={form.notes} onChange={(next) => shell.setPack({ notes: next })} rows={3} />
      </Field>
    </Ask>
  );
}

interface MemberProps {
  readonly shell: DmsShell;
  readonly packageId: string | null;
  readonly documentId: string | null;
  readonly text: string;
}

/**
 * Filing one document into one package, from whichever end the reviewer started at.
 *
 * Whichever id arrives null is the select the dialog renders, and it keeps rendering it after the
 * answer lands — which is why the question is frozen at mount rather than re-read from the ids on
 * every keystroke. Opened from a document's inspector the package is the question, opened from a
 * package's row the document is; the commit needs both ends and refuses until it has them, which
 * is the whole of `disabled` here. A select that vanished the moment it was answered would leave
 * a reviewer with a live Add button and no way to see what they had picked.
 *
 * Only OPEN packages are offered, matching the app's own rule at the two openers: a sealed dossier
 * is a closed statement about a set of bytes and `addPackageDocument` will not touch it. When
 * nothing is open the dialog says so rather than showing a select with one empty row in it.
 *
 * The document list is the library **page**, not the library — `model.documents.rows` is capped by
 * the same page size the grid draws. A document that is not on it is filed from the other
 * direction, by opening it and choosing its package, which is why both directions exist.
 *
 * The blank option writes `null` rather than `''`. An empty string is not a missing answer as far
 * as `disabled` can see, and the button would light up over an id the server would reject.
 */
function MemberDialog({ shell, packageId, documentId, text }: MemberProps) {
  const { lang, tr } = useLocale();
  const [asking] = useState(() => ({ pack: packageId === null, doc: documentId === null }));
  const open = shell.model.packages.rows.filter((pack) => pack.status === 'OPEN');
  const blank = tr('اختر…', 'Choisir…', 'Choose…');
  return (
    <Ask
      shell={shell}
      title={tr('إضافة إلى حزمة', 'Ajouter au dossier', 'Add to package')}
      action={tr('إضافة', 'Ajouter', 'Add')}
      commit="member"
      onCommit={shell.commitMember}
      disabled={packageId === null || documentId === null}
    >
      {asking.pack && open.length === 0 ? (
        <InfoBar tone="warning" title={tr('لا حزمة مفتوحة', 'Aucun dossier ouvert', 'No open package')}>
          {tr(
            'كل الحزم مختومة أو ملغاة. أنشئ حزمة جديدة أولًا.',
            'Tous les dossiers sont scellés ou annulés. Créez-en un nouveau.',
            'Every package is sealed or void. Create a new one first.',
          )}
        </InfoBar>
      ) : null}
      {asking.pack ? (
        <Field label={tr('الحزمة', 'Dossier', 'Package')} required>
          <Select
            value={packageId ?? ''}
            onChange={(next) => shell.setMemberEnd({ packageId: next === '' ? null : next })}
            options={[
              { value: '', label: blank },
              ...open.map((pack) => ({
                value: pack.id,
                label: `${pack.name} · ${fmt.integer(pack.documentCount, lang)}`,
              })),
            ]}
          />
        </Field>
      ) : null}
      {asking.doc ? (
        <Field
          label={tr('المستند', 'Document', 'Document')}
          required
          hint={tr('من الصفحة المعروضة', 'Depuis la page affichée', 'From the page on screen')}
        >
          <Select
            value={documentId ?? ''}
            onChange={(next) => shell.setMemberEnd({ documentId: next === '' ? null : next })}
            options={[
              { value: '', label: blank },
              ...shell.model.documents.rows.map((doc) => ({
                value: doc.id,
                label: doc.documentNumber === null ? doc.title : `${doc.documentNumber} · ${doc.title}`,
              })),
            ]}
          />
        </Field>
      ) : null}
      <Field label={tr('ملاحظة', 'Note', 'Note')}>
        <Input value={text} onChange={shell.setText} onEscape={shell.closeDialog} />
      </Field>
    </Ask>
  );
}

const CAPTION = { color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' } as const;

/** Document, sealed digest, current digest, review state — the four columns of a drift row. */
const DRIFT_GRID = '1.6fr 92px 92px 116px';

/** The centred spinner both readings show while their round trip is out. */
function Waiting() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
      <Spinner size={20} />
    </div>
  );
}

interface PreviewProps {
  readonly shell: DmsShell;
  readonly title: string;
  readonly url: string | null;
  readonly loading: boolean;
}

/**
 * A signed link to the bytes, shown rather than followed.
 *
 * There is no `shell.openUrl`. The eight syscalls the ABI exposes are launch, openPath, toast,
 * notify, messageBox, fileDialog and the two clipboard verbs, so the OS cannot navigate on an
 * app's behalf and this dialog does not pretend otherwise: it puts the URL on screen and on the
 * clipboard, and the reviewer opens it themselves.
 *
 * `shell.actions.copy` rather than `copyLink`. The URL in hand was minted when the dialog opened;
 * `copyLink` would mint a second one under a different busy key, leaving two links to the same
 * bytes with two different expiries for no gain.
 *
 * A null url with `loading` false is a failure the action already toasted. The dialog says it
 * again because a reviewer who let the toast pass would otherwise be reading an empty box.
 */
function PreviewDialog({ shell, title, url, loading }: PreviewProps) {
  const { tr } = useLocale();
  return (
    <Show shell={shell} title={title}>
      {loading ? <Waiting /> : null}
      {loading || url !== null ? null : (
        <InfoBar tone="danger" title={tr('لا رابط', 'Aucun lien', 'No link')}>
          {tr(
            'لم يُنشأ رابط لهذه النسخة. قد تكون بايتاتها غير مكتملة.',
            'Aucun lien n’a pu être créé pour cette version. Ses octets sont peut-être incomplets.',
            'No link could be minted for this version. Its bytes may never have been finalized.',
          )}
        </InfoBar>
      )}
      {url === null ? null : (
        <>
          <PropertyRow label={tr('الرابط', 'Lien', 'Link')} mono>
            {url}
          </PropertyRow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button variant="subtle" size="sm" icon={Copy} onClick={() => shell.actions.copy(url)}>
              {tr('نسخ الرابط', 'Copier le lien', 'Copy link')}
            </Button>
            <span style={CAPTION}>
              {tr(
                'رابط مؤقت، يُفتح خارج النظام.',
                'Lien temporaire, à ouvrir hors du système.',
                'Time-limited, and opens outside the OS.',
              )}
            </span>
          </div>
        </>
      )}
    </Show>
  );
}

/**
 * The members that no longer match what was sealed.
 *
 * Both digests are drawn side by side rather than one with a flag, because the question a reviewer
 * has at this point is not *whether* a row moved — the verdict bar above already said that — but
 * which of the two versions they are now holding. `Hash` shortens both ends of a digest for the
 * same reason, and puts the whole thing on the tooltip.
 */
function DriftTable({ rows }: { readonly rows: readonly DmsDrift[] }) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid' }}>
      <div style={{ display: 'grid', gridTemplateColumns: DRIFT_GRID, gap: 8, paddingBottom: 4, ...CAPTION }}>
        <span>{tr('المستند', 'Document', 'Document')}</span>
        <span>{tr('المختوم', 'Scellé', 'Sealed')}</span>
        <span>{tr('الحالي', 'Actuel', 'Current')}</span>
        <span>{tr('المراجعة', 'Revue', 'Review')}</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.documentId}
          style={{
            display: 'grid',
            gridTemplateColumns: DRIFT_GRID,
            gap: 8,
            alignItems: 'center',
            padding: '5px 0',
            borderTop: '1px solid var(--fx-divider)',
          }}
        >
          <Stack title={row.title} caption={row.documentNumber} />
          <Hash hash={row.sealedChecksum} />
          <Hash hash={row.currentChecksum} />
          <StateChip value={row.reviewStatus} tones={REVIEW_TONE} labels={REVIEW_LABEL} />
        </div>
      ))}
    </div>
  );
}

interface VerifyProps {
  readonly shell: DmsShell;
  readonly title: string;
  readonly report: DmsVerification | null;
  readonly loading: boolean;
}

/**
 * Whether a sealed dossier still holds the bytes it was sealed over.
 *
 * This is the one reading in the app that can return bad news, and the whole subsystem exists to
 * produce it: a seal is a checksum over the members' checksums, so recomputing it and finding a
 * different answer means a member changed underneath a statement somebody already handed to a
 * ministry. The verdict is a full-width bar with its own icon rather than a chip, because a broken
 * seal is not a status — it is a finding.
 *
 * An unsealed package short-circuits before the digest rows. `verifyPackage` will answer for one,
 * but there is nothing to compare and printing two empty checksums beside the word *broken* would
 * be a lie about a package that has simply never been closed.
 */
function VerifyDialog({ shell, title, report, loading }: VerifyProps) {
  const { lang, tr } = useLocale();
  const ok = report !== null && report.matches;
  return (
    <Show shell={shell} title={title} wide>
      {loading ? <Waiting /> : null}
      {loading || report !== null ? null : (
        <InfoBar tone="danger" title={tr('تعذّر التحقق', 'Vérification impossible', 'Verify failed')}>
          {tr(
            'لم يُرجع الخادم تقريرًا لهذه الحزمة.',
            'Le serveur n’a retourné aucun rapport pour ce dossier.',
            'The server returned no report for this package.',
          )}
        </InfoBar>
      )}
      {report === null || report.status === 'SEALED' ? null : (
        <InfoBar tone="warning" title={tr('غير مختومة', 'Non scellé', 'Not sealed')}>
          {tr(
            'لا يوجد ختم لمقارنته. اختم الحزمة أولًا.',
            'Aucun sceau à comparer. Scellez d’abord le dossier.',
            'There is no seal to compare against. Seal the package first.',
          )}
        </InfoBar>
      )}
      {report === null || report.status !== 'SEALED' ? null : (
        <>
          <InfoBar
            tone={ok ? 'success' : 'danger'}
            icon={ok ? ShieldCheck : ShieldAlert}
            title={ok ? tr('الختم سليم', 'Sceau intact', 'Seal intact') : tr('الختم مكسور', 'Sceau rompu', 'Seal broken')}
          >
            {ok
              ? tr(
                  'كل عضو هو النسخة التي خُتمت.',
                  'Chaque membre est la version qui a été scellée.',
                  'Every member is the version that was sealed.',
                )
              : tr(
                  'المجموع المحسوب يخالف الختم. تغيّرت الصفوف أدناه بعده.',
                  'La somme recalculée diffère du sceau. Les lignes ci-dessous ont changé depuis.',
                  'The recomputed sum differs from the seal. The rows below changed after it.',
                )}
          </InfoBar>
          <PropertyRow label={tr('خُتمت في', 'Scellé le', 'Sealed at')}>
            {fmt.dateTime(report.sealedAt, lang)}
          </PropertyRow>
          <PropertyRow label={tr('ختم', 'Sceau', 'Seal')} mono>
            <Hash hash={report.sealChecksum} />
          </PropertyRow>
          <PropertyRow label={tr('المحسوب', 'Recalculé', 'Recomputed')} mono>
            <Hash hash={report.recomputedChecksum} />
          </PropertyRow>
          {report.drift.length === 0 ? null : <DriftTable rows={report.drift} />}
        </>
      )}
    </Show>
  );
}

/**
 * Every dialog this app can open, and nothing else.
 *
 * `App.tsx` mounts this once. The switch has all fourteen cases and no `default`, with an explicit
 * `ReactElement | null` return: adding a member to `DmsDialog` then fails to compile here, which is
 * the only way a fifteenth dialog cannot be opened by a command and silently show nothing. The
 * `null` for a closed host is returned before the switch, so the switch itself is total.
 *
 * The six single-string cases quote their guard and their busy key from `useDmsCommits` rather than
 * re-deriving either — see the file header. `record` names what is being acted on, and the label on
 * that row differs by case: four of the six act on a document, one on a package, and two on things
 * inside a document — a field and an engine run.
 */
export function DmsDialogHost({ shell }: { readonly shell: DmsShell }): ReactElement | null {
  const { tr } = useLocale();
  const dialog = shell.dialog;
  if (dialog === null) return null;
  const save = tr('حفظ', 'Enregistrer', 'Save');
  const reason = tr('السبب', 'Motif', 'Reason');
  const docRow = tr('المستند', 'Document', 'Document');
  switch (dialog.kind) {
    case 'tags':
      return (
        <Words
          shell={shell}
          title={tr('الوسوم', 'Étiquettes', 'Tags')}
          action={save}
          commit="tags"
          onCommit={shell.commitTags}
          label={tr('الوسوم', 'Étiquettes', 'Tags')}
          hint={tr('مفصولة بفواصل', 'Séparées par des virgules', 'Comma separated')}
          text={dialog.text}
          required={false}
          box="line"
          record={{ label: docRow, value: dialog.title }}
        />
      );
    case 'reject':
      return (
        <Words
          shell={shell}
          title={tr('رفض المستند', 'Rejeter le document', 'Reject document')}
          action={tr('رفض', 'Rejeter', 'Reject')}
          commit="reject"
          onCommit={shell.commitReject}
          label={reason}
          text={dialog.text}
          required
          box="prose"
          danger
          record={{ label: docRow, value: dialog.title }}
        />
      );
    case 'changes':
      return (
        <Words
          shell={shell}
          title={tr('طلب تعديلات', 'Demander des modifications', 'Request changes')}
          action={tr('إرسال', 'Envoyer', 'Send')}
          commit="requestChanges"
          onCommit={shell.commitChanges}
          label={tr('المطلوب تعديله', 'Ce qui doit changer', 'What needs changing')}
          text={dialog.text}
          required
          box="prose"
          record={{ label: docRow, value: dialog.title }}
        />
      );
    case 'void':
      return (
        <Words
          shell={shell}
          title={tr('إلغاء الحزمة', 'Annuler le dossier', 'Void package')}
          action={tr('إلغاء الحزمة', 'Annuler', 'Void')}
          commit="void"
          onCommit={shell.commitVoid}
          label={reason}
          text={dialog.text}
          required
          box="prose"
          danger
          record={{ label: tr('الحزمة', 'Dossier', 'Package'), value: dialog.title }}
        />
      );
    case 'correct':
      return (
        <Words
          shell={shell}
          title={tr('تصحيح القيمة', 'Corriger la valeur', 'Correct value')}
          action={save}
          commit="field"
          onCommit={shell.commitCorrect}
          label={tr('القيمة', 'Valeur', 'Value')}
          hint={tr(
            'ما يقوله المستند فعلًا',
            'Ce que le document dit réellement',
            'What the document actually says',
          )}
          text={dialog.text}
          required
          box="code"
          record={{ label: tr('الحقل', 'Champ', 'Field'), value: dialog.title }}
        />
      );
    case 'failJob':
      return (
        <Words
          shell={shell}
          title={tr('تعليم التشغيل كفاشل', 'Marquer l’exécution échouée', 'Mark run failed')}
          action={tr('تسجيل', 'Enregistrer', 'Record')}
          commit="record"
          onCommit={shell.commitFailJob}
          label={tr('الملاحظة', 'Note', 'Note')}
          hint={tr('اختيارية', 'Facultative', 'Optional')}
          text={dialog.text}
          required={false}
          box="prose"
          danger
          record={{ label: tr('المحرّك', 'Moteur', 'Engine'), value: dialog.title }}
        />
      );
    case 'upload':
      return <UploadDialog shell={shell} form={dialog.form} />;
    case 'metadata':
      return <MetadataDialog shell={shell} form={dialog.form} name={dialog.title} />;
    case 'link':
      return <LinkDialog shell={shell} form={dialog.form} name={dialog.title} />;
    case 'relate':
      return <RelateDialog shell={shell} form={dialog.form} id={dialog.id} name={dialog.title} />;
    case 'package':
      return <PackageDialog shell={shell} form={dialog.form} id={dialog.id} />;
    case 'member':
      return (
        <MemberDialog
          shell={shell}
          packageId={dialog.packageId}
          documentId={dialog.documentId}
          text={dialog.text}
        />
      );
    case 'preview':
      return (
        <PreviewDialog shell={shell} title={dialog.title} url={dialog.url} loading={dialog.loading} />
      );
    case 'verify':
      return (
        <VerifyDialog
          shell={shell}
          title={dialog.title}
          report={dialog.report}
          loading={dialog.loading}
        />
      );
  }
}
