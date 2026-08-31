/**
 * Leads: the entry point of the pipeline.
 *
 * Two kinds of write happen here and they are deliberately not the same shape.
 * Editing a lead -- its priority, its score, its next action -- is a patch
 * through update_crm_lead_command. Turning a lead into a customer is NOT: it is
 * convert_crm_lead_command, one transaction that inserts the customer, opens a
 * QUALIFYING opportunity at 25%, writes the first stage-history row and logs the
 * activity. That is why CONVERTED is missing from the status dropdown below:
 * patching the column would leave a lead marked converted with no customer and
 * no opportunity behind it, which is exactly the shape of data that makes a
 * pipeline report lie.
 */
import { useMemo, useState } from 'react';
import { ArrowRightLeft, Plus, Search, Trash2, X } from 'lucide-react';
import GlassDate from '@/components/admin/GlassDate';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner, TableEmpty } from '@/components/admin/ui';
import { crmCommands as crmLeadCommands, crmLifecycleCommands } from '@/services/domainCommands';
import type { CrmLeadPriority, CrmLeadRow, CrmLeadStatus } from '@/types/crm';
import { Field, NoticeBar, Panel, Pill } from './atoms';
import { DASH, fmtDate, fmtDateTime, fmtInt, fmtMoney, isoToday, useCrmI18n } from './crmFormat';
import { useCrmLeadRows, useCrmPackageOptions } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

/** Statuses a person may set by hand. CONVERTED is absent on purpose (see the
 *  file header); LOST is here but goes through the reason prompt below, because
 *  a lost lead with no reason teaches nobody anything. */
const MANUAL_STATUSES: readonly CrmLeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'LOST'];
const FILTER_STATUSES: readonly CrmLeadStatus[] = [...MANUAL_STATUSES, 'CONVERTED'];
const PRIORITIES: readonly CrmLeadPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

interface LeadDraft {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  source: string;
  priority: CrmLeadPriority;
  score: string;
  next_action_at: string;
  notes: string;
}

const EMPTY_DRAFT: LeadDraft = {
  first_name: '', last_name: '', phone: '', email: '',
  source: '', priority: 'MEDIUM', score: '', next_action_at: '', notes: '',
};

const trimmed = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** A score outside 0..100 violates crm_leads_score_range. Checked here so the
 *  button can be disabled instead of the server raising 23514 at the user. */
function scoreOf(raw: string): { value: number | null; valid: boolean } {
  if (raw.trim() === '') return { value: null, valid: true };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) return { value: null, valid: false };
  return { value: n, valid: true };
}

function draftToPayload(draft: LeadDraft): Record<string, unknown> | null {
  // A lead with no name and no phone is not a lead; the create command would
  // insert an unreachable row.
  if (!trimmed(draft.first_name) && !trimmed(draft.last_name) && !trimmed(draft.phone)) return null;
  const score = scoreOf(draft.score);
  if (!score.valid) return null;
  return {
    first_name: trimmed(draft.first_name),
    last_name: trimmed(draft.last_name),
    phone: trimmed(draft.phone),
    email: trimmed(draft.email),
    source: trimmed(draft.source),
    priority: draft.priority,
    score: score.value,
    // Local midnight, not a fabricated hour: the picker collects a day.
    next_action_at: draft.next_action_at ? new Date(`${draft.next_action_at}T00:00:00`).toISOString() : null,
    notes: trimmed(draft.notes),
  };
}

