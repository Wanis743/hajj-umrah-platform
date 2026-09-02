/**
 * Inbox — the queue grid.
 *
 * One grid, four column sets. The rows are already normalised, so what changes
 * between queues is only which facts are worth a column: an amount and an age for
 * things waiting on a decision, a route and a deadline for work another desk has
 * handed over, an actor and a timestamp for decisions already taken.
 *
 * The reason an item cannot be acted on takes the place of its description rather
 * than getting a column of its own. Two things follow from that. The sentence lands
 * in the most-read position in the row instead of a strip at the right edge that a
 * narrow window would cut off, and it displaces the description exactly when the
 * description matters less than the reason. Both are still in the reading pane.
 *
 * Selection is the grid's own: click for one, Ctrl-click and Shift-click for many,
 * checkboxes on the approvals queue so the sweep is discoverable. One row selected
 * opens the reading pane; several turn it into the sweep's summary.
 */
import { AlertTriangle } from 'lucide-react';
import { type MouseEvent, useMemo } from 'react';
import { Badge, type Column, DataGrid, EmptyState, fmt, toneColor, useApp } from '@/platform/sdk';
import { INTENT_LABEL, PRIORITY_LABEL, priorityTone, ROLE_LABEL, STAGE_LABEL, toRole } from '../shared/spine';
import { ageTone, type QueueId, type WorkItem } from './queue';

/** Two lines per row: this is a mail queue, and a subject line has a body under it. */
const ROW_HEIGHT = 44;

/** One empty set, so "nothing selected" is not a new object every render. */
const NO_SELECTION: ReadonlySet<string> = new Set<string>();

type Locale = ReturnType<typeof useApp>['locale'];

interface ItemCellProps {
  readonly item: WorkItem;
  readonly locale: Locale;
}

/**
 * What the row is, and under it either what it says or why it is stuck.
 *
 * A blocked row shows the block. That is the whole point of mirroring the server's
 * refusals: the person triaging a queue of forty entries needs to know which three
 * they cannot do anything about without opening each one.
 */
function ItemCell({ item, locale }: ItemCellProps) {
  const blocked = item.block !== null;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span className="fx-title-ellipsis" style={{ fontWeight: item.state === 'waiting' ? 600 : 400 }}>
          {item.title}
        </span>
      </span>
      {blocked ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: toneColor('warning'),
          }}
        >
          <AlertTriangle size={11} aria-hidden />
          <span className="fx-title-ellipsis">{locale.t(item.block ?? { ar: '', fr: '', en: '' })}</span>
        </span>
      ) : (
        <span className="fx-title-ellipsis" style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>
          {item.subtitle === '' ? '—' : item.subtitle}
        </span>
      )}
    </span>
  );
}

/**
 * How long it has been waiting, over the date it has been waiting since.
 *
 * The number is the fact a triage decision turns on, so it leads; the date it is
 * derived from sits under it rather than in a column of its own. A settled row
 * gets a plain grey number, because the age of a decision is not a problem.
 */
function AgeCell({ item, locale }: ItemCellProps) {
  const tone = ageTone(item.age, item.state);
  const days = fmt.integer(item.age, locale.lang);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <span className="fx-num" style={{ color: tone === 'neutral' ? undefined : toneColor(tone) }}>
        {locale.tr(`${days} ي`, `${days} j`, `${days} d`)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>{fmt.date(item.at, locale.lang)}</span>
    </span>
  );
}

/**
 * Which desk is asking, and what it is asking for.
 *
 * A handoff is the only row that arrives from outside this desk, so the route is
 * the fact triage turns on: `Accounting → Planning` answers "is this even mine?"
 * before the title has been read. The intent goes under it as a second line rather
 * than in a column of its own, for the same reason the age carries its own date —
 * there is one grid's width to spend and a column of one-word values spends it
 * badly.
 */
