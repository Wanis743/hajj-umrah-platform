/**
 * Inbox — the queue grid.
 *
 * One grid, three column sets. The rows are already normalised, so what changes
 * between queues is only which facts are worth a column: an amount and an age for
 * things waiting on a decision, an actor and a timestamp for decisions already
 * taken.
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
 * Three sets, and the differences between them are the point.
 *
 * Approvals need a magnitude and an age, because that is what a person weighs when
 * deciding what to open first. The checklist needs neither an amount nor an actor —
 * a close step has no value and its owner is a uid — so it gets the widest item
 * column of the three, which is where its dependency list lives. Decided rows need
 * who and when, and no age at all: the age of a settled decision is trivia.
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
                : undefined
          }
        />
      }
      style={{ flex: 1, minHeight: 0 }}
    />
  );
}
