/**
 * The pipeline, as a file.
 *
 * Seven grids, seven column lists, and one shape they all pass through: a header row and
 * a rectangle of already-stringified cells. `crmCsv` writes that rectangle to a file,
 * `gridClipboardText` writes it to the clipboard as tab-separated columns, and
 * `recordClipboardText` reads one row of it back as a labelled block a person can paste
 * into WhatsApp. Three consumers, one set of columns — so the file, the paste and the
 * message can never disagree about what a quote's columns are.
 *
 * Cells are raw, in the sense `shared/csv.ts` means it: ISO stamps rather than
 * `29/08/2026`, `1250.00` rather than `1 250,00 DA`. A CSV is opened by a spreadsheet,
 * and this OS runs in a locale where the comma is the decimal separator — a file that
 * arrives pre-formatted cannot be un-formatted, and one that arrives formatted for the
 * wrong locale arrives wrong. Headers are the exception: they are translated, because
 * they are read by a person and never parsed.
 *
 * Every table leads with the record's id. It is the least interesting column and the
 * only indispensable one: a lead has no code, a quote's number is assigned by a trigger
 * after the fact, and the Monday meeting's spreadsheet is the thing somebody later asks
 * to reconcile against the book. Where a foreign key points outside the loaded page the
 * cell carries the raw id rather than a blank — a blank means "no campaign", and an id
 * means "a campaign this page could not name", which are different facts.
 */
import { csvDocument } from '../shared/csv';
import type {
  Activity,
  Campaign,
  Customer,
  CrmView,
  CrmVisible,
  Followup,
  Lead,
  Opportunity,
  PackageOption,
  Quote,
} from './model';

/** The runtime's positional translator, narrowed to what a pure module needs. */
export type Translate = (ar: string, fr: string, en: string) => string;

/**
 * The four maps the row builders cross the graph with. `CrmModel` satisfies this
 * structurally, so a caller passes the model itself and no adapter exists to drift.
 */
export interface Lookups {
  readonly customerById: ReadonlyMap<string, Customer>;
  readonly packageById: ReadonlyMap<string, PackageOption>;
  readonly campaignById: ReadonlyMap<string, Campaign>;
  readonly opportunityById: ReadonlyMap<string, Opportunity>;
}

/** A header row and the rows beneath it, all cells already strings. */
export interface CrmTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** Two decimals, dot separator, no currency mark. The column heading says which. */
const money = (value: number): string => value.toFixed(2);

const int = (value: number): string => String(value);

/** A nullable stamp or date, verbatim from the database. */
const at = (value: string | null): string => value ?? '';

const customerName = (lookups: Lookups, id: string | null): string =>
  id === null ? '' : (lookups.customerById.get(id)?.name ?? id);

const campaignName = (lookups: Lookups, id: string | null): string =>
  id === null ? '' : (lookups.campaignById.get(id)?.name ?? id);

const dealTitle = (lookups: Lookups, id: string | null): string =>
  id === null ? '' : (lookups.opportunityById.get(id)?.title ?? id);

/** The package's code, not its name: a code is what an operations sheet is keyed on. */
const packageCode = (lookups: Lookups, id: string | null): string =>
  id === null ? '' : (lookups.packageById.get(id)?.code ?? id);

// ---------------------------------------------------------------------------
// Leads, customers
// ---------------------------------------------------------------------------

/**
 * First and last name in their own columns rather than the joined `name` the grid shows.
 * A spreadsheet that comes back the other way — a list bought from a fair, cleaned in
 * Excel — has two columns, and the table a person exports should be the table they can
 * hand back.
 */
