/**
 * What the document is connected to: the polymorphic edges out to the rest of the
 * platform, and the edges between documents.
 *
 * The two are the same idea with different targets, which is why they share a file
 * and not much else. A link points at any of seventeen entity types with no foreign
 * key behind it, so its target is typed by a column and validated by the command. A
 * relation points at another document, so its target can be picked from a list the
 * user is already allowed to see.
 */
import { useState } from 'react';
import { Link2, Plus, Unlink } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import type {
  DmsDocumentRelation, DmsLink, DmsLinkEntityType, DmsLinkRelation, DmsRelation,
} from '@/types/dms';
import { Field, Panel, Pill } from './atoms';
import { DASH, REVIEW_TONE, useDmsI18n, useDmsLabels } from './dmsFormat';
import { useDmsDocumentRows } from './dmsRows';

const ENTITY_TYPES: readonly DmsLinkEntityType[] = [
  'pilgrim', 'booking', 'group', 'package', 'payment', 'invoice', 'supplier',
  'supplier_bill', 'contract', 'hotel_contract', 'journal_entry', 'crm_customer',
  'crm_quote', 'crm_opportunity', 'staff_profile', 'visa', 'external_operation',
];

const LINK_RELATIONS: readonly DmsLinkRelation[] = [
  'ABOUT', 'EVIDENCE_FOR', 'SIGNED_BY', 'ISSUED_BY', 'INVOICE_FOR', 'CONTRACT_FOR',
];

