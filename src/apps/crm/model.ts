/**
 * CRM — the read layer.
 *
 * Eleven queries, of which nine are always live and two follow the selection.
 * That looks profligate beside an app that loads one table per view, and it is
 * deliberate: the rail carries a count against every surface, the inspector puts
 * a customer's deals and quotes beside the customer, and both of those are lies
 * if the app only knows about the view you happen to be looking at. The point of
 * moving CRM into the OS was to stop it being seven screens, and seven screens
 * is exactly what you get when each one fetches only itself.
 *
 * Every projection here is the broker's, column for column. The `map` functions
 * are module-level and pure because `useMappedDataset` takes one as a `useMemo`
 * dependency — an inline arrow would re-map every row on every render.
 *
 * The pages are windows, not the whole book. Substring filtering happens here,
 * over the page, because the broker's `where` speaks equality, `in` and `is null`
 * and nothing else; the status bar says how big the window is so that nobody
 * reads "not on this page" as "not in the database".
 */
import { useCallback, useMemo, useRef } from 'react';
import { useDataset, useMappedDataset } from '@/platform/sdk';
import { asString, num, status, str } from '../shared/guards';

/**
 * A row as the table spells it. Exported because the seven editable records carry
 * theirs: `ENTITY_FIELDS` is keyed by column name, so an editor prefills from the
 * source row, and inverting eleven projections to do it would be the same knowledge
 * written a second time.
 */
export type SourceRow = Readonly<Record<string, unknown>>;

/** The seven surfaces. The manifest declares the same seven, in this order. */
export type CrmView =
  | 'leads'
  | 'customers'
  | 'pipeline'
  | 'quotes'
  | 'activities'
  | 'followups'
  | 'campaigns';

/**
 * One page of each entity. 400 is chosen against the shape of the business
 * rather than the shape of the grid: an agency running two Hajj seasons and a
 * year of Umrah has hundreds of live customers, not tens of thousands, so the
 * window is usually the whole book and the truncation notice is usually silent.
 */
const PAGE = 400;
/** The diary and the contact log are longer, and read far more than written. */
const LOG = 300;
/** Quote lines and stage history belong to one record, so a small limit does. */
const DETAIL = 200;

/** The six stages a deal walks, in order. The broker's derived funnel agrees. */
export const STAGES = ['NEW', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
export type Stage = (typeof STAGES)[number];

/** The stages a deal can still be won from — what "open pipeline" adds up. */
const OPEN_STAGES: readonly string[] = ['NEW', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATION'];

/** Follow-up states that mean nobody owes anybody a call. */
const CLOSED_TASKS: readonly string[] = ['done', 'completed', 'cancelled'];

/** An ISO timestamp or nothing; a blank string is a missing date, not an empty one. */
const iso = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** A Postgres `text[]`, arriving as JSON, narrowed to the strings actually in it. */
function tagList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = asString(entry);
    if (text !== null && text.trim() !== '') out.push(text);
  }
  return out;
}

/** Drops the rows a guard rejected, so a renamed column costs a row, not a page. */
function mapRows<T>(rows: readonly SourceRow[], map: (row: SourceRow) => T | null): readonly T[] {
  const out: T[] = [];
  for (const row of rows) {
    const mapped = map(row);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

/** Keys a page by id so the inspector can cross the graph without a second query. */
function index<T>(rows: readonly T[], key: (row: T) => string): ReadonlyMap<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) out.set(key(row), row);
  return out;
}

/* ------------------------------------------------------------------ *
 * The records. One interface per dataset, named for the business rather
 * than the table: a salesperson has leads and deals, not `crm_leads` rows.
 * ------------------------------------------------------------------ */

