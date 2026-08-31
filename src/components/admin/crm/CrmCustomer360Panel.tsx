/**
 * Customer 360 -- one round trip, one screen.
 *
 * get_crm_customer_360 returns the customer, the lead they came from, the campaign
 * that attributed them, every opportunity, quote, activity and follow-up, the
 * bookings and payments that reference their pilgrim, and the totals over those
 * rows. The screen renders that payload and adds nothing to it: the outstanding
 * figure is booked − paid as the SQL computed it, and the DZD and SAR columns stay
 * apart because the platform holds no exchange rate and a summed total of the two
 * would be a fabricated number.
 *
 * Two writes are offered here, both narrow. Tags go through set_crm_customer_tags:
 * tags is text[], and a jsonb payload cannot carry a Postgres array through the
 * generic patch helper. Status is a plain column update -- unlike an opportunity
 * stage, a customer status carries no history and no cascade.
 */
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmAnalytics } from '@/services/crmAnalytics';
import { crmCustomerCommands, crmLifecycleCommands } from '@/services/domainCommands';
import type { CrmCustomer360, CrmCustomerStatus } from '@/types/crm';
import { Field, KeyValue, NoticeBar, Panel, Pill, Tile } from './atoms';
import { DASH, fmtDate, fmtDateTime, fmtInt, fmtMoney, toneForStatus, useCrmI18n, useCrmRead } from './crmFormat';
import { useCrmCommand } from './useCrmCommand';

const STATUSES: readonly CrmCustomerStatus[] = ['ACTIVE', 'DORMANT', 'BLOCKED'];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</h4>
      {children}
    </section>
  );
}