const leadTable = (rows: readonly Lead[], lookups: Lookups, tr: Translate): CrmTable => ({
  header: [
    tr('المعرّف', 'Identifiant', 'ID'),
    tr('الاسم', 'Prénom', 'First name'),
    tr('اللقب', 'Nom', 'Last name'),
    tr('الهاتف', 'Téléphone', 'Phone'),
    tr('البريد', 'E-mail', 'Email'),
    tr('المصدر', 'Source', 'Source'),
    tr('الحالة', 'Statut', 'Status'),
    tr('الأولوية', 'Priorité', 'Priority'),
    tr('النقاط', 'Score', 'Score'),
    tr('الحملة', 'Campagne', 'Campaign'),
    tr('الإجراء القادم', 'Prochaine action', 'Next action'),
    tr('العميل', 'Client', 'Customer'),
    tr('تاريخ التأهيل', 'Qualifié le', 'Qualified at'),
    tr('تاريخ التحويل', 'Converti le', 'Converted at'),
    tr('سبب الخسارة', 'Motif de la perte', 'Lost reason'),
    tr('تاريخ الإنشاء', 'Créé le', 'Created at'),
    tr('ملاحظات', 'Notes', 'Notes'),
  ],
  rows: rows.map((lead) => [
    lead.id,
    lead.firstName,
    lead.lastName,
    lead.phone,
    lead.email,
    lead.source,
    lead.status,
    lead.priority,
    int(lead.score),
    campaignName(lookups, lead.campaignId),
    at(lead.nextActionAt),
    customerName(lookups, lead.customerId),
    at(lead.qualifiedAt),
    at(lead.convertedAt),
    lead.lostReason,
    at(lead.createdAt),
    lead.notes,
  ]),
});

/**
 * `tags` is joined with `', '` — the same separator `tagsText` shows in the editor and one
 * of the two `tagsPayload` splits on. A tag list exported, edited in a spreadsheet and
 * pasted back into the tags box survives the trip unchanged.
 *
 * `ownerId` and `pilgrimId` are emitted raw. This app holds no map of staff or pilgrims,
 * and a uuid a person can search for is worth more than an empty cell.
 */
const customerTable = (rows: readonly Customer[], lookups: Lookups, tr: Translate): CrmTable => ({
  header: [
    tr('المعرّف', 'Identifiant', 'ID'),
    tr('الرمز', 'Code', 'Code'),
    tr('الاسم', 'Nom', 'Name'),
    tr('الاسم بالعربية', 'Nom en arabe', 'Arabic name'),
    tr('النوع', 'Type', 'Type'),
    tr('الحالة', 'Statut', 'Status'),
    tr('الهاتف', 'Téléphone', 'Phone'),
    tr('البريد', 'E-mail', 'Email'),
    tr('الولاية', 'Wilaya', 'Wilaya'),
    tr('العنوان', 'Adresse', 'Address'),
    tr('المصدر', 'Source', 'Source'),
    tr('الوسوم', 'Étiquettes', 'Tags'),
    tr('المسؤول', 'Responsable', 'Owner'),
    tr('الحاج', 'Pèlerin', 'Pilgrim'),
    tr('الحملة', 'Campagne', 'Campaign'),
    tr('أول بيع', 'Premier gain', 'First won at'),
    tr('آخر نشاط', 'Dernière activité', 'Last activity'),
    tr('ملاحظات', 'Notes', 'Notes'),
  ],
  rows: rows.map((customer) => [
    customer.id,
    customer.code,
    customer.name,
    customer.nameAr,
    customer.type,
    customer.status,
    customer.phone,
    customer.email,
    customer.wilaya,
    customer.address,
    customer.source,
    customer.tags.join(', '),
    customer.ownerId ?? '',
    customer.pilgrimId ?? '',
    campaignName(lookups, customer.campaignId),
    at(customer.firstWonAt),
    at(customer.lastActivityAt),
    customer.notes,
  ]),
});

// ---------------------------------------------------------------------------
// Opportunities, quotes
// ---------------------------------------------------------------------------

/**
 * `weightedDzd` travels with the value it is derived from rather than being left to the
 * spreadsheet. The model computes it once so every grid and KPI agrees on it, and a
 * column recomputed in Excel is a second opinion nobody asked for.
 *
 * `bookingId` is the deal's crossing into operations, emitted raw: it is the id a person
 * pastes into the booking search when the question is *'what actually happened to this'*.
 */