export interface Lead {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Both names joined — what the grid shows and what the search box matches. */
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly source: string;
  readonly status: string;
  readonly priority: string;
  readonly score: number;
  readonly notes: string;
  readonly nextActionAt: string | null;
  readonly assignedTo: string | null;
  readonly customerId: string | null;
  readonly campaignId: string | null;
  readonly lostReason: string;
  readonly qualifiedAt: string | null;
  readonly convertedAt: string | null;
  readonly createdAt: string | null;
  /** Carried so the editor can prefill by column name. See {@link SourceRow}. */
  readonly row: SourceRow;
}

export interface Customer {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
  readonly type: string;
  readonly status: string;
  readonly phone: string;
  readonly email: string;
  readonly wilaya: string;
  readonly address: string;
  readonly source: string;
  readonly tags: readonly string[];
  readonly notes: string;
  /** Set when the customer became a pilgrim — the operational side of the graph. */
  readonly pilgrimId: string | null;
  readonly leadId: string | null;
  readonly campaignId: string | null;
  readonly ownerId: string | null;
  readonly firstWonAt: string | null;
  readonly lastActivityAt: string | null;
  readonly row: SourceRow;
}

export interface Opportunity {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly stage: string;
  readonly probability: number;
  readonly travelers: number;
  readonly valueDzd: number;
  /** Value × probability. Derived here so every grid and KPI agrees on it. */
  readonly weightedDzd: number;
  readonly customerId: string | null;
  readonly leadId: string | null;
  readonly packageId: string | null;
  readonly campaignId: string | null;
  /** Set the moment a quote is accepted — the deal's crossing into operations. */
  readonly bookingId: string | null;
  readonly expectedCloseDate: string | null;
  readonly wonAt: string | null;
  readonly lostAt: string | null;
  readonly lostReason: string;
  readonly notes: string;
  readonly row: SourceRow;
}

export interface Quote {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly currency: string;
  readonly subtotal: number;
  readonly discount: number;
  readonly total: number;
  readonly travelers: number;
  readonly opportunityId: string | null;
  readonly customerId: string | null;
  readonly packageId: string | null;
  readonly bookingId: string | null;
  readonly validUntil: string | null;
  readonly terms: string;
  readonly notes: string;
  readonly sentAt: string | null;
  readonly acceptedAt: string | null;
  readonly declinedAt: string | null;
  readonly declinedReason: string;
  readonly createdAt: string | null;
  readonly row: SourceRow;
}

export interface QuoteLine {
  readonly id: string;
  readonly quoteId: string;
  readonly packageId: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
  readonly sortOrder: number;
  readonly row: SourceRow;
}

/**
 * One line of the log. Alone among the records it carries no `row`: there is no
 * `crm.activity.update` to route a save to, so nothing ever prefills an activity form.
 */
export interface Activity {
  readonly id: string;
  readonly type: string;
  readonly direction: string;
  readonly subject: string;
  readonly body: string;
  readonly outcome: string;
  readonly minutes: number;
  readonly occurredAt: string | null;
  readonly customerId: string | null;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly quoteId: string | null;
}

export interface Followup {
  readonly id: string;
  readonly title: string;
  readonly dueAt: string | null;
  readonly priority: string;
  readonly status: string;
  readonly notes: string;
  readonly completedAt: string | null;
  readonly assignedTo: string | null;
  readonly leadId: string | null;
  readonly customerId: string | null;
  readonly opportunityId: string | null;
  readonly row: SourceRow;
}

export interface Campaign {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly channel: string;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly budgetDzd: number;
  readonly spendDzd: number;
  readonly targetSegment: string;
  readonly notes: string;
  readonly row: SourceRow;
}

/** One rung of a deal's stage ladder. The inspector reads it as a timeline. */
export interface StageStep {
  readonly id: string;
  readonly opportunityId: string;
  readonly fromStage: string;
  readonly toStage: string;
  readonly probability: number;
  readonly note: string;
  readonly changedAt: string | null;
}

/** A column of the funnel board. The broker emits all six stages, always. */
export interface PipelineStage {
  readonly stage: string;
  readonly order: number;
  readonly count: number;
  readonly valueDzd: number;
  readonly weightedDzd: number;
  readonly travelers: number;
}

