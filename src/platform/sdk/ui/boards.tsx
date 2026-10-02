/**
 * Fluent UI kit — board layouts.
 *
 * Eighteen applications were built out of one arrangement: a command bar, a
 * navigation rail, a grid, an inspector. That is the right shape for a ledger
 * and the wrong shape for a pipeline, a reconciliation or a document library,
 * and using it everywhere is why the suite read as one program with eighteen
 * datasets rather than eighteen programs.
 *
 * This module holds the arrangements that are not a grid. Each one is a *shape*
 * and nothing else: it owns no data, performs no syscall and renders whatever
 * the app hands it. What each does own is the part an app would otherwise get
 * wrong — the measurement, the fold, and the keyboard contract that a mouse-
 * built board always forgets.
 *
 * Every one measures its own box rather than the viewport, for the reason
 * `responsive.ts` sets out at length: one 1280px screen holds a maximised
 * Treasury at 1280 and a quarter-snapped CRM at 640, and only the frame's own
 * width is a fact either of them can act on.
 */
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useKitLabels, useKitRtl } from './kitRuntime';
import { useElementWidth } from './responsive';
import { toneColor, toneSurface, type Tone } from './tokens';

/* ------------------------------------------------------------------ *
 * Tile wall
 * ------------------------------------------------------------------ */

export interface WallTile {
  readonly id: string;
  readonly node: ReactNode;
  /** Columns this tile asks for. Clamped to what the wall can actually give. */
  readonly span?: number;
  /** Two row tracks instead of one. */
  readonly tall?: boolean;
  /** Spoken by the resize grip, which otherwise has nothing to name. */
  readonly name?: string;
}

export interface TileWallProps {
  tiles: readonly WallTile[];
  /** The width one column aims for; the wall fits as many as its box allows. */
  track?: number;
  gap?: number;
  /** Row floor. A tile grows past it and is never squeezed below it. */
  rowHeight?: number;
  /** Lets a person retune a tile's span in place, by drag or by arrow key. */
  resizable?: boolean;
  label?: string;
}

const clampSpan = (value: number, columns: number) => Math.max(1, Math.min(columns, Math.round(value)));

/**
 * A wall of tiles that chooses its own column count.
 *
 * The alternative — `repeat(auto-fill, minmax(…))` and nothing else — cannot be
 * used here, because a tile that asks for three columns in a grid that turned
 * out to have two does not shrink: CSS grid creates the third track implicitly
 * and the wall overflows its window. So the count is measured and every span is
 * clamped against it, which is also what makes the resize grip able to say how
 * far it may go.
 *
 * Before the first measurement the wall falls back to `auto-fill` with every
 * tile at one column — a layout that is never painted in practice, because
 * `useElementWidth` reads the box in a layout effect and re-renders before the
 * browser paints, but which is correct rather than broken if it ever is.
 */