const opportunityTable = (
  rows: readonly Opportunity[],
  lookups: Lookups,
  tr: Translate,
): CrmTable => ({
  header: [
    tr('المعرّف', 'Identifiant', 'ID'),
    tr('المرجع', 'Référence', 'Reference'),
    tr('العنوان', 'Intitulé', 'Title'),
    tr('المرحلة', 'Étape', 'Stage'),
    tr('الاحتمال %', 'Probabilité %', 'Probability %'),
    tr('المسافرون', 'Voyageurs', 'Travellers'),
    tr('القيمة دج', 'Valeur DZD', 'Value DZD'),
    tr('القيمة المرجّحة دج', 'Valeur pondérée DZD', 'Weighted DZD'),
    tr('العميل', 'Client', 'Customer'),
    tr('الباقة', 'Forfait', 'Package'),
    tr('الحملة', 'Campagne', 'Campaign'),
    tr('العميل المحتمل', 'Prospect', 'Lead'),
    tr('الحجز', 'Réservation', 'Booking'),
    tr('الإغلاق المتوقع', 'Clôture prévue', 'Expected close'),
    tr('تاريخ الفوز', 'Gagnée le', 'Won at'),
    tr('تاريخ الخسارة', 'Perdue le', 'Lost at'),
    tr('سبب الخسارة', 'Motif de la perte', 'Lost reason'),
    tr('ملاحظات', 'Notes', 'Notes'),
  ],
  rows: rows.map((deal) => [
    deal.id,
    deal.reference,
    deal.title,
    deal.stage,
    int(deal.probability),
    int(deal.travelers),
    money(deal.valueDzd),
    money(deal.weightedDzd),
    customerName(lookups, deal.customerId),
    packageCode(lookups, deal.packageId),
    campaignName(lookups, deal.campaignId),
    deal.leadId ?? '',
    deal.bookingId ?? '',
    at(deal.expectedCloseDate),
    at(deal.wonAt),
    at(deal.lostAt),
    deal.lostReason,
    deal.notes,
  ]),
});

/**
 * The currency column precedes the three amounts because it qualifies them: a quote is
 * priced in DZD or in SAR and the numbers carry no mark of their own. Reading the columns
 * in order is reading a sentence — *'SAR, 4 800.00, 0.00, 4 800.00'* — and a spreadsheet
 * that sums a column of mixed currencies at least had the chance to notice.
 */
const quoteTable = (rows: readonly Quote[], lookups: Lookups, tr: Translate): CrmTable => ({
  header: [
    tr('المعرّف', 'Identifiant', 'ID'),
    tr('الرقم', 'Numéro', 'Number'),
    tr('الحالة', 'Statut', 'Status'),
    tr('العملة', 'Devise', 'Currency'),
    tr('المجموع الفرعي', 'Sous-total', 'Subtotal'),
    tr('الخصم', 'Remise', 'Discount'),
    tr('الإجمالي', 'Total', 'Total'),
    tr('المسافرون', 'Voyageurs', 'Travellers'),
    tr('العميل', 'Client', 'Customer'),
    tr('الفرصة', 'Opportunité', 'Opportunity'),
    tr('الباقة', 'Forfait', 'Package'),
    tr('الحجز', 'Réservation', 'Booking'),
    tr('صالح حتى', 'Valable jusqu’au', 'Valid until'),
    tr('تاريخ الإرسال', 'Envoyé le', 'Sent at'),
    tr('تاريخ القبول', 'Accepté le', 'Accepted at'),
    tr('تاريخ الرفض', 'Refusé le', 'Declined at'),
    tr('سبب الرفض', 'Motif du refus', 'Declined reason'),
    tr('تاريخ الإنشاء', 'Créé le', 'Created at'),
    tr('الشروط', 'Conditions', 'Terms'),
    tr('ملاحظات', 'Notes', 'Notes'),
  ],
  rows: rows.map((quote) => [
    quote.id,
    quote.number,
    quote.status,
    quote.currency,
    money(quote.subtotal),
    money(quote.discount),
    money(quote.total),
    int(quote.travelers),
    customerName(lookups, quote.customerId),
    dealTitle(lookups, quote.opportunityId),
    packageCode(lookups, quote.packageId),
    quote.bookingId ?? '',
    at(quote.validUntil),
    at(quote.sentAt),
    at(quote.acceptedAt),
    at(quote.declinedAt),
    quote.declinedReason,
    at(quote.createdAt),
    quote.terms,
    quote.notes,
  ]),
});

