/**
 * CRM — the pane on the right, and the six tiles above the grid.
 *
 * Seven panes, one slot. The rail decides which surface is on screen and the grid decides
 * which row is selected; between them they name exactly one record, and this file draws it.
 * Nothing here is a second source of truth: every pane reads `model.all`, so the deals
 * listed under a customer are the same rows the pipeline grid would show, and a number
 * shown in two places was computed once, in `model.ts`.
 *
 * The panes cross the graph, which is the whole reason an inspector exists. A grid can only
 * widen — another column, another 150px — but a customer's deals, a lead's log and a quote's
 * lines are lists, and a list belongs beside the record rather than inside a cell. Where a
 * foreign key points outside the loaded page the row carries the raw id rather than
 * disappearing, for the reason `export.ts` gives: a blank means *'no campaign'* and an id
 * means *'a campaign this page could not name'*, which are different facts.
 *
 * The rows, chips and lists a pane is assembled from live in `./rows`, which is where they went
 * when the two halves together outgrew what `max-lines` allows one module. The split is a real
 * boundary and not a filing decision: nothing in that file takes `CrmModel`, so a primitive
 * cannot quietly become a second source of truth for the pane drawing it.
 *
 * Two things live here on purpose rather than in the grid. The campaign spend `Meter`,
 * because a bar reads as a measurement and a 150px cell cannot honestly show one; and the
 * deal's stage ladder, because `model.history` is loaded for the selected deal alone —
 * drawing it as a column would mean reading every deal's history to fill one screen.
 *
 * The six tiles are the desk's summary and not the selection's: they answer *'what is the
 * pipeline worth and what is late'*, which does not change when you click a row.
 */
