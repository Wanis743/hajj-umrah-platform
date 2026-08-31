/**
 * Customers: the list, direct creation, and the door to Customer 360.
 *
 * Most customers arrive through convert_crm_lead, which creates the customer and
 * its first opportunity in one transaction. This screen is for the other case -- a
 * walk-in who is already buying -- so the form is deliberately small: a name, how
 * to reach them, where they came from. `code` is not on it, because the column
 * carries its own CUS-YYMMDD-XXXXXXXX default and a client-sent value would be
 * either ignored or wrong.
 *
 * The campaign field is the only field here that later becomes a number: campaign
 * ROI counts the customers attributed to a campaign, so an unattributed customer
 * makes a campaign look worse than it was.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmCustomerCommands } from '@/services/domainCommands';
import type { CrmCustomerStatus, CrmCustomerType } from '@/types/crm';
import { Field, NoticeBar, Panel, Pill } from './atoms';
import { fmtDateTime, toneForStatus, useCrmI18n } from './crmFormat';
import { CrmCustomer360Panel } from './CrmCustomer360Panel';
import { useCrmCampaignRows, useCrmCustomerRows } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

const TYPES: readonly CrmCustomerType[] = ['INDIVIDUAL', 'FAMILY', 'CORPORATE'];
const STATUSES: readonly (CrmCustomerStatus | 'ALL')[] = ['ALL', 'ACTIVE', 'DORMANT', 'BLOCKED'];

export function CrmCustomersPanel() {
  const { t } = useCrmI18n();
  const [status, setStatus] = useState<CrmCustomerStatus | 'ALL'>('ALL');
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const customers = useCrmCustomerRows({ status, term, limit: 200 });

  const selected = useMemo(
    () => customers.data.find((c) => c.id === selectedId) ?? null,
    [customers.data, selectedId],
  );

  return (
    <div className="space-y-4">
      <Panel
        title={t('العملاء', 'Clients', 'Customers')}
        subtitle={t(
          'الترتيب بآخر نشاط مسجَّل',
          'Triés par dernière activité enregistrée',
          'Ordered by the last recorded activity',
        )}
        actions={(
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('عميل جديد', 'Nouveau client', 'New customer')}
          </button>
        )}
      >
        {customers.error && <ErrorBanner message={customers.error} onRetry={() => { void customers.refetch(); }} />}

        {creating && (
          <CustomerForm
            onCancel={() => setCreating(false)}
            onCreated={async (id) => {
              setCreating(false);
              await customers.refetch();
              if (id) setSelectedId(id);
            }}
          />
        )}

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Field label={t('بحث', 'Recherche', 'Search')}>
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="input"
                placeholder={t('الاسم أو الرمز أو الهاتف', 'Nom, code ou téléphone', 'Name, code or phone')}
              />
            </Field>
          </div>
          <div className="min-w-[150px]">
            <Field label={t('الحالة', 'Statut', 'Status')}>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as CrmCustomerStatus | 'ALL')}
                className="input"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        {customers.loading && customers.data.length === 0 ? (
          <Spinner className="p-6" />
        ) : customers.data.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا عملاء', 'Aucun client', 'No customers')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[820px]">
              <thead>
                <tr>
                  <th>{t('الرمز', 'Code', 'Code')}</th>
                  <th>{t('الاسم', 'Nom', 'Name')}</th>
                  <th>{t('النوع', 'Type', 'Type')}</th>
                  <th>{t('الحالة', 'Statut', 'Status')}</th>
                  <th>{t('الهاتف', 'Téléphone', 'Phone')}</th>
                  <th>{t('الوسوم', 'Étiquettes', 'Tags')}</th>
                  <th>{t('آخر نشاط', 'Dernière activité', 'Last activity')}</th>
                  <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {customers.data.map((c) => (
                  <tr key={c.id} className={c.id === selectedId ? 'bg-[var(--bg-hover)]' : undefined}>
                    <td className="tabular">{c.code}</td>
                    <td>{c.full_name}</td>
                    <td className="text-[12px] text-[var(--text-muted)]">{c.customer_type}</td>
                    <td><Pill tone={toneForStatus(c.status)}>{c.status}</Pill></td>
                    <td className="tabular">{c.phone ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {c.tags.length === 0
                          ? <span className="text-[12px] text-[var(--text-muted)]">—</span>
                          : c.tags.slice(0, 3).map((tag) => <Pill key={tag}>{tag}</Pill>)}
                        {c.tags.length > 3 && <Pill>+{c.tags.length - 3}</Pill>}
                      </div>
                    </td>
                    <td className="text-[12px]">{fmtDateTime(c.last_activity_at)}</td>
                    <td className="end">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                      >
                        {c.id === selectedId ? t('إغلاق', 'Fermer', 'Close') : t('360', '360', '360')}
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
        <CrmCustomer360Panel
          customerId={selected.id}
          onCustomerChanged={async () => { await customers.refetch(); }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/** Direct creation. Only full_name is required, because that is the only column
 *  the table itself requires beyond its own defaults. */