// ---------------------------------------------------------------------------
// Activities, follow-ups, campaigns
// ---------------------------------------------------------------------------

/**
 * The stamp comes second, straight after the id, because a communication log is read in
 * time order and a person scanning the file scans that column. All four targets travel
 * with the row: `crm_activities_target_present` guarantees at least one of them is set,
 * and which one it is *is* the fact — a call logged against a quote is a different event
 * from a call logged against the customer.
 */
const activityTable = (rows: readonly Activity[], lookups: Lookups, tr: Translate): CrmTable => ({
  header: [
    tr('المعرّف', 'Identifiant', 'ID'),
    tr('التاريخ', 'Date', 'Occurred at'),
    tr('النوع', 'Type', 'Type'),
    tr('الاتجاه', 'Sens', 'Direction'),
    tr('الموضوع', 'Objet', 'Subject'),
    tr('النتيجة', 'Résultat', 'Outcome'),
    tr('الدقائق', 'Minutes', 'Minutes'),
    tr('العميل', 'Client', 'Customer'),
    tr('العميل المحتمل', 'Prospect', 'Lead'),
    tr('الفرصة', 'Opportunité', 'Opportunity'),
    tr('العرض', 'Devis', 'Quote'),
    tr('المحتوى', 'Contenu', 'Body'),
  ],
  rows: rows.map((activity) => [
    activity.id,
    at(activity.occurredAt),
    activity.type,
    activity.direction,
    activity.subject,
    activity.outcome,
    int(activity.minutes),
    customerName(lookups, activity.customerId),
    activity.leadId ?? '',
    dealTitle(lookups, activity.opportunityId),
    activity.quoteId ?? '',
    activity.body,
  ]),
});

/** Due date second, for the same reason the activity log leads with its stamp. */
const followupTable = (rows: readonly Followup[], lookups: Lookups, tr: Translate): CrmTable => ({
  header: [
    tr('المعرّف', 'Identifiant', 'ID'),
    tr('تاريخ الاستحقاق', 'Échéance', 'Due at'),
    tr('العنوان', 'Intitulé', 'Title'),
    tr('الأولوية', 'Priorité', 'Priority'),
    tr('الحالة', 'Statut', 'Status'),
    tr('العميل', 'Client', 'Customer'),
    tr('العميل المحتمل', 'Prospect', 'Lead'),
    tr('الفرصة', 'Opportunité', 'Opportunity'),
    tr('المسؤول', 'Assigné à', 'Assigned to'),
    tr('تاريخ الإنجاز', 'Terminé le', 'Completed at'),
    tr('ملاحظات', 'Notes', 'Notes'),
  ],
  rows: rows.map((followup) => [
    followup.id,
    at(followup.dueAt),
    followup.title,
    followup.priority,
    followup.status,
    customerName(lookups, followup.customerId),
    followup.leadId ?? '',
    dealTitle(lookups, followup.opportunityId),
    followup.assignedTo ?? '',
    at(followup.completedAt),
    followup.notes,
  ]),
});

/**
 * Budget and spend, and no third column subtracting them. The model publishes no notion
 * of *'remaining'*, and a number invented here would make this file its only authority —
 * which is the drift the header warns about. A spreadsheet can subtract.
 */