function RouteCell({ item, locale }: ItemCellProps) {
  const handoff = item.handoff;
  if (handoff === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-secondary)' }}>
        {locale.t(STAGE_LABEL[handoff.fromStage])} → {locale.t(STAGE_LABEL[handoff.toStage])}
      </span>
      <span className="fx-title-ellipsis" style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>
        {locale.t(INTENT_LABEL[handoff.intent])}
      </span>
    </span>
  );
}

/**
 * Where the handoff stands, over how loudly its chain is asking.
 *
 * The status is the badge, because the status is what decides which of accept,
 * complete and decline the row will even offer. The priority is text under it and
 * not a second badge: `priorityTone` reads neutral for LOW and NORMAL on purpose,
 * and a chip on every row would turn URGENT — the one priority worth interrupting a
 * triage for — into another grey box.
 */
function HandoffStateCell({ item, locale }: ItemCellProps) {
  const handoff = item.handoff;
  if (handoff === null) return <Badge tone={item.tone}>{locale.t(item.badge)}</Badge>;
  const tone = priorityTone(handoff.chainPriority);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <Badge tone={item.tone}>{locale.t(item.badge)}</Badge>
      <span style={{ fontSize: 11, color: tone === 'neutral' ? 'var(--fx-text-tertiary)' : toneColor(tone) }}>
        {locale.t(PRIORITY_LABEL[handoff.chainPriority])}
      </span>
    </span>
  );
}

/**
 * Whose answer the handoff is waiting on, in words a reader can use.
 *
 * A handoff is addressed to a person or to a role, and the normalised row already
 * carries whichever it is. What it cannot carry is a *translated* role: the record
 * holds an upper-case code and the queue is read in three languages. A code this
 * build does not recognise survives as itself rather than collapsing to a dash,
 * because a role the server knows is still more use to a reader than nothing.
 *
 * An unaddressed handoff says so in a word. "Nobody in particular" is the real state
 * of that row, and it is exactly the row that needs someone to pick it up — a dash
 * would read as missing data instead of as an invitation.
 */
function ownerText(item: WorkItem, locale: Locale): string {
  const handoff = item.handoff;
  if (handoff === null) return item.who === '' ? '—' : item.who;
  if (handoff.assignedTo !== null) return handoff.assignedTo;
  if (handoff.assignedRole === null) return locale.tr('غير مُسند', 'Non attribué', 'Unassigned');
  const role = toRole(handoff.assignedRole);
  return role === null ? handoff.assignedRole : locale.t(ROLE_LABEL[role]);
}

/**
 * Sort the route on its codes, not on its labels.
 *
 * Grouping by route is the only reason to sort by it, and a group that reshuffles
 * when the reader switches language is not a group. Same encoding the queue's own
 * CSV uses, so the order on screen is the order a spreadsheet reproduces.
 */
function routeKey(item: WorkItem): string {
  return item.handoff === null ? '' : `${item.handoff.fromStage}>${item.handoff.toStage}`;
}

/**
 * A handoff with no deadline sorts after every handoff that has one.
 *
 * A date nobody set is not the beginning of time, so ascending order should open
 * with the deadline that is closest rather than with the whole undated tail.
 */
function dueKey(item: WorkItem): string {
  const due = item.handoff === null ? null : item.handoff.dueOn;
  return due ?? '9999-12-31';
}

/** The item column, which every queue has, because every queue is a list of things. */
function itemColumn(locale: Locale): Column<WorkItem> {
  return {
    id: 'item',
    header: locale.tr('البند', 'Élément', 'Item'),
    render: (item) => <ItemCell item={item} locale={locale} />,
    sort: (a, b) => a.title.localeCompare(b.title),
  };
}

/** The state badge, which is also where a kind is legible: `Draft`, `Pending`, `Posted`. */
function stateColumn(locale: Locale): Column<WorkItem> {
  return {
    id: 'state',
    header: locale.tr('الحالة', 'État', 'State'),
    width: 116,
    render: (item) => <Badge tone={item.tone}>{locale.t(item.badge)}</Badge>,
    sort: (a, b) => locale.t(a.badge).localeCompare(locale.t(b.badge)),
  };
}

