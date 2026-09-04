/**
 * The seven registers.
 *
 * One exported dispatcher and seven private grids. `CrmList` switches on the view and each
 * branch owns its own columns, its own empty state and its own loading rule. The grids are
 * private because `react-refresh/only-export-components` is error-level here and a `.tsx` may
 * export nothing but components — a shared `columnsFor(view)` would have to live in a `.ts`
 * file, where it could not contain JSX. Keeping each column list beside its grid is the better
 * trade anyway: the array closes over `t`/`tr`/`lang` and reads as a table of the surface.
 *
 * Loading is per branch, measured against that branch's *unfiltered* length — `close/App.tsx`'s
 * rule verbatim: a search that matches nothing must say "no matches" rather than spin forever.
 *
 * Enum badges all pass through `wordFor`, which resolves the word from the same option tables
 * the editors use and falls back to the raw uppercase code when a table deliberately omits one
 * (a lead's CONVERTED, an activity's SYSTEM, a follow-up's DONE — each written only by the
 * command that makes it true). Two keys are not the projection's field name: `customer_type`
 * for a customer's type and `activity_type` for an activity's. Tones come from the tables in
 * `tones.ts`, keyed by the uppercase code; `toneOf` upper-cases before it looks up, which is
 * what lets a projection that lower-cased its status on read still find its colour.
 *
 * A stage is the one enum with no option table — it belongs to the pipeline RPC — so it narrows
 * through `asStage` and labels through `stageLabel`, exactly as the funnel band above it does.
 *
 * Foreign keys resolve through the model's `*ById` maps and show an em-dash when the lookup
 * misses. That folds two different facts — "this row has no customer" and "that customer fell
 * past the page cap" — into one glyph, which is the right call in a grid: the inspector is
 * where a missing link gets explained, and a raw UUID in a cell explains nothing.
 *
 * No new class and no new token: every colour here is one `cells.tsx` already exercises.
 */
import { type MouseEvent as ReactMouseEvent, useMemo } from 'react';
import {
  AlarmClock,
  FileText,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Target,
  UserPlus,
  Users,
} from 'lucide-react';
import { type Column, DataGrid, EmptyState, fmt, type Localized, useLocale } from '@/platform/sdk';
import { Chip, Dash, Funnel, Stack, TagList, Tinted } from './cells';
import type { CrmEntity } from './form';
import { asStage, stageLabel } from './lifecycle';
import type {
  Activity,
  Campaign,
  CrmModel,
  CrmView,
  Customer,
  Followup,
  Lead,
  Opportunity,
  Quote,
} from './model';
import type { CrmRow } from './shell';
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
  STAGE_TONE,
  toneOf,
  type ToneTable,
  wordFor,
} from './tones';

export interface CrmListProps {
  readonly view: CrmView;
  readonly model: CrmModel;
  /** The raw search text; only its emptiness matters here, for the empty state's wording. */
  readonly search: string;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onContext: (row: CrmRow, event: ReactMouseEvent) => void;
  readonly onActivate: (row: CrmRow) => void;
}

/**
 * What every grid needs, and nothing else.
 *
 * The three callbacks are typed on the `CrmRow` union rather than per record, which is exactly
 * what lets one handler serve seven differently-typed grids: a function accepting the whole
 * union is assignable wherever one accepting a single member is expected.
 */
interface Desk {
  readonly model: CrmModel;
  readonly searching: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onContext: (row: CrmRow, event: ReactMouseEvent) => void;
  readonly onActivate: (row: CrmRow) => void;
}

/** `DataGrid` speaks in key sets; the shell holds one id. Written once for all seven grids. */
const pick = (onSelect: (id: string | null) => void) => (keys: ReadonlySet<string>) => {
  const list = [...keys];
  onSelect(list.length === 0 ? null : list[0]);
};

/** A date that has gone by. Parse failures are not overdue — an unreadable date is not a debt. */
function due(iso: string | null, now: number): boolean {
  if (iso === null) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at < now;
}

/**
 * A single line of text, clipped, or a dash when there is nothing to show.
 *
 * Used for plain columns and for resolved foreign keys alike, which is why it takes the already
 * looked-up string rather than a map and an id: `undefined` from a `Map.get(...)?.name` and `''`
 * from a nullable text column both mean "nothing to print here".
 */
