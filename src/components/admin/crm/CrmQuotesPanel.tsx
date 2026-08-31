/**
 * Quotes: the list, and the only place a quote's status moves.
 *
 * Three transitions live here and each one is a server RPC, never a status patch:
 * send (DRAFT -> SENT, stamps valid_until, and pushes a NEW or QUALIFYING
 * opportunity to PROPOSAL), decline (DRAFT or SENT -> DECLINED, reason required),
 * and accept (SENT -> ACCEPTED plus the whole money path behind it). EXPIRED is
 * absent on purpose: no button writes it, because only the server does -- accepting
 * one quote expires the opportunity's others, and losing the opportunity expires
 * them all.
 *
 * Buttons are disabled from the quote row itself, not from a guess: send needs a
 * total above zero, decline needs an open quote, accept needs a sent one. Where the
 * row cannot answer -- whether the package still has seats, whether the validity
 * date has passed in the server's clock -- the button stays enabled and the server
 * answers, which is why every panel here renders cmd.error verbatim.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmLifecycleCommands } from '@/services/domainCommands';
import type { CrmQuoteRow, CrmQuoteStatus } from '@/types/crm';
import { Field, KeyValue, NoticeBar, Panel, Pill } from './atoms';
import { fmtDate, fmtDateTime, fmtInt, fmtMoney, toneForStatus, useCrmI18n } from './crmFormat';
import { CrmQuoteAccept } from './CrmQuoteAccept';
import { CrmQuoteForm } from './CrmQuoteForm';
import { CrmQuoteLines } from './CrmQuoteLines';
import { useCrmQuoteRows } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

const STATUSES: readonly (CrmQuoteStatus | 'ALL')[] = [
  'ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED',
];

export function CrmQuotesPanel() {
  const { t } = useCrmI18n();
  const [status, setStatus] = useState<CrmQuoteStatus | 'ALL'>('ALL');
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const quotes = useCrmQuoteRows({ status, term, limit: 200 });

  const selected = useMemo(
    () => quotes.data.find((q) => q.id === selectedId) ?? null,
    [quotes.data, selectedId],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of quotes.data) map.set(q.status, (map.get(q.status) ?? 0) + 1);
    return map;
  }, [quotes.data]);

  return (
    <div className="space-y-4">
      <Panel
        title={t('العروض', 'Devis', 'Quotes')}
        subtitle={t(
          'الأرقام والإجماليات تُحسب في قاعدة البيانات',
          'Numéros et totaux calculés en base',
          'Numbers and totals are computed in the database',
        )}
        actions={(
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('عرض جديد', 'Nouveau devis', 'New quote')}
          </button>
        )}
      >
        {quotes.error && <ErrorBanner message={quotes.error} onRetry={() => { void quotes.refetch(); }} />}

        {creating && (
          <CrmQuoteForm
            onCancel={() => setCreating(false)}
            onCreated={async (quoteId) => {
              setCreating(false);
              await quotes.refetch();
              if (quoteId) setSelectedId(quoteId);
            }}
          />
        )}

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <Field label={t('بحث برقم العرض', 'Recherche par numéro', 'Search by quote number')}>
              <input value={term} onChange={(e) => setTerm(e.target.value)} className="input" />
            </Field>
          </div>
          <div className="min-w-[150px]">
            <Field label={t('الحالة', 'Statut', 'Status')}>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as CrmQuoteStatus | 'ALL')}
                className="input"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}{s !== 'ALL' && counts.has(s) ? ` (${counts.get(s)})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {quotes.loading && quotes.data.length === 0 ? (
          <Spinner className="p-6" />
        ) : quotes.data.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا عروض', 'Aucun devis', 'No quotes')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>{t('الرقم', 'Numéro', 'Number')}</th>
                  <th>{t('الحالة', 'Statut', 'Status')}</th>
                  <th className="end">{t('المعتمرون', 'Pèlerins', 'Travellers')}</th>
                  <th className="end">{t('الإجمالي', 'Total', 'Total')}</th>
                  <th>{t('صالح حتى', 'Valable jusqu’au', 'Valid until')}</th>
                  <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {quotes.data.map((q) => (
                  <tr key={q.id} className={q.id === selectedId ? 'bg-[var(--bg-hover)]' : undefined}>
                    <td className="tabular">{q.quote_number}</td>
                    <td><Pill tone={toneForStatus(q.status)}>{q.status}</Pill></td>
                    <td className="end tabular text-end">{fmtInt(q.travelers)}</td>
                    <td className="end tabular text-end">{fmtMoney(q.total_amount, q.currency_code)}</td>
                    <td>{fmtDate(q.valid_until)}</td>
                    <td className="end">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedId(q.id === selectedId ? null : q.id)}
                      >
                        {q.id === selectedId ? t('إغلاق', 'Fermer', 'Close') : t('فتح', 'Ouvrir', 'Open')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <QuoteDetail
          quote={selected}
          onChanged={async () => { await quotes.refetch(); }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/** One quote: its header, its lines, and the transitions its status still allows. */
