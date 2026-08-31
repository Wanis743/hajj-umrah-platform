/**
 * Campaigns, and what each one actually returned.
 *
 * The list is the editable side: budget, spend, dates, status. The ROI table below
 * it is not editable and not computed here -- get_crm_campaign_roi derives every
 * figure in SQL from the leads attributed to the campaign, the opportunities those
 * leads became, and the payments collected against the resulting bookings.
 *
 * revenue_basis is COLLECTED_BOOKING_PAYMENTS_DZD, and that is stated on the screen
 * rather than implied: ROI here is money actually received, not money invoiced, so
 * a campaign with confirmed bookings and no payments yet shows a negative return
 * and it is telling the truth.
 *
 * cost_per_lead, cost_per_won, conversion_rate and roi_pct arrive as null whenever
 * their denominator is zero. They render as an em dash. A campaign with no leads
 * has no cost per lead; printing 0 would claim it was free.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmAnalytics } from '@/services/crmAnalytics';
import { crmCampaignCommands } from '@/services/domainCommands';
import type { CrmCampaignChannel, CrmCampaignRoi, CrmCampaignRow, CrmCampaignStatus } from '@/types/crm';
import { Field, Meter, NoticeBar, Panel, Pill } from './atoms';
import { DASH, fmtDate, fmtInt, fmtMoney, fmtPct, isoDaysAgo, isoToday, toneForStatus, useCrmI18n, useCrmRead } from './crmFormat';
import { useCrmCampaignRows } from './crmRows';
import { useCrmCommand } from './useCrmCommand';

const CHANNELS: readonly CrmCampaignChannel[] = [
  'FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'WHATSAPP', 'SMS', 'EMAIL',
  'REFERRAL', 'WALK_IN', 'EVENT', 'MOSQUE', 'OTHER',
];
const STATUSES: readonly CrmCampaignStatus[] = ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'];

export function CrmCampaignsPanel() {
  const { t } = useCrmI18n();
  const [status, setStatus] = useState<CrmCampaignStatus | 'ALL'>('ALL');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const campaigns = useCrmCampaignRows();

  const rows = useMemo(
    () => (status === 'ALL' ? campaigns.data : campaigns.data.filter((c) => c.status === status)),
    [campaigns.data, status],
  );
  const editing = useMemo(
    () => campaigns.data.find((c) => c.id === editingId) ?? null,
    [campaigns.data, editingId],
  );
  const activeBudget = useMemo(
    () => campaigns.data.filter((c) => c.status === 'ACTIVE').reduce((sum, c) => sum + c.budget_dzd, 0),
    [campaigns.data],
  );

  return (
    <div className="space-y-4">
      <Panel
        title={t('الحملات', 'Campagnes', 'Campaigns')}
        subtitle={t(
          `ميزانية الحملات النشطة ${fmtMoney(activeBudget)}`,
          `Budget des campagnes actives ${fmtMoney(activeBudget)}`,
          `Active campaign budget ${fmtMoney(activeBudget)}`,
        )}
        actions={(
          <>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as CrmCampaignStatus | 'ALL')}
              className="input w-auto"
            >
              <option value="ALL">ALL</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setCreating((v) => !v); setEditingId(null); }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('حملة', 'Campagne', 'New')}
            </button>
          </>
        )}
      >
        {campaigns.error && <ErrorBanner message={campaigns.error} onRetry={() => { void campaigns.refetch(); }} />}

        {(creating || editing) && (
          <CampaignForm
            key={editing?.id ?? 'new'}
            campaign={editing}
            onCancel={() => { setCreating(false); setEditingId(null); }}
            onSaved={async () => {
              setCreating(false);
              setEditingId(null);
              await campaigns.refetch();
            }}
          />
        )}

        {campaigns.loading && campaigns.data.length === 0 ? (
          <Spinner className="p-6" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا حملات', 'Aucune campagne', 'No campaigns')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[880px]">
              <thead>
                <tr>
                  <th>{t('الرمز', 'Code', 'Code')}</th>
                  <th>{t('الحملة', 'Campagne', 'Campaign')}</th>
                  <th>{t('القناة', 'Canal', 'Channel')}</th>
                  <th>{t('الحالة', 'Statut', 'Status')}</th>
                  <th>{t('الفترة', 'Période', 'Window')}</th>
                  <th className="end">{t('الميزانية', 'Budget', 'Budget')}</th>
                  <th className="end">{t('المصروف', 'Dépensé', 'Spent')}</th>
                  <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => <CampaignRow key={c.id} campaign={c} onEdit={() => setEditingId(c.id)} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <RoiSection />
    </div>
  );
}

/** One list row. The spend bar is drawn from this row's own two columns, not from
 *  the ROI payload: a campaign with a zero budget gets an empty track and an em
 *  dash, because "0% of nothing spent" is not a fact about the campaign. */