import {
  AlarmClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Percent,
  ScrollText,
  Send,
  Target,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import {
  Card,
  fmt,
  InfoBar,
  KpiTile,
  type Localized,
  Meter,
  PropertyRow,
  Section,
  useLocale,
} from '@/platform/sdk';
import { Chip, TagList } from './cells';
import type {
  Activity,
  Campaign,
  CrmModel,
  CrmSummary,
  CrmView,
  Customer,
  Followup,
  Lead,
  Opportunity,
  Quote,
  QuoteLine,
} from './model';
import {
  Coded,
  Count,
  Day,
  DealRow,
  Ladder,
  Lines,
  Linked,
  Log,
  Money,
  Notes,
  Prose,
  StageChip,
  Stamp,
  Tasks,
  Text,
} from './rows';
import {
  CAMPAIGN_STATUS_TONE,
  CUSTOMER_STATUS_TONE,
  CUSTOMER_TYPE_TONE,
  DIRECTION_TONE,
  FOLLOWUP_STATUS_TONE,
  LEAD_STATUS_TONE,
  OUTCOME_TONE,
  PRIORITY_TONE,
  quoteState,
  toneOf,
  wordFor,
} from './tones';
// ---------------------------------------------------------------------------
// Which record
// ---------------------------------------------------------------------------

/**
 * The selected record, out of the page the grid is already showing.
 *
 * The rail hands down an id, and the pane and the grid must be reading one row rather than
 * two copies of it: `model.all` is that one list. So an inspector never asks the server a
 * second question to draw a record the screen already holds.
 */
const find = <T extends { readonly id: string }>(rows: readonly T[], id: string | null): T | null =>
  id === null ? null : (rows.find((row) => row.id === id) ?? null);

// ---------------------------------------------------------------------------
// The seven panes
// ---------------------------------------------------------------------------

/**
 * A lead: who it is, where it came from, and what has happened since.
 *
 * `customerId` is the interesting row. A lead that has been converted keeps pointing at the
 * customer it became, so the pane can answer *'what came of this'* without a search — and the
 * link survives even when that customer is on a page this desk has not loaded.
 */
function LeadPane({ model, lead }: { readonly model: CrmModel; readonly lead: Lead }) {
  const { tr, lang } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={UserPlus} title={lead.name}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Coded
            label={tr('الحالة', 'Statut', 'Status')}
            entity="lead"
            field="status"
            value={lead.status}
            table={LEAD_STATUS_TONE}
          />
          <Coded
            label={tr('الأولوية', 'Priorité', 'Priority')}
            entity="lead"
            field="priority"
            value={lead.priority}
            table={PRIORITY_TONE}
          />
          <PropertyRow label={tr('النقاط', 'Score', 'Score')} mono>
            {fmt.integer(lead.score, lang)}
          </PropertyRow>
        </div>
      </Card>
      <Card title={tr('الاتصال', 'Contact', 'Contact')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Text label={tr('الهاتف', 'Téléphone', 'Phone')} value={lead.phone} />
          <Text label={tr('البريد', 'E-mail', 'Email')} value={lead.email} />
          <Coded
            label={tr('المصدر', 'Source', 'Source')}
            entity="lead"
            field="source"
            value={lead.source}
          />
          <Linked
            label={tr('المسؤول', 'Responsable', 'Assigned to')}
            id={lead.assignedTo}
            name={undefined}
          />
          <Stamp
            label={tr('الإجراء القادم', 'Prochaine action', 'Next action')}
            value={lead.nextActionAt}
          />
        </div>
      </Card>
      <Card title={tr('الروابط', 'Liens', 'Links')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Linked
            label={tr('العميل', 'Client', 'Customer')}
            id={lead.customerId}
            name={model.customerById.get(lead.customerId ?? '')?.name}
          />
          <Linked
            label={tr('الحملة', 'Campagne', 'Campaign')}
            id={lead.campaignId}
            name={model.campaignById.get(lead.campaignId ?? '')?.name}
          />
          <Stamp label={tr('التأهيل', 'Qualification', 'Qualified')} value={lead.qualifiedAt} />
          <Stamp label={tr('التحويل', 'Conversion', 'Converted')} value={lead.convertedAt} />
          <Stamp label={tr('الإنشاء', 'Création', 'Created')} value={lead.createdAt} />
          <Text label={tr('سبب الخسارة', 'Motif de perte', 'Lost reason')} value={lead.lostReason} />
        </div>
      </Card>
      <Log rows={model.all.activities.filter((row) => row.leadId === lead.id)} />
      <Tasks
        rows={model.all.followups.filter((row) => row.leadId === lead.id)}
        overdue={model.overdue}
      />
      <Notes text={lead.notes} />
    </div>
  );
}

/**
 * A customer: who they are, where they are, and what the graph has hung off them.
 *
 * `pilgrimId` and `ownerId` print as raw ids rather than names, because this desk loads neither
 * pilgrims nor staff, and an id is the fact the page actually holds. The originating lead is
 * resolved out of `model.all.leads` instead of a map: the model publishes `customerById`,
 * `campaignById`, `packageById` and `opportunityById`, but deliberately no `leadById`.
 */
function CustomerPane({ model, customer }: { readonly model: CrmModel; readonly customer: Customer }) {
  const { tr } = useLocale();
  const deals = model.all.opportunities.filter((row) => row.customerId === customer.id);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card
        icon={Users}
        title={customer.name}
        subtitle={customer.nameAr === '' ? undefined : customer.nameAr}
      >
        <div style={{ display: 'grid', gap: 2 }}>
          <Text label={tr('الرمز', 'Code', 'Code')} value={customer.code} />
          <Coded
            label={tr('النوع', 'Type', 'Type')}
            entity="customer"
            field="customer_type"
            value={customer.type}
            table={CUSTOMER_TYPE_TONE}
          />
          <Coded
            label={tr('الحالة', 'Statut', 'Status')}
            entity="customer"
            field="status"
            value={customer.status}
            table={CUSTOMER_STATUS_TONE}
          />
          {customer.tags.length === 0 ? null : (
            <PropertyRow label={tr('الوسوم', 'Étiquettes', 'Tags')}>
              <TagList tags={customer.tags} />
            </PropertyRow>
          )}
        </div>
      </Card>
      <Card title={tr('الاتصال', 'Contact', 'Contact')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Text label={tr('الهاتف', 'Téléphone', 'Phone')} value={customer.phone} />
          <Text label={tr('البريد', 'E-mail', 'Email')} value={customer.email} />
          <Text label={tr('الولاية', 'Wilaya', 'Wilaya')} value={customer.wilaya} />
          <Text label={tr('العنوان', 'Adresse', 'Address')} value={customer.address} />
          <Text label={tr('المصدر', 'Source', 'Source')} value={customer.source} />
        </div>
      </Card>
      <Card title={tr('الروابط', 'Liens', 'Links')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Linked
            label={tr('العميل المحتمل', 'Piste', 'Lead')}
            id={customer.leadId}
            name={find(model.all.leads, customer.leadId)?.name}
          />
          <Linked
            label={tr('الحملة', 'Campagne', 'Campaign')}
            id={customer.campaignId}
            name={model.campaignById.get(customer.campaignId ?? '')?.name}
          />
          <Linked
            label={tr('الحاج', 'Pèlerin', 'Pilgrim')}
            id={customer.pilgrimId}
            name={undefined}
          />
          <Linked
            label={tr('المسؤول', 'Responsable', 'Owner')}
            id={customer.ownerId}
            name={undefined}
          />
          <Stamp label={tr('أول فوز', 'Premier gain', 'First won')} value={customer.firstWonAt} />
          <Stamp
            label={tr('آخر نشاط', 'Dernière activité', 'Last activity')}
            value={customer.lastActivityAt}
          />
        </div>
      </Card>
      <Section title={tr('الفرص', 'Opportunités', 'Deals')} action={<Count value={deals.length} />}>
        {deals.length === 0 ? (
          <InfoBar icon={Target} title={tr('لا توجد فرص', 'Aucune opportunité', 'No deals')} />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {deals.map((deal) => (
              <DealRow key={deal.id} deal={deal} />
            ))}
          </div>
        )}
      </Section>
      <Log rows={model.all.activities.filter((row) => row.customerId === customer.id)} />
      <Tasks
        rows={model.all.followups.filter((row) => row.customerId === customer.id)}
        overdue={model.overdue}
      />
      <Notes text={customer.notes} />
    </div>
  );
}

/**
 * A deal: where it stands, what it is worth, and how it got here.
 *
 * The stage ladder at the foot is the reason this pane cannot be a column. `model.history` is
 * loaded for the selected deal alone, so drawing the ladder in the grid would mean reading every
 * deal's history to fill one screen. `probability` arrives as 0–100 while `fmt.percent` wants a
 * fraction, so it is divided at the call site rather than mangled in the projection.
 */
function DealPane({ model, deal }: { readonly model: CrmModel; readonly deal: Opportunity }) {
  const { tr, lang } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card
        icon={Target}
        title={deal.title}
        subtitle={deal.reference === '' ? undefined : deal.reference}
      >
        <div style={{ display: 'grid', gap: 2 }}>
          <PropertyRow label={tr('المرحلة', 'Étape', 'Stage')}>
            <StageChip stage={deal.stage} />
          </PropertyRow>
          <PropertyRow label={tr('الاحتمال', 'Probabilité', 'Probability')} mono>
            {fmt.percent(deal.probability / 100, lang)}
          </PropertyRow>
          <PropertyRow label={tr('المسافرون', 'Voyageurs', 'Travellers')} mono>
            {fmt.integer(deal.travelers, lang)}
          </PropertyRow>
        </div>
      </Card>
      <Card icon={Wallet} title={tr('القيمة', 'Valeur', 'Value')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Money label={tr('القيمة', 'Valeur', 'Value')} value={deal.valueDzd} />
          <Money label={tr('المرجّحة', 'Pondérée', 'Weighted')} value={deal.weightedDzd} />
        </div>
      </Card>
      <Card title={tr('الروابط', 'Liens', 'Links')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Linked
            label={tr('العميل', 'Client', 'Customer')}
            id={deal.customerId}
            name={model.customerById.get(deal.customerId ?? '')?.name}
          />
          <Linked
            label={tr('العميل المحتمل', 'Piste', 'Lead')}
            id={deal.leadId}
            name={find(model.all.leads, deal.leadId)?.name}
          />
          <Linked
            label={tr('الباقة', 'Forfait', 'Package')}
            id={deal.packageId}
            name={model.packageById.get(deal.packageId ?? '')?.name}
          />
          <Linked
            label={tr('الحملة', 'Campagne', 'Campaign')}
            id={deal.campaignId}
            name={model.campaignById.get(deal.campaignId ?? '')?.name}
          />
          <Linked
            label={tr('الحجز', 'Réservation', 'Booking')}
            id={deal.bookingId}
            name={undefined}
          />
        </div>
      </Card>
      <Card title={tr('التواريخ', 'Dates', 'Dates')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Day
            label={tr('الإغلاق المتوقع', 'Clôture prévue', 'Expected close')}
            value={deal.expectedCloseDate}
          />
          <Stamp label={tr('الفوز', 'Gain', 'Won')} value={deal.wonAt} />
          <Stamp label={tr('الخسارة', 'Perte', 'Lost')} value={deal.lostAt} />
          <Text label={tr('سبب الخسارة', 'Motif de perte', 'Lost reason')} value={deal.lostReason} />
        </div>
      </Card>
      <Ladder rows={model.history} />
      <Log rows={model.all.activities.filter((row) => row.opportunityId === deal.id)} />
      <Tasks
        rows={model.all.followups.filter((row) => row.opportunityId === deal.id)}
        overdue={model.overdue}
      />
      <Notes text={deal.notes} />
    </div>
  );
}
interface QuotePaneProps {
  readonly model: CrmModel;
  readonly quote: Quote;
  readonly onAddLine: (quote: Quote) => void;
  readonly onEditLine: (line: QuoteLine) => void;
  readonly onRemoveLine: (line: QuoteLine) => void;
}

/**
 * A quote: its state, its arithmetic, and the three verbs no accelerator reaches.
 *
 * The state chip comes from `quoteState` and not from the `status` column, and the clock is read
 * here rather than passed in: expiry is a fact about the moment the pane draws, and threading a
 * clock down from the shell would only invite a second one. Lines stay editable while `sentAt`
 * is null — the same null `chrome.tsx` gates Send on, so buttons and accelerators agree.
 */
function QuotePane({ model, quote, onAddLine, onEditLine, onRemoveLine }: QuotePaneProps) {
  const { t, tr, lang } = useLocale();
  const state = quoteState(quote, Date.now());
  const sar = quote.currency === 'SAR';
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={FileText} title={quote.number}>
        <div style={{ display: 'grid', gap: 2 }}>
          <PropertyRow label={tr('الحالة', 'Statut', 'Status')}>
            <Chip text={t(state.text)} tone={state.tone} />
          </PropertyRow>
          <PropertyRow label={tr('المسافرون', 'Voyageurs', 'Travellers')} mono>
            {fmt.integer(quote.travelers, lang)}
          </PropertyRow>
        </div>
      </Card>
      <Card icon={Wallet} title={tr('المبالغ', 'Montants', 'Amounts')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Money
            label={tr('المجموع الفرعي', 'Sous-total', 'Subtotal')}
            value={quote.subtotal}
            sar={sar}
          />
          <Money label={tr('الخصم', 'Remise', 'Discount')} value={quote.discount} sar={sar} />
          <Money label={tr('الإجمالي', 'Total', 'Total')} value={quote.total} sar={sar} />
        </div>
      </Card>
      <Lines
        lines={model.quoteLines}
        sar={sar}
        editable={quote.sentAt === null}
        onAdd={() => onAddLine(quote)}
        onEdit={onEditLine}
        onRemove={onRemoveLine}
      />
      <Card title={tr('الروابط', 'Liens', 'Links')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Linked
            label={tr('الفرصة', 'Opportunité', 'Deal')}
            id={quote.opportunityId}
            name={model.opportunityById.get(quote.opportunityId ?? '')?.title}
          />
          <Linked
            label={tr('العميل', 'Client', 'Customer')}
            id={quote.customerId}
            name={model.customerById.get(quote.customerId ?? '')?.name}
          />
          <Linked
            label={tr('الباقة', 'Forfait', 'Package')}
            id={quote.packageId}
            name={model.packageById.get(quote.packageId ?? '')?.name}
          />
          <Linked
            label={tr('الحجز', 'Réservation', 'Booking')}
            id={quote.bookingId}
            name={undefined}
          />
        </div>
      </Card>
      <Card title={tr('التواريخ', 'Dates', 'Dates')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Day label={tr('صالح حتى', 'Valable jusqu’au', 'Valid until')} value={quote.validUntil} />
          <Stamp label={tr('الإرسال', 'Envoi', 'Sent')} value={quote.sentAt} />
          <Stamp label={tr('القبول', 'Acceptation', 'Accepted')} value={quote.acceptedAt} />
          <Stamp label={tr('الرفض', 'Refus', 'Declined')} value={quote.declinedAt} />
          <Text
            label={tr('سبب الرفض', 'Motif du refus', 'Declined reason')}
            value={quote.declinedReason}
          />
          <Stamp label={tr('الإنشاء', 'Création', 'Created')} value={quote.createdAt} />
        </div>
      </Card>
      {quote.terms.trim() === '' ? null : (
        <Card icon={ScrollText} title={tr('الشروط', 'Conditions', 'Terms')}>
          <Prose text={quote.terms} />
        </Card>
      )}
      <Log rows={model.all.activities.filter((row) => row.quoteId === quote.id)} />
      <Notes text={quote.notes} />
    </div>
  );
}
interface ActivityPaneProps {
  readonly model: CrmModel;
  readonly activity: Activity;
}

/**
 * An activity: what was said, which way it went, and what came of it.
 *
 * `minutes` is dropped when zero rather than printed, because the column is optional on every
 * write path and a duration nobody recorded is not a call that took no time. Nothing here opens
 * an editor: `Activity` alone carries no `row`, since the graph has no `crm.activity.update`.
 */
function ActivityPane({ model, activity }: ActivityPaneProps) {
  const { tr, lang } = useLocale();
  const subject = activity.subject.trim() === '' ? tr('نشاط', 'Activité', 'Activity') : activity.subject;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={MessageSquare} title={subject}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Coded
            label={tr('النوع', 'Type', 'Type')}
            entity="activity"
            field="activity_type"
            value={activity.type}
          />
          <Coded
            label={tr('الاتجاه', 'Sens', 'Direction')}
            entity="activity"
            field="direction"
            value={activity.direction}
            table={DIRECTION_TONE}
          />
          <Coded
            label={tr('النتيجة', 'Résultat', 'Outcome')}
            entity="activity"
            field="outcome"
            value={activity.outcome}
            table={OUTCOME_TONE}
          />
          {activity.minutes === 0 ? null : (
            <PropertyRow label={tr('الدقائق', 'Minutes', 'Minutes')} mono>
              {fmt.integer(activity.minutes, lang)}
            </PropertyRow>
          )}
          <Stamp label={tr('الوقت', 'Horodatage', 'Occurred')} value={activity.occurredAt} />
        </div>
      </Card>
      {activity.body.trim() === '' ? null : (
        <Card icon={ScrollText} title={tr('النص', 'Contenu', 'Body')}>
          <Prose text={activity.body} />
        </Card>
      )}
      <Card title={tr('الروابط', 'Liens', 'Links')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Linked
            label={tr('العميل', 'Client', 'Customer')}
            id={activity.customerId}
            name={model.customerById.get(activity.customerId ?? '')?.name}
          />
          <Linked
            label={tr('العميل المحتمل', 'Piste', 'Lead')}
            id={activity.leadId}
            name={find(model.all.leads, activity.leadId)?.name}
          />
          <Linked
            label={tr('الفرصة', 'Opportunité', 'Deal')}
            id={activity.opportunityId}
            name={model.opportunityById.get(activity.opportunityId ?? '')?.title}
          />
          <Linked
            label={tr('العرض', 'Devis', 'Quote')}
            id={activity.quoteId}
            name={find(model.all.quotes, activity.quoteId)?.number}
          />
        </div>
      </Card>
    </div>
  );
}
interface FollowupPaneProps {
  readonly model: CrmModel;
  readonly followup: Followup;
}

/**
 * A follow-up: what is owed, when it was owed, and whether it is late.
 *
 * Lateness is read off `model.overdue` rather than computed here, so this pane, the grid's red
 * rows and the overdue tile all count one set — the one the projection built. It overrides the
 * status tone rather than sitting beside it, because *'pending'* and *'pending since Tuesday'*
 * are not the same fact and only one of them needs acting on today.
 */
function FollowupPane({ model, followup }: FollowupPaneProps) {
  const { t, tr } = useLocale();
  const late = model.overdue.has(followup.id);
  const status = wordFor(t, 'followup', 'status', followup.status);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={ClipboardList} title={followup.title}>
        <div style={{ display: 'grid', gap: 2 }}>
          {status === '' ? null : (
            <PropertyRow label={tr('الحالة', 'Statut', 'Status')}>
              <Chip
                text={status}
                tone={late ? 'danger' : toneOf(FOLLOWUP_STATUS_TONE, followup.status)}
              />
            </PropertyRow>
          )}
          <Coded
            label={tr('الأولوية', 'Priorité', 'Priority')}
            entity="followup"
            field="priority"
            value={followup.priority}
            table={PRIORITY_TONE}
          />
          <Stamp label={tr('الاستحقاق', 'Échéance', 'Due')} value={followup.dueAt} />
          <Stamp label={tr('الإنجاز', 'Achèvement', 'Completed')} value={followup.completedAt} />
          <Linked
            label={tr('المسؤول', 'Responsable', 'Assigned to')}
            id={followup.assignedTo}
            name={undefined}
          />
        </div>
      </Card>
      <Card title={tr('الروابط', 'Liens', 'Links')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Linked
            label={tr('العميل', 'Client', 'Customer')}
            id={followup.customerId}
            name={model.customerById.get(followup.customerId ?? '')?.name}
          />
          <Linked
            label={tr('العميل المحتمل', 'Piste', 'Lead')}
            id={followup.leadId}
            name={find(model.all.leads, followup.leadId)?.name}
          />
          <Linked
            label={tr('الفرصة', 'Opportunité', 'Deal')}
            id={followup.opportunityId}
            name={model.opportunityById.get(followup.opportunityId ?? '')?.title}
          />
        </div>
      </Card>
      <Notes text={followup.notes} />
    </div>
  );
}
interface CampaignPaneProps {
  readonly model: CrmModel;
  readonly campaign: Campaign;
}

/**
 * A campaign: what it was aimed at, what it has cost, and what it has brought in.
 *
 * The meter is why spend belongs in a pane and not a column: a bar needs a maximum, and a
 * campaign with no budget has none. So it is drawn only when `budgetDzd` is set, both amounts
 * print either way, and `Meter` reddens itself past the budget without being asked to.
 */
function CampaignPane({ model, campaign }: CampaignPaneProps) {
  const { tr, lang } = useLocale();
  const leads = model.all.leads.filter((row) => row.campaignId === campaign.id);
  const customers = model.all.customers.filter((row) => row.campaignId === campaign.id);
  const deals = model.all.opportunities.filter((row) => row.campaignId === campaign.id);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card
        icon={Megaphone}
        title={campaign.name}
        subtitle={campaign.code === '' ? undefined : campaign.code}
      >
        <div style={{ display: 'grid', gap: 2 }}>
          <Coded
            label={tr('القناة', 'Canal', 'Channel')}
            entity="campaign"
            field="channel"
            value={campaign.channel}
          />
          <Coded
            label={tr('الحالة', 'Statut', 'Status')}
            entity="campaign"
            field="status"
            value={campaign.status}
            table={CAMPAIGN_STATUS_TONE}
          />
          <Day label={tr('البداية', 'Début', 'Start')} value={campaign.startDate} />
          <Day label={tr('النهاية', 'Fin', 'End')} value={campaign.endDate} />
          <Text label={tr('الشريحة', 'Segment', 'Segment')} value={campaign.targetSegment} />
        </div>
      </Card>
      <Card icon={Wallet} title={tr('الميزانية', 'Budget', 'Budget')}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <Money label={tr('الميزانية', 'Budget', 'Budget')} value={campaign.budgetDzd} />
            <Money label={tr('المصروف', 'Dépensé', 'Spend')} value={campaign.spendDzd} />
          </div>
          {campaign.budgetDzd === 0 ? null : (
            <Meter
              value={campaign.spendDzd}
              max={campaign.budgetDzd}
              label={fmt.percent(campaign.spendDzd / campaign.budgetDzd, lang)}
            />
          )}
        </div>
      </Card>
      <Card title={tr('الحصيلة', 'Retombées', 'Results')}>
        <div style={{ display: 'grid', gap: 2 }}>
          <PropertyRow label={tr('العملاء المحتملون', 'Pistes', 'Leads')} mono>
            {fmt.integer(leads.length, lang)}
          </PropertyRow>
          <PropertyRow label={tr('العملاء', 'Clients', 'Customers')} mono>
            {fmt.integer(customers.length, lang)}
          </PropertyRow>
          <PropertyRow label={tr('الفرص', 'Opportunités', 'Deals')} mono>
            {fmt.integer(deals.length, lang)}
          </PropertyRow>
        </div>
      </Card>
      <Notes text={campaign.notes} />
    </div>
  );
}
// ---------------------------------------------------------------------------
// The slot, and the six tiles above it
// ---------------------------------------------------------------------------

/**
 * What each surface calls the thing it lists.
 *
 * The empty state names the record instead of saying *'select a row'*: a rail with seven
 * entries can be misread, and *'select a quote'* tells a reader who thought they were looking
 * at deals where they actually are. Keyed by `CrmView`, so an eighth surface cannot reach this
 * file without the compiler asking what its rows are called — the same bargain
 * `model.counts` strikes for the rail's badges.
 */
const VIEW_NOUN: Readonly<Record<CrmView, Localized>> = {
  leads: { ar: 'عميلاً محتملاً', fr: 'une piste', en: 'a lead' },
  customers: { ar: 'عميلاً', fr: 'un client', en: 'a customer' },
  pipeline: { ar: 'فرصةً', fr: 'une opportunité', en: 'a deal' },
  quotes: { ar: 'عرضَ سعر', fr: 'un devis', en: 'a quote' },
  activities: { ar: 'نشاطاً', fr: 'une activité', en: 'an activity' },
  followups: { ar: 'متابعةً', fr: 'une relance', en: 'a follow-up' },
  campaigns: { ar: 'حملةً', fr: 'une campagne', en: 'a campaign' },
};

/** The rail's own glyphs, so the empty slot is recognisably the surface it belongs to. */
const VIEW_ICON: Readonly<Record<CrmView, LucideIcon>> = {
  leads: UserPlus,
  customers: Users,
  pipeline: Target,
  quotes: FileText,
  activities: MessageSquare,
  followups: ClipboardList,
  campaigns: Megaphone,
};

/**
 * The slot with nothing in it — which is the state it is in most of the time.
 *
 * `t` resolves the noun before `tr` builds the sentence, so the two branches this render
 * discards carry a noun in the wrong language. That is harmless and deliberate: the
 * alternative is seven sentences in three languages for a line that says one thing.
 */
function Unselected({ view }: { readonly view: CrmView }) {
  const { t, tr } = useLocale();
  const noun = t(VIEW_NOUN[view]);
  return (
    <InfoBar
      icon={VIEW_ICON[view]}
      tone="neutral"
      title={tr(`اختر ${noun}`, `Sélectionnez ${noun}`, `Select ${noun}`)}
    />
  );
}
/**
 * The desk's six numbers.
 *
 * They belong to the whole book of business rather than to the row under the cursor, which is
 * why they sit above the grid and do not change when a selection does. All six arrive already
 * computed on `CrmSummary` — a tile that added anything up for itself would be a second answer
 * to a question `model.ts` has already answered, and the two would drift.
 *
 * `secondary` on the weighted tile is the one derived value here, and it is a ratio of two
 * numbers on the same object: how much of the open pipeline the probabilities actually credit.
 */
export function CrmKpis({ summary }: { readonly summary: CrmSummary }) {
  const { tr, lang } = useLocale();
  const share =
    summary.openValueDzd === 0 ? null : summary.weightedValueDzd / summary.openValueDzd;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
      }}
    >
      <KpiTile
        icon={Wallet}
        label={tr('الفرص المفتوحة', 'Pipeline ouvert', 'Open pipeline')}
        value={fmt.money(summary.openValueDzd, 'DZD', lang)}
      />
      <KpiTile
        icon={Percent}
        tone="info"
        label={tr('القيمة المرجّحة', 'Valeur pondérée', 'Weighted')}
        value={fmt.money(summary.weightedValueDzd, 'DZD', lang)}
        secondary={share === null ? undefined : fmt.percent(share, lang)}
      />
      <KpiTile
        icon={CheckCircle2}
        tone="success"
        label={tr('المكسوبة', 'Gagné', 'Won')}
        value={fmt.money(summary.wonValueDzd, 'DZD', lang)}
      />
      <KpiTile
        icon={Send}
        tone="info"
        label={tr('عروض في الانتظار', 'Devis en attente', 'Quotes awaiting')}
        value={fmt.integer(summary.awaitingQuotes, lang)}
      />
      <KpiTile
        icon={AlarmClock}
        tone={summary.overdueFollowups === 0 ? 'neutral' : 'danger'}
        label={tr('متابعات متأخرة', 'Relances en retard', 'Overdue')}
        value={fmt.integer(summary.overdueFollowups, lang)}
      />
      <KpiTile
        icon={UserPlus}
        tone="neutral"
        label={tr('عملاء محتملون جدد', 'Nouvelles pistes', 'New leads')}
        value={fmt.integer(summary.newLeads, lang)}
      />
    </div>
  );
}
interface CrmDetailProps {
  readonly model: CrmModel;
  readonly view: CrmView;
  /** The grid's selection, which is an id and not a record — this file resolves it. */
  readonly selectedId: string | null;
  readonly onAddLine: (quote: Quote) => void;
  readonly onEditLine: (line: QuoteLine) => void;
  readonly onRemoveLine: (line: QuoteLine) => void;
}

/**
 * The one slot, and which of the seven panes is drawn into it.
 *
 * An exhaustive `switch` with no `default`, matching `crmTable` in `export.ts`: an eighth
 * `CrmView` is then a compile error here rather than a silently blank inspector. The `find`
 * happens inside each branch on purpose — that is what narrows `Lead` from `Customer` for the
 * compiler, so no pane has to be handed a record it then has to check the type of.
 */
export function CrmDetail({
  model,
  view,
  selectedId,
  onAddLine,
  onEditLine,
  onRemoveLine,
}: CrmDetailProps) {
  const empty = <Unselected view={view} />;
  switch (view) {
    case 'leads': {
      const row = find(model.all.leads, selectedId);
      return row === null ? empty : <LeadPane model={model} lead={row} />;
    }
    case 'customers': {
      const row = find(model.all.customers, selectedId);
      return row === null ? empty : <CustomerPane model={model} customer={row} />;
    }
    case 'pipeline': {
      const row = find(model.all.opportunities, selectedId);
      return row === null ? empty : <DealPane model={model} deal={row} />;
    }
    case 'quotes': {
      const row = find(model.all.quotes, selectedId);
      return row === null ? empty : (
        <QuotePane
          model={model}
          quote={row}
          onAddLine={onAddLine}
          onEditLine={onEditLine}
          onRemoveLine={onRemoveLine}
        />
      );
    }
    case 'activities': {
      const row = find(model.all.activities, selectedId);
      return row === null ? empty : <ActivityPane model={model} activity={row} />;
    }
    case 'followups': {
      const row = find(model.all.followups, selectedId);
      return row === null ? empty : <FollowupPane model={model} followup={row} />;
    }
    case 'campaigns': {
      const row = find(model.all.campaigns, selectedId);
      return row === null ? empty : <CampaignPane model={model} campaign={row} />;
    }
  }
}