function link(text: string | undefined) {
  if (text === undefined || text === '') return <Dash />;
  return (
    <span className="fx-title-ellipsis" title={text}>
      {text}
    </span>
  );
}

/**
 * An enum as a badge, resolved the same way the editors resolve it.
 *
 * The tone table is optional because three of these enums have no colour of their own — a lead's
 * source, an activity's type, a campaign's channel are facts rather than states — and a neutral
 * badge is the honest rendering of a fact.
 */
function enumCell(
  t: (value: Localized) => string,
  entity: CrmEntity,
  key: string,
  value: string,
  table?: ToneTable,
) {
  const text = wordFor(t, entity, key, value);
  if (text === '') return <Dash />;
  return <Chip text={text} tone={table === undefined ? 'neutral' : toneOf(table, value)} />;
}

/** The three keys an activity and a follow-up share, so one resolver serves both desks. */
interface Linked {
  readonly customerId: string | null;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
}

/**
 * What a log line is *about*, in one column.
 *
 * A row may carry more than one of the three keys — an activity against an opportunity almost
 * always carries its customer too — so the order here is a precedence, not a search: the
 * customer is the name a salesperson recognises, the lead is the name before there was a
 * customer, and the deal is the fallback when neither party is on the row.
 *
 * Leads resolve through a map built by the caller: the model publishes `customerById`,
 * `campaignById`, `opportunityById` and `packageById`, but no `leadById`.
 */
function linkedTo(model: CrmModel, leads: ReadonlyMap<string, string>, row: Linked) {
  if (row.customerId !== null) return link(model.customerById.get(row.customerId)?.name);
  if (row.leadId !== null) return link(leads.get(row.leadId));
  if (row.opportunityId !== null) return link(model.opportunityById.get(row.opportunityId)?.title);
  return <Dash />;
}

interface BlankProps {
  readonly icon: LucideIcon;
  readonly searching: boolean;
  /** Already localised by the grid, because only the grid knows which register is empty. */
  readonly noun: string;
}

/**
 * The two ways a grid can be empty, told apart.
 *
 * "No matches" is a statement about the search box and is answered by clearing it; "no leads yet"
 * is a statement about the register and is answered by Ctrl+N. Collapsing them into one message
 * makes a filtered grid look like a broken one.
 */
function Blank({ icon, searching, noun }: BlankProps) {
  const { tr } = useLocale();
  if (searching) {
    return (
      <EmptyState
        icon={icon}
        title={tr('لا نتائج', 'Aucun résultat', 'No matches')}
        description={tr(
          'عدّل البحث أو امسحه.',
          'Modifiez la recherche ou effacez-la.',
          'Adjust the search, or clear it.',
        )}
      />
    );
  }
  return (
    <EmptyState
      icon={icon}
      title={noun}
      description={tr('ابدأ بـ Ctrl+N.', 'Commencez par Ctrl+N.', 'Start with Ctrl+N.')}
    />
  );
}

/**
 * Leads.
 *
 * The next action tints only while the lead is still live: a converted lead's stale reminder is
 * finished business, and painting it red would send somebody to re-work a won customer. The
 * model's `overdue` set is deliberately not consulted — it is built from follow-ups alone, so it
 * would never match a lead id and the column would silently never tint.
 */