/** A package, as a quote line's choice rather than as an operations record. */
export interface PackageOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
  readonly priceDzd: number;
  readonly priceSar: number;
  readonly seats: number;
  readonly status: string;
}

/* ------------------------------------------------------------------ *
 * The projections. Each is `(row) => T | null`: a row without an id is
 * not a record, and dropping it is better than rendering a grid whose
 * keys collide. The snake_case names below are the broker's `select`
 * lists, verbatim — this file is the only place they appear.
 * ------------------------------------------------------------------ */

function toLead(row: SourceRow): Lead | null {
  const id = asString(row.id);
  if (id === null) return null;
  const firstName = str(row.first_name);
  const lastName = str(row.last_name);
  return {
    id,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    phone: str(row.phone),
    email: str(row.email),
    source: str(row.source),
    status: status(row.status),
    priority: status(row.priority),
    score: num(row.score),
    notes: str(row.notes),
    nextActionAt: iso(row.next_action_at),
    assignedTo: asString(row.assigned_to),
    customerId: asString(row.customer_id),
    campaignId: asString(row.campaign_id),
    lostReason: str(row.lost_reason),
    qualifiedAt: iso(row.qualified_at),
    convertedAt: iso(row.converted_at),
    createdAt: iso(row.created_at),
    row,
  };
}

function toCustomer(row: SourceRow): Customer | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    code: str(row.code),
    name: str(row.full_name),
    nameAr: str(row.full_name_ar),
    type: status(row.customer_type),
    status: status(row.status),
    phone: str(row.phone),
    email: str(row.email),
    wilaya: str(row.wilaya),
    address: str(row.address),
    source: str(row.source),
    tags: tagList(row.tags),
    notes: str(row.notes),
    pilgrimId: asString(row.pilgrim_id),
    leadId: asString(row.lead_id),
    campaignId: asString(row.campaign_id),
    ownerId: asString(row.owner_id),
    firstWonAt: iso(row.first_won_at),
    lastActivityAt: iso(row.last_activity_at),
    row,
  };
}

function toOpportunity(row: SourceRow): Opportunity | null {
  const id = asString(row.id);
  if (id === null) return null;
  const probability = num(row.probability);
  const valueDzd = num(row.expected_value_dzd);
  return {
    id,
    reference: str(row.reference),
    title: str(row.title),
    stage: str(row.stage).toUpperCase(),
    probability,
    travelers: num(row.travelers),
    valueDzd,
    weightedDzd: (valueDzd * probability) / 100,
    customerId: asString(row.customer_id),
    leadId: asString(row.lead_id),
    packageId: asString(row.package_id),
    campaignId: asString(row.campaign_id),
    bookingId: asString(row.booking_id),
    expectedCloseDate: iso(row.expected_close_date),
    wonAt: iso(row.won_at),
    lostAt: iso(row.lost_at),
    lostReason: str(row.lost_reason),
    notes: str(row.notes),
    row,
  };
}

function toQuote(row: SourceRow): Quote | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    number: str(row.quote_number),
    status: status(row.status),
    currency: str(row.currency_code) || 'DZD',
    subtotal: num(row.subtotal),
    discount: num(row.discount_amount),
    total: num(row.total_amount),
    travelers: num(row.travelers),
    opportunityId: asString(row.opportunity_id),
    customerId: asString(row.customer_id),
    packageId: asString(row.package_id),
    bookingId: asString(row.booking_id),
    validUntil: iso(row.valid_until),
    terms: str(row.terms),
    notes: str(row.notes),
    sentAt: iso(row.sent_at),
    acceptedAt: iso(row.accepted_at),
    declinedAt: iso(row.declined_at),
    declinedReason: str(row.declined_reason),
    createdAt: iso(row.created_at),
    row,
  };
}