export function TileWall({ tiles, track = 260, gap = 12, rowHeight = 120, resizable = false, label }: TileWallProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const tr = useKitLabels();
  const rtl = useKitRtl();
  const [spans, setSpans] = useState<Record<string, number>>({});
  const drag = useRef<{ id: string; x: number; from: number } | null>(null);

  const columns = width <= 0 ? null : Math.max(1, Math.floor((width + gap) / (track + gap)));

  const setSpan = useCallback((id: string, next: number) => {
    setSpans((current) => ({ ...current, [id]: next }));
  }, []);

  const spanOf = (tile: WallTile) => (columns === null ? 1 : clampSpan(spans[tile.id] ?? tile.span ?? 1, columns));

  const onGripDown = (tile: WallTile) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (columns === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: tile.id, x: event.clientX, from: spanOf(tile) };
  };

  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active === null || columns === null) return;
    // Right-to-left reverses the gesture but not the arithmetic: dragging
    // towards the window's edge widens the tile in both directions.
    const delta = (event.clientX - active.x) * (rtl ? -1 : 1);
    setSpan(active.id, clampSpan(active.from + delta / (track + gap), columns));
  };

  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };

  const onGripKey = (tile: WallTile) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (columns === null) return;
    const span = spanOf(tile);
    const wider = rtl ? 'ArrowLeft' : 'ArrowRight';
    const narrower = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === wider) setSpan(tile.id, clampSpan(span + 1, columns));
    else if (event.key === narrower) setSpan(tile.id, clampSpan(span - 1, columns));
    else if (event.key === 'Home') setSpan(tile.id, 1);
    else if (event.key === 'End') setSpan(tile.id, columns);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={frame}
      aria-label={label}
      style={{
        display: 'grid',
        gap,
        gridTemplateColumns: columns === null ? `repeat(auto-fill, minmax(${track}px, 1fr))` : `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: `minmax(${rowHeight}px, auto)`,
        alignItems: 'stretch',
      }}
    >
      {tiles.map((tile) => {
        const span = spanOf(tile);
        return (
          <div
            key={tile.id}
            style={{
              gridColumn: `span ${span}`,
              gridRow: tile.tall === true ? 'span 2' : undefined,
              position: 'relative',
              minWidth: 0,
              display: 'grid',
            }}
          >
            {tile.node}
            {resizable && columns !== null && columns > 1 ? (
              <div
                role="slider"
                tabIndex={0}
                aria-label={tr(
                  `عرض ${tile.name ?? tile.id}`,
                  `Largeur de ${tile.name ?? tile.id}`,
                  `Width of ${tile.name ?? tile.id}`,
                )}
                aria-valuemin={1}
                aria-valuemax={columns}
                aria-valuenow={span}
                aria-valuetext={tr(
                  `${span} من ${columns}`,
                  `${span} sur ${columns}`,
                  `${span} of ${columns} columns`,
                )}
                onPointerDown={onGripDown(tile)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onKeyDown={onGripKey(tile)}
                style={{
                  position: 'absolute',
                  insetBlock: 10,
                  insetInlineEnd: -1,
                  width: 7,
                  cursor: 'col-resize',
                  borderRadius: 999,
                  touchAction: 'none',
                  background: 'transparent',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    insetBlock: 0,
                    insetInlineEnd: 3,
                    width: 2,
                    borderRadius: 999,
                    background: 'var(--fx-stroke)',
                    opacity: 0.6,
                  }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Kanban board
 * ------------------------------------------------------------------ */

interface BoardContextValue {
  readonly column: string;
  readonly columns: readonly string[];
  readonly move: ((cardId: string, toColumn: string) => void) | null;
  readonly dragging: string | null;
  readonly setDragging: (id: string | null) => void;
}

/** Module-local on purpose: a context export would make this file non-refreshable. */
const BoardContext = createContext<BoardContextValue | null>(null);

export interface BoardColumn {
  readonly id: string;
  readonly title: ReactNode;
  /** Count, total, whatever the column is worth — shown beside the title. */
  readonly meta?: ReactNode;
  readonly tone?: Tone;
  readonly icon?: LucideIcon;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export interface KanbanBoardProps {
  columns: readonly BoardColumn[];
  /** Resting width of one column. */
  columnWidth?: number;
  /** A card was dropped, or arrow-moved, onto another column. */
  onMove?: (cardId: string, toColumn: string) => void;
  label?: string;
}

/**
 * Stages side by side, with the cards movable between them.
 *
 * Drag-and-drop is the native HTML5 kind — no library, and no pointer-event
 * reimplementation of one — but it is deliberately not the only way to move a
 * card. A board that can only be operated by dragging is a board a keyboard
 * cannot use at all, so every card also answers Ctrl+Arrow, and the board
 * publishes that through `aria-keyshortcuts` rather than hoping it is guessed.
 *
 * Below the width that seats two columns the board keeps scrolling rather than
 * collapsing into a list: a pipeline whose stages are stacked vertically is a
 * list of everything, which is the view the board exists to replace. What it
 * does instead is widen each column to the full frame and snap, so a narrow
 * window shows one stage at a time and swipes between them.
 */
export function KanbanBoard({ columns, columnWidth = 300, onMove, label }: KanbanBoardProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ids = useMemo(() => columns.map((column) => column.id), [columns]);

  // Two columns and a gutter, or the board is better off showing one at a time.
  const single = width > 0 && width < columnWidth * 2 + 12;
  const basis = single ? 'calc(100% - 20px)' : `${columnWidth}px`;

  const drop = (columnId: string) => (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const card = event.dataTransfer.getData('text/x-fx-card') || dragging;
    setOver(null);
    setDragging(null);
    if (card !== null && card !== '' && onMove !== undefined) onMove(card, columnId);
  };

  return (
    <div
      ref={frame}
      aria-label={label}
      style={{
        display: 'flex',
        gap: 12,
        flex: 1,
        minHeight: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollSnapType: single ? 'x mandatory' : 'x proximity',
        paddingBottom: 4,
      }}
    >
      {columns.map((column) => {
        const accent = column.tone === undefined ? 'var(--fx-accent)' : toneColor(column.tone);
        const Glyph = column.icon;
        const isOver = over === column.id && dragging !== null;
        return (
          <section
            key={column.id}
            aria-label={typeof column.title === 'string' ? column.title : undefined}
            style={{
              flex: `0 0 ${basis}`,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              scrollSnapAlign: 'start',
              borderRadius: 'var(--fx-radius-card)',
              background: isOver ? toneSurface(column.tone ?? 'accent') : 'var(--fx-control)',
              border: `1px solid ${isOver ? accent : 'var(--fx-stroke)'}`,
              transition: 'background var(--fx-fast) var(--fx-ease-out), border-color var(--fx-fast) var(--fx-ease-out)',
            }}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              setOver(column.id);
            }}
            onDragLeave={() => setOver((current) => (current === column.id ? null : current))}
            onDrop={drop(column.id)}
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 12px',
                borderBottom: '1px solid var(--fx-divider)',
              }}
            >
              <span aria-hidden="true" style={{ width: 3, height: 14, borderRadius: 999, background: accent, flex: 'none' }} />
              {Glyph ? <Glyph size={14} style={{ color: accent, flex: 'none' }} /> : null}
              <span style={{ fontSize: 'var(--fx-body)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {column.title}
              </span>
              {column.meta !== undefined ? (
                <span className="fx-mono" style={{ marginInlineStart: 'auto', fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)', flex: 'none' }}>
                  {column.meta}
                </span>
              ) : null}
            </header>
            <div
              role="list"
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 8, alignContent: 'start', padding: 10 }}
            >
              <BoardContext.Provider value={{ column: column.id, columns: ids, move: onMove ?? null, dragging, setDragging }}>
                {column.children}
              </BoardContext.Provider>
            </div>
            {column.footer !== undefined ? (
              <footer style={{ padding: '8px 10px', borderTop: '1px solid var(--fx-divider)' }}>{column.footer}</footer>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export interface BoardCardProps {
  id: string;
  children: ReactNode;
  tone?: Tone;
  selected?: boolean;
  onClick?: () => void;
  /** A card that cannot change stage: no drag, no Ctrl+Arrow. */
  locked?: boolean;
}

/** One movable card. Only meaningful inside a `KanbanBoard` column. */
export function BoardCard({ id, children, tone, selected = false, onClick, locked = false }: BoardCardProps) {
  const board = useContext(BoardContext);
  const tr = useKitLabels();
  const rtl = useKitRtl();
  const movable = !locked && board !== null && board.move !== null;

  const step = (direction: -1 | 1) => {
    if (board === null || board.move === null) return;
    const at = board.columns.indexOf(board.column);
    const next = board.columns[at + direction];
    if (at === -1 || next === undefined) return;
    board.move(id, next);
  };

  return (
    <article
      role="listitem"
      tabIndex={0}
      draggable={movable}
      aria-keyshortcuts={movable ? 'Control+ArrowLeft Control+ArrowRight' : undefined}
      aria-roledescription={movable ? tr('بطاقة قابلة للنقل', 'Carte déplaçable', 'Movable card') : undefined}
      onDragStart={(event) => {
        if (!movable) return;
        event.dataTransfer.setData('text/x-fx-card', id);
        event.dataTransfer.effectAllowed = 'move';
        board?.setDragging(id);
      }}
      onDragEnd={() => board?.setDragging(null)}
      onClick={onClick}
      onKeyDown={(event) => {
        if (movable && event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          const forward = rtl ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
          step(forward ? 1 : -1);
          return;
        }
        if (onClick !== undefined && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        background: 'var(--fx-layer)',
        border: `1px solid ${selected ? 'var(--fx-accent)' : 'var(--fx-stroke)'}`,
        borderInlineStartWidth: tone === undefined ? undefined : 3,
        borderInlineStartColor: tone === undefined ? undefined : toneColor(tone),
        borderRadius: 'var(--fx-radius-control)',
        padding: '9px 11px',
        display: 'grid',
        gap: 4,
        cursor: movable ? 'grab' : onClick === undefined ? 'default' : 'pointer',
        boxShadow: selected ? 'var(--fx-shadow-card)' : undefined,
        opacity: board?.dragging === id ? 0.5 : 1,
      }}
    >
      {children}
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Match board
 * ------------------------------------------------------------------ */

export interface MatchBoardProps {
  leftTitle: ReactNode;
  rightTitle: ReactNode;
  left: ReactNode;
  right: ReactNode;
  /** The arithmetic of the proposed match, read down the centre. */
  spine?: ReactNode;
  /** What committing the match looks like. */
  action?: ReactNode;
  /** Narrowest a side may become before the board stacks instead. */
  minSide?: number;
}

const SPINE = 132;

/**
 * Two ledgers facing each other, with the difference between them in the middle.
 *
 * Reconciliation is the one task in the suite that is genuinely two-sided, and
 * presenting it as a single table forces the person to hold one side in their
 * head while reading the other. Here both sides are visible and the spine shows
 * what the selection currently adds up to, which is the number the work is
 * actually about.
 *
 * When the frame can no longer seat two sides the board stacks and the spine
 * becomes a band between them. It stays between them, rather than moving to the
 * bottom: the difference belongs where the eye crosses from one side to the
 * other, whichever way the two are arranged.
 */
export function MatchBoard({ leftTitle, rightTitle, left, right, spine, action, minSide = 280 }: MatchBoardProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const stacked = width > 0 && width < minSide * 2 + SPINE;

  const side = (title: ReactNode, body: ReactNode) => (
    <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '7px 12px',
          fontSize: 'var(--fx-caption)',
          fontWeight: 600,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          color: 'var(--fx-text-tertiary)',
          borderBottom: '1px solid var(--fx-divider)',
        }}
      >
        {title}
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{body}</div>
    </section>
  );

  return (
    <div
      ref={frame}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        border: '1px solid var(--fx-stroke)',
        borderRadius: 'var(--fx-radius-card)',
        background: 'var(--fx-layer)',
        overflow: 'hidden',
      }}
    >
      {side(leftTitle, left)}
      <div
        style={{
          flex: stacked ? 'none' : `0 0 ${SPINE}px`,
          display: 'flex',
          flexDirection: stacked ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: stacked ? '8px 12px' : '14px 10px',
          background: 'var(--fx-control)',
          borderBlock: stacked ? '1px solid var(--fx-divider)' : undefined,
          borderInline: stacked ? undefined : '1px solid var(--fx-divider)',
          textAlign: 'center',
        }}
      >
        {spine}
        {action}
      </div>
      {side(rightTitle, right)}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Gallery
 * ------------------------------------------------------------------ */

export interface GalleryItem {
  readonly id: string;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly icon?: LucideIcon;
  readonly tone?: Tone;
  /** Anything that stands in for the file: a thumbnail, a page, a glyph wall. */
  readonly thumb?: ReactNode;
}

export interface GalleryProps {
  items: readonly GalleryItem[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
  /** Tile edge length; the column count follows from it and the measured width. */
  size?: number;
  label?: string;
  empty?: ReactNode;
}

/**
 * A wall of documents, keyboard-navigable in two dimensions.
 *
 * The contract a gallery owes and a grid of `<div>`s never pays: one tab stop
 * for the whole wall, arrow keys that move the selection across *and down* by
 * the real column count, Home and End for the ends, and Enter to open. The
 * column count is the measured one, so Down moves to the tile visually below
 * rather than to a position computed from a guess about the window.
 */
export function Gallery({ items, selected = null, onSelect, onOpen, size = 168, label, empty }: GalleryProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const rtl = useKitRtl();
  const gap = 12;
  const columns = width <= 0 ? 1 : Math.max(1, Math.floor((width + gap) / (size + gap)));
  const active = selected === null ? -1 : items.findIndex((item) => item.id === selected);
  const cursor = active === -1 ? 0 : active;

  const go = (next: number) => {
    const item = items[Math.max(0, Math.min(items.length - 1, next))];
    if (item !== undefined && onSelect !== undefined) onSelect(item.id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward) go(cursor + 1);
    else if (event.key === back) go(cursor - 1);
    else if (event.key === 'ArrowDown') go(cursor + columns);
    else if (event.key === 'ArrowUp') go(cursor - columns);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Enter' && onOpen !== undefined && items[cursor] !== undefined) onOpen(items[cursor].id);
    else return;
    event.preventDefault();
  };

  if (items.length === 0 && empty !== undefined) return <>{empty}</>;

  return (
    <div
      ref={frame}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        display: 'grid',
        gap,
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        alignContent: 'start',
        outline: 'none',
      }}
    >
      {items.map((item, index) => {
        const chosen = item.id === selected;
        const Glyph = item.icon;
        const tint = item.tone === undefined ? 'var(--fx-accent)' : toneColor(item.tone);
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={chosen}

            onClick={() => onSelect?.(item.id)}
            onDoubleClick={() => onOpen?.(item.id)}
            style={{
              display: 'grid',
              gridTemplateRows: 'auto auto',
              gap: 0,
              borderRadius: 'var(--fx-radius-card)',
              border: `1px solid ${chosen ? 'var(--fx-accent)' : 'var(--fx-stroke)'}`,
              background: 'var(--fx-layer)',
              overflow: 'hidden',
              cursor: 'default',
              outline: chosen && index === cursor ? '2px solid var(--fx-accent)' : 'none',
              outlineOffset: -1,
            }}
          >
            <div
              style={{
                height: Math.round(size * 0.62),
                display: 'grid',
                placeItems: 'center',
                background: item.tone === undefined ? 'var(--fx-control)' : toneSurface(item.tone),
                borderBottom: '1px solid var(--fx-divider)',
                overflow: 'hidden',
              }}
            >
              {item.thumb ?? (Glyph ? <Glyph size={34} strokeWidth={1.1} style={{ color: tint }} /> : null)}
            </div>
            <div style={{ padding: '8px 10px', display: 'grid', gap: 2, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 'var(--fx-caption)',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.title}
              </span>
              {item.meta !== undefined ? (
                <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.meta}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reader pane
 * ------------------------------------------------------------------ */

export interface ReaderPaneProps {
  list: ReactNode;
  item: ReactNode;
  listWidth?: number;
  /** An item is open. A narrow frame then shows it *instead of* the list. */
  open?: boolean;
  onBack?: () => void;
  listLabel?: string;
  itemLabel?: string;
  /** Narrowest the reading column may be before the pane folds. */
  itemMin?: number;
}

/**
 * A list beside what is open in it.
 *
 * `SplitPane` is the wrong instrument for a queue: below two minimums it stacks,
 * and a stacked reader gives a phone half a list above half a message. A reader
 * *replaces* instead. Narrow, it is the list until something is opened and the
 * item afterwards, with one way back — which is how every mail client on a
 * phone has behaved for fifteen years, and the behaviour a person arrives
 * expecting.
 *
 * `open` is the app's own state rather than this component's, because the app
 * is what knows whether anything is selected, and a pane that kept its own
 * answer would disagree with the list the moment a filter emptied it.
 */
export function ReaderPane({
  list,
  item,
  listWidth = 300,
  open = false,
  onBack,
  listLabel,
  itemLabel,
  itemMin = 320,
}: ReaderPaneProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const tr = useKitLabels();
  const rtl = useKitRtl();
  const backId = useId();
  const folded = width > 0 && width < listWidth + itemMin;
  const Back = rtl ? ChevronRight : ChevronLeft;

  const listStyle: CSSProperties = folded
    ? { flex: 1, minWidth: 0 }
    : { flex: `0 0 ${listWidth}px`, minWidth: 0, borderInlineEnd: '1px solid var(--fx-divider)' };

  return (
    <div ref={frame} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
      {folded && open ? null : (
        <section aria-label={listLabel} style={{ ...listStyle, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {list}
        </section>
      )}
      {folded && !open ? null : (
        <section
          aria-label={itemLabel}
          aria-describedby={folded && open ? backId : undefined}
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          {folded && open && onBack !== undefined ? (
            <button
              id={backId}
              type="button"
              onClick={onBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                border: 'none',
                borderBottom: '1px solid var(--fx-divider)',
                background: 'var(--fx-control)',
                color: 'var(--fx-accent-text)',
                font: 'inherit',
                fontSize: 'var(--fx-caption)',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'start',
              }}
            >
              <Back size={14} />
              {listLabel ?? tr('رجوع', 'Retour', 'Back')}
            </button>
          ) : null}
          {item}
        </section>
      )}
    </div>
  );
}