function LeadGrid({ model, searching, selectedId, onSelect, onContext, onActivate }: Desk) {
  const { t, tr, lang } = useLocale();
  const now = Date.now();
  const columns: readonly Column<Lead>[] = [
    {
      id: 'name',
      header: tr('العميل المحتمل', 'Prospect', 'Lead'),
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (row) => <Stack title={row.name} caption={row.phone} hint={row.name} />,
    },
    { id: 'email', header: tr('البريد', 'E-mail', 'Email'), width: 190, render: (row) => link(row.email) },
    {
      id: 'source',
      header: tr('المصدر', 'Source', 'Source'),
      width: 132,
      render: (row) => enumCell(t, 'lead', 'source', row.source),
    },
    {
      id: 'status',
      header: tr('الحالة', 'Statut', 'Status'),
      width: 124,
      render: (row) => enumCell(t, 'lead', 'status', row.status, LEAD_STATUS_TONE),
    },
    {
      id: 'priority',
      header: tr('الأولوية', 'Priorité', 'Priority'),
      width: 112,
      render: (row) => enumCell(t, 'lead', 'priority', row.priority, PRIORITY_TONE),
    },
    {
      id: 'score',
      header: tr('النقاط', 'Score', 'Score'),
      width: 78,
      align: 'end',
      mono: true,
      sort: (a, b) => a.score - b.score,
      render: (row) => fmt.integer(row.score, lang),
    },
    {
      id: 'campaign',
      header: tr('الحملة', 'Campagne', 'Campaign'),
      width: 160,
      render: (row) =>
        link(row.campaignId === null ? undefined : model.campaignById.get(row.campaignId)?.name),
    },
    {
      id: 'next',
      header: tr('الإجراء القادم', 'Prochaine action', 'Next action'),
      width: 152,
      mono: true,
      render: (row) =>
        row.nextActionAt === null ? (
          <Dash />
        ) : (
          <Tinted
            text={fmt.dateTime(row.nextActionAt, lang)}
            tone={row.convertedAt === null && due(row.nextActionAt, now) ? 'danger' : undefined}
          />
        ),
    },
  ];
  return (
    <DataGrid
      rows={model.visible.leads}
      columns={columns}
      rowKey={(row) => row.id}
      loading={model.loading && model.all.leads.length === 0}
      density="compact"
      virtualized
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={pick(onSelect)}
      onRowContextMenu={onContext}
      onActivate={onActivate}
      empty={
        <Blank
          icon={UserPlus}
          searching={searching}
          noun={tr('لا عملاء محتملين', 'Aucun prospect', 'No leads')}
        />
      }
    />
  );
}

/**
 * Customers.
 *
 * The Arabic name rides under the Latin one rather than in a column of its own: a register that
 * gave each script its own column would double the width of the identity and leave one of the
 * two blank on most rows. Last activity is relative — "3 days ago" answers "is this account warm"
 * in a way an absolute date does not.
 */
function CustomerGrid({ model, searching, selectedId, onSelect, onContext, onActivate }: Desk) {
  const { t, tr, lang } = useLocale();
  const columns: readonly Column<Customer>[] = [
    {
      id: 'code',
      header: tr('الرمز', 'Code', 'Code'),
      width: 112,
      mono: true,
      sort: (a, b) => a.code.localeCompare(b.code),
      render: (row) => link(row.code),
    },
    {
      id: 'name',
      header: tr('العميل', 'Client', 'Customer'),
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (row) => <Stack title={row.name} caption={row.nameAr} hint={row.name} />,
    },
    {
      id: 'type',
      header: tr('النوع', 'Type', 'Type'),
      width: 118,
      render: (row) => enumCell(t, 'customer', 'customer_type', row.type, CUSTOMER_TYPE_TONE),
    },
    {
      id: 'status',
      header: tr('الحالة', 'Statut', 'Status'),
      width: 112,
      render: (row) => enumCell(t, 'customer', 'status', row.status, CUSTOMER_STATUS_TONE),
    },
    { id: 'wilaya', header: tr('الولاية', 'Wilaya', 'Wilaya'), width: 132, render: (row) => link(row.wilaya) },
    {
      id: 'phone',
      header: tr('الهاتف', 'Téléphone', 'Phone'),
      width: 142,
      mono: true,
      render: (row) => link(row.phone),
    },
    {
      id: 'tags',
      header: tr('الوسوم', 'Étiquettes', 'Tags'),
      width: 172,
      render: (row) => <TagList tags={row.tags} />,
    },
    {
      id: 'seen',
      header: tr('آخر نشاط', 'Dernière activité', 'Last activity'),
      width: 132,
      render: (row) =>
        row.lastActivityAt === null ? <Dash /> : fmt.relativeTime(row.lastActivityAt, lang),
    },
  ];
  return (
    <DataGrid
      rows={model.visible.customers}
      columns={columns}
      rowKey={(row) => row.id}
      loading={model.loading && model.all.customers.length === 0}
      density="compact"
      virtualized
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={pick(onSelect)}
      onRowContextMenu={onContext}
      onActivate={onActivate}
      empty={
        <Blank
          icon={Users}
          searching={searching}
          noun={tr('لا عملاء', 'Aucun client', 'No customers')}
        />
      }
    />
  );
}