/** A line without a quote is an orphan, so the parent id is required too. */
function toQuoteLine(row: SourceRow): QuoteLine | null {
  const id = asString(row.id);
  const quoteId = asString(row.quote_id);
  if (id === null || quoteId === null) return null;
  return {
    id,
    quoteId,
    packageId: asString(row.package_id),
    description: str(row.description),
    quantity: num(row.quantity),
    unitPrice: num(row.unit_price),
    lineTotal: num(row.line_total),
    sortOrder: num(row.sort_order),
    row,
  };
}

function toActivity(row: SourceRow): Activity | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    type: status(row.activity_type),
    direction: status(row.direction),
    subject: str(row.subject),
    body: str(row.body),
    outcome: str(row.outcome),
    minutes: num(row.duration_minutes),
    occurredAt: iso(row.occurred_at),
    customerId: asString(row.customer_id),
    leadId: asString(row.lead_id),
    opportunityId: asString(row.opportunity_id),
    quoteId: asString(row.quote_id),
  };
}

function toFollowup(row: SourceRow): Followup | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    title: str(row.title),
    dueAt: iso(row.due_at),
    priority: status(row.priority),
    status: status(row.status),
    notes: str(row.notes),
    completedAt: iso(row.completed_at),
    assignedTo: asString(row.assigned_to),
    leadId: asString(row.lead_id),
    customerId: asString(row.customer_id),
    opportunityId: asString(row.opportunity_id),
    row,
  };
}

function toCampaign(row: SourceRow): Campaign | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    code: str(row.code),
    name: str(row.name),
    channel: status(row.channel),
    status: status(row.status),
    startDate: iso(row.start_date),
    endDate: iso(row.end_date),
    budgetDzd: num(row.budget_dzd),
    spendDzd: num(row.spend_dzd),
    targetSegment: str(row.target_segment),
    notes: str(row.notes),
    row,
  };
}

function toStageStep(row: SourceRow): StageStep | null {
  const id = asString(row.id);
  const opportunityId = asString(row.opportunity_id);
  if (id === null || opportunityId === null) return null;
  return {
    id,
    opportunityId,
    fromStage: str(row.from_stage).toUpperCase(),
    toStage: str(row.to_stage).toUpperCase(),
    probability: num(row.probability),
    note: str(row.note),
    changedAt: iso(row.changed_at),
  };
}

/** The funnel is derived, so its key is the stage name rather than a row id. */
function toPipelineStage(row: SourceRow): PipelineStage | null {
  const stage = asString(row.stage);
  if (stage === null) return null;
  return {
    stage: stage.toUpperCase(),
    order: num(row.sort_order),
    count: num(row.opportunity_count),
    valueDzd: num(row.value_dzd),
    weightedDzd: num(row.weighted_dzd),
    travelers: num(row.travelers),
  };
}

function toPackage(row: SourceRow): PackageOption | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    code: str(row.code),
    name: str(row.name),
    nameAr: str(row.name_ar),
    priceDzd: num(row.price_dzd),
    priceSar: num(row.price_sar),
    seats: num(row.seats_available),
    status: status(row.status),
  };
}

/* ------------------------------------------------------------------ *
 * Filtering and totals
 * ------------------------------------------------------------------ */

/**
 * Case-insensitive substring across the fields a salesperson would type: a
 * name, a phone number, a quote number, a reference. An empty needle matches
 * everything, which is what makes `filterAll` a no-op when the box is clear.
 */
