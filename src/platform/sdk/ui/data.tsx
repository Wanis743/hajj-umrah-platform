/**
 * Fluent UI kit — data surfaces.
 *
 * `DataGrid` is the workhorse: sortable, selectable, keyboard-navigable,
 * optionally virtualised, with a sticky header and a totals footer. It is what
 * every ledger, journal and register in the OS renders through, so behaviour
 * (shift-range selection, Enter to open, F2-style inline edits) is identical
 * everywhere.
 */
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronRight, type LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Checkbox, Spinner } from './primitives';
import { EmptyState } from './layout';
import { toneColor, type Tone } from './tokens';

/* ------------------------------------------------------------------ *
 * DataGrid
 * ------------------------------------------------------------------ */

export interface Column<T> {
  readonly id: string;
  readonly header: ReactNode;
  readonly render: (row: T, index: number) => ReactNode;
  /** Fixed pixel width; omit to share remaining space. */
  readonly width?: number;
  readonly align?: 'start' | 'end' | 'center';
  /** Providing a comparator makes the column sortable. */
  readonly sort?: (a: T, b: T) => number;
  readonly footer?: ReactNode;
  readonly mono?: boolean;
  readonly title?: string;
}

export type SortState = { readonly columnId: string; readonly direction: 'asc' | 'desc' } | null;

export interface DataGridProps<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  /** Controlled selection; omit to let the grid own it. */
  selectedKeys?: ReadonlySet<string>;
  onSelectionChange?: (keys: ReadonlySet<string>) => void;
  onActivate?: (row: T) => void;
  onRowContextMenu?: (row: T, event: ReactMouseEvent) => void;
  loading?: boolean;
  empty?: ReactNode;
  density?: 'compact' | 'normal';
  /** Row accent, e.g. red for unbalanced entries. */
  rowTone?: (row: T) => Tone | undefined;
  initialSort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Windows large registers; requires a uniform `rowHeight`. */
  virtualized?: boolean;
  rowHeight?: number;
  showFooter?: boolean;
  checkboxes?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Rows to render either side of the viewport, so a fast scroll never shows a gap. */
const OVERSCAN = 8;

/**
 * Sort state and the click that cycles one column asc → desc → unsorted.
 *
 * A column with no comparator is inert: the header still renders, it just does
 * nothing, which is how a grid says "this is not a sortable dimension" without
 * needing a second prop.
 */
function useGridSort<T>(
  rows: readonly T[],
  columns: readonly Column<T>[],
  initialSort: SortState,
  onSortChange: ((sort: SortState) => void) | undefined,
): { readonly sorted: readonly T[]; readonly sort: SortState; readonly toggle: (column: Column<T>) => void } {
  const [sort, setSort] = useState<SortState>(initialSort);

  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (!column?.sort) return rows;
    const comparator = column.sort;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => comparator(a, b) * factor);
  }, [rows, columns, sort]);

  const toggle = useCallback(
    (column: Column<T>) => {
      if (!column.sort) return;
      const next: SortState =
        sort === null || sort.columnId !== column.id
          ? { columnId: column.id, direction: 'asc' }
          : sort.direction === 'asc'
            ? { columnId: column.id, direction: 'desc' }
            : null;
      setSort(next);
      if (onSortChange) onSortChange(next);
    },
    [sort, onSortChange],
  );

  return { sorted, sort, toggle };
}

/**
 * The half-open range of rows worth mounting. An unvirtualised grid reports the
 * whole list, so the caller has one code path either way, and the spacer rows
 * either side collapse to nothing.
 */
function useVirtualWindow(
  total: number,
  rowHeight: number,
  virtualized: boolean,
  viewport: RefObject<HTMLDivElement | null>,
): { readonly start: number; readonly end: number; readonly onScrollTop: (value: number) => void } {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!virtualized) return;
    const element = viewport.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [virtualized, viewport]);

  if (!virtualized) return { start: 0, end: total, onScrollTop: setScrollTop };
  // 400 is the floor before the observer has measured, so the first paint is full.
  const span = Math.max(height, 400);
  return {
    start: Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN),
    end: Math.min(total, Math.ceil((scrollTop + span) / rowHeight) + OVERSCAN),
    onScrollTop: setScrollTop,
  };
}

