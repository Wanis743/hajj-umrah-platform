/**
 * Event Viewer — the list and the filter strip above it.
 *
 * Two surfaces that belong together: the grid of records, and the row of filters
 * that decides which records reach it. Neither one talks to the kernel. The page
 * is fetched once by the shell and every filter here is applied to it, so
 * toggling "Error" costs a re-render rather than a syscall — and the counts on
 * the chips can be honest about the scope you are looking at.
 */
import { useMemo } from 'react';
import { ListFilter, ScrollText, X } from 'lucide-react';
import {
  Button,
  type Column,
  DataGrid,
  type DataGridProps,
  EmptyState,
  type EventLevel,
  type EventRecord,
  Select,
  fmt,
  toneColor,
  useApp,
} from '@/platform/sdk';
import {
  LEVEL_ICON,
  LEVEL_LABEL,
  LEVEL_RANK,
  RANGES,
  type RangeId,
  eventName,
  levelTone,
} from './catalog';

/** Compact rows, because a log is read by scanning it. */
const ROW_HEIGHT = 30;

/* ------------------------------------------------------------------ *
 * Filter strip
 * ------------------------------------------------------------------ */

export interface FilterStripProps {
  /** Levels this view can show at all — three of them on Administrative Events. */
  readonly view: readonly EventLevel[];
  /** Chips the user has switched on; empty means "no level filter". */
  readonly active: ReadonlySet<EventLevel>;
  readonly counts: Readonly<Record<EventLevel, number>>;
  readonly onToggle: (level: EventLevel) => void;
  readonly range: RangeId;
  readonly onRange: (range: RangeId) => void;
  /** Exact source name the list is pinned to, or `null`. */
  readonly source: string | null;
  readonly onClearSource: () => void;
  readonly dirty: boolean;
  readonly onReset: () => void;
}

/**
 * Windows keeps this behind a modal ("Filter Current Log…"). A strip is the same
 * filter with the dialog taken away: what is on is visible without opening
 * anything, which is the whole point of a log you are watching.
 */
export function FilterStrip({
  view,
  active,
  counts,
  onToggle,
  range,
  onRange,
  source,
  onClearSource,
  dirty,
  onReset,
}: FilterStripProps) {
  const { t, tr, lang } = useApp().locale;

  const chooseRange = (next: string) => {
    const found = RANGES.find((candidate) => candidate.id === next);
    if (found !== undefined) onRange(found.id);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '8px 12px',
        flex: 'none',
        borderBlockEnd: '1px solid var(--fx-divider)',
      }}
    >
      <ListFilter size={14} style={{ flex: 'none', color: 'var(--fx-text-tertiary)' }} />
      <Select
        value={range}
        onChange={chooseRange}
        width={150}
        options={RANGES.map((entry) => ({ value: entry.id, label: t(entry.label) }))}
      />
      {view.map((level) => (
        <Button
          key={level}
          size="sm"
          variant={active.has(level) ? 'accent' : 'subtle'}
          icon={LEVEL_ICON[level]}
          onClick={() => onToggle(level)}
          title={t(LEVEL_LABEL[level])}
        >
          {`${t(LEVEL_LABEL[level])} · ${fmt.integer(counts[level], lang)}`}
        </Button>
      ))}
      {source === null ? null : (
        <Button
          size="sm"
          variant="accent"
          trailingIcon={X}
          onClick={onClearSource}
          title={tr('إزالة مرشّح المصدر', 'Retirer le filtre de source', 'Remove the source filter')}
        >
          {source}
        </Button>
      )}
      {dirty ? (
        <Button size="sm" variant="subtle" onClick={onReset}>
          {tr('مسح المرشّحات', 'Effacer les filtres', 'Clear filters')}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The grid
 * ------------------------------------------------------------------ */

export interface EventGridProps {
  readonly rows: readonly EventRecord[];
  readonly loading: boolean;
  readonly selection: ReadonlySet<string>;
  readonly onSelectionChange: (keys: ReadonlySet<string>) => void;
  readonly onActivate: (record: EventRecord) => void;
  readonly onContextMenu: DataGridProps<EventRecord>['onRowContextMenu'];
}

/** The six columns Event Viewer shows, in its order. */
export function EventGrid({
  rows,
  loading,
  selection,
  onSelectionChange,
  onActivate,
  onContextMenu,
}: EventGridProps) {
  const { t, tr, lang } = useApp().locale;

  const columns = useMemo<readonly Column<EventRecord>[]>(() => {
    // Record ids are monotonic, so sorting by id *is* sorting by time — and it
    // costs a subtraction instead of parsing two timestamps per comparison.
    const task = (record: EventRecord): string => {
      const friendly = eventName(record.eventId);
      return friendly === null ? '' : t(friendly);
    };
    return [
      {
        id: 'level',
        header: tr('المستوى', 'Niveau', 'Level'),
        width: 122,
        sort: (a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level],
        render: (record) => {
          const Glyph = LEVEL_ICON[record.level];
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Glyph size={13} style={{ flex: 'none', color: toneColor(levelTone(record.level)) }} />
              {t(LEVEL_LABEL[record.level])}
            </span>
          );
        },
      },
      {
        id: 'logged',
        header: tr('التاريخ والوقت', 'Date et heure', 'Date and time'),
        width: 164,
        sort: (a, b) => a.id - b.id,
        render: (record) => <span title={fmt.relativeTime(record.at, lang)}>{fmt.dateTime(record.at, lang)}</span>,
      },
      {
        id: 'source',
        header: tr('المصدر', 'Source', 'Source'),
        width: 138,
        sort: (a, b) => a.source.localeCompare(b.source),
        render: (record) => record.source,
      },
      {
        id: 'eventId',
        header: tr('الرقم', 'ID', 'Event ID'),
        width: 88,
        align: 'end',
        mono: true,
        sort: (a, b) => a.eventId - b.eventId,
        render: (record) => record.eventId,
      },
      {
        id: 'task',
        header: tr('المهمة', 'Tâche', 'Task category'),
        width: 172,
        sort: (a, b) => task(a).localeCompare(task(b)),
        render: (record) => {
          const label = task(record);
          return label === '' ? <span style={{ color: 'var(--fx-text-tertiary)' }}>—</span> : label;
        },
      },
      {
        id: 'message',
        header: tr('الرسالة', 'Message', 'Message'),
        sort: (a, b) => a.message.localeCompare(b.message),
        render: (record) => (
          <span
            title={record.message}
            style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {record.message}
          </span>
        ),
      },
    ];
  }, [t, tr, lang]);

  return (
    <DataGrid<EventRecord>
      rows={rows}
      columns={columns}
      rowKey={(record) => String(record.id)}
      selectedKeys={selection}
      onSelectionChange={onSelectionChange}
      onActivate={onActivate}
      onRowContextMenu={onContextMenu}
      rowTone={(record) => (record.level === 'critical' || record.level === 'error' ? 'danger' : undefined)}
      initialSort={{ columnId: 'logged', direction: 'desc' }}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      loading={loading}
      empty={
        <EmptyState
          icon={ScrollText}
          title={tr('لا أحداث مطابقة', 'Aucun événement', 'No matching events')}
          description={tr(
            'لا يحتوي هذا السجل على أحداث تطابق المرشّحات الحالية.',
            'Ce journal ne contient aucun événement correspondant aux filtres actuels.',
            'This log holds no events matching the current filters.',
          )}
        />
      }
    />
  );
}
