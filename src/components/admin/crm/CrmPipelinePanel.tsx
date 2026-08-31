/**
 * The pipeline board.
 *
 * Column headers come from get_crm_pipeline_summary, not from adding up the cards
 * below them: the card list is a capped row read, so a client-side sum would drift
 * from the number the forecast reports the moment an agency has more open
 * opportunities than the page fetches. The two disagree only when the read is
 * stale, and the counter is the one that is right.
 *
 * A card offers exactly the moves private.move_crm_opportunity_stage accepts.
 * WON is never offered: an opportunity is won by accepting its quote, the path
 * that also creates the booking, the payment and the journal entry.
 */
import { useMemo, useState } from 'react';
import { History, Plus, Search } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { crmAnalytics } from '@/services/crmAnalytics';
import { crmLifecycleCommands } from '@/services/domainCommands';
import { CRM_STAGES, CRM_STAGE_TRANSITIONS, type CrmOpportunityRow, type CrmPipelineStage, type CrmStage } from '@/types/crm';
import { Field, NoticeBar, Panel, Pill } from './atoms';
import { CrmOpportunityForm } from './CrmOpportunityForm';
import { DASH, fmtDate, fmtDateTime, fmtInt, fmtMoney, fmtPct, STAGE_TONE, useCrmI18n, useCrmRead } from './crmFormat';
import { useCrmOpportunityRows, useCrmStageHistoryRows } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

