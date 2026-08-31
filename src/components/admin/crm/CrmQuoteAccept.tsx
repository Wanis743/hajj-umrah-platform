/**
 * Quote acceptance -- the one screen in the CRM that moves money.
 *
 * One click on Confirm runs private.accept_crm_quote, and that single transaction
 * creates the pilgrim when the customer has none, the booking, the payment when an
 * amount is given and the balanced journal entry behind it; it decrements the
 * package seats, expires the opportunity's other open quotes, marks the opportunity
 * WON with a stage-history row, cancels the open follow-ups and stamps the
 * customer's first_won_at. Nothing on this screen can undo any of that, which is
 * why Confirm takes two clicks.
 *
 * The pre-flight list is derived, never asserted: every line is a condition
 * accept_crm_quote itself checks, evaluated against rows this screen has actually
 * read. A condition it cannot evaluate -- a package outside the loaded page, an
 * opportunity outside it -- says so. It neither passes by default nor blocks the
 * button, because the server is the authority in both directions.
 *
 * The amount is one field in the quote's own currency. accept_crm_quote refuses a
 * payment in the other one ("This quote is priced in DZD; record the payment in
 * DZD") and refuses both at once as a multi-currency transaction, so a second field
 * would only offer a way to fail.
 */
import { useMemo, useState } from 'react';
import { Check, HelpCircle, X } from 'lucide-react';
import { ErrorBanner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmLifecycleCommands } from '@/services/domainCommands';
import type { CrmQuoteAcceptedResult, CrmQuoteRow } from '@/types/crm';
import { Field, KeyValue, NoticeBar } from './atoms';
import { DASH, fmtDate, fmtInt, fmtMoney, isoToday, useCrmI18n } from './crmFormat';
import { useCrmGroupOptions, useCrmOpportunityRows, useCrmPackageOptions } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

/** The vocabulary the ledger screens already use (FinancialLedgerManager), not the
 *  SCREAMING_CASE variant one modal invented: payments.payment_method is free text,
 *  and two spellings of one method cannot be grouped in a report. */
const METHODS: readonly string[] = ['Cash', 'Bank Transfer', 'Check', 'Card', 'CCP', 'BaridiMob'];

/** ok = this screen verified it. block = the server will refuse, so Confirm is
 *  disabled. unknown = no row here to judge with, so the server decides. */
type CheckState = 'ok' | 'block' | 'unknown';

interface Preflight { key: string; label: string; detail: string; state: CheckState }

function CheckRow({ check }: { check: Preflight }) {
  const Icon = check.state === 'ok' ? Check : check.state === 'block' ? X : HelpCircle;
  const tone = check.state === 'ok'
    ? 'text-[var(--success)]'
    : check.state === 'block' ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]';
  return (
    <li className="flex items-start gap-2">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="text-[12px] leading-snug">
        <span className="text-[var(--text-primary)]">{check.label}</span>
        <span className="ms-1.5 text-[var(--text-muted)]">{check.detail}</span>
      </span>
    </li>
  );
}