function hit(needle: string, ...fields: readonly (string | null)[]): boolean {
  if (needle === '') return true;
  for (const field of fields) {
    if (field !== null && field.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * The seven grids' rows. The model carries two of these: `all`, which the
 * inspector reads so a customer's deals appear whatever the search box says,
 * and `visible`, which the grids read. Two parallel groups rather than one
 * tagged union, so every `Column<T>` stays exactly typed.
 */
export interface CrmVisible {
  readonly leads: readonly Lead[];
  readonly customers: readonly Customer[];
  readonly opportunities: readonly Opportunity[];
  readonly quotes: readonly Quote[];
  readonly activities: readonly Activity[];
  readonly followups: readonly Followup[];
  readonly campaigns: readonly Campaign[];
}

/** Returns `all` itself when the needle is empty — no copying, no re-render. */
function filterAll(all: CrmVisible, needle: string): CrmVisible {
  if (needle === '') return all;
  return {
    leads: all.leads.filter((r) => hit(needle, r.name, r.phone, r.email, r.source, r.status)),
    customers: all.customers.filter((r) =>
      hit(needle, r.name, r.nameAr, r.code, r.phone, r.email, r.wilaya),
    ),
    opportunities: all.opportunities.filter((r) =>
      hit(needle, r.title, r.reference, r.stage, r.notes),
    ),
    quotes: all.quotes.filter((r) => hit(needle, r.number, r.status, r.terms, r.notes)),
    activities: all.activities.filter((r) =>
      hit(needle, r.subject, r.body, r.type, r.outcome, r.direction),
    ),
    followups: all.followups.filter((r) => hit(needle, r.title, r.notes, r.priority, r.status)),
    campaigns: all.campaigns.filter((r) => hit(needle, r.name, r.code, r.channel, r.status)),
  };
}

/** What the header tiles show. Every figure is over the loaded page. */
export interface CrmSummary {
  /** Deals still winnable, at face value. */
  readonly openValueDzd: number;
  /** The same deals at their own stated probability — the honest number. */
  readonly weightedValueDzd: number;
  readonly wonValueDzd: number;
  /** Quotes sent and not yet answered: the queue the customer is sitting in. */
  readonly awaitingQuotes: number;
  readonly overdueFollowups: number;
  readonly newLeads: number;
}

/** Leads nobody has worked yet — the two statuses that mean "still owed a call". */
const FRESH_LEADS: readonly string[] = ['new', 'contacted'];

function summarize(
  opportunities: readonly Opportunity[],
  quotes: readonly Quote[],
  leads: readonly Lead[],
  overdueFollowups: number,
): CrmSummary {
  let openValueDzd = 0;
  let weightedValueDzd = 0;
  let wonValueDzd = 0;
  for (const deal of opportunities) {
    if (OPEN_STAGES.includes(deal.stage)) {
      openValueDzd += deal.valueDzd;
      weightedValueDzd += deal.weightedDzd;
    } else if (deal.stage === 'WON') {
      wonValueDzd += deal.valueDzd;
    }
  }
  let awaitingQuotes = 0;
  for (const quote of quotes) if (quote.status === 'sent') awaitingQuotes += 1;
  let newLeads = 0;
  for (const lead of leads) if (FRESH_LEADS.includes(lead.status)) newLeads += 1;
  return {
    openValueDzd,
    weightedValueDzd,
    wonValueDzd,
    awaitingQuotes,
    overdueFollowups,
    newLeads,
  };
}

/**
 * A task is overdue when it is still open and its due date has passed. The
 * clock arrives as an argument rather than being read here, so the set below
 * is computed once per page instead of once per row, and the model exposes
 * membership rather than a timestamp nothing else needs.
 */
function isOverdue(task: Followup, now: number): boolean {
  if (CLOSED_TASKS.includes(task.status) || task.dueAt === null) return false;
  const due = Date.parse(task.dueAt);
  return Number.isFinite(due) && due < now;
}

/** Campaign states that mean money is going out of the door right now. */
const LIVE_CAMPAIGNS: readonly string[] = ['active', 'running', 'live'];

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

export interface CrmModel {
  /** Every loaded row, unfiltered — what the inspector crosses the graph with. */
  readonly all: CrmVisible;
  /** The same rows narrowed by the search box — what the grids render. */
  readonly visible: CrmVisible;
  readonly pipeline: readonly PipelineStage[];
  readonly packages: readonly PackageOption[];
  /** Lines of the selected quote; empty on every other surface. */
  readonly quoteLines: readonly QuoteLine[];
  /** Stage ladder of the selected deal; empty on every other surface. */
  readonly history: readonly StageStep[];
  readonly summary: CrmSummary;
  /** The rail's badge per surface — semantic, not merely a row count. */
  readonly counts: Readonly<Record<CrmView, number>>;
  readonly overdue: ReadonlySet<string>;
  readonly customerById: ReadonlyMap<string, Customer>;
  readonly packageById: ReadonlyMap<string, PackageOption>;
  readonly campaignById: ReadonlyMap<string, Campaign>;
  readonly opportunityById: ReadonlyMap<string, Opportunity>;
  readonly loading: boolean;
  readonly error: string | null;
  /** ISO stamp of the customers page — what the status bar reports as freshness. */
  readonly fetchedAt: string | null;
  /** True when any page came back full, so the status bar can say so. */
  readonly truncated: boolean;
  readonly refresh: () => void;
}

/**
 * What the model needs from a query, whichever of the two hooks produced it.
 * Both return this shape; treating them alike is what lets one loop answer
 * "is anything still loading?" and "did anything fail?" for all eleven.
 */
interface Feed {
  readonly rows: readonly unknown[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * True when any page came back full. A dropped row can hide a full page — a
 * guard rejecting one of 400 leaves 399 — so this under-reports rather than
 * over-reports, which is the right way round for a warning about missing rows.
 */
function windowed(pages: readonly (readonly [number, number])[]): boolean {
  for (const [count, limit] of pages) if (count >= limit) return true;
  return false;
}

/**
 * Reads the whole desk. `view` and `selectedId` shape only the two detail
 * queries; the other nine ignore them, which is why switching surfaces is
 * instant and why the rail's badges are true before you have visited a tab.
 */
export function useCrmModel(view: CrmView, query: string, selectedId: string | null): CrmModel {
  // The spine: ordered by last contact, and the page whose stamp the status
  // bar reports. It is the one read through `useDataset` because it is the one
  // whose `fetchedAt` the user is told about.
  const customerPage = useDataset('crmCustomers', {
    limit: PAGE,
    orderBy: { column: 'last_activity_at', ascending: false },
  });

  const leads = useMappedDataset('crmLeads', toLead, { limit: PAGE });
  const deals = useMappedDataset('crmOpportunities', toOpportunity, { limit: PAGE });
  const quotes = useMappedDataset('crmQuotes', toQuote, { limit: PAGE });
  const campaigns = useMappedDataset('crmCampaigns', toCampaign, { limit: PAGE });
  const packages = useMappedDataset('packages', toPackage, { limit: PAGE });
  const activities = useMappedDataset('crmActivities', toActivity, { limit: LOG });
  const followups = useMappedDataset('crmFollowups', toFollowup, { limit: LOG });

  // The funnel is derived server-side from the deals, so it is invalidated by
  // whatever invalidates them: `watch` keeps the board honest even if a future
  // command binding forgets to name `crmPipeline` in its own invalidation list.
  const pipeline = useMappedDataset('crmPipeline', toPipelineStage, {
    limit: 16,
    watch: ['crmOpportunities'],
  });

  // The two selection-scoped reads. `enabled` keeps them off the wire entirely
  // on the five surfaces that have no use for them.
  const quoteLines = useMappedDataset('crmQuoteLines', toQuoteLine, {
    where: { quote_id: view === 'quotes' ? (selectedId ?? '') : '' },
    limit: DETAIL,
    enabled: view === 'quotes' && selectedId !== null,
  });
  const history = useMappedDataset('crmStageHistory', toStageStep, {
    where: { opportunity_id: view === 'pipeline' ? (selectedId ?? '') : '' },
    limit: DETAIL,
    enabled: view === 'pipeline' && selectedId !== null,
  });

  const customers = useMemo(() => mapRows(customerPage.rows, toCustomer), [customerPage.rows]);

  const all = useMemo<CrmVisible>(
    () => ({
      leads: leads.rows,
      customers,
      opportunities: deals.rows,
      quotes: quotes.rows,
      activities: activities.rows,
      followups: followups.rows,
      campaigns: campaigns.rows,
    }),
    [leads.rows, customers, deals.rows, quotes.rows, activities.rows, followups.rows, campaigns.rows],
  );

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => filterAll(all, needle), [all, needle]);

  // The clock is read here and nowhere else. Keying this memo on a `now` from
  // the caller would make it a dependency that only ever grows, and re-derive
  // the set on every tick for no gain.
  const overdue = useMemo(() => {
    const now = Date.now();
    const out = new Set<string>();
    for (const task of all.followups) if (isOverdue(task, now)) out.add(task.id);
    return out;
  }, [all.followups]);

  const summary = useMemo(
    () => summarize(all.opportunities, all.quotes, all.leads, overdue.size),
    [all.opportunities, all.quotes, all.leads, overdue],
  );

  // Badges answer "is there work here?", not "how many rows did we load?".
  // Pipeline counts winnable deals, follow-ups count the late ones, campaigns
  // count the ones currently spending money.
  const counts = useMemo<Readonly<Record<CrmView, number>>>(() => {
    let open = 0;
    for (const deal of all.opportunities) if (OPEN_STAGES.includes(deal.stage)) open += 1;
    let live = 0;
    for (const run of all.campaigns) if (LIVE_CAMPAIGNS.includes(run.status)) live += 1;
    return {
      leads: all.leads.length,
      customers: all.customers.length,
      pipeline: open,
      quotes: all.quotes.length,
      activities: all.activities.length,
      followups: overdue.size,
      campaigns: live,
    };
  }, [all, overdue]);

  const customerById = useMemo(() => index(customers, (row) => row.id), [customers]);
  const packageById = useMemo(() => index(packages.rows, (row) => row.id), [packages.rows]);
  const campaignById = useMemo(() => index(campaigns.rows, (row) => row.id), [campaigns.rows]);
  const opportunityById = useMemo(() => index(deals.rows, (row) => row.id), [deals.rows]);

  // One pass over all eleven queries: the desk is loading while any of them is,
  // and one banner carries the first failure rather than eleven stacked ones.
  const feeds: readonly Feed[] = [
    customerPage,
    leads,
    deals,
    quotes,
    campaigns,
    packages,
    activities,
    followups,
    pipeline,
    quoteLines,
    history,
  ];
  let loading = false;
  let error: string | null = null;
  for (const feed of feeds) {
    if (feed.loading) loading = true;
    if (error === null) error = feed.error;
  }

  // Refresh reloads every query, including the two the current view is not
  // using — F5 means "the desk is stale", not "this grid is stale". The ref
  // keeps the callback stable while still calling the newest `refetch`s.
  const latest = useRef(feeds);
  latest.current = feeds;
  const refresh = useCallback(() => {
    for (const feed of latest.current) feed.refetch();
  }, []);

  const truncated = windowed([
    [all.leads.length, PAGE],
    [all.customers.length, PAGE],
    [all.opportunities.length, PAGE],
    [all.quotes.length, PAGE],
    [all.campaigns.length, PAGE],
    [packages.rows.length, PAGE],
    [all.activities.length, LOG],
    [all.followups.length, LOG],
    [quoteLines.rows.length, DETAIL],
    [history.rows.length, DETAIL],
  ]);

  return {
    all,
    visible,
    pipeline: pipeline.rows,
    packages: packages.rows,
    quoteLines: quoteLines.rows,
    history: history.rows,
    summary,
    counts,
    overdue,
    customerById,
    packageById,
    campaignById,
    opportunityById,
    loading,
    error,
    fetchedAt: customerPage.fetchedAt,
    truncated,
    refresh,
  };
}

/** The stage a deal sits in, as the funnel board's own ordering wants it. */
export const stageOrder = (stage: string): number => {
  const at = STAGES.indexOf(stage.toUpperCase() as Stage);
  return at === -1 ? STAGES.length : at;
};