export function CrmPipelinePanel() {
  const { t } = useCrmI18n();
  const [term, setTerm] = useState('');
  const rows = useCrmOpportunityRows({ term, limit: 200 });
  const summary = useCrmRead<CrmPipelineStage[]>(() => crmAnalytics.pipeline(null, null), []);
  const cmd = useCrmCommand();

  const [lostFor, setLostFor] = useState<CrmOpportunityRow | null>(null);
  const [historyFor, setHistoryFor] = useState<CrmOpportunityRow | null>(null);
  const [creating, setCreating] = useState(false);

  const byStage = useMemo(() => {
    const map = new Map<CrmStage, CrmOpportunityRow[]>();
    for (const stage of CRM_STAGES) map.set(stage, []);
    for (const row of rows.data) map.get(row.stage)?.push(row);
    return map;
  }, [rows.data]);

  const totals = useMemo(() => {
    const map = new Map<CrmStage, CrmPipelineStage>();
    for (const stage of summary.data ?? []) map.set(stage.stage, stage);
    return map;
  }, [summary.data]);

  const move = async (opp: CrmOpportunityRow, to: CrmStage) => {
    if (to === 'LOST') { setLostFor(opp); return; }
    await cmd.run(() => crmLifecycleCommands.moveStage(opp.id, to), {
      notice: `${opp.reference}: ${opp.stage} → ${to}`,
      onSuccess: async () => { await rows.refetch(); summary.reload(); },
    });
  };

  return (
    <div className="space-y-4">
      {rows.error && <ErrorBanner message={rows.error} onRetry={() => { void rows.refetch(); }} />}
      {summary.error && <ErrorBanner message={summary.error} onRetry={summary.reload} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <Panel
        title={t('خط الأنابيب', 'Pipeline', 'Pipeline')}
        subtitle={t(
          'الإجماليات من قاعدة البيانات؛ البطاقات هي أحدث 200 فرصة',
          'Totaux calculés en base ; les cartes sont les 200 dernières opportunités',
          'Totals are computed in the database; the cards are the newest 200 opportunities',
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
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('فرصة', 'Opportunité', 'New opportunity')}
            </button>
          </>
        }
      >
        {creating && (
          <CrmOpportunityForm
            busy={cmd.busy}
            onCancel={() => setCreating(false)}
            onCreated={async () => { setCreating(false); await rows.refetch(); summary.reload(); }}
          />
        )}

        {rows.loading && rows.data.length === 0 ? (
          <Spinner className="p-8" />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {CRM_STAGES.map((stage) => {
              const cards = byStage.get(stage) ?? [];
              const total = totals.get(stage);
              return (
                <section key={stage} className="w-[280px] shrink-0 rounded-lg border border-[var(--border)] p-2.5">
                  <header className="mb-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Pill tone={STAGE_TONE[stage]}>{stage}</Pill>
                      <span className="tabular text-[12px] font-semibold text-[var(--text-primary)]">
                        {total ? fmtInt(total.opportunity_count) : DASH}
                      </span>
                    </div>
                    <p className="tabular text-[11px] text-[var(--text-muted)]">
                      {total ? fmtMoney(total.value_dzd) : DASH}
                      {total && <> · {t('مرجح', 'pondéré', 'weighted')} {fmtMoney(total.weighted_dzd)}</>}
                    </p>
                  </header>
                  <div className="space-y-2">
                    {cards.length === 0 ? (
                      <p className="py-4 text-center text-[12px] text-[var(--text-muted)]">
                        {t('لا شيء', 'Vide', 'Empty')}
                      </p>
                    ) : (
                      cards.map((opp) => (
                        <article key={opp.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5">
                          <p className="truncate text-[13px] font-medium text-[var(--text-primary)]" title={opp.title}>
                            {opp.title}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)]">{opp.reference}</p>
                          <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
                            <span className="tabular font-semibold text-[var(--text-primary)]">
                              {fmtMoney(opp.expected_value_dzd)}
                            </span>
                            <span className="tabular text-[var(--text-muted)]">{fmtPct(opp.probability)}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                            {fmtInt(opp.travelers)} {t('معتمر', 'pèlerins', 'travellers')}
                            {' · '}
                            {opp.expected_close_date ? fmtDate(opp.expected_close_date) : t('بلا تاريخ', 'sans date', 'no date')}
                          </p>
                          {opp.lost_reason && (
                            <p className="mt-1 text-[11px] text-[var(--danger)]">{opp.lost_reason}</p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            {CRM_STAGE_TRANSITIONS[opp.stage].map((to) => (
                              <button
                                key={to}
                                type="button"
                                className="btn btn-sm"
                                disabled={cmd.busy}
                                onClick={() => { void move(opp, to); }}
                              >
                                → {to}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`${t('السجل', 'Historique', 'History')} ${opp.reference}`}
                              onClick={() => setHistoryFor(historyFor?.id === opp.id ? null : opp)}
                            >
                              <History className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                          {opp.stage === 'NEGOTIATION' && (
                            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                              {t('الفوز يتم بقبول العرض', 'Le gain passe par le devis', 'Winning happens by accepting the quote')}
                            </p>
                          )}
                        </article>
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Panel>

      {lostFor && (
        <LostPanel
          opportunity={lostFor}
          busy={cmd.busy}
          onCancel={() => setLostFor(null)}
          onConfirm={async (reason, note) => {
            const ok = await cmd.run(
              () => crmLifecycleCommands.moveStage(lostFor.id, 'LOST', note, reason),
              {
                notice: `${lostFor.reference} → LOST`,
                onSuccess: async () => { await rows.refetch(); summary.reload(); },
              },
            );
            if (ok) setLostFor(null);
          }}
        />
      )}

      {historyFor && <HistoryPanel opportunity={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

/**
 * Losing an opportunity is not only a stage change, and the panel says so before
 * the click: the server also cancels every open follow-up and expires every draft
 * or sent quote attached to it. The reason is required because the server requires
 * it -- refusing here saves a round trip, it does not replace the check.
 */
function LostPanel({ opportunity, busy, onCancel, onConfirm }: {
  opportunity: CrmOpportunityRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, note: string | null) => Promise<void>;
}) {
  const { t } = useCrmI18n();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const trimmed = reason.trim();

  return (
    <Panel title={`${t('فرصة مفقودة', 'Opportunité perdue', 'Mark as lost')} · ${opportunity.reference}`}>
      <p className="mb-3 text-[12px] text-[var(--text-muted)]">
        {t(
          'سيتم أيضاً إلغاء كل متابعة مفتوحة وإنهاء صلاحية كل عرض مُسوَّد أو مُرسَل لهذه الفرصة.',
          'Les suivis ouverts seront annulés et les devis brouillon ou envoyés expireront.',
          'Every open follow-up will be cancelled and every draft or sent quote will expire.',
        )}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('السبب', 'Motif', 'Reason')}>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input"
            placeholder={t('السعر، التوقيت، منافس…', 'Prix, calendrier, concurrent…', 'Price, timing, competitor…')}
          />
        </Field>
        <Field label={t('ملاحظة (اختياري)', 'Note (optionnel)', 'Note (optional)')}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={busy || trimmed.length === 0}
          onClick={() => { void onConfirm(trimmed, note.trim() || null); }}
        >
          {t('تأكيد الخسارة', 'Confirmer', 'Confirm lost')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
        {trimmed.length === 0 && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {t('السبب مطلوب', 'Motif obligatoire', 'A reason is required')}
          </span>
        )}
      </div>
    </Panel>
  );
}

/**
 * The stage ledger. crm_stage_history is append-only -- every client write path on
 * it was revoked -- so this is the audit trail of the board above, written by the
 * same function that moved the card.
 */
function HistoryPanel({ opportunity, onClose }: { opportunity: CrmOpportunityRow; onClose: () => void }) {
  const { t } = useCrmI18n();
  const history = useCrmStageHistoryRows(opportunity.id);

  return (
    <Panel
      title={`${t('سجل المراحل', 'Historique des étapes', 'Stage history')} · ${opportunity.reference}`}
      actions={
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('إغلاق', 'Fermer', 'Close')}
        </button>
      }
    >
      {history.error && <ErrorBanner message={history.error} onRetry={() => { void history.refetch(); }} />}
      {history.loading && history.data.length === 0 ? (
        <Spinner className="p-6" />
      ) : history.data.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا حركات', 'Aucun mouvement', 'No stage moves recorded')}
        </p>
      ) : (
        <ul className="divided text-[13px]">
          {history.data.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {row.from_stage ? <Pill tone={STAGE_TONE[row.from_stage]}>{row.from_stage}</Pill> : <span className="text-[var(--text-muted)]">{t('البداية', 'Création', 'Created')}</span>}
                <span aria-hidden="true" className="text-[var(--text-muted)]">→</span>
                <Pill tone={STAGE_TONE[row.to_stage]}>{row.to_stage}</Pill>
                <span className="tabular text-[11px] text-[var(--text-muted)]">{fmtPct(row.probability)}</span>
              </div>
              <div className="min-w-0 text-end">
                <p className="text-[11px] text-[var(--text-muted)]">{fmtDateTime(row.changed_at)}</p>
                {row.note && <p className="truncate text-[12px] text-[var(--text-secondary)]" title={row.note}>{row.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