function toAmount(raw: string): number | null {
  if (raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

export function CrmQuoteAccept({ quote, onAccepted, onClose }: {
  quote: CrmQuoteRow;
  onAccepted: (result: CrmQuoteAcceptedResult) => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const packages = useCrmPackageOptions();
  const opportunities = useCrmOpportunityRows({ limit: 200 });
  const groups = useCrmGroupOptions();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [groupId, setGroupId] = useState('');
  const [passport, setPassport] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CrmQuoteAcceptedResult | null>(null);

  const money = (v: number | null) => fmtMoney(v, quote.currency_code);

  // coalesce(q.package_id, o.package_id) -- the same order accept_crm_quote uses.
  const opportunity = useMemo(
    () => opportunities.data.find((o) => o.id === quote.opportunity_id) ?? null,
    [opportunities.data, quote.opportunity_id],
  );
  const packageResolved = quote.package_id !== null || opportunity !== null;
  const packageId = quote.package_id ?? opportunity?.package_id ?? null;
  const packageRow = useMemo(
    () => (packageId ? packages.data.find((p) => p.id === packageId) ?? null : null),
    [packages.data, packageId],
  );

  const amountValue = toAmount(amount);

  const checks = useMemo<Preflight[]>(() => {
    const list: Preflight[] = [];

    list.push(quote.status === 'SENT'
      ? { key: 'status', state: 'ok', label: t('العرض مُرسل', 'Devis envoyé', 'The quote is sent'), detail: '' }
      : {
        key: 'status', state: 'block',
        label: t('لا يمكن القبول', 'Acceptation impossible', 'Cannot be accepted'),
        detail: t(
          `يمكن قبول العرض المُرسل فقط (هذا ${quote.status})`,
          `Seul un devis envoyé peut être accepté (celui-ci est ${quote.status})`,
          `Only a sent quote can be accepted (this one is ${quote.status})`,
        ),
      });

    const today = isoToday();
    if (quote.valid_until === null) {
      list.push({
        key: 'expiry', state: 'unknown',
        label: t('الصلاحية', 'Validité', 'Validity'),
        detail: t('لا تاريخ مسجّل', 'Aucune date enregistrée', 'no date recorded'),
      });
    } else if (quote.valid_until < today) {
      list.push({
        key: 'expiry', state: 'block',
        label: t('انتهت الصلاحية', 'Devis expiré', 'The quote has expired'),
        detail: fmtDate(quote.valid_until),
      });
    } else {
      list.push({
        key: 'expiry', state: 'ok',
        label: t('ساري', 'Valable', 'Still valid'),
        detail: fmtDate(quote.valid_until),
      });
    }

    if (!packageResolved) {
      list.push({
        key: 'package', state: 'unknown',
        label: t('الباقة', 'Forfait', 'Package'),
        detail: t('الفرصة خارج القائمة المحمّلة', 'Opportunité hors de la liste chargée', 'the opportunity is outside the loaded list'),
      });
    } else if (packageId === null) {
      list.push({
        key: 'package', state: 'block',
        label: t('لا باقة', 'Aucun forfait', 'No package'),
        detail: t(
          'العرض يحتاج باقة قبل القبول',
          'Un devis doit référencer un forfait avant acceptation',
          'a quote must reference a package before it can be accepted',
        ),
      });
    } else if (!packageRow) {
      list.push({
        key: 'package', state: 'unknown',
        label: t('الباقة', 'Forfait', 'Package'),
        detail: t('خارج القائمة المحمّلة', 'Hors de la liste chargée', 'outside the loaded list'),
      });
    } else if (packageRow.status !== 'ACTIVE') {
      list.push({
        key: 'package', state: 'block',
        label: t('الباقة غير نشطة', 'Forfait inactif', 'The package is not active'),
        detail: packageRow.status ?? DASH,
      });
    } else {
      list.push({
        key: 'package', state: 'ok',
        label: t('الباقة نشطة', 'Forfait actif', 'The package is active'),
        detail: packageRow.name ?? packageRow.code ?? '',
      });
    }

    const seats = packageRow?.seats_available ?? null;
    if (seats === null) {
      list.push({
        key: 'seats', state: 'unknown',
        label: t('المقاعد', 'Places', 'Seats'),
        detail: t('غير معروفة هنا', 'Inconnues ici', 'not known here'),
      });
    } else if (seats < quote.travelers) {
      list.push({
        key: 'seats', state: 'block',
        label: t('المقاعد غير كافية', 'Places insuffisantes', 'Not enough seats'),
        detail: `${fmtInt(seats)} / ${fmtInt(quote.travelers)}`,
      });
    } else {
      list.push({
        key: 'seats', state: 'ok',
        label: t('المقاعد متوفرة', 'Places disponibles', 'Seats available'),
        detail: `${fmtInt(seats)} ≥ ${fmtInt(quote.travelers)}`,
      });
    }

    if (amountValue === null) {
      list.push({
        key: 'payment', state: 'block',
        label: t('المبلغ غير صالح', 'Montant invalide', 'The amount is not a number'),
        detail: amount,
      });
    } else if (amountValue < 0) {
      list.push({
        key: 'payment', state: 'block',
        label: t('المبلغ سالب', 'Montant négatif', 'The amount is negative'),
        detail: '',
      });
    } else if (amountValue > quote.total_amount) {
      list.push({
        key: 'payment', state: 'block',
        label: t('الدفعة تتجاوز الإجمالي', 'Le paiement dépasse le total', 'The payment exceeds the quoted total'),
        detail: `${fmtMoney(amountValue, quote.currency_code)} > ${fmtMoney(quote.total_amount, quote.currency_code)}`,
      });
    } else if (amountValue === 0) {
      list.push({
        key: 'payment', state: 'ok',
        label: t('بدون دفعة', 'Sans paiement', 'No payment'),
        detail: t('حجز فقط، ولا قيد محاسبي', 'Réservation seule, aucune écriture', 'booking only, no journal entry'),
      });
    } else {
      list.push({
        key: 'payment', state: 'ok',
        label: t('الدفعة', 'Paiement', 'Payment'),
        detail: `${fmtMoney(amountValue, quote.currency_code)} · ${t('الرصيد', 'Solde', 'balance')} ${fmtMoney(Number((quote.total_amount - amountValue).toFixed(2)), quote.currency_code)}`,
      });
    }

    return list;
  }, [
    amount, amountValue, packageId, packageResolved, packageRow, t,
    quote.currency_code, quote.status, quote.total_amount, quote.travelers, quote.valid_until,
  ]);

  const blocked = checks.some((c) => c.state === 'block');

  const submit = async () => {
    if (blocked || amountValue === null) return;
    await cmd.run(
      () => crmLifecycleCommands.acceptQuote(quote.id, {
        // One currency, never both: the server treats a nonzero pair as a
        // multi-currency transaction and refuses it.
        paymentAmountDzd: quote.currency_code === 'DZD' ? amountValue : 0,
        paymentAmountSar: quote.currency_code === 'SAR' ? amountValue : 0,
        paymentMethod: method,
        groupId: groupId === '' ? null : groupId,
        passportNumber: passport.trim() === '' ? null : passport.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
      }),
      {
        notice: t('تم قبول العرض', 'Devis accepté', 'Quote accepted'),
        onSuccess: async (data) => {
          if (data) setResult(data);
          if (data) await onAccepted(data);
        },
      },
    );
    setConfirming(false);
  };

  // The receipt. Every id below is a row that now exists, so it is shown as the
  // server returned it rather than summarised away.
  if (result !== null) {
    const journal = result.payment_id === null
      ? t('لا دفعة، فلا قيد', 'Aucun paiement, aucune écriture', 'no payment, so no entry')
      : result.journal_entry_id ?? t('الدفعة لم تُنتج قيداً', 'Le paiement n’a produit aucune écriture', 'the payment posted no entry');
    return (
      <div className="rounded-lg border border-[var(--border)] p-3">
        <NoticeBar message={t(
          `تم إنشاء الحجز ${result.booking_reference}`,
          `Réservation ${result.booking_reference} créée`,
          `Booking ${result.booking_reference} created`,
        )} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KeyValue label={t('العرض', 'Devis', 'Quote')} value={result.quote_number} mono />
          <KeyValue label={t('الحجز', 'Réservation', 'Booking')} value={result.booking_reference} mono />
          <KeyValue label={t('عدد المعتمرين', 'Pèlerins', 'Travellers')} value={fmtInt(result.travelers)} mono />
          <KeyValue
            label={t('الإجمالي', 'Total', 'Total')}
            value={fmtMoney(result.total_amount, result.currency_code)}
            mono
          />
          <KeyValue
            label={t('الدفعة', 'Paiement', 'Payment')}
            value={result.payment_id ?? t('لم تُسجَّل دفعة', 'Aucun paiement enregistré', 'no payment recorded')}
            mono
          />
          <KeyValue label={t('القيد المحاسبي', 'Écriture', 'Journal entry')} value={journal} mono />
          <KeyValue label={t('المعتمر', 'Pèlerin', 'Pilgrim')} value={result.pilgrim_id} mono />
        </div>
        <p className="mt-3 text-[12px] text-[var(--text-muted)]">
          {t(
            'الفرصة أصبحت مكسوبة، وعروضها الأخرى المفتوحة انتهت، والمتابعات المفتوحة أُلغيت، ومقاعد الباقة نُقصت.',
            'L’opportunité est gagnée, ses autres devis ouverts ont expiré, les relances ouvertes sont annulées et les places du forfait ont été décrémentées.',
            'The opportunity is won, its other open quotes expired, open follow-ups were cancelled and the package seats were decremented.',
          )}
        </p>
        <button type="button" className="btn btn-sm mt-3" onClick={onClose}>
          {t('إغلاق', 'Fermer', 'Close')}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      {packages.error && <ErrorBanner message={packages.error} onRetry={() => { void packages.refetch(); }} />}
      {opportunities.error && <ErrorBanner message={opportunities.error} onRetry={() => { void opportunities.refetch(); }} />}
      {groups.error && <ErrorBanner message={groups.error} onRetry={() => { void groups.refetch(); }} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={`${t('الدفعة', 'Paiement', 'Payment')} (${quote.currency_code})`}
            hint={t(
              'اتركه فارغاً لحجز بدون دفعة',
              'Laisser vide pour réserver sans paiement',
              'Leave empty to book without a payment',
            )}
          >
            <input
              type="number"
              min={0}
              max={quote.total_amount}
              step="0.01"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setConfirming(false); }}
              className="input tabular"
            />
          </Field>

          <Field label={t('طريقة الدفع', 'Mode de paiement', 'Payment method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)} className="input">
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>

          <Field
            label={t('الفوج (اختياري)', 'Groupe (optionnel)', 'Group (optional)')}
            hint={t('يمكن إسناده لرحلة لاحقاً', 'Assignable à un départ plus tard', 'Can be assigned to a departure later')}
          >
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="input">
              <option value="">{t('بدون فوج', 'Aucun groupe', 'No group')}</option>
              {groups.data.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name ?? g.code ?? g.id.slice(0, 8)}
                  {g.departure_date ? ` · ${fmtDate(g.departure_date)}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t('رقم جواز السفر (اختياري)', 'N° de passeport (optionnel)', 'Passport number (optional)')}
            hint={t(
              'يُستخدم فقط إذا لم يكن للعميل معتمر مسجّل',
              'Utilisé seulement si le client n’a pas encore de pèlerin',
              'Used only when the customer has no pilgrim yet',
            )}
          >
            <input value={passport} onChange={(e) => setPassport(e.target.value)} className="input" />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t('ملاحظات', 'Notes', 'Notes')}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {t('فحص قبل القبول', 'Contrôles avant acceptation', 'Pre-flight')}
          </p>
          <ul className="space-y-1.5">
            {checks.map((c) => <CheckRow key={c.key} check={c} />)}
          </ul>
          <div className="mt-3 border-t border-[var(--border)] pt-2">
            <KeyValue
              label={t('الإجمالي المطلوب', 'Total du devis', 'Quoted total')}
              value={money(quote.total_amount)}
              mono
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          className={confirming ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm'}
          disabled={cmd.busy || blocked}
          onClick={() => {
            // Two clicks, not window.confirm: the second one posts a booking, a
            // payment and a journal entry that this screen cannot take back.
            if (confirming) { void submit(); return; }
            setConfirming(true);
          }}
        >
          {confirming
            ? t('تأكيد القبول', 'Confirmer l’acceptation', 'Confirm acceptance')
            : t('قبول العرض', 'Accepter le devis', 'Accept quote')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={cmd.busy}>
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
        <span className="text-[11px] text-[var(--text-muted)]">
          {blocked
            ? t('عنصر واحد على الأقل يمنع القبول', 'Au moins un contrôle bloque', 'At least one check blocks acceptance')
            : t(
              'ينشئ حجزاً ودفعة وقيداً محاسبياً في عملية واحدة',
              'Crée réservation, paiement et écriture en une transaction',
              'Creates a booking, a payment and a journal entry in one transaction',
            )}
        </span>
      </div>
    </div>
  );
}