function MiniTable({ head, minWidth, children }: { head: readonly string[]; minWidth: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="table" style={{ minWidth }}>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Chips plus one input. Every edit is a whole-array write, which is what the
 *  command takes: set_crm_customer_tags replaces the array rather than appending,
 *  so removing a tag and adding one are the same call. */
function TagEditor({ customerId, tags, onSaved }: {
  customerId: string;
  tags: readonly string[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const [entry, setEntry] = useState('');

  const write = async (next: string[]) => {
    await cmd.run(() => crmLifecycleCommands.setCustomerTags(customerId, next), {
      notice: t('تم تحديث الوسوم', 'Étiquettes mises à jour', 'Tags updated'),
      onSuccess: async () => { await onSaved(); },
    });
  };

  const add = async () => {
    const value = entry.trim();
    if (value === '' || tags.includes(value)) return;
    await write([...tags, value]);
    setEntry('');
  };

  return (
    <div>
      {cmd.error && <ErrorBanner message={cmd.error} />}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {tags.length === 0 && <span className="text-[12px] text-[var(--text-muted)]">{DASH}</span>}
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1">
            <Pill>{tag}</Pill>
            <button
              type="button"
              className="text-[var(--text-muted)] hover:text-[var(--danger)]"
              disabled={cmd.busy}
              aria-label={`${t('حذف', 'Retirer', 'Remove')} ${tag}`}
              onClick={() => { void write(tags.filter((x) => x !== tag)); }}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          className="input"
          placeholder={t('وسم جديد', 'Nouvelle étiquette', 'New tag')}
          aria-label={t('وسم جديد', 'Nouvelle étiquette', 'New tag')}
        />
        <button type="button" className="btn btn-sm" onClick={() => { void add(); }} disabled={cmd.busy}>
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function CrmCustomer360Panel({ customerId, onCustomerChanged, onClose }: {
  customerId: string;
  onCustomerChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const view = useCrmRead<CrmCustomer360>(() => crmAnalytics.customer360(customerId), [customerId]);
  const [status, setStatus] = useState<CrmCustomerStatus | ''>('');

  const payload = view.data;
  const customer = payload?.customer ?? null;
  const effectiveStatus = status === '' ? customer?.status ?? 'ACTIVE' : status;

  const refresh = async () => { view.reload(); await onCustomerChanged(); };

  const saveStatus = async () => {
    if (!customer || effectiveStatus === customer.status) return;
    await cmd.run(() => crmCustomerCommands.update(customer.id, { status: effectiveStatus }), {
      notice: t('تم تحديث الحالة', 'Statut mis à jour', 'Status updated'),
      onSuccess: async () => { setStatus(''); await refresh(); },
    });
  };

  const complete = async (followupId: string) => {
    await cmd.run(() => crmLifecycleCommands.completeFollowup(followupId), {
      notice: t('تمت المتابعة', 'Relance terminée', 'Follow-up completed'),
      onSuccess: async () => { await refresh(); },
    });
  };

  const openOpportunities = useMemo(
    () => (payload?.opportunities ?? []).filter((o) => o.stage !== 'WON' && o.stage !== 'LOST').length,
    [payload],
  );

  if (view.loading && payload === null) {
    return <Panel title={t('ملف العميل', 'Fiche client', 'Customer 360')}><Spinner className="p-8" /></Panel>;
  }
  if (view.error !== null || payload === null || customer === null) {
    return (
      <Panel
        title={t('ملف العميل', 'Fiche client', 'Customer 360')}
        actions={<button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t('إغلاق', 'Fermer', 'Close')}</button>}
      >
        <ErrorBanner
          message={view.error ?? t('لا بيانات', 'Aucune donnée', 'No data')}
          onRetry={() => { view.reload(); }}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title={customer.full_name}
      subtitle={`${customer.code} · ${customer.customer_type}`}
      actions={(
        <>
          <Pill tone={toneForStatus(customer.status)}>{customer.status}</Pill>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { view.reload(); }}>
            {t('تحديث', 'Rafraîchir', 'Refresh')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('إغلاق', 'Fermer', 'Close')}
          </button>
        </>
      )}
    >
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <KeyValue label={t('الهاتف', 'Téléphone', 'Phone')} value={customer.phone ?? DASH} mono />
          <KeyValue label={t('البريد', 'E-mail', 'Email')} value={customer.email ?? DASH} />
          <KeyValue label={t('الولاية', 'Wilaya', 'Wilaya')} value={customer.wilaya ?? DASH} />
          <KeyValue label={t('المصدر', 'Source', 'Source')} value={customer.source ?? DASH} />
          <KeyValue
            label={t('الحملة', 'Campagne', 'Campaign')}
            value={payload.campaign ? `${payload.campaign.name} · ${payload.campaign.channel}` : DASH}
          />
          <KeyValue
            label={t('من عميل محتمل', 'Issu d’un prospect', 'From lead')}
            value={payload.lead
              ? `${payload.lead.first_name ?? ''} ${payload.lead.last_name ?? ''}`.trim() || payload.lead.id
              : DASH}
          />
          <KeyValue label={t('أول بيع', 'Première vente', 'First won')} value={fmtDate(customer.first_won_at)} />
          <KeyValue label={t('آخر نشاط', 'Dernière activité', 'Last activity')} value={fmtDateTime(customer.last_activity_at)} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('الوسوم', 'Étiquettes', 'Tags')}>
            <TagEditor customerId={customer.id} tags={customer.tags} onSaved={refresh} />
          </Field>
          <Field label={t('الحالة', 'Statut', 'Status')}>
            <div className="flex items-center gap-2">
              <Select
                value={effectiveStatus}
                onChange={(e) => setStatus(e.target.value as CrmCustomerStatus)}
                className="input"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { void saveStatus(); }}
                disabled={cmd.busy || effectiveStatus === customer.status}
              >
                {t('حفظ', 'OK', 'Save')}
              </button>
            </div>
          </Field>
        </div>

        <Customer360Totals payload={payload} openOpportunities={openOpportunities} />
        <Customer360Lists payload={payload} busy={cmd.busy} onComplete={complete} />
      </div>
    </Panel>
  );
}

/** DZD and SAR never merge into one figure: there is no rate in this platform, so a
 *  combined total would be invented. A currency with no rows shows an em dash. */
function Customer360Totals({ payload, openOpportunities }: {
  payload: CrmCustomer360;
  openOpportunities: number;
}) {
  const { t } = useCrmI18n();
  const total = payload.totals;
  const sarUsed = total.booked_sar !== 0 || total.paid_sar !== 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={t('الحجوزات', 'Réservations', 'Bookings')} value={fmtInt(total.bookings)} />
      <Tile label={t('المعتمرون', 'Pèlerins', 'Travellers')} value={fmtInt(total.travelers)} />
      <Tile
        label={t('محجوز (دج)', 'Réservé (DZD)', 'Booked (DZD)')}
        value={fmtMoney(total.booked_dzd)}
        hint={`${t('مدفوع', 'Payé', 'Paid')} ${fmtMoney(total.paid_dzd)}`}
      />
      <Tile
        label={t('متبقٍ (دج)', 'Reste (DZD)', 'Outstanding (DZD)')}
        value={fmtMoney(total.outstanding_dzd)}
        tone={total.outstanding_dzd > 0 ? 'warn' : 'good'}
      />
      <Tile
        label={t('محجوز (ريال)', 'Réservé (SAR)', 'Booked (SAR)')}
        value={sarUsed ? fmtMoney(total.booked_sar, 'SAR') : DASH}
        hint={sarUsed ? `${t('مدفوع', 'Payé', 'Paid')} ${fmtMoney(total.paid_sar, 'SAR')}` : undefined}
      />
      <Tile
        label={t('متبقٍ (ريال)', 'Reste (SAR)', 'Outstanding (SAR)')}
        value={sarUsed ? fmtMoney(total.outstanding_sar, 'SAR') : DASH}
        tone={sarUsed && total.outstanding_sar > 0 ? 'warn' : undefined}
      />
      <Tile
        label={t('خط الأنابيب المفتوح', 'Pipeline ouvert', 'Open pipeline')}
        value={fmtMoney(payload.open_pipeline_dzd)}
        hint={`${fmtInt(openOpportunities)} ${t('فرصة', 'opportunités', 'opportunities')}`}
      />
      <Tile label={t('العروض', 'Devis', 'Quotes')} value={fmtInt(payload.quotes.length)} />
    </div>
  );
}

function Customer360Lists({ payload, busy, onComplete }: {
  payload: CrmCustomer360;
  busy: boolean;
  onComplete: (followupId: string) => Promise<void>;
}) {
  const { t } = useCrmI18n();
  const none = <p className="text-[12px] text-[var(--text-muted)]">{DASH}</p>;

  return (
    <div className="space-y-4">
      <Block title={t('الفرص', 'Opportunités', 'Opportunities')}>
        {payload.opportunities.length === 0 ? none : (
          <MiniTable
            minWidth={560}
            head={[t('المرجع', 'Réf.', 'Ref'), t('العنوان', 'Intitulé', 'Title'), t('المرحلة', 'Étape', 'Stage'),
              t('القيمة', 'Valeur', 'Value'), t('الإغلاق', 'Clôture', 'Close')]}
          >
            {payload.opportunities.map((o) => (
              <tr key={o.id}>
                <td className="tabular">{o.reference}</td>
                <td>{o.title}</td>
                <td><Pill tone={toneForStatus(o.stage)}>{o.stage}</Pill></td>
                <td className="tabular">{fmtMoney(o.expected_value_dzd)}</td>
                <td>{fmtDate(o.expected_close_date)}</td>
              </tr>
            ))}
          </MiniTable>
        )}
      </Block>

      <Block title={t('العروض', 'Devis', 'Quotes')}>
        {payload.quotes.length === 0 ? none : (
          <MiniTable
            minWidth={520}
            head={[t('الرقم', 'Numéro', 'Number'), t('الحالة', 'Statut', 'Status'),
              t('الإجمالي', 'Total', 'Total'), t('صالح حتى', 'Valable', 'Valid until')]}
          >
            {payload.quotes.map((q) => (
              <tr key={q.id}>
                <td className="tabular">{q.quote_number}</td>
                <td><Pill tone={toneForStatus(q.status)}>{q.status}</Pill></td>
                <td className="tabular">{fmtMoney(q.total_amount, q.currency_code)}</td>
                <td>{fmtDate(q.valid_until)}</td>
              </tr>
            ))}
          </MiniTable>
        )}
      </Block>

      <Block title={t('الحجوزات', 'Réservations', 'Bookings')}>
        {payload.bookings.length === 0 ? none : (
          <MiniTable
            minWidth={620}
            head={[t('المرجع', 'Réf.', 'Ref'), t('الحالة', 'Statut', 'Status'), t('المعتمرون', 'Pèlerins', 'Travellers'),
              t('الإجمالي', 'Total', 'Total'), t('المدفوع', 'Payé', 'Paid'), t('التاريخ', 'Date', 'Date')]}
          >
            {payload.bookings.map((b) => (
              <tr key={b.id}>
                <td className="tabular">{b.reference ?? b.id}</td>
                <td><Pill tone={toneForStatus(b.status)}>{b.status ?? DASH}</Pill></td>
                <td className="tabular">{fmtInt(b.travelers)}</td>
                <td className="tabular">
                  {b.total_sar ? fmtMoney(b.total_sar, 'SAR') : fmtMoney(b.total_dzd)}
                </td>
                <td className="tabular">
                  {b.total_sar ? fmtMoney(b.paid_sar, 'SAR') : fmtMoney(b.paid_dzd)}
                </td>
                <td>{fmtDate(b.created_at)}</td>
              </tr>
            ))}
          </MiniTable>
        )}
      </Block>

      <Block title={t('الدفعات', 'Paiements', 'Payments')}>
        {payload.payments.length === 0 ? none : (
          <MiniTable
            minWidth={560}
            head={[t('المرجع', 'Réf.', 'Ref'), t('الطريقة', 'Mode', 'Method'), t('المبلغ', 'Montant', 'Amount'),
              t('الحالة', 'Statut', 'Status'), t('التاريخ', 'Date', 'Date')]}
          >
            {payload.payments.map((p) => (
              <tr key={p.id}>
                <td className="tabular">{p.reference ?? p.id}</td>
                <td>{p.method ?? DASH}</td>
                <td className="tabular">
                  {p.amount_sar ? fmtMoney(p.amount_sar, 'SAR') : fmtMoney(p.amount_dzd)}
                </td>
                <td><Pill tone={toneForStatus(p.status)}>{p.status ?? DASH}</Pill></td>
                <td>{fmtDateTime(p.received_at)}</td>
              </tr>
            ))}
          </MiniTable>
        )}
      </Block>

      <Block title={t('المتابعات', 'Relances', 'Follow-ups')}>
        {payload.followups.length === 0 ? none : (
          <MiniTable
            minWidth={560}
            head={[t('العنوان', 'Intitulé', 'Title'), t('الاستحقاق', 'Échéance', 'Due'), t('الأولوية', 'Priorité', 'Priority'),
              t('الحالة', 'Statut', 'Status'), '']}
          >
            {payload.followups.map((f) => (
              <tr key={f.id}>
                <td>{f.title}</td>
                <td>{fmtDateTime(f.due_at)}</td>
                <td className="text-[12px] text-[var(--text-muted)]">{f.priority}</td>
                <td><Pill tone={toneForStatus(f.status)}>{f.status}</Pill></td>
                <td className="end">
                  {f.status === 'OPEN' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => { void onComplete(f.id); }}
                    >
                      {t('إتمام', 'Terminer', 'Complete')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </MiniTable>
        )}
      </Block>

      <Block title={t('النشاط', 'Activité', 'Activity')}>
        {payload.activities.length === 0 ? none : (
          <ul className="space-y-1.5">
            {payload.activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                <Pill tone={a.activity_type === 'SYSTEM' ? 'neutral' : 'info'}>{a.activity_type}</Pill>
                <span className="text-[var(--text-primary)]">{a.subject}</span>
                <span className="text-[var(--text-muted)]">{fmtDateTime(a.occurred_at)}</span>
                {a.outcome && <span className="text-[var(--text-muted)]">· {a.outcome}</span>}
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}

