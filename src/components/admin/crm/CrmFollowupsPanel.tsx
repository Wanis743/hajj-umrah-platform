/**
 * Follow-ups: the work list, ordered by when it is due.
 *
 * A follow-up must hang off something -- crm_followups_target_present requires a
 * lead, a customer or an opportunity -- so the form asks which one before it asks
 * anything else. A task attached to nothing is a note, and notes belong on the row
 * they describe.
 *
 * Completion goes through complete_crm_followup rather than a status patch: the
 * table's crm_followups_done_has_time constraint refuses DONE without a
 * completed_at, and the command stamps it and logs the activity in one call.
 * Cancelling is a plain update, because a cancelled task carries no timestamp and
 * no history.
 *
 * due_at is sent as an absolute instant (toISOString), never as the raw
 * datetime-local string: 'YYYY-MM-DDTHH:mm' would be read in the database server's
 * timezone, which is not necessarily the one the person typing it is in.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmFollowupCommands, crmLifecycleCommands } from '@/services/domainCommands';
import type { CrmFollowupPriority, CrmFollowupStatus } from '@/types/crm';
import { Field, NoticeBar, Panel, Pill } from './atoms';
import { DASH, daysUntil, fmtDateTime, type Tone, useCrmI18n } from './crmFormat';
import { useCrmCustomerRows, useCrmFollowupRows, useCrmLeadRows, useCrmOpportunityRows } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

const STATUSES: readonly (CrmFollowupStatus | 'ALL')[] = ['ALL', 'OPEN', 'DONE', 'CANCELLED'];
const PRIORITIES: readonly CrmFollowupPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const PRIORITY_TONE: Record<CrmFollowupPriority, Tone> = {
  LOW: 'neutral', MEDIUM: 'info', HIGH: 'warn', URGENT: 'bad',
};

export function CrmFollowupsPanel() {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const [status, setStatus] = useState<CrmFollowupStatus | 'ALL'>('OPEN');
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const followups = useCrmFollowupRows({ status, limit: 200 });

  const overdue = useMemo(
    () => followups.data.filter((f) => f.status === 'OPEN' && (daysUntil(f.due_at) ?? 0) < 0).length,
    [followups.data],
  );

  const complete = async (id: string) => {
    const ok = await cmd.run(
      () => crmLifecycleCommands.completeFollowup(id, note.trim() === '' ? null : note.trim()),
      {
        notice: t('تمت المتابعة', 'Relance terminée', 'Follow-up completed'),
        onSuccess: async () => { await followups.refetch(); },
      },
    );
    if (ok) { setCompleting(null); setNote(''); }
  };

  const cancel = async (id: string) => {
    const ok = await cmd.run(() => crmFollowupCommands.update(id, { status: 'CANCELLED' }), {
      notice: t('تم إلغاء المتابعة', 'Relance annulée', 'Follow-up cancelled'),
      onSuccess: async () => { await followups.refetch(); },
    });
    if (ok) setCancelling(null);
  };

  return (
    <Panel
      title={t('المتابعات', 'Relances', 'Follow-ups')}
      subtitle={overdue > 0
        ? t(`${overdue} متأخرة`, `${overdue} en retard`, `${overdue} overdue`)
        : t('لا متأخرات', 'Aucun retard', 'Nothing overdue')}
      actions={(
        <>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as CrmFollowupStatus | 'ALL')}
            className="input w-auto"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('متابعة', 'Relance', 'New')}
          </button>
        </>
      )}
    >

      {followups.error && <ErrorBanner message={followups.error} onRetry={() => { void followups.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      {creating && (
        <FollowupForm
          onCancel={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await followups.refetch(); }}
        />
      )}

      {followups.loading && followups.data.length === 0 ? (
        <Spinner className="p-6" />
      ) : followups.data.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا متابعات', 'Aucune relance', 'No follow-ups')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead>
              <tr>
                <th>{t('العنوان', 'Intitulé', 'Title')}</th>
                <th>{t('الاستحقاق', 'Échéance', 'Due')}</th>
                <th>{t('الأولوية', 'Priorité', 'Priority')}</th>
                <th>{t('الحالة', 'Statut', 'Status')}</th>
                <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {followups.data.map((f) => {
                const left = daysUntil(f.due_at);
                const late = f.status === 'OPEN' && left !== null && left < 0;
                return (
                  <tr key={f.id}>
                    <td>
                      {f.title}
                      {f.notes && <span className="ms-2 text-[11px] text-[var(--text-muted)]">{f.notes}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {fmtDateTime(f.due_at)}
                      {late && (
                        <span className="ms-2">
                          <Pill tone="bad">{t(`متأخرة ${-left} ي`, `${-left} j de retard`, `${-left}d late`)}</Pill>
                        </span>
                      )}
                    </td>
                    <td><Pill tone={PRIORITY_TONE[f.priority]}>{f.priority}</Pill></td>
                    <td>
                      <Pill tone={f.status === 'DONE' ? 'good' : f.status === 'CANCELLED' ? 'bad' : 'info'}>
                        {f.status}
                      </Pill>
                      {f.completed_at && (
                        <span className="ms-2 text-[11px] text-[var(--text-muted)]">{fmtDateTime(f.completed_at)}</span>
                      )}
                    </td>

                    <td className="end">
                      {f.status !== 'OPEN' ? (
                        <span className="text-[11px] text-[var(--text-muted)]">{DASH}</span>
                      ) : completing === f.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="input w-40"
                            placeholder={t('ملاحظة (اختياري)', 'Note (optionnel)', 'Note (optional)')}
                            aria-label={t('ملاحظة', 'Note', 'Note')}
                          />
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={cmd.busy}
                            onClick={() => { void complete(f.id); }}
                          >
                            {t('إتمام', 'Terminer', 'Complete')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => { setCompleting(null); setNote(''); }}
                          >
                            {t('إلغاء', 'Annuler', 'Cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className="btn btn-sm" onClick={() => setCompleting(f.id)}>
                            {t('إتمام', 'Terminer', 'Complete')}
                          </button>
                          <button
                            type="button"
                            className={cancelling === f.id ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm'}
                            disabled={cmd.busy}
                            onClick={() => {
                              // Second click confirms; a cancelled follow-up has no
                              // button that brings it back.
                              if (cancelling === f.id) { void cancel(f.id); return; }
                              setCancelling(f.id);
                            }}
                          >
                            {cancelling === f.id ? t('تأكيد', 'Confirmer', 'Confirm') : t('إلغاء', 'Annuler', 'Cancel')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

type TargetKind = 'CUSTOMER' | 'OPPORTUNITY' | 'LEAD';

function FollowupForm({ onCancel, onCreated }: {
  onCancel: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const customers = useCrmCustomerRows({ limit: 200 });
  const opportunities = useCrmOpportunityRows({ limit: 200 });
  const leads = useCrmLeadRows({ limit: 200 });

  const [kind, setKind] = useState<TargetKind>('CUSTOMER');
  const [targetId, setTargetId] = useState('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<CrmFollowupPriority>('MEDIUM');
  const [notes, setNotes] = useState('');

  const dueInstant = due === '' ? null : new Date(due);
  const dueValid = dueInstant !== null && !Number.isNaN(dueInstant.getTime());
  const ready = title.trim() !== '' && targetId !== '' && dueValid;

  const submit = async () => {
    if (!ready || dueInstant === null) return;
    const payload: Record<string, unknown> = {
      title: title.trim(),
      due_at: dueInstant.toISOString(),
      priority,
    };
    if (kind === 'CUSTOMER') payload.customer_id = targetId;
    if (kind === 'OPPORTUNITY') payload.opportunity_id = targetId;
    if (kind === 'LEAD') payload.lead_id = targetId;
    if (notes.trim()) payload.notes = notes.trim();

    await cmd.run(() => crmFollowupCommands.create(payload), {
      notice: t('تم إنشاء المتابعة', 'Relance créée', 'Follow-up created'),
      onSuccess: async () => { await onCreated(); },
    });
  };

  const targets = kind === 'CUSTOMER'
    ? customers.data.map((c) => ({ id: c.id, label: `${c.full_name}${c.phone ? ` · ${c.phone}` : ''}` }))
    : kind === 'OPPORTUNITY'
      ? opportunities.data.map((o) => ({ id: o.id, label: `${o.reference} · ${o.title}` }))
      : leads.data.map((l) => ({
        id: l.id,
        label: `${`${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || l.id.slice(0, 8)}${l.phone ? ` · ${l.phone}` : ''}`,
      }));

  const listError = customers.error ?? opportunities.error ?? leads.error;

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
      {listError && <ErrorBanner message={listError} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('مرتبطة بـ', 'Rattachée à', 'Attached to')}>
          <Select
            value={kind}
            onChange={(e) => { setKind(e.target.value as TargetKind); setTargetId(''); }}
            className="input"
          >
            <option value="CUSTOMER">{t('عميل', 'Client', 'Customer')}</option>
            <option value="OPPORTUNITY">{t('فرصة', 'Opportunité', 'Opportunity')}</option>
            <option value="LEAD">{t('عميل محتمل', 'Prospect', 'Lead')}</option>
          </Select>
        </Field>

        <Field label={t('الهدف', 'Cible', 'Target')}>
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input">
            <option value="">{t('اختر', 'Choisir', 'Select')}</option>
            {targets.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </Select>
        </Field>

        <Field label={t('الأولوية', 'Priorité', 'Priority')}>
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value as CrmFollowupPriority)}
            className="input"
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>

        <Field label={t('العنوان', 'Intitulé', 'Title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
        </Field>

        <Field
          label={t('الاستحقاق', 'Échéance', 'Due')}
          hint={t('بتوقيتك المحلي', 'À votre heure locale', 'In your local time')}
        >
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="input"
          />
        </Field>

        <div className="sm:col-span-2 lg:col-span-3">
          <Field label={t('ملاحظات', 'Notes', 'Notes')}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" />
          </Field>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={cmd.busy || !ready}
          onClick={() => { void submit(); }}
        >
          {t('إنشاء', 'Créer', 'Create')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={cmd.busy}>
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
        {!ready && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {t(
              'الهدف والعنوان والاستحقاق مطلوبة',
              'Cible, intitulé et échéance obligatoires',
              'A target, a title and a due date are required',
            )}
          </span>
        )}
      </div>
    </div>
  );
}