const DOC_RELATIONS: readonly DmsDocumentRelation[] = [
  'SUPERSEDES', 'SUPPORTS', 'TRANSLATION_OF', 'SIGNED_COPY_OF', 'ATTACHMENT_OF', 'AMENDS', 'RELATED',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the document is about. dms_document_links is deliberately polymorphic --
 * seventeen entity types, no foreign key -- because a passport scan is about a
 * pilgrim and a hotel contract is about a supplier, and one column cannot reference
 * both. The command validates the type against the same list and checks the target
 * is in scope, so an id that names nothing is refused there rather than here.
 */
export function LinksSection({ links, busy, onAdd, onRemove }: {
  links: DmsLink[];
  busy: boolean;
  onAdd: (
    entityType: DmsLinkEntityType, entityId: string, relation: DmsLinkRelation, note: string | null,
  ) => Promise<boolean>;
  onRemove: (linkId: string) => Promise<void>;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const [adding, setAdding] = useState(false);
  const [entityType, setEntityType] = useState<DmsLinkEntityType>('pilgrim');
  const [entityId, setEntityId] = useState('');
  const [relation, setRelation] = useState<DmsLinkRelation>('ABOUT');
  const [note, setNote] = useState('');
  const valid = UUID_RE.test(entityId.trim());

  const add = async () => {
    const ok = await onAdd(entityType, entityId.trim(), relation, note.trim() || null);
    if (ok) { setEntityId(''); setNote(''); setAdding(false); }
  };

  return (
    <Panel
      title={t('الارتباطات', 'Liens', 'Links')}
      actions={
        <button type="button" className="btn btn-sm" onClick={() => setAdding((v) => !v)} disabled={busy}>
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ربط', 'Lier', 'Link')}
        </button>
      }
    >
      {adding && (
        <form className="mb-3 space-y-3 rounded-lg border border-[var(--border)] p-3"
          onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('نوع السجل', "Type d'enregistrement", 'Entity type')}>
              <Select className="input" value={entityType} disabled={busy}
                onChange={(e) => setEntityType(e.target.value as DmsLinkEntityType)}>
                {ENTITY_TYPES.map((k) => <option key={k} value={k}>{labels.linkEntity[k]}</option>)}
              </Select>
            </Field>
            <Field label={t('العلاقة', 'Relation', 'Relation')}>
              <Select className="input" value={relation} disabled={busy}
                onChange={(e) => setRelation(e.target.value as DmsLinkRelation)}>
                {LINK_RELATIONS.map((r) => <option key={r} value={r}>{labels.linkRelation[r]}</option>)}
              </Select>
            </Field>
          </div>
          <Field
            label={t('معرّف السجل', "Identifiant de l'enregistrement", 'Record id')}
            hint={t('UUID من الشاشة المعنية', "UUID pris sur l'écran concerné", 'The UUID from the record’s own screen')}
          >
            <input className="input font-mono" value={entityId} onChange={(e) => setEntityId(e.target.value)}
              disabled={busy} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
          <Field label={t('ملاحظة', 'Note', 'Note')}>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !valid}>
              {t('إضافة', 'Ajouter', 'Add')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)} disabled={busy}>
              {t('إلغاء', 'Annuler', 'Cancel')}
            </button>
          </div>
        </form>
      )}

      {links.length === 0 ? (
        <p className="py-2 text-[13px] text-[var(--text-muted)]">{t('لا ارتباطات', 'Aucun lien', 'No links')}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-[13px] text-[var(--text-primary)]">
                  {labels.linkEntity[link.entity_type]} · {labels.linkRelation[link.relation]}
                </p>
                <p className="truncate font-mono text-[11px] text-[var(--text-muted)]" title={link.entity_id}>
                  {link.entity_id}
                </p>
                {link.note && <p className="text-[11px] text-[var(--text-muted)]">{link.note}</p>}
              </div>
              <button type="button" className="btn btn-sm" disabled={busy}
                aria-label={`${t('فك الربط', 'Retirer le lien', 'Remove link')} ${link.entity_id}`}
                onClick={() => { void onRemove(link.id); }}>
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Document-to-document edges, both directions. The picker is the hundred most
 * recently touched documents in scope rather than a free uuid box: a relation is
 * between two things a person can name, and the list is already RLS-filtered.
 *
 * SUPERSEDES is not just an edge -- the command also marks the target SUPERSEDED,
 * which is one of only two ways into that state.
 */
export function RelationsSection({ documentId, relations, busy, onAdd, onRemove }: {
  documentId: string;
  relations: DmsRelation[];
  busy: boolean;
  onAdd: (toId: string, relation: DmsDocumentRelation) => Promise<boolean>;
  onRemove: (relationId: string) => Promise<void>;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const candidates = useDmsDocumentRows({ limit: 100 });
  const [adding, setAdding] = useState(false);
  const [toId, setToId] = useState('');
  const [relation, setRelation] = useState<DmsDocumentRelation>('RELATED');

  const options = candidates.data.filter((d) => d.id !== documentId);

  const add = async () => {
    const ok = await onAdd(toId, relation);
    if (ok) { setToId(''); setAdding(false); }
  };

  return (
    <Panel
      title={t('العلاقات', 'Relations', 'Relations')}
      actions={
        <button type="button" className="btn btn-sm" onClick={() => setAdding((v) => !v)} disabled={busy}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('علاقة', 'Relation', 'Relate')}
        </button>
      }
    >
      {adding && (
        <form className="mb-3 space-y-3 rounded-lg border border-[var(--border)] p-3"
          onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <Field label={t('الوثيقة الأخرى', 'Autre document', 'Other document')}>
            <Select className="input" value={toId} disabled={busy || candidates.loading}
              onChange={(e) => setToId(e.target.value)}>
              <option value="">{t('اختر…', 'Choisir…', 'Choose…')}</option>
              {options.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.document_number ? `${d.document_number} — ${d.title}` : d.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('النوع', 'Type', 'Type')}
            hint={relation === 'SUPERSEDES'
              ? t('سيصبح الهدف مستبدلاً', 'La cible deviendra remplacée', 'The target becomes SUPERSEDED')
              : undefined}
          >
            <Select className="input" value={relation} disabled={busy}
              onChange={(e) => setRelation(e.target.value as DmsDocumentRelation)}>
              {DOC_RELATIONS.map((r) => <option key={r} value={r}>{labels.docRelation[r]}</option>)}
            </Select>
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || toId === ''}>
              {t('إضافة', 'Ajouter', 'Add')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)} disabled={busy}>
              {t('إلغاء', 'Annuler', 'Cancel')}
            </button>
          </div>
        </form>
      )}

      {relations.length === 0 ? (
        <p className="py-2 text-[13px] text-[var(--text-muted)]">{t('لا علاقات', 'Aucune relation', 'No relations')}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {relations.map((rel) => (
            <li key={rel.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-[13px] text-[var(--text-primary)]">
                  <span className="text-[var(--text-muted)]">
                    {rel.direction === 'OUTGOING' ? '→ ' : '← '}
                  </span>
                  {labels.docRelation[rel.relation]} · {rel.title}
                </p>
                <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] tabular">
                  {rel.document_number ?? DASH}
                  <Pill tone={REVIEW_TONE[rel.review_status]}>{labels.review[rel.review_status]}</Pill>
                </p>
              </div>
              <button type="button" className="btn btn-sm" disabled={busy}
                aria-label={`${t('إزالة العلاقة', 'Retirer la relation', 'Remove relation')} ${rel.title}`}
                onClick={() => { void onRemove(rel.id); }}>
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