function QuoteDetail({ quote, onChanged, onClose }: {
  quote: CrmQuoteRow;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const [mode, setMode] = useState<'none' | 'send' | 'decline' | 'accept'>('none');
  const [validDays, setValidDays] = useState('14');
  const [reason, setReason] = useState('');

  const canSend = quote.status === 'DRAFT' && quote.total_amount > 0;
  const canDecline = quote.status === 'DRAFT' || quote.status === 'SENT';
  const canAccept = quote.status === 'SENT';

  const send = async () => {
    const days = Math.max(1, Math.trunc(Number(validDays) || 14));
    const ok = await cmd.run(() => crmLifecycleCommands.sendQuote(quote.id, days), {
      notice: t('تم إرسال العرض', 'Devis envoyé', 'Quote sent'),
      onSuccess: async () => { await onChanged(); },
    });
    if (ok) setMode('none');
  };

  const decline = async () => {
    if (reason.trim() === '') return;
    const ok = await cmd.run(() => crmLifecycleCommands.declineQuote(quote.id, reason.trim()), {
      notice: t('تم رفض العرض', 'Devis refusé', 'Quote declined'),
      onSuccess: async () => { await onChanged(); },
    });
    if (ok) { setReason(''); setMode('none'); }
  };

  return (
    <Panel
      title={`${t('العرض', 'Devis', 'Quote')} ${quote.quote_number}`}
      subtitle={quote.declined_reason ?? undefined}
      actions={(
        <>
          <Pill tone={toneForStatus(quote.status)}>{quote.status}</Pill>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('إغلاق', 'Fermer', 'Close')}
          </button>
        </>
      )}
    >
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KeyValue label={t('العملة', 'Devise', 'Currency')} value={quote.currency_code} mono />
        <KeyValue label={t('المعتمرون', 'Pèlerins', 'Travellers')} value={fmtInt(quote.travelers)} mono />
        <KeyValue label={t('صالح حتى', 'Valable jusqu’au', 'Valid until')} value={fmtDate(quote.valid_until)} />
        <KeyValue label={t('أُرسل في', 'Envoyé le', 'Sent at')} value={fmtDateTime(quote.sent_at)} />
        <KeyValue label={t('قُبل في', 'Accepté le', 'Accepted at')} value={fmtDateTime(quote.accepted_at)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canSend || cmd.busy}
          onClick={() => setMode(mode === 'send' ? 'none' : 'send')}
        >
          {t('إرسال', 'Envoyer', 'Send')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canAccept || cmd.busy}
          onClick={() => setMode(mode === 'accept' ? 'none' : 'accept')}
        >
          {t('قبول', 'Accepter', 'Accept')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!canDecline || cmd.busy}
          onClick={() => setMode(mode === 'decline' ? 'none' : 'decline')}
        >
          {t('رفض', 'Refuser', 'Decline')}
        </button>
        {quote.status === 'DRAFT' && quote.total_amount <= 0 && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {t(
              'العرض يحتاج سطراً واحداً على الأقل وإجمالياً أكبر من صفر قبل الإرسال',
              'Un devis exige au moins une ligne et un total supérieur à zéro avant l’envoi',
              'A quote needs at least one line and a total above zero before it can be sent',
            )}
          </span>
        )}
        {quote.booking_id && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {t('الحجز', 'Réservation', 'Booking')}: <span className="tabular">{quote.booking_id}</span>
          </span>
        )}
      </div>

      {mode === 'send' && (
        <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Field
                label={t('مدة الصلاحية (أيام)', 'Validité (jours)', 'Validity (days)')}
                hint={quote.valid_until
                  ? t(
                    'العرض يحمل تاريخاً بالفعل — سيُستخدم هو',
                    'Le devis porte déjà une date — elle sera conservée',
                    'The quote already carries a date — that one is kept',
                  )
                  : undefined}
              >
                <input
                  type="number"
                  min={1}
                  value={validDays}
                  onChange={(e) => setValidDays(e.target.value)}
                  className="input tabular"
                />
              </Field>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void send(); }} disabled={cmd.busy}>
              {t('إرسال الآن', 'Envoyer', 'Send now')}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            {t(
              'الإرسال يجعل السطور غير قابلة للتعديل، وينقل الفرصة إلى مرحلة العرض إن كانت جديدة أو قيد التأهيل.',
              'L’envoi verrouille les lignes et fait passer une opportunité NEW ou QUALIFYING en PROPOSAL.',
              'Sending locks the lines and moves a NEW or QUALIFYING opportunity to PROPOSAL.',
            )}
          </p>
        </div>
      )}

      {mode === 'decline' && (
        <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
          <Field label={t('سبب الرفض (مطلوب)', 'Motif du refus (obligatoire)', 'Decline reason (required)')}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" />
          </Field>
          <button
            type="button"
            className="btn btn-danger btn-sm mt-2"
            onClick={() => { void decline(); }}
            disabled={cmd.busy || reason.trim() === ''}
          >
            {t('تأكيد الرفض', 'Confirmer le refus', 'Confirm decline')}
          </button>
        </div>
      )}

      {mode === 'accept' && (
        <div className="mb-4">
          <CrmQuoteAccept
            quote={quote}
            onAccepted={async () => { await onChanged(); }}
            onClose={() => setMode('none')}
          />
        </div>
      )}

      <CrmQuoteLines quote={quote} onQuoteChanged={onChanged} />
    </Panel>
  );
}