/**
 * The pipeline.
 *
 * The only grid with a band above it: `Funnel` reads across the six stages, the grid reads down
 * the deals inside them. Probability arrives 0–100 from the projection — `STAGE_PROBABILITY`'s
 * `NEW: 10 … NEGOTIATION: 75` fix that scale — so it is divided before `fmt.percent`, which
 * expects a fraction. Expected close tints only while the deal is open: a closed deal's date is
 * a record, not a debt.
 */
function PipelineGrid({ model, searching, selectedId, onSelect, onContext, onActivate }: Desk) {
  const { t, tr, lang } = useLocale();
  const now = Date.now();
  const columns: readonly Column<Opportunity>[] = [
    {
      id: 'reference',
      header: tr('المرجع', 'Référence', 'Reference'),
      width: 122,
      mono: true,
      sort: (a, b) => a.reference.localeCompare(b.reference),
      render: (row) => link(row.reference),
    },
    {
      id: 'title',
      header: tr('الفرصة', 'Opportunité', 'Deal'),
      sort: (a, b) => a.title.localeCompare(b.title),
      render: (row) => (
        <Stack
          title={row.title}
          caption={row.customerId === null ? null : model.customerById.get(row.customerId)?.name}
          hint={row.title}
        />
      ),
    },
    {
      id: 'stage',
      header: tr('المرحلة', 'Étape', 'Stage'),
      width: 130,
      render: (row) => {
        const known = asStage(row.stage);
        return (
          <Chip
            text={known === null ? row.stage.toUpperCase() : t(stageLabel(known))}
            tone={toneOf(STAGE_TONE, row.stage)}
          />
        );
      },
    },
    {
      id: 'probability',
      header: tr('الاحتمال', 'Probabilité', 'Probability'),
      width: 104,
      align: 'end',
      mono: true,
      sort: (a, b) => a.probability - b.probability,
      render: (row) => fmt.percent(row.probability / 100, lang, 0),
    },
    {
      id: 'value',
      header: tr('القيمة', 'Valeur', 'Value'),
      width: 148,
      align: 'end',
      mono: true,
      sort: (a, b) => a.valueDzd - b.valueDzd,
      render: (row) => fmt.money(row.valueDzd, 'DZD', lang),
    },
    {
      id: 'weighted',
      header: tr('مرجّحة', 'Pondérée', 'Weighted'),
      width: 148,
      align: 'end',
      mono: true,
      sort: (a, b) => a.weightedDzd - b.weightedDzd,
      render: (row) => fmt.money(row.weightedDzd, 'DZD', lang),
    },
    {
      id: 'travelers',
      header: tr('المسافرون', 'Voyageurs', 'Travelers'),
      width: 96,
      align: 'end',
      mono: true,
      render: (row) => fmt.integer(row.travelers, lang),
    },
    {
      id: 'close',
      header: tr('الإغلاق المتوقع', 'Clôture prévue', 'Expected close'),
      width: 138,
      mono: true,
      render: (row) =>
        row.expectedCloseDate === null ? (
          <Dash />
        ) : (
          <Tinted
            text={fmt.date(row.expectedCloseDate, lang)}
            tone={
              row.wonAt === null && row.lostAt === null && due(row.expectedCloseDate, now)
                ? 'warning'
                : undefined
            }
          />
        ),
    },
  ];
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Funnel stages={model.pipeline} />
      <DataGrid
        rows={model.visible.opportunities}
        columns={columns}
        rowKey={(row) => row.id}
        loading={model.loading && model.all.opportunities.length === 0}
        density="compact"
        virtualized
        style={{ flex: 1, minHeight: 0 }}
        selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
        onSelectionChange={pick(onSelect)}
        onRowContextMenu={onContext}
        onActivate={onActivate}
        empty={
          <Blank
            icon={Target}
            searching={searching}
            noun={tr('لا فرص', 'Aucune opportunité', 'No deals')}
          />
        }
      />
    </div>
  );
}

/**
 * Quotes.
 *
 * The state column is the one badge in this file that is computed rather than looked up:
 * `quoteState` folds four nullable timestamps and the validity date into one word, because a
 * quote's `status` column cannot say "sent but expired" and that is exactly the state a
 * salesperson needs to see. The same call supplies the validity tint, so the badge and the date
 * can never disagree.
 */