function CustomerForm({ onCancel, onCreated }: {
  onCancel: () => void;
  onCreated: (id: string | null) => Promise<void> | void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const campaigns = useCrmCampaignRows();

  const [fullName, setFullName] = useState('');
  const [fullNameAr, setFullNameAr] = useState('');
  const [type, setType] = useState<CrmCustomerType>('INDIVIDUAL');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [wilaya, setWilaya] = useState('');
  const [source, setSource] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [notes, setNotes] = useState('');

  const ready = fullName.trim().length > 0;

  const submit = async () => {
    if (!ready) return;
    const payload: Record<string, unknown> = { full_name: fullName.trim(), customer_type: type };
    if (fullNameAr.trim()) payload.full_name_ar = fullNameAr.trim();
    if (phone.trim()) payload.phone = phone.trim();
    if (email.trim()) payload.email = email.trim();
    if (wilaya.trim()) payload.wilaya = wilaya.trim();
    if (source.trim()) payload.source = source.trim();
    if (campaignId) payload.campaign_id = campaignId;
    if (notes.trim()) payload.notes = notes.trim();

    await cmd.run(() => crmCustomerCommands.create(payload), {
      notice: t('تم إنشاء العميل', 'Client créé', 'Customer created'),
      onSuccess: async (data) => { await onCreated(data?.id ?? null); },
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
      {campaigns.error && <ErrorBanner message={campaigns.error} onRetry={() => { void campaigns.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('الاسم الكامل', 'Nom complet', 'Full name')}>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" />
        </Field>
        <Field label={t('الاسم بالعربية', 'Nom en arabe', 'Name in Arabic')}>
          <input value={fullNameAr} onChange={(e) => setFullNameAr(e.target.value)} className="input" dir="rtl" />
        </Field>
        <Field label={t('النوع', 'Type', 'Type')}>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as CrmCustomerType)}
            className="input"
          >
            {TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
          </Select>
        </Field>
        <Field label={t('الهاتف', 'Téléphone', 'Phone')}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input tabular" />
        </Field>
        <Field label={t('البريد الإلكتروني', 'E-mail', 'Email')}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </Field>
        <Field label={t('الولاية', 'Wilaya', 'Wilaya')}>
          <input value={wilaya} onChange={(e) => setWilaya(e.target.value)} className="input" />
        </Field>
        <Field label={t('المصدر', 'Source', 'Source')}>
          <input value={source} onChange={(e) => setSource(e.target.value)} className="input" />
        </Field>
        <Field
          label={t('الحملة', 'Campagne', 'Campaign')}
          hint={t('تُستخدم في حساب مردود الحملة', 'Utilisée dans le ROI de campagne', 'Used by the campaign ROI')}
        >
          <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="input">
            <option value="">{t('بدون', 'Aucune', 'None')}</option>
            {campaigns.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
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
      </div>
    </div>
  );
}

