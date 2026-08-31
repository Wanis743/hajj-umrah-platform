/**
 * Direct opportunity creation, for the deal that starts from an existing customer
 * rather than from a lead.
 *
 * It creates at NEW with the stage ladder's own probability -- the form never picks
 * a stage, because a stage is a transition with history behind it, and the board is
 * where transitions happen. An opportunity converted from a lead already carries a
 * QUALIFYING history row written by convert_crm_lead; one created here starts its
 * ledger at its first move, which is the truth rather than a backfilled entry.
 *
 * expected_value_dzd is either typed or computed from the package price and the
 * traveller count, and the form shows which one it is about to send.
 */
import { useMemo, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmOpportunityCommands } from '@/services/domainCommands';
import { CRM_STAGE_PROBABILITY } from '@/types/crm';
import { Field, NoticeBar } from './atoms';
import { fmtMoney, isoToday, useCrmI18n } from './crmFormat';
import { useCrmCustomerRows, useCrmPackageOptions } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

export function CrmOpportunityForm({ busy, onCancel, onCreated }: {
  busy: boolean;
  onCancel: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const customers = useCrmCustomerRows({ limit: 200 });
  const packages = useCrmPackageOptions();

  const [customerId, setCustomerId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [title, setTitle] = useState('');
  const [travelers, setTravelers] = useState('1');
  const [value, setValue] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [notes, setNotes] = useState('');

  const count = Math.max(1, Math.trunc(Number(travelers) || 1));
  const chosenPackage = useMemo(
    () => packages.data.find((p) => p.id === packageId) ?? null,
    [packages.data, packageId],
  );
  const typed = value.trim() === '' ? null : Number(value);
  const derived = chosenPackage?.price_dzd != null ? chosenPackage.price_dzd * count : null;
  const effective = typed != null && Number.isFinite(typed) && typed >= 0 ? typed : derived;
  const ready = customerId !== '' && title.trim().length > 0 && effective != null;

  const submit = async () => {
    if (!ready || effective == null) return;
    const payload: Record<string, unknown> = {
      customer_id: customerId,
      title: title.trim(),
      stage: 'NEW',
      probability: CRM_STAGE_PROBABILITY.NEW,
      travelers: count,
      expected_value_dzd: Number(effective.toFixed(2)),
    };
    if (packageId) payload.package_id = packageId;
    if (closeDate) payload.expected_close_date = closeDate;
    if (notes.trim()) payload.notes = notes.trim();

    await cmd.run(() => crmOpportunityCommands.create(payload), {
      notice: t('تم إنشاء الفرصة', 'Opportunité créée', 'Opportunity created'),
      onSuccess: async () => { await onCreated(); },
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
      {customers.error && <ErrorBanner message={customers.error} onRetry={() => { void customers.refetch(); }} />}
      {packages.error && <ErrorBanner message={packages.error} onRetry={() => { void packages.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('العميل', 'Client', 'Customer')}>
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input">
            <option value="">{t('اختر عميلاً', 'Choisir un client', 'Select a customer')}</option>
            {customers.data.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` · ${c.phone}` : ''}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('العنوان', 'Intitulé', 'Title')}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            placeholder={t('عمرة رمضان — عائلة', 'Omra Ramadan — famille', 'Ramadan Umrah — family')}
          />
        </Field>

        <Field
          label={t('الباقة (اختياري)', 'Forfait (optionnel)', 'Package (optional)')}
          hint={chosenPackage?.price_dzd != null
            ? `${fmtMoney(chosenPackage.price_dzd)} × ${count}`
            : undefined}
        >
          <Select value={packageId} onChange={(e) => setPackageId(e.target.value)} className="input">
            <option value="">{t('بدون باقة', 'Aucun forfait', 'No package')}</option>
            {packages.data.map((p) => (
              <option key={p.id} value={p.id}>{p.name ?? p.code ?? p.id.slice(0, 8)}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('عدد المعتمرين', 'Pèlerins', 'Travellers')}>
          <input
            type="number"
            min={1}
            value={travelers}
            onChange={(e) => setTravelers(e.target.value)}
            className="input tabular"
          />
        </Field>

        <Field
          label={t('القيمة المتوقعة (دج)', 'Valeur attendue (DZD)', 'Expected value (DZD)')}
          hint={effective != null
            ? `${t('سيتم الإرسال', 'Sera envoyé', 'Will send')}: ${fmtMoney(effective)}`
            : t('أدخل قيمة أو اختر باقة', 'Saisir une valeur ou choisir un forfait', 'Type a value or pick a package')}
        >
          <input
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={derived != null ? String(derived) : ''}
            className="input tabular"
          />
        </Field>

        <Field label={t('تاريخ الإغلاق المتوقع', 'Clôture prévue', 'Expected close')}>
          <input
            type="date"
            min={isoToday()}
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
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
          disabled={busy || cmd.busy || !ready}
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
              'العميل والعنوان والقيمة مطلوبة',
              'Client, intitulé et valeur obligatoires',
              'Customer, title and a value are required',
            )}
          </span>
        )}
      </div>
    </div>
  );
}