function QuoteGrid({ model, searching, selectedId, onSelect, onContext, onActivate }: Desk) {
  const { t, tr, lang } = useLocale();
  const now = Date.now();
  const columns: readonly Column<Quote>[] = [
    {
      id: 'number',
      header: tr('الرقم', 'Numéro', 'Number'),
      width: 136,
      mono: true,
      sort: (a, b) => a.number.localeCompare(b.number),
      render: (row) => link(row.number),
    },
    {
      id: 'party',
      header: tr('العميل', 'Client', 'Customer'),
      render: (row) => {
        const customer =
          row.customerId === null ? undefined : model.customerById.get(row.customerId);
        const deal =
          row.opportunityId === null ? undefined : model.opportunityById.get(row.opportunityId);
        if (customer === undefined) return link(deal?.title);
        return <Stack title={customer.name} caption={deal?.title} hint={customer.name} />;
      },
    },
    {
      id: 'state',
      header: tr('الحالة', 'État', 'State'),
      width: 130,
      render: (row) => {
        const state = quoteState(row, now);
        return <Chip text={t(state.text)} tone={state.tone} />;
      },
    },
    {
      id: 'total',
      header: tr('المجموع', 'Total', 'Total'),
      width: 152,
      align: 'end',
      mono: true,
      sort: (a, b) => a.total - b.total,
      render: (row) => fmt.money(row.total, row.currency === 'SAR' ? 'SAR' : 'DZD', lang),
    },
    {
      id: 'travelers',
      header: tr('المسافرون', 'Voyageurs', 'Travelers'),
      width: 92,
      align: 'end',
      mono: true,
      render: (row) => fmt.integer(row.travelers, lang),
    },
    {
      id: 'valid',
      header: tr('صالح حتى', 'Valide jusqu’au', 'Valid until'),
      width: 134,
      mono: true,
      render: (row) => (
        <Tinted
          text={fmt.date(row.validUntil, lang)}
          tone={quoteState(row, now).expired ? 'warning' : undefined}
        />
      ),
    },
    {
      id: 'sent',
      header: tr('أُرسل', 'Envoyé', 'Sent'),
      width: 134,
      mono: true,
      render: (row) => fmt.dateTime(row.sentAt, lang),
    },
  ];
  return (
    <DataGrid
      rows={model.visible.quotes}
      columns={columns}
      rowKey={(row) => row.id}
      loading={model.loading && model.all.quotes.length === 0}
      density="compact"
      virtualized
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={pick(onSelect)}
      onRowContextMenu={onContext}
      onActivate={onActivate}
      empty={
        <Blank
          icon={FileText}
          searching={searching}
          noun={tr('لا عروض', 'Aucun devis', 'No quotes')}
        />
      }
    />
  );
}

/**
 * Activities.
 *
 * The one grid with no `onActivate`: an activity line is history, `allowed()` returns nothing for
 * it and `crm.activity.update` does not exist, so a double-click that opened an editor would open
 * one that cannot save. Leads resolve through a map built here because the model publishes no
 * `leadById` — it is the only lookup in this file that is not already a projection map.
 */
function ActivityGrid({ model, searching, selectedId, onSelect, onContext }: Desk) {
  const { t, tr, lang } = useLocale();
  const leadById = useMemo(
    () => new Map<string, string>(model.all.leads.map((row) => [row.id, row.name])),
    [model.all.leads],
  );
  const columns: readonly Column<Activity>[] = [
    {
      id: 'occurred',
      header: tr('التاريخ', 'Date', 'Occurred'),
      width: 152,
      mono: true,
      sort: (a, b) => (a.occurredAt ?? '').localeCompare(b.occurredAt ?? ''),
      render: (row) => fmt.dateTime(row.occurredAt, lang),
    },
    {
      id: 'type',
      header: tr('النوع', 'Type', 'Type'),
      width: 122,
      render: (row) => enumCell(t, 'activity', 'activity_type', row.type),
    },
    {
      id: 'direction',
      header: tr('الاتجاه', 'Sens', 'Direction'),
      width: 112,
      render: (row) => enumCell(t, 'activity', 'direction', row.direction, DIRECTION_TONE),
    },
    {
      id: 'subject',
      header: tr('الموضوع', 'Objet', 'Subject'),
      render: (row) => <Stack title={row.subject} caption={row.body} hint={row.subject} />,
    },
    {
      id: 'outcome',
      header: tr('النتيجة', 'Résultat', 'Outcome'),
      width: 132,
      render: (row) => enumCell(t, 'activity', 'outcome', row.outcome, OUTCOME_TONE),
    },
    {
      id: 'minutes',
      header: tr('الدقائق', 'Minutes', 'Minutes'),
      width: 88,
      align: 'end',
      mono: true,
      sort: (a, b) => a.minutes - b.minutes,
      render: (row) => (row.minutes === 0 ? <Dash /> : fmt.integer(row.minutes, lang)),
    },
    {
      id: 'linked',
      header: tr('مرتبط بـ', 'Lié à', 'Linked to'),
      width: 176,
      render: (row) => linkedTo(model, leadById, row),
    },
  ];
  return (
    <DataGrid
      rows={model.visible.activities}
      columns={columns}
      rowKey={(row) => row.id}
      loading={model.loading && model.all.activities.length === 0}
      density="compact"
      virtualized
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={pick(onSelect)}
      onRowContextMenu={onContext}
      empty={
        <Blank
          icon={MessageSquare}
          searching={searching}
          noun={tr('لا أنشطة', 'Aucune activité', 'No activity')}
        />
      }
    />
  );
}