const leadName = (lead: CrmLeadRow): string =>
  [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || lead.phone || lead.id.slice(0, 8);

export function CrmLeadsPanel() {
  const { t } = useCrmI18n();
  const [status, setStatus] = useState<string>('ALL');
  const [term, setTerm] = useState('');
  const rows = useCrmLeadRows({ status, term });
  const cmd = useCrmCommand();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<LeadDraft>(EMPTY_DRAFT);
  const [convertFor, setConvertFor] = useState<CrmLeadRow | null>(null);
  const [lostFor, setLostFor] = useState<CrmLeadRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const payload = useMemo(() => draftToPayload(draft), [draft]);

  const create = async () => {
    if (!payload) return;
    await cmd.run(() => crmLeadCommands.create(payload), {
      notice: t('تم إنشاء العميل المحتمل', 'Prospect créé', 'Lead created'),
      onSuccess: async () => { setDraft(EMPTY_DRAFT); setCreating(false); await rows.refetch(); },
    });
  };

  const setStatusOf = async (lead: CrmLeadRow, next: CrmLeadStatus) => {
    if (next === lead.status) return;
    if (next === 'LOST') { setLostFor(lead); return; }
    // qualified_at is stamped by the conversion path only; a manual move to
    // QUALIFIED records its own timestamp so the funnel can count it.
    const patch: Record<string, unknown> = { status: next };
    if (next === 'QUALIFIED' && !lead.qualified_at) patch.qualified_at = new Date().toISOString();
    await cmd.run(() => crmLeadCommands.update(lead.id, patch), {
      notice: `${leadName(lead)} → ${next}`,
      onSuccess: async () => { await rows.refetch(); },
    });
  };

  const remove = async (lead: CrmLeadRow) => {
    await cmd.run(() => crmLeadCommands.remove(lead.id), {
      notice: t('تم الحذف', 'Supprimé', 'Deleted'),
      onSuccess: async () => { setPendingDelete(null); await rows.refetch(); },
    });
  };

  return (
    <div className="space-y-4">
      {rows.error && <ErrorBanner message={rows.error} onRetry={() => { void rows.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <Panel
        title={t('العملاء المحتملون', 'Prospects', 'Leads')}
        subtitle={t(
          'التحويل ينشئ عميلاً وفرصة في معاملة واحدة',
          'La conversion crée un client et une opportunité en une transaction',
          'Converting creates a customer and an opportunity in one transaction',
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
              onChange={(e) => setStatus(e.target.value)}
              className="input w-auto"
              aria-label={t('الحالة', 'Statut', 'Status')}
            >
              <option value="ALL">{t('كل الحالات', 'Tous les statuts', 'All statuses')}</option>
              {FILTER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('عميل محتمل', 'Prospect', 'New lead')}
            </button>
          </>
        }
      >
        {creating && (
          <LeadForm
            draft={draft}
            onChange={setDraft}
            onSubmit={() => { void create(); }}
            onCancel={() => { setCreating(false); setDraft(EMPTY_DRAFT); }}
            busy={cmd.busy}
            valid={payload !== null}
          />
        )}

        {rows.loading && rows.data.length === 0 ? (
          <Spinner className="p-8" />
        ) : rows.data.length === 0 ? (
          <TableEmpty query={term || undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[900px]">
              <thead>
                <tr>
                  <th>{t('الاسم', 'Nom', 'Name')}</th>
                  <th>{t('الاتصال', 'Contact', 'Contact')}</th>
                  <th>{t('المصدر', 'Source', 'Source')}</th>
                  <th>{t('الحالة', 'Statut', 'Status')}</th>
                  <th>{t('الأولوية', 'Priorité', 'Priority')}</th>
                  <th className="end">{t('النقاط', 'Score', 'Score')}</th>
                  <th>{t('الإجراء التالي', 'Prochaine action', 'Next action')}</th>
                  <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.data.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <p className="font-medium text-[var(--text-primary)]">{leadName(lead)}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{fmtDate(lead.created_at)}</p>
                    </td>
                    <td className="text-[12px]">
                      <p>{lead.phone ?? DASH}</p>
                      <p className="text-[var(--text-muted)]">{lead.email ?? DASH}</p>
                    </td>
                    <td className="text-[12px]">{lead.source ?? DASH}</td>
                    <td>
                      {lead.status === 'CONVERTED' ? (
                        <Pill tone="good">CONVERTED</Pill>
                      ) : (
                        <Select
                          value={lead.status}
                          onChange={(e) => { void setStatusOf(lead, e.target.value as CrmLeadStatus); }}
                          disabled={cmd.busy}
                          className="input w-auto"
                          aria-label={`${leadName(lead)} ${t('الحالة', 'statut', 'status')}`}
                        >
                          {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      )}
                      {lead.lost_reason && (
                        <p className="mt-1 max-w-[180px] text-[11px] text-[var(--text-muted)]">{lead.lost_reason}</p>
                      )}
                    </td>
                    <td>
                      <Pill tone={lead.priority === 'HIGH' ? 'warn' : lead.priority === 'LOW' ? 'neutral' : 'info'}>
                        {lead.priority ?? DASH}
                      </Pill>
                    </td>
                    <td className="end tabular text-end">{fmtInt(lead.score)}</td>
                    <td className="text-[12px] whitespace-nowrap">{fmtDateTime(lead.next_action_at)}</td>
                    <td className="end">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={cmd.busy || lead.status === 'LOST'}
                          title={t('تحويل إلى عميل وفرصة', 'Convertir en client et opportunité', 'Convert to customer + opportunity')}
                          onClick={() => setConvertFor(lead)}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('تحويل', 'Convertir', 'Convert')}
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${pendingDelete === lead.id ? 'btn-danger' : ''}`}
                          disabled={cmd.busy}
                          aria-label={
                            pendingDelete === lead.id
                              ? `${t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm delete')} ${leadName(lead)}`
                              : `${t('حذف', 'Supprimer', 'Delete')} ${leadName(lead)}`
                          }
                          onClick={() => {
                            // Two clicks, not window.confirm: the delete is real and
                            // the second click is the confirmation.
                            if (pendingDelete === lead.id) { void remove(lead); return; }
                            setPendingDelete(lead.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {pendingDelete === lead.id && t('تأكيد', 'Confirmer', 'Confirm')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {lostFor && (
        <LostReasonPanel
          lead={lostFor}
          busy={cmd.busy}
          onCancel={() => setLostFor(null)}
          onConfirm={async (reason) => {
            const ok = await cmd.run(
              () => crmLeadCommands.update(lostFor.id, { status: 'LOST', lost_reason: reason }),
              {
                notice: `${leadName(lostFor)} → LOST`,
                onSuccess: async () => { await rows.refetch(); },
              },
            );
            if (ok) setLostFor(null);
          }}
        />
      )}

      {convertFor && (
        <ConvertPanel
          lead={convertFor}
          busy={cmd.busy}
          onCancel={() => setConvertFor(null)}
          onConfirm={async (opts) => {
            const ok = await cmd.run(() => crmLifecycleCommands.convertLead(convertFor.id, opts), {
              notice: t('تم التحويل: عميل + فرصة', 'Converti : client + opportunité', 'Converted: customer + opportunity'),
              onSuccess: async () => { await rows.refetch(); },
            });
            if (ok) setConvertFor(null);
          }}
        />
      )}
    </div>
  );
}

function LeadForm({ draft, onChange, onSubmit, onCancel, busy, valid }: {
  draft: LeadDraft;
  onChange: (next: LeadDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  valid: boolean;
}) {
  const { t } = useCrmI18n();
  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) => onChange({ ...draft, [key]: value });
  const score = scoreOf(draft.score);
  return (
    <form
      className="mb-4 rounded-lg border border-[var(--border)] p-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('الاسم الأول', 'Prénom', 'First name')}>
          <input className="input" value={draft.first_name} onChange={(e) => set('first_name', e.target.value)} />
        </Field>
        <Field label={t('اللقب', 'Nom', 'Last name')}>
          <input className="input" value={draft.last_name} onChange={(e) => set('last_name', e.target.value)} />
        </Field>
        <Field label={t('الهاتف', 'Téléphone', 'Phone')}>
          <input className="input" value={draft.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
        </Field>
        <Field label={t('البريد', 'E-mail', 'Email')}>
          <input className="input" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label={t('المصدر', 'Source', 'Source')}>
          <input className="input" value={draft.source} onChange={(e) => set('source', e.target.value)} />
        </Field>
        <Field label={t('الأولوية', 'Priorité', 'Priority')}>
          <Select value={draft.priority} onChange={(e) => set('priority', e.target.value as CrmLeadPriority)} className="input">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field
          label={t('النقاط (0-100)', 'Score (0-100)', 'Score (0-100)')}
          hint={score.valid ? undefined : t('يجب أن تكون بين 0 و 100', 'Doit être entre 0 et 100', 'Must be a whole number 0-100')}
        >
          <input className="input" value={draft.score} onChange={(e) => set('score', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label={t('الإجراء التالي', 'Prochaine action', 'Next action')}>
          <GlassDate value={draft.next_action_at} onChange={(e) => set('next_action_at', e.target.value)} className="input" />
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t('ملاحظات', 'Notes', 'Notes')}>
          <textarea className="input min-h-[64px]" value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !valid}>
          {t('حفظ', 'Enregistrer', 'Save')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
        {!valid && (
          <p className="text-[11px] text-[var(--text-muted)]">
            {t('الاسم أو الهاتف مطلوب', 'Un nom ou un téléphone est requis', 'A name or a phone number is required')}
          </p>
        )}
      </div>
    </form>
  );
}

/** LOST needs a reason. Not a database constraint on crm_leads -- a product one:
 *  the campaign ROI screen reads these to explain why a channel underperforms. */
function LostReasonPanel({ lead, busy, onCancel, onConfirm }: {
  lead: CrmLeadRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const { t } = useCrmI18n();
  const [reason, setReason] = useState(lead.lost_reason ?? '');
  return (
    <Panel title={`${t('سبب الخسارة', 'Raison de la perte', 'Lost reason')} — ${leadName(lead)}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => { e.preventDefault(); void onConfirm(reason.trim()); }}
      >
        <Field label={t('السبب', 'Raison', 'Reason')}>
          <textarea
            className="input min-h-[64px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-danger btn-sm" disabled={busy || reason.trim() === ''}>
            {t('تسجيل كخسارة', 'Marquer perdu', 'Mark lost')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            {t('إلغاء', 'Annuler', 'Cancel')}
          </button>
        </div>
      </form>
    </Panel>
  );
}

interface ConvertOpts {
  packageId?: string | null;
  travelers?: number;
  expectedValueDzd?: number | null;
  expectedCloseDate?: string | null;
  title?: string | null;
}

/** The conversion form. Expected value left blank is not zero: the command
 *  computes package price × travellers, so the preview below shows what the
 *  server will store rather than sending a number the browser guessed. */
function ConvertPanel({ lead, busy, onCancel, onConfirm }: {
  lead: CrmLeadRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (opts: ConvertOpts) => void | Promise<void>;
}) {
  const { t } = useCrmI18n();
  const packages = useCrmPackageOptions();
  const [packageId, setPackageId] = useState('');
  const [travelers, setTravelers] = useState('1');
  const [value, setValue] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [title, setTitle] = useState('');

  const count = Math.max(1, Math.trunc(Number(travelers) || 1));
  const chosen = packages.data.find((p) => p.id === packageId) ?? null;
  const typed = value.trim() === '' ? null : Number(value);
  const derived = chosen?.price_dzd != null ? chosen.price_dzd * count : null;
  const preview = typed !== null && Number.isFinite(typed) ? typed : derived;

  const submit = () => {
    void onConfirm({
      packageId: packageId || null,
      travelers: count,
      expectedValueDzd: typed !== null && Number.isFinite(typed) ? typed : null,
      expectedCloseDate: closeDate || null,
      title: trimmed(title),
    });
  };

  return (
    <Panel
      title={`${t('تحويل', 'Convertir', 'Convert')} — ${leadName(lead)}`}
      subtitle={t(
        'ينشئ عميلاً وفرصة في مرحلة التأهيل باحتمال 25%',
        'Crée un client et une opportunité en QUALIFYING à 25 %',
        'Creates a customer and a QUALIFYING opportunity at 25%',
      )}
    >
      {packages.error && <ErrorBanner message={packages.error} onRetry={() => { void packages.refetch(); }} />}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('الباقة', 'Forfait', 'Package')} hint={t('اختياري', 'Optionnel', 'Optional')}>
            <Select value={packageId} onChange={(e) => setPackageId(e.target.value)} className="input">
              <option value="">{t('بدون باقة', 'Aucun forfait', 'No package')}</option>
              {packages.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {[p.code, p.name].filter(Boolean).join(' · ')} — {fmtMoney(p.price_dzd)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('عدد المعتمرين', 'Voyageurs', 'Travellers')}>
            <input className="input" value={travelers} onChange={(e) => setTravelers(e.target.value)} inputMode="numeric" />
          </Field>
          <Field
            label={t('القيمة المتوقعة', 'Valeur attendue', 'Expected value')}
            hint={t('اتركه فارغاً للحساب من الباقة', 'Vide = calculé depuis le forfait', 'Blank = computed from the package')}
          >
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t('تاريخ الإغلاق المتوقع', 'Clôture prévue', 'Expected close')}>
            <GlassDate value={closeDate} onChange={(e) => setCloseDate(e.target.value)} min={isoToday()} className="input" />
          </Field>
        </div>
        <Field label={t('عنوان الفرصة', 'Titre', 'Opportunity title')} hint={t('اختياري', 'Optionnel', 'Optional')}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {t('تحويل', 'Convertir', 'Convert')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            {t('إلغاء', 'Annuler', 'Cancel')}
          </button>
          <p className="text-[12px] text-[var(--text-muted)]">
            {t('قيمة الفرصة', 'Valeur de l’opportunité', 'Opportunity value')}: <span className="tabular">{preview === null ? DASH : fmtMoney(preview)}</span>
            {chosen?.seats_available != null && (
              <> · {t('مقاعد متاحة', 'Places', 'Seats')}: <span className="tabular">{fmtInt(chosen.seats_available)}</span></>
            )}
          </p>
        </div>
      </form>
    </Panel>
  );
}
