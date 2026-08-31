/**
 * A new quote, always as a DRAFT with no lines yet.
 *
 * Three things are deliberately absent. The quote number: a trigger assigns it and
 * ignores whatever the client sends. The totals: subtotal is rolled up from the
 * lines and total_amount is subtotal − discount, both computed by triggers. The
 * discount: at creation the subtotal is still zero, and the server refuses a
 * discount above the subtotal, so the field belongs in the lines editor where the
 * subtotal is known.
 *
 * customer_id comes from the chosen opportunity rather than a second picker. A
 * quote for one customer against another customer's opportunity is not a case
 * worth supporting; it is a data-entry accident.
 */
import { useMemo, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmQuoteCommands } from '@/services/domainCommands';
import type { CrmCurrency } from '@/types/crm';
import { Field, NoticeBar } from './atoms';
import { fmtMoney, isoToday, useCrmI18n } from './crmFormat';
import { useCrmOpportunityRows, useCrmPackageOptions } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

const CURRENCIES: readonly CrmCurrency[] = ['DZD', 'SAR'];

export function CrmQuoteForm({ onCancel, onCreated }: {
  onCancel: () => void;
  onCreated: (quoteId: string | null) => Promise<void> | void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const opportunities = useCrmOpportunityRows({ limit: 200 });
  const packages = useCrmPackageOptions();

  const [opportunityId, setOpportunityId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [currency, setCurrency] = useState<CrmCurrency>('DZD');
  const [travelers, setTravelers] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');

  // WON and LOST opportunities are filtered out: accept_crm_quote refuses both,
  // so offering them here would only produce a quote that can never be accepted.
  const open = useMemo(
    () => opportunities.data.filter((o) => o.stage !== 'WON' && o.stage !== 'LOST'),
    [opportunities.data],
  );
  const chosen = useMemo(() => open.find((o) => o.id === opportunityId) ?? null, [open, opportunityId]);
  const effectivePackage = packageId || chosen?.package_id || '';
  const packageRow = useMemo(
    () => packages.data.find((p) => p.id === effectivePackage) ?? null,
    [packages.data, effectivePackage],
  );
  const count = travelers.trim() === ''
    ? (chosen?.travelers ?? 1)
    : Math.max(1, Math.trunc(Number(travelers) || 1));

  const submit = async () => {
    if (!chosen) return;
    const payload: Record<string, unknown> = {
      opportunity_id: chosen.id,
      customer_id: chosen.customer_id,
      currency_code: currency,
      travelers: count,
    };
    if (effectivePackage) payload.package_id = effectivePackage;
    if (validUntil) payload.valid_until = validUntil;
    if (terms.trim()) payload.terms = terms.trim();
    if (notes.trim()) payload.notes = notes.trim();

    await cmd.run(() => crmQuoteCommands.create(payload), {
      notice: t('تم إنشاء مسودة عرض', 'Devis brouillon créé', 'Draft quote created'),
      onSuccess: async (data) => { await onCreated(data?.id ?? null); },
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
      {opportunities.error && <ErrorBanner message={opportunities.error} onRetry={() => { void opportunities.refetch(); }} />}
      {packages.error && <ErrorBanner message={packages.error} onRetry={() => { void packages.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={t('الفرصة', 'Opportunité', 'Opportunity')}
          hint={chosen ? `${chosen.stage} · ${fmtMoney(chosen.expected_value_dzd)}` : undefined}
        >
          <Select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} className="input">
            <option value="">{t('اختر فرصة', 'Choisir', 'Select an opportunity')}</option>
            {open.map((o) => (
              <option key={o.id} value={o.id}>{o.reference} · {o.title}</option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('الباقة', 'Forfait', 'Package')}
          hint={packageRow
            ? `${packageRow.status ?? '—'} · ${t('مقاعد', 'places', 'seats')} ${packageRow.seats_available ?? 0}`
            : t('مطلوبة قبل القبول', 'Requis avant acceptation', 'Required before acceptance')}
        >
          <Select value={effectivePackage} onChange={(e) => setPackageId(e.target.value)} className="input">
            <option value="">{t('بدون', 'Aucun', 'None')}</option>
            {packages.data.map((p) => (
              <option key={p.id} value={p.id}>{p.name ?? p.code ?? p.id.slice(0, 8)}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('العملة', 'Devise', 'Currency')}>
          <Select
            value={currency}
            onChange={(e) => setCurrency(e.target.value === 'SAR' ? 'SAR' : 'DZD')}
            className="input"
          >
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>

        <Field label={t('عدد المعتمرين', 'Pèlerins', 'Travellers')}>
          <input
            type="number"
            min={1}
            value={travelers}
            onChange={(e) => setTravelers(e.target.value)}
            placeholder={String(chosen?.travelers ?? 1)}
            className="input tabular"
          />
        </Field>

        <Field
          label={t('صالح حتى', 'Valable jusqu’au', 'Valid until')}
          hint={t('يُحدَّد عند الإرسال إن تُرك فارغاً', 'Défini à l’envoi si vide', 'Set on send when left empty')}
        >
          <input
            type="date"
            min={isoToday()}
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="input"
          />
        </Field>

        <Field label={t('الشروط', 'Conditions', 'Terms')}>
          <input value={terms} onChange={(e) => setTerms(e.target.value)} className="input" />
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
          disabled={cmd.busy || !chosen}
          onClick={() => { void submit(); }}
        >
          {t('إنشاء مسودة', 'Créer le brouillon', 'Create draft')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={cmd.busy}>
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
        <span className="text-[11px] text-[var(--text-muted)]">
          {t(
            'الرقم والإجماليات تُحسب في قاعدة البيانات',
            'Numéro et totaux calculés en base',
            'The number and the totals are computed in the database',
          )}
        </span>
      </div>
    </div>
  );
}