const campaignTable = (rows: readonly Campaign[], tr: Translate): CrmTable => ({
  header: [
    tr('المعرّف', 'Identifiant', 'ID'),
    tr('الرمز', 'Code', 'Code'),
    tr('الاسم', 'Nom', 'Name'),
    tr('القناة', 'Canal', 'Channel'),
    tr('الحالة', 'Statut', 'Status'),
    tr('البداية', 'Début', 'Start'),
    tr('النهاية', 'Fin', 'End'),
    tr('الميزانية دج', 'Budget DZD', 'Budget DZD'),
    tr('المصروف دج', 'Dépensé DZD', 'Spend DZD'),
    tr('الشريحة المستهدفة', 'Segment ciblé', 'Target segment'),
    tr('ملاحظات', 'Notes', 'Notes'),
  ],
  rows: rows.map((campaign) => [
    campaign.id,
    campaign.code,
    campaign.name,
    campaign.channel,
    campaign.status,
    at(campaign.startDate),
    at(campaign.endDate),
    money(campaign.budgetDzd),
    money(campaign.spendDzd),
    campaign.targetSegment,
    campaign.notes,
  ]),
});

// ---------------------------------------------------------------------------
// The three consumers
// ---------------------------------------------------------------------------

/**
 * The surface's rows as a table. `pipeline` reads `visible.opportunities` — the funnel
 * board and the deal grid are two views of one list, and exporting the board should hand
 * over the deals rather than the six column totals a person can see at a glance anyway.
 */
export function crmTable(
  view: CrmView,
  visible: CrmVisible,
  lookups: Lookups,
  tr: Translate,
): CrmTable {
  switch (view) {
    case 'leads':
      return leadTable(visible.leads, lookups, tr);
    case 'customers':
      return customerTable(visible.customers, lookups, tr);
    case 'pipeline':
      return opportunityTable(visible.opportunities, lookups, tr);
    case 'quotes':
      return quoteTable(visible.quotes, lookups, tr);
    case 'activities':
      return activityTable(visible.activities, lookups, tr);
    case 'followups':
      return followupTable(visible.followups, lookups, tr);
    case 'campaigns':
      return campaignTable(visible.campaigns, tr);
  }
}

/** The file. CRLF and quoting are `csvDocument`'s business. */
export const crmCsv = (
  view: CrmView,
  visible: CrmVisible,
  lookups: Lookups,
  tr: Translate,
): string => {
  const table = crmTable(view, visible, lookups, tr);
  return csvDocument(table.header, table.rows);
};

/**
 * `crm-quotes-2026-09-03.csv` — the surface first, because that is what differs between
 * two exports taken the same afternoon.
 */
export const suggestedFileName = (view: CrmView, today: string): string =>
  `crm-${view}-${today}.csv`;

/**
 * The same rectangle as tab-separated columns, which is what a spreadsheet accepts from
 * the clipboard as cells rather than as one string per row. No quoting: a cell containing
 * a tab or a newline would break the paste, so those are replaced by spaces rather than
 * escaped — the clipboard has no CSV-style escape a spreadsheet honours on paste.
 */
export const gridClipboardText = (
  view: CrmView,
  visible: CrmVisible,
  lookups: Lookups,
  tr: Translate,
): string => {
  const table = crmTable(view, visible, lookups, tr);
  const flat = (cell: string): string => cell.replace(/[\t\r\n]+/g, ' ');
  const line = (cells: readonly string[]): string => cells.map(flat).join('\t');
  return [line(table.header), ...table.rows.map(line)].join('\n');
};

/**
 * One row as a labelled block: `Phone: 0550…` a line at a time, empty cells dropped. This
 * is the paste that leaves the OS — into WhatsApp, into an email, into a message to the
 * hotel — so it is prose rather than columns, and it is built from the same header the
 * file uses so the two can never describe the record differently.
 *
 * The row is found by its id in the first column, which is why every table leads with one.
 * An id that is no longer on the page yields an empty string, and the caller treats that
 * the same way it treats a cancelled dialog: nothing to copy is not a failure.
 */
export function recordClipboardText(
  view: CrmView,
  visible: CrmVisible,
  lookups: Lookups,
  tr: Translate,
  id: string,
): string {
  const table = crmTable(view, visible, lookups, tr);
  const row = table.rows.find((cells) => cells[0] === id);
  if (row === undefined) return '';
  const lines: string[] = [];
  table.header.forEach((label, index) => {
    const cell = row[index] ?? '';
    if (cell !== '') lines.push(`${label}: ${cell}`);
  });
  return lines.join('\n');
}