function ageColumn(locale: Locale): Column<WorkItem> {
  return {
    id: 'age',
    header: locale.tr('العمر', 'Âge', 'Age'),
    width: 92,
    align: 'end',
    render: (item) => <AgeCell item={item} locale={locale} />,
    sort: (a, b) => a.age - b.age,
  };
}

/**
 * Four sets, and the differences between them are the point.
 *
 * Approvals need a magnitude and an age, because that is what a person weighs when
 * deciding what to open first. The checklist needs neither an amount nor an actor —
 * a close step has no value and its owner is a uid — so it gets the widest item
 * column of the four, which is where its dependency list lives. Decided rows need
 * who and when, and no age at all: the age of a settled decision is trivia.
 *
 * Handoffs need the most facts of any queue, because a handoff is the only row that
 * arrives from another desk: which desk, what it wants, whose answer it is waiting
 * on, and by when. Seven facts in six columns, then — the intent rides under the
 * route and the priority under the status — because this grid shares its window with
 * a reading pane, and seven fixed columns would leave the titles nothing to be read
 * in.
 */
function columnsFor(queue: QueueId, locale: Locale): readonly Column<WorkItem>[] {
  const item = itemColumn(locale);
  const state = stateColumn(locale);
  if (queue === 'decided') {
    return [
      item,
      {
        id: 'who',
        header: locale.tr('بواسطة', 'Par', 'By'),
        width: 176,
        render: (row) => (
          <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-secondary)' }} title={row.who}>
            {row.who === '' ? '—' : row.who}
          </span>
        ),
        sort: (a, b) => a.who.localeCompare(b.who),
      },
      {
        id: 'when',
        header: locale.tr('التاريخ', 'Date', 'When'),
        width: 156,
        render: (row) => <span className="fx-num">{fmt.dateTime(row.at, locale.lang)}</span>,
        sort: (a, b) => a.at.localeCompare(b.at),
      },
      state,
    ];
  }
  if (queue === 'checklist') return [item, ageColumn(locale), state];
  if (queue === 'handoffs') {
    return [
      item,
      {
        id: 'route',
        header: locale.tr('المسار', 'Parcours', 'Route'),
        width: 176,
        render: (row) => <RouteCell item={row} locale={locale} />,
        sort: (a, b) => routeKey(a).localeCompare(routeKey(b)),
      },
      {
        id: 'owner',
        header: locale.tr('المسؤول', 'Responsable', 'Owner'),
        width: 152,
        render: (row) => {
          const owner = ownerText(row, locale);
          return (
            <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-secondary)' }} title={owner}>
              {owner}
            </span>
          );
        },
        // On the rendered words, so the order matches what the reader is looking at:
        // a translated role and a raw uid sort together here or not at all.
        sort: (a, b) => ownerText(a, locale).localeCompare(ownerText(b, locale)),
      },
      {
        id: 'due',
        header: locale.tr('الاستحقاق', 'Échéance', 'Due'),
        width: 112,
        render: (row) => {
          const due = row.handoff === null ? null : row.handoff.dueOn;
          return due === null ? '—' : <span className="fx-num">{fmt.date(due, locale.lang)}</span>;
        },
        sort: (a, b) => dueKey(a).localeCompare(dueKey(b)),
      },
      ageColumn(locale),
      // Not the shared state column: this one hangs the chain's priority under the
      // badge, and the eight extra pixels are what «Prise en charge» asks for — the
      // French for an accepted handoff is the widest badge label any of the four
      // queues shows. Tone, sort and the position at the end of the row are the
      // same as everywhere else on purpose.
      {
        id: 'state',
        header: locale.tr('الحالة', 'État', 'State'),
        width: 124,
        render: (row) => <HandoffStateCell item={row} locale={locale} />,
        sort: (a, b) => locale.t(a.badge).localeCompare(locale.t(b.badge)),
      },
    ];
  }
  return [
    item,
    {
      id: 'amount',
      header: locale.tr('المبلغ', 'Montant', 'Amount'),
      width: 132,
      align: 'end',
      mono: true,
      render: (row) => (row.amount === null ? '—' : fmt.money(row.amount, row.currency, locale.lang)),
      sort: (a, b) => (a.amount ?? 0) - (b.amount ?? 0),
    },
    ageColumn(locale),
    state,
  ];
}