/** The modifier keys that decide whether a click extends, toggles, or replaces. */
interface Modifiers {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/** One header cell: label, sort affordance, and the arrow when it is the sort. */
function HeadCell<T>({
  column,
  padding,
  sort,
  onToggle,
}: {
  readonly column: Column<T>;
  readonly padding: string;
  readonly sort: SortState;
  readonly onToggle: (column: Column<T>) => void;
}) {
  const active = sort?.columnId === column.id;
  const justify =
    column.align === 'end' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start';
  return (
    <th
      data-sortable={column.sort ? 'true' : undefined}
      onClick={() => onToggle(column)}
      title={column.title}
      style={{ padding, textAlign: column.align ?? 'start' }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          justifyContent: justify,
          width: '100%',
          color: active ? 'var(--fx-text-primary)' : undefined,
        }}
      >
        {column.header}
        {active ? sort?.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
      </span>
    </th>
  );
}

/** Sticky header: the select-all box, the labels, and the sort arrow. */
function GridHead<T>({
  columns,
  checkboxes,
  padding,
  sort,
  allSelected,
  someSelected,
  onToggleSort,
  onToggleAll,
}: {
  readonly columns: readonly Column<T>[];
  readonly checkboxes: boolean;
  readonly padding: string;
  readonly sort: SortState;
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  readonly onToggleSort: (column: Column<T>) => void;
  readonly onToggleAll: (next: boolean) => void;
}) {
  return (
    <thead>
      <tr>
        {checkboxes ? (
          <th style={{ padding, width: 36 }}>
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onChange={onToggleAll}
            />
          </th>
        ) : null}
        {columns.map((column) => (
          <HeadCell
            key={column.id}
            column={column}
            padding={padding}
            sort={sort}
            onToggle={onToggleSort}
          />
        ))}
      </tr>
    </thead>
  );
}

interface GridRowProps<T> {
  readonly row: T;
  readonly index: number;
  readonly rowId: string;
  readonly columns: readonly Column<T>[];
  readonly checkboxes: boolean;
  readonly padding: string;
  readonly height: number | undefined;
  readonly selected: boolean;
  readonly tone: Tone | undefined;
  readonly onSelect: (index: number, modifiers: Modifiers) => void;
  readonly onActivate: ((row: T) => void) | undefined;
  readonly onContextMenu: ((row: T, event: ReactMouseEvent) => void) | undefined;
  readonly onCheck: (rowId: string, next: boolean) => void;
}

/**
 * One register line.
 *
 * Selection happens on pointer *down*, not click, because a drag that starts on an
 * unselected row has to act on that row. A right-click selects first when the row
 * is outside the selection, so a context menu never acts on something invisible.
 */
function GridRow<T>(props: GridRowProps<T>) {
  const { row, index, rowId, columns, padding, selected, tone } = props;
  return (
    <tr
      data-selected={selected ? 'true' : undefined}
      style={{
        height: props.height,
        boxShadow:
          tone !== undefined && tone !== 'neutral' ? `inset 3px 0 0 0 ${toneColor(tone)}` : undefined,
      }}
      onPointerDown={(event) =>
        props.onSelect(index, {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        })
      }
      onDoubleClick={() => props.onActivate?.(row)}
      onContextMenu={(event) => {
        const handler = props.onContextMenu;
        if (!handler) return;
        if (!selected) props.onSelect(index, { ctrlKey: false, metaKey: false, shiftKey: false });
        handler(row, event);
      }}
    >
      {props.checkboxes ? (
        <td style={{ padding }} onPointerDown={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} onChange={(next) => props.onCheck(rowId, next)} />
        </td>
      ) : null}
      {columns.map((column) => (
        <td
          key={column.id}
          className={column.mono === true ? 'fx-mono' : undefined}
          style={{ padding, textAlign: column.align ?? 'start' }}
        >
          {column.render(row, index)}
        </td>
      ))}
    </tr>
  );
}

interface GridBodyProps<T> extends Omit<GridRowProps<T>, 'row' | 'index' | 'rowId' | 'height' | 'selected' | 'tone'> {
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly start: number;
  readonly end: number;
  readonly total: number;
  readonly rowHeight: number;
  readonly virtualized: boolean;
  readonly selection: ReadonlySet<string>;
  readonly rowTone: ((row: T) => Tone | undefined) | undefined;
}

/**
 * The rows, with the unrendered remainder standing in as two tall empty rows so the
 * scrollbar measures the whole register rather than the mounted slice of it.
 */
function GridBody<T>({
  rows,
  rowKey,
  start,
  end,
  total,
  rowHeight,
  virtualized,
  selection,
  rowTone,
  ...row
}: GridBodyProps<T>) {
  return (
    <tbody>
      {start > 0 ? <tr style={{ height: start * rowHeight }} aria-hidden="true" /> : null}
      {rows.map((item, offset) => {
        const id = rowKey(item);
        return (
          <GridRow
            {...row}
            key={id}
            row={item}
            rowId={id}
            index={start + offset}
            height={virtualized ? rowHeight : undefined}
            selected={selection.has(id)}
            tone={rowTone?.(item)}
          />
        );
      })}
      {end < total ? <tr style={{ height: (total - end) * rowHeight }} aria-hidden="true" /> : null}
    </tbody>
  );
}

/** Column totals. Rendered only when a column actually declares one. */
function GridFoot<T>({
  columns,
  checkboxes,
}: {
  readonly columns: readonly Column<T>[];
  readonly checkboxes: boolean;
}) {
  return (
    <tfoot>
      <tr>
        {checkboxes ? <td /> : null}
        {columns.map((column) => (
          <td
            key={column.id}
            className={column.mono === true ? 'fx-mono' : undefined}
            style={{ textAlign: column.align ?? 'start' }}
          >
            {column.footer}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}

export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  selectedKeys,
  onSelectionChange,
  onActivate,
  onRowContextMenu,
  loading,
  empty,
  density = 'normal',
  rowTone,
  initialSort = null,
  onSortChange,
  virtualized,
  rowHeight = 33,
  showFooter,
  checkboxes,
  className,
  style,
}: DataGridProps<T>) {
  const [internalSelection, setInternalSelection] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [activeIndex, setActiveIndex] = useState(-1);
  const anchorIndex = useRef(-1);
  const viewport = useRef<HTMLDivElement | null>(null);

  const selection = selectedKeys ?? internalSelection;
  const setSelection = useCallback(
    (next: ReadonlySet<string>) => {
      if (onSelectionChange) onSelectionChange(next);
      else setInternalSelection(next);
    },
    [onSelectionChange],
  );

  const { sorted, sort, toggle: toggleSort } = useGridSort(rows, columns, initialSort, onSortChange);

  const selectRow = (index: number, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const row = sorted[index];
    if (row === undefined) return;
    const key = rowKey(row);
    setActiveIndex(index);
    if (event.shiftKey && anchorIndex.current >= 0) {
      const from = Math.min(anchorIndex.current, index);
      const to = Math.max(anchorIndex.current, index);
      const next = new Set<string>();
      for (let i = from; i <= to; i += 1) {
        const candidate = sorted[i];
        if (candidate !== undefined) next.add(rowKey(candidate));
      }
      setSelection(next);
      return;
    }
    anchorIndex.current = index;
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selection);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setSelection(next);
      return;
    }
    setSelection(new Set([key]));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (sorted.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.max(0, Math.min(sorted.length - 1, (activeIndex < 0 ? -delta : activeIndex) + delta));
      selectRow(next, { ctrlKey: false, metaKey: false, shiftKey: event.shiftKey });
      const container = viewport.current;
      if (container) {
        const top = next * rowHeight;
        if (top < container.scrollTop) container.scrollTop = top;
        else if (top + rowHeight > container.scrollTop + container.clientHeight) {
          container.scrollTop = top + rowHeight - container.clientHeight;
        }
      }
      return;
    }
    if (event.key === 'Enter' && onActivate) {
      const row = sorted[activeIndex];
      if (row !== undefined) {
        event.preventDefault();
        onActivate(row);
      }
      return;
    }
    if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      setSelection(new Set(sorted.map(rowKey)));
    }
  };