/**
 * Follow-ups.
 *
 * The only grid that tints whole rows, and the only one whose lateness is not recomputed here:
 * `model.overdue` is built from follow-ups alone, so membership *is* the answer and asking twice
 * could disagree with the rail's badge, which counts the same set. The row tone is `warning` while
 * the due cell is `danger` — the row says "this desk has debt", the cell says which date is it.
 */
function FollowupGrid({ model, searching, selectedId, onSelect, onContext, onActivate }: Desk) {
  const { t, tr, lang } = useLocale();
  const leadById = useMemo(
    () => new Map<string, string>(model.all.leads.map((row) => [row.id, row.name])),
    [model.all.leads],
  );
  const columns: readonly Column<Followup>[] = [
    {
      id: 'due',
      header: tr('الاستحقاق', 'Échéance', 'Due'),
      width: 152,
      mono: true,
      sort: (a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''),
      render: (row) =>
        row.dueAt === null ? (
          <Dash />
        ) : (
          <Tinted
            text={fmt.dateTime(row.dueAt, lang)}
            tone={model.overdue.has(row.id) ? 'danger' : undefined}
          />
        ),
    },
    {
      id: 'title',
      header: tr('المتابعة', 'Suivi', 'Follow-up'),
      render: (row) => <Stack title={row.title} caption={row.notes} hint={row.title} />,
    },
    {
      id: 'priority',
      header: tr('الأولوية', 'Priorité', 'Priority'),
      width: 112,
      render: (row) => enumCell(t, 'followup', 'priority', row.priority, PRIORITY_TONE),
    },
    {
      id: 'status',
      header: tr('الحالة', 'Statut', 'Status'),
      width: 112,
      render: (row) => enumCell(t, 'followup', 'status', row.status, FOLLOWUP_STATUS_TONE),
    },
    {
      id: 'linked',
      header: tr('مرتبط بـ', 'Lié à', 'Linked to'),
      width: 180,
      render: (row) => linkedTo(model, leadById, row),
    },
    {
      id: 'completed',
      header: tr('أُنجزت', 'Terminé', 'Completed'),
      width: 152,
      mono: true,
      sort: (a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''),
      render: (row) => fmt.dateTime(row.completedAt, lang),
    },
  ];
  return (
    <DataGrid
      rows={model.visible.followups}
      columns={columns}
      rowKey={(row) => row.id}
      loading={model.loading && model.all.followups.length === 0}
      density="compact"
      virtualized
      rowTone={(row) => (model.overdue.has(row.id) ? 'warning' : undefined)}
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={pick(onSelect)}
      onRowContextMenu={onContext}
      onActivate={onActivate}
      empty={
        <Blank
          icon={AlarmClock}
          searching={searching}
          noun={tr('لا متابعات', 'Aucun suivi', 'No follow-ups')}
        />
      }
    />
  );
}

/**
 * Campaigns.
 *
 * Spend carries the only comparison in this file that is not a date: it turns `danger` once it
 * passes the budget, guarded on a non-zero budget so an unbudgeted campaign is not permanently
 * red. The proportion itself — the `Meter` — belongs to the inspector, because a bar reads as a
 * measurement and a 150px cell cannot honestly show one. Channel is the one enum with no tone
 * table: an email campaign is not better or worse than an SMS campaign, so all of them stay grey.
 */