export interface QueueGridProps {
  readonly queue: QueueId;
  readonly items: readonly WorkItem[];
  readonly loading: boolean;
  /** Controlled: the shell owns the set, because the sweep reads it too. */
  readonly selection?: ReadonlySet<string>;
  onSelectionChange: (keys: ReadonlySet<string>) => void;
  onActivate: (item: WorkItem) => void;
  onContextMenu: (item: WorkItem, event: MouseEvent) => void;
  /** True when a filter is narrowing the queue, so "empty" can say which. */
  readonly filtered: boolean;
}

export function QueueGrid({
  queue,
  items,
  loading,
  selection = NO_SELECTION,
  onSelectionChange,
  onActivate,
  onContextMenu,
  filtered,
}: QueueGridProps) {
  const { locale } = useApp();
  const { tr } = locale;
  const columns = useMemo(() => columnsFor(queue, locale), [queue, locale]);

  return (
    <DataGrid<WorkItem>
      rows={items}
      columns={columns}
      rowKey={(item) => item.key}
      selectedKeys={selection}
      onSelectionChange={onSelectionChange}
      onActivate={onActivate}
      onRowContextMenu={(item, event) => onContextMenu(item, event)}
      loading={loading}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      // The sweep is a bulk act, and a bulk act nobody can see is a bulk act nobody
      // uses. Checkboxes only where one exists.
      //
      // Handoffs deliberately have none. Accepting work is a promise about your own
      // week, declining it needs a reason typed for the desk that will read it, and
      // neither survives being done thirty at a time — so that queue is acted on one
      // row at a time and the sweep stays entry-only.
      checkboxes={queue === 'approvals'}
      // Ageing, not identity: a row's accent says "this has been sitting too long",
      // which is the only thing about a queue worth colouring.
      rowTone={(item) => ageTone(item.age, item.state)}
      empty={
        <EmptyState
          icon={filtered ? undefined : AlertTriangle}
          title={
            filtered
              ? tr('لا نتائج للمرشّح', 'Aucun résultat', 'Nothing matches')
              : queue === 'approvals'
                ? tr('لا شيء ينتظر الاعتماد', 'Rien à approuver', 'Nothing waiting')
                : queue === 'checklist'
                  ? tr('لا خطوات إقفال', 'Aucune étape de clôture', 'No close steps')
                  : queue === 'handoffs'
                    ? tr('لا تحويلات', 'Aucune transmission', 'No handoffs')
                    : tr('لا قرارات بعد', 'Aucune décision', 'No decisions yet')
          }
          description={
            filtered
              ? tr(
                  'وسّع المرشّح لعرض المزيد من البنود.',
                  'Élargissez le filtre pour voir plus d’éléments.',
                  'Widen the filter to see more items.',
                )
              : queue === 'approvals'
                ? tr(
                    'كل القيود مرحّلة أو ملغاة.',
                    'Toutes les écritures sont comptabilisées ou annulées.',
                    'Every entry is posted or void.',
                  )
                : queue === 'handoffs'
                  ? tr(
                      'لا شيء ينتظرك من قسم آخر.',
                      'Rien ne vous attend d’un autre service.',
                      'Nothing is waiting on you from another department.',
                    )
                  : undefined
          }
        />
      }
      style={{ flex: 1, minHeight: 0 }}
    />
  );
}