  const total = sorted.length;
  const isVirtual = virtualized === true;
  const withCheckboxes = checkboxes === true;
  const { start, end, onScrollTop } = useVirtualWindow(total, rowHeight, isVirtual, viewport);
  const visible = isVirtual ? sorted.slice(start, end) : sorted;

  const cellPadding = density === 'compact' ? '4px 10px' : '7px 12px';
  const allSelected = total > 0 && selection.size === total;

  const checkRow = useCallback(
    (rowId: string, next: boolean) => {
      const updated = new Set(selection);
      if (next) updated.add(rowId);
      else updated.delete(rowId);
      setSelection(updated);
    },
    [selection, setSelection],
  );

  if (loading === true && total === 0) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 40 }}>
        <Spinner size={22} />
      </div>
    );
  }

  if (total === 0) {
    return <>{empty ?? <EmptyState title="Nothing to show" compact />}</>;
  }

  return (
    <div
      ref={viewport}
      className={clsx('fx-scroll', className)}
      style={{ flex: 1, minHeight: 0, outline: 'none', ...style }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={isVirtual ? (event) => onScrollTop(event.currentTarget.scrollTop) : undefined}
    >
      <table className="fx-grid">
        {columns.some((column) => column.width !== undefined) ? (
          <colgroup>
            {withCheckboxes ? <col style={{ width: 36 }} /> : null}
            {columns.map((column) => (
              <col key={column.id} style={column.width !== undefined ? { width: column.width } : undefined} />
            ))}
          </colgroup>
        ) : null}
        <GridHead
          columns={columns}
          checkboxes={withCheckboxes}
          padding={cellPadding}
          sort={sort}
          allSelected={allSelected}
          someSelected={selection.size > 0}
          onToggleSort={toggleSort}
          onToggleAll={(next) => setSelection(next ? new Set(sorted.map(rowKey)) : new Set())}
        />
        <GridBody
          rows={visible}
          columns={columns}
          rowKey={rowKey}
          start={start}
          end={end}
          total={total}
          rowHeight={rowHeight}
          virtualized={isVirtual}
          selection={selection}
          rowTone={rowTone}
          checkboxes={withCheckboxes}
          padding={cellPadding}
          onSelect={selectRow}
          onActivate={onActivate}
          onContextMenu={onRowContextMenu}
          onCheck={checkRow}
        />
        {showFooter === true && columns.some((column) => column.footer !== undefined) ? (
          <GridFoot columns={columns} checkboxes={withCheckboxes} />
        ) : null}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * TreeView
 * ------------------------------------------------------------------ */

export interface TreeNode {
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: LucideIcon;
  readonly children?: readonly TreeNode[];
  /** Show a chevron before children are known (lazy branches). */
  readonly expandable?: boolean;
  readonly badge?: ReactNode;
  readonly tone?: Tone;
}

export interface TreeViewProps {
  nodes: readonly TreeNode[];
  selectedId?: string | null;
  onSelect?: (node: TreeNode) => void;
  expandedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onContextMenu?: (node: TreeNode, event: ReactMouseEvent) => void;
  indent?: number;
}

/** Registry-style tree. Expansion is controlled by the caller. */
export function TreeView({
  nodes,
  selectedId,
  onSelect,
  expandedIds,
  onToggle,
  onContextMenu,
  indent = 14,
}: TreeViewProps) {
  const renderNodes = (list: readonly TreeNode[], depth: number): ReactNode =>
    list.map((node) => {
      const expanded = expandedIds.has(node.id);
      const hasChildren = (node.children !== undefined && node.children.length > 0) || node.expandable === true;
      const Glyph = node.icon;
      return (
        <div key={node.id}>
          <div
            role="treeitem"
            aria-expanded={hasChildren ? expanded : undefined}
            aria-selected={node.id === selectedId}
            onPointerDown={() => onSelect?.(node)}
            onDoubleClick={() => hasChildren && onToggle(node.id)}
            onContextMenu={(event) => onContextMenu?.(node, event)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: 28,
              paddingInlineStart: 6 + depth * indent,
              paddingInlineEnd: 8,
              borderRadius: 'var(--fx-radius-control)',
              background: node.id === selectedId ? 'var(--fx-control)' : undefined,
              color: node.id === selectedId ? 'var(--fx-text-primary)' : 'var(--fx-text-secondary)',
              fontSize: 'var(--fx-caption)',
              cursor: 'default',
            }}
          >
            <button
              type="button"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (hasChildren) onToggle(node.id);
              }}
              style={{
                width: 16,
                height: 16,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                visibility: hasChildren ? 'visible' : 'hidden',
              }}
            >
              <ChevronRight
                size={12}
                style={{
                  transform: expanded ? 'rotate(90deg)' : undefined,
                  transition: 'transform var(--fx-fast) var(--fx-ease-out)',
                }}
              />
            </button>
            {Glyph ? (
              <Glyph
                size={14}
                style={{ flex: 'none', color: node.tone !== undefined ? toneColor(node.tone) : undefined }}
              />
            ) : null}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.label}
            </span>
            {node.badge}
          </div>
          {expanded && node.children !== undefined ? renderNodes(node.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <div role="tree" style={{ display: 'grid', gap: 1 }}>
      {renderNodes(nodes, 0)}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * KPI tile
 * ------------------------------------------------------------------ */

export interface KpiTileProps {
  label: ReactNode;
  value: ReactNode;
  secondary?: ReactNode;
  delta?: { value: number; label?: string } | null;
  icon?: LucideIcon;
  tone?: Tone;
  onClick?: () => void;
  children?: ReactNode;
}

export function KpiTile({ label, value, secondary, delta, icon: Glyph, tone = 'accent', onClick, children }: KpiTileProps) {
  const positive = delta !== null && delta !== undefined && delta.value >= 0;
  return (
    <div
      className="fx-card"
      onClick={onClick}
      style={{
        padding: 14,
        display: 'grid',
        gap: 6,
        cursor: onClick ? 'default' : undefined,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Glyph ? (
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              display: 'grid',
              placeItems: 'center',
              background: `color-mix(in srgb, ${toneColor(tone)} 18%, transparent)`,
              color: toneColor(tone),
              flex: 'none',
            }}
          >
            <Glyph size={14} />
          </span>
        ) : null}
        <span
          style={{
            fontSize: 'var(--fx-caption)',
            color: 'var(--fx-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </div>
      <div
        className="fx-mono"
        style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.15 }}
      >
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 16 }}>
        {delta !== null && delta !== undefined ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              fontSize: 11,
              fontWeight: 600,
              color: positive ? 'var(--fx-success)' : 'var(--fx-danger)',
            }}
          >
            {positive ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            {Math.abs(delta.value).toFixed(1)}%
            {delta.label !== undefined ? (
              <span style={{ color: 'var(--fx-text-tertiary)', fontWeight: 400 }}> {delta.label}</span>
            ) : null}
          </span>
        ) : null}
        {secondary !== undefined ? (
          <span style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>{secondary}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Label/value pair row — property inspectors, detail panes. */
export function PropertyRow({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '5px 0', fontSize: 'var(--fx-caption)', minWidth: 0 }}>
      <span style={{ width: 132, flex: 'none', color: 'var(--fx-text-tertiary)' }}>{label}</span>
      <span className={mono === true ? 'fx-mono' : undefined} style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
        {children}
      </span>
    </div>
  );
}