function CampaignGrid({ model, searching, selectedId, onSelect, onContext, onActivate }: Desk) {
  const { t, tr, lang } = useLocale();
  const columns: readonly Column<Campaign>[] = [
    {
      id: 'code',
      header: tr('الرمز', 'Code', 'Code'),
      width: 120,
      mono: true,
      sort: (a, b) => a.code.localeCompare(b.code),
      render: (row) => link(row.code),
    },
    {
      id: 'name',
      header: tr('الحملة', 'Campagne', 'Campaign'),
      render: (row) => <Stack title={row.name} caption={row.targetSegment} hint={row.name} />,
    },
    {
      id: 'channel',
      header: tr('القناة', 'Canal', 'Channel'),
      width: 130,
      render: (row) => enumCell(t, 'campaign', 'channel', row.channel),
    },
    {
      id: 'status',
      header: tr('الحالة', 'Statut', 'Status'),
      width: 120,
      render: (row) => enumCell(t, 'campaign', 'status', row.status, CAMPAIGN_STATUS_TONE),
    },
    {
      id: 'budget',
      header: tr('الميزانية', 'Budget', 'Budget'),
      width: 150,
      align: 'end',
      mono: true,
      sort: (a, b) => a.budgetDzd - b.budgetDzd,
      render: (row) => fmt.money(row.budgetDzd, 'DZD', lang),
    },
    {
      id: 'spend',
      header: tr('المصروف', 'Dépensé', 'Spend'),
      width: 150,
      align: 'end',
      mono: true,
      sort: (a, b) => a.spendDzd - b.spendDzd,
      render: (row) => (
        <Tinted
          text={fmt.money(row.spendDzd, 'DZD', lang)}
          tone={row.spendDzd > row.budgetDzd && row.budgetDzd > 0 ? 'danger' : undefined}
        />
      ),
    },
    {
      id: 'window',
      header: tr('الفترة', 'Période', 'Window'),
      width: 190,
      mono: true,
      sort: (a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''),
      render: (row) =>
        row.startDate === null && row.endDate === null ? (
          <Dash />
        ) : (
          `${fmt.date(row.startDate, lang)} – ${fmt.date(row.endDate, lang)}`
        ),
    },
  ];
  return (
    <DataGrid
      rows={model.visible.campaigns}
      columns={columns}
      rowKey={(row) => row.id}
      loading={model.loading && model.all.campaigns.length === 0}
      density="compact"
      virtualized
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={pick(onSelect)}
      onRowContextMenu={onContext}
      onActivate={onActivate}
      empty={
        <Blank
          icon={Megaphone}
          searching={searching}
          noun={tr('لا حملات', 'Aucune campagne', 'No campaigns')}
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// The one consumer
// ---------------------------------------------------------------------------

/**
 * The register for the surface the rail has selected.
 *
 * The switch is exhaustive over `CrmView` and carries no `default`, so adding an eighth surface is
 * a type error here rather than a blank pane at runtime — the same contract `crmTable` keeps in
 * `export.ts`. Every grid takes the identical `Desk`, assembled once, which is why the seven cases
 * are one line each: a surface differs in its columns, never in its plumbing.
 *
 * `search` is reduced to `searching` at this boundary and the needle itself is dropped. The rows
 * arrive already filtered in `model.visible`, so the only thing downstream still needs from the
 * text is whether an empty grid means "nothing matched" or "nothing here yet".
 */
export function CrmList({
  view,
  model,
  search,
  selectedId,
  onSelect,
  onContext,
  onActivate,
}: CrmListProps) {
  const desk: Desk = {
    model,
    searching: search.trim() !== '',
    selectedId,
    onSelect,
    onContext,
    onActivate,
  };
  switch (view) {
    case 'leads':
      return <LeadGrid {...desk} />;
    case 'customers':
      return <CustomerGrid {...desk} />;
    case 'pipeline':
      return <PipelineGrid {...desk} />;
    case 'quotes':
      return <QuoteGrid {...desk} />;
    case 'activities':
      return <ActivityGrid {...desk} />;
    case 'followups':
      return <FollowupGrid {...desk} />;
    case 'campaigns':
      return <CampaignGrid {...desk} />;
  }
}