function CampaignRow({ campaign, onEdit }: { campaign: CrmCampaignRow; onEdit: () => void }) {
  const { t } = useCrmI18n();
  const used = campaign.budget_dzd > 0
    ? Math.round((campaign.spend_dzd / campaign.budget_dzd) * 1000) / 10
    : null;
  const over = used !== null && used > 100;

  return (
    <tr>
      <td className="tabular">{campaign.code}</td>
      <td>
        {campaign.name}
        {campaign.target_segment && (
          <span className="ms-2 text-[11px] text-[var(--text-muted)]">{campaign.target_segment}</span>
        )}
      </td>
      <td className="text-[12px] text-[var(--text-muted)]">{campaign.channel}</td>
      <td><Pill tone={toneForStatus(campaign.status)}>{campaign.status}</Pill></td>
      <td className="whitespace-nowrap text-[12px]">
        {fmtDate(campaign.start_date)} {DASH} {fmtDate(campaign.end_date)}
      </td>
      <td className="end tabular text-end">{fmtMoney(campaign.budget_dzd)}</td>
      <td className="end text-end">
        <span className="tabular">{fmtMoney(campaign.spend_dzd)}</span>
        <span className="mt-1 block">
          <Meter
            value={campaign.spend_dzd}
            max={campaign.budget_dzd}
            tone={over ? 'bad' : 'info'}
            label={t('استخدام الميزانية', 'Utilisation du budget', 'Budget used')}
          />
        </span>
        <span className={`mt-0.5 block text-[11px] ${over ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
          {fmtPct(used)}
        </span>
      </td>
      <td className="end">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          {t('تعديل', 'Modifier', 'Edit')}
        </button>
      </td>
    </tr>
  );
}

/** '' -> null so a cleared date clears the column; a non-finite or negative
 *  amount -> null, which blocks submission rather than sending a value the
 *  check constraint would reject. */
function toAmount(raw: string): number | null {
  if (raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Create and edit share one form. On edit only the changed columns are sent:
 *  patch_scoped_command_row raises 22023 on an empty payload, so an unchanged
 *  form has its Save button disabled instead of sending nothing. `code` is on
 *  neither path -- the column carries its own CMP-YYMMDD-XXXXXXXX default. */
function CampaignForm({ campaign, onCancel, onSaved }: {
  campaign: CrmCampaignRow | null;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useCrmI18n();
  const cmd = useCrmCommand();
  const [name, setName] = useState(campaign?.name ?? '');
  const [channel, setChannel] = useState<CrmCampaignChannel>(campaign?.channel ?? 'FACEBOOK');
  const [campaignStatus, setCampaignStatus] = useState<CrmCampaignStatus>(campaign?.status ?? 'PLANNED');
  const [startDate, setStartDate] = useState(campaign?.start_date ?? '');
  const [endDate, setEndDate] = useState(campaign?.end_date ?? '');
  const [budget, setBudget] = useState(campaign ? String(campaign.budget_dzd) : '0');
  const [spend, setSpend] = useState(campaign ? String(campaign.spend_dzd) : '0');
  const [segment, setSegment] = useState(campaign?.target_segment ?? '');
  const [notes, setNotes] = useState(campaign?.notes ?? '');

  const budgetValue = toAmount(budget);
  const spendValue = toAmount(spend);
  // crm_campaigns_date_order: end_date >= start_date. Checked here so the form can
  // say so before the round trip; the constraint is still what enforces it.
  const datesOrdered = startDate === '' || endDate === '' || endDate >= startDate;
  const amountsValid = budgetValue !== null && spendValue !== null;
  const ready = name.trim() !== '' && amountsValid && datesOrdered;

  const patch = useMemo(() => {
    if (!campaign || budgetValue === null || spendValue === null) return {};
    const next: Record<string, unknown> = {};
    // One comparison per column, so a field the user opened and left alone is not
    // sent. `|| null` on the optional text and date columns turns a cleared input
    // into an explicit null rather than an empty string the column would store.
    const put = (column: string, value: unknown, current: unknown) => {
      if (value !== current) next[column] = value;
    };
    put('name', name.trim(), campaign.name);
    put('channel', channel, campaign.channel);
    put('status', campaignStatus, campaign.status);
    put('start_date', startDate || null, campaign.start_date);
    put('end_date', endDate || null, campaign.end_date);
    put('budget_dzd', budgetValue, campaign.budget_dzd);
    put('spend_dzd', spendValue, campaign.spend_dzd);
    put('target_segment', segment.trim() || null, campaign.target_segment);
    put('notes', notes.trim() || null, campaign.notes);
    return next;
  }, [campaign, name, channel, campaignStatus, startDate, endDate, budgetValue, spendValue, segment, notes]);

  const dirty = Object.keys(patch).length > 0;

  const submit = async () => {
    if (!ready || budgetValue === null || spendValue === null) return;
    if (campaign) {
      if (!dirty) return;
      await cmd.run(() => crmCampaignCommands.update(campaign.id, patch), {
        notice: t('تم تحديث الحملة', 'Campagne mise à jour', 'Campaign updated'),
        onSuccess: async () => { await onSaved(); },
      });
      return;
    }
    const payload: Record<string, unknown> = {
      name: name.trim(),
      channel,
      status: campaignStatus,
      budget_dzd: budgetValue,
      spend_dzd: spendValue,
    };
    if (startDate) payload.start_date = startDate;
    if (endDate) payload.end_date = endDate;
    if (segment.trim()) payload.target_segment = segment.trim();
    if (notes.trim()) payload.notes = notes.trim();

    await cmd.run(() => crmCampaignCommands.create(payload), {
      notice: t('تم إنشاء الحملة', 'Campagne créée', 'Campaign created'),
      onSuccess: async () => { await onSaved(); },
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('الاسم', 'Nom', 'Name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </Field>
        <Field label={t('القناة', 'Canal', 'Channel')}>
          <Select
            value={channel}
            onChange={(e) => setChannel(e.target.value as CrmCampaignChannel)}
            className="input"
          >
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label={t('الحالة', 'Statut', 'Status')}>
          <Select
            value={campaignStatus}
            onChange={(e) => setCampaignStatus(e.target.value as CrmCampaignStatus)}
            className="input"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label={t('البداية', 'Début', 'Start')}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
        </Field>
        <Field
          label={t('النهاية', 'Fin', 'End')}
          hint={datesOrdered ? undefined : t(
            'النهاية لا يمكن أن تسبق البداية',
            'La fin ne peut précéder le début',
            'The end cannot precede the start',
          )}
        >
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
        </Field>
        <Field label={t('القطاع المستهدف', 'Segment ciblé', 'Target segment')}>
          <input value={segment} onChange={(e) => setSegment(e.target.value)} className="input" />
        </Field>
        <Field
          label={t('الميزانية (دج)', 'Budget (DZD)', 'Budget (DZD)')}
          hint={budgetValue === null
            ? t('مبلغ غير صالح', 'Montant invalide', 'Not a valid amount')
            : undefined}
        >
          <input
            type="number"
            min={0}
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="input tabular"
          />
        </Field>
        <Field
          label={t('المصروف (دج)', 'Dépensé (DZD)', 'Spent (DZD)')}
          hint={spendValue === null
            ? t('مبلغ غير صالح', 'Montant invalide', 'Not a valid amount')
            : t('يُدخل يدوياً، ويقود تكلفة العميل المحتمل', 'Saisi à la main, pilote le coût par prospect', 'Entered by hand; drives cost per lead')}
        >
          <input
            type="number"
            min={0}
            step="0.01"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            className="input tabular"
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
          disabled={cmd.busy || !ready || (campaign !== null && !dirty)}
          onClick={() => { void submit(); }}
        >
          {campaign ? t('حفظ', 'Enregistrer', 'Save') : t('إنشاء', 'Créer', 'Create')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={cmd.busy}>
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
        {campaign && !dirty && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {t('لا تغييرات', 'Aucune modification', 'Nothing changed')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The return side. Every column below is read from get_crm_campaign_roi; none of
 * it is computed here except the two column sums in the footer, which are sums of
 * DZD over the rows on screen and are labelled as such. No aggregate ROI is
 * printed: a ratio over a mixed set of campaigns is a different figure from the
 * per-campaign ones, and the server did not send it.
 */
function RoiSection() {
  const { t } = useCrmI18n();
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(isoToday());
  const roi = useCrmRead<CrmCampaignRoi>(() => crmAnalytics.campaignRoi(from, to), [from, to]);

  // Memoised for identity, not for cost: `?? []` would be a new array each render
  // and the totals memo below it would recompute every time regardless.
  const rows = useMemo(() => roi.data?.campaigns ?? [], [roi.data]);
  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({ spend: acc.spend + r.spend_dzd, collected: acc.collected + r.collected_dzd }),
    { spend: 0, collected: 0 },
  ), [rows]);

  return (
    <Panel
      title={t('مردود الحملات', 'ROI des campagnes', 'Campaign ROI')}
      subtitle={t(
        'الإيراد = الدفعات المحصَّلة فعلاً على الحجوزات، لا المبالغ المفوترة',
        'Revenu = paiements réellement encaissés sur les réservations, non les montants facturés',
        'Revenue = payments actually collected against bookings, not amounts invoiced',
      )}
      actions={(
        <>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input w-auto"
            aria-label={t('من', 'Du', 'From')}
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input w-auto"
            aria-label={t('إلى', 'Au', 'To')}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { roi.reload(); }}>
            {t('تحديث', 'Rafraîchir', 'Refresh')}
          </button>
        </>
      )}
    >
      {roi.error && <ErrorBanner message={roi.error} onRetry={() => { roi.reload(); }} />}

      {roi.loading && roi.data === null ? (
        <Spinner className="p-6" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا حملات في هذه الفترة', 'Aucune campagne sur la période', 'No campaigns in this window')}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table min-w-[1080px]">
              <thead>
                <tr>
                  <th>{t('الحملة', 'Campagne', 'Campaign')}</th>
                  <th className="end">{t('المصروف', 'Dépensé', 'Spent')}</th>
                  <th className="end">{t('محتملون', 'Prospects', 'Leads')}</th>
                  <th className="end">{t('محوَّلون', 'Convertis', 'Converted')}</th>
                  <th className="end">{t('فرص', 'Opport.', 'Opps')}</th>
                  <th className="end">{t('مكسوبة', 'Gagnées', 'Won')}</th>
                  <th className="end">{t('محجوز', 'Réservé', 'Booked')}</th>
                  <th className="end">{t('محصَّل', 'Encaissé', 'Collected')}</th>
                  <th className="end">{t('كلفة المحتمل', 'Coût/prospect', 'Cost/lead')}</th>
                  <th className="end">{t('كلفة المكسوبة', 'Coût/gain', 'Cost/won')}</th>
                  <th className="end">{t('التحويل', 'Conversion', 'Conv.')}</th>
                  <th className="end">{t('المردود', 'ROI', 'ROI')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <RoiRow key={r.campaign_id} row={r} />)}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t('مجموع الأسطر المعروضة', 'Total des lignes affichées', 'Total of the rows shown')}</th>
                  <th className="end tabular text-end">{fmtMoney(totals.spend)}</th>
                  <th colSpan={5} />
                  <th className="end tabular text-end">{fmtMoney(totals.collected)}</th>
                  <th colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
          <RoiBasisNote payload={roi.data} />
        </>
      )}
    </Panel>
  );
}

/** A null ratio is an em dash, always. cost_per_lead is null when the campaign
 *  drew no leads, conversion_rate when it drew none either, roi_pct when nothing
 *  was spent -- and a spend of zero makes a return unmeasurable, not infinite. */
function RoiRow({ row }: { row: CrmCampaignRoi['campaigns'][number] }) {
  const { t } = useCrmI18n();
  const roiTone = row.roi_pct === null ? 'neutral' : row.roi_pct >= 0 ? 'good' : 'bad';

  return (
    <tr>
      <td>
        <span className="block">{row.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span className="tabular">{row.code}</span>
          <span>{row.channel}</span>
          <Pill tone={toneForStatus(row.status)}>{row.status}</Pill>
        </span>
      </td>
      <td
        className="end tabular text-end"
        title={row.budget_used_pct === null
          ? t('لا ميزانية مسجَّلة', 'Aucun budget enregistré', 'No budget recorded')
          : `${t('من الميزانية', 'du budget', 'of budget')} ${fmtPct(row.budget_used_pct)}`}
      >
        {fmtMoney(row.spend_dzd)}
        <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
          {t('ميزانية', 'budget', 'budget')} {fmtMoney(row.budget_dzd)}
        </span>
      </td>
      <td className="end tabular text-end">{fmtInt(row.leads)}</td>
      <td className="end tabular text-end">{fmtInt(row.converted_leads)}</td>
      <td className="end tabular text-end">{fmtInt(row.opportunities)}</td>
      <td
        className="end tabular text-end"
        title={`${t('قيمة المكسوب', 'Valeur gagnée', 'Won pipeline')} ${fmtMoney(row.won_pipeline_dzd)}`}
      >
        {fmtInt(row.won)}
      </td>
      <td className="end tabular text-end">
        {fmtMoney(row.booked_dzd)}
        <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
          {fmtInt(row.bookings)} {t('حجز', 'rés.', 'bookings')}
        </span>
      </td>
      <td className="end tabular text-end">{fmtMoney(row.collected_dzd)}</td>
      <td className="end tabular text-end">{fmtMoney(row.cost_per_lead_dzd)}</td>
      <td className="end tabular text-end">{fmtMoney(row.cost_per_won_dzd)}</td>
      <td className="end tabular text-end">{fmtPct(row.conversion_rate)}</td>
      <td className="end text-end">
        <Pill tone={roiTone}>{fmtPct(row.roi_pct)}</Pill>
      </td>
    </tr>
  );
}

/** The basis, on the screen rather than in a wiki. A reader who does not know that
 *  revenue here is collected cash will read a negative ROI as a loss when it may
 *  only be an unpaid balance. */
function RoiBasisNote({ payload }: { payload: CrmCampaignRoi | null }) {
  const { t } = useCrmI18n();
  if (payload === null) return null;
  return (
    <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
      {t(
        `الفترة ${fmtDate(payload.from)} — ${fmtDate(payload.to)}. أساس الإيراد: ${payload.revenue_basis}. `
        + 'المردود = (المحصَّل − المصروف) ÷ المصروف، فحملة لها حجوزات مؤكَّدة ولا دفعات تظهر بمردود سالب. '
        + 'النسب الفارغة تعني مقاماً صفرياً: صفر محتملين لا يعني كلفة صفر.',
        `Période ${fmtDate(payload.from)} — ${fmtDate(payload.to)}. Base du revenu : ${payload.revenue_basis}. `
        + 'ROI = (encaissé − dépensé) ÷ dépensé : une campagne avec des réservations confirmées et aucun '
        + 'paiement affiche donc un ROI négatif. Un tiret signifie un dénominateur nul, pas un zéro.',
        `Window ${fmtDate(payload.from)} — ${fmtDate(payload.to)}. Revenue basis: ${payload.revenue_basis}. `
        + 'ROI is (collected − spent) ÷ spent, so a campaign with confirmed bookings and no payments yet '
        + 'shows a negative return. A dash means a zero denominator, not a zero value.',
      )}
    </p>
  );
}

