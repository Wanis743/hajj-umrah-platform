/**
 * Desktop icon placement — the arithmetic behind dropping an icon anywhere.
 *
 * Windows lets you put an icon on any cell of an invisible grid and remembers
 * where you put it. Two ideas carry that here, and both live in this file so
 * they can be reasoned about — and tested — without a DOM:
 *
 *   1. A *cell* is a one-based `{ col, row }`, which is exactly what CSS Grid
 *      wants in `grid-column` / `grid-row`. An icon the user has never dragged
 *      carries no cell at all and is auto-placed by the browser, which is why an
 *      untouched desktop still flows the way it always did.
 *   2. Grid resolves definite placements before it flows the auto ones, so a
 *      dropped icon never has to fight an auto-placed neighbour — the browser
 *      moves the neighbour out of the way for free. Only two *placed* icons can
 *      genuinely collide, and `firstFree` is the tie-break for those.
 *
 * Nothing here imports anything: it is pure geometry over plain data.
 */

/** A one-based grid cell, in `grid-column` / `grid-row` coordinates. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** Icon key → the cell it was dropped on. Absent means "let the grid decide". */
export type Placements = ReadonlyMap<string, Cell>;

/** Track pitch in CSS pixels: the width and height of one cell. */
export interface CellSize {
  readonly w: number;
  readonly h: number;
}

/** How many whole cells the grid's content box holds. */
export interface GridBounds {
  readonly cols: number;
  readonly rows: number;
}

/** An icon on the move, and the cell it started from. */
export interface Move {
  readonly key: string;
  readonly at: Cell;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Stable identity for a cell, so a `Set` can hold occupancy. */
export const cellKey = (cell: Cell): string => `${cell.col}:${cell.row}`;

/** A cell pulled back inside `bounds`. */
export const fitCell = (cell: Cell, bounds: GridBounds): Cell => ({
  col: clamp(Math.round(cell.col), 1, bounds.cols),
  row: clamp(Math.round(cell.row), 1, bounds.rows),
});

/**
 * The same division `grid-template-rows: repeat(auto-fill, H)` performs, so the
 * grid we reason about is the grid the browser drew. One of each at minimum: a
 * zero-row grid would divide by zero in `firstFree`.
 */
export const gridBounds = (content: CellSize, cell: CellSize): GridBounds => ({
  cols: Math.max(1, Math.floor(content.w / cell.w)),
  rows: Math.max(1, Math.floor(content.h / cell.h)),
});

/**
 * The cell a point falls on, measured from the content box's own corner.
 * Rounded rather than floored: an icon is carried by its leading corner, and
 * rounding snaps to the nearest gridline, which is what "put it about here"
 * means to a hand holding a mouse.
 */
export const cellAt = (
  point: { readonly x: number; readonly y: number },
  cell: CellSize,
  bounds: GridBounds,
): Cell => fitCell({ col: Math.round(point.x / cell.w) + 1, row: Math.round(point.y / cell.h) + 1 }, bounds);

/**
 * The first unoccupied cell at or after `from`, walking column-major the way the
 * desktop itself flows and wrapping once through the whole grid. Returns `from`
 * when every cell is taken: an overfull desktop stacks rather than refusing the
 * drop.
 */
export function firstFree(taken: ReadonlySet<string>, from: Cell, bounds: GridBounds): Cell {
  const total = bounds.cols * bounds.rows;
  const origin = fitCell(from, bounds);
  const start = (origin.col - 1) * bounds.rows + (origin.row - 1);
  for (let step = 0; step < total; step += 1) {
    const index = (start + step) % total;
    const candidate: Cell = { col: Math.floor(index / bounds.rows) + 1, row: (index % bounds.rows) + 1 };
    if (!taken.has(cellKey(candidate))) return candidate;
  }
  return origin;
}

/**
 * A placement map fitted to the grid that exists right now. An arrangement saved
 * on a wide screen would otherwise put icons in implicit columns off the
 * right-hand edge when the same desktop is reopened narrow. Clamping can land
 * two icons on one cell, so collisions go through `firstFree` — and the result is
 * only ever *rendered*, never written back, so widening the window again
 * restores the original arrangement untouched.
 */
export function fitPlacements(placements: Placements, bounds: GridBounds): Placements {
  const out = new Map<string, Cell>();
  const taken = new Set<string>();
  for (const [key, cell] of placements) {
    const free = firstFree(taken, fitCell(cell, bounds), bounds);
    taken.add(cellKey(free));
    out.set(key, free);
  }
  return out;
}

/** Everything `resolveDrop` needs to know about a completed drag. */
export interface DropRequest {
  /** Placements as they stood before the drag. */
  readonly placements: Placements;
  /** The icons being carried, each with the cell it started from. */
  readonly moves: readonly Move[];
  /** The cell the grabbed icon was released on. */
  readonly target: Cell;
  /** Key of the icon the pointer grabbed; the rest of the group follows it. */
  readonly anchor: string;
  readonly bounds: GridBounds;
  /** Keys still on the desktop. A deleted file's placement is forgotten here. */
  readonly alive: ReadonlySet<string>;
}

/**
 * Where a dragged group lands. The group shifts by the grabbed icon's own
 * displacement, clamped so that no member of it leaves the grid, and each member
 * then takes the first free cell from its ideal one. The movers are lifted out of
 * the occupancy set before any of that, so a group can shuffle inside the cells
 * it already held instead of colliding with itself.
 */
export function resolveDrop({ placements, moves, target, anchor, bounds, alive }: DropRequest): Placements {
  const next = new Map<string, Cell>();
  for (const [key, cell] of placements) if (alive.has(key)) next.set(key, cell);
  for (const move of moves) next.delete(move.key);
  if (moves.length === 0) return next;

  const from = moves.find((move) => move.key === anchor)?.at ?? target;
  const cols = moves.map((move) => move.at.col);
  const rows = moves.map((move) => move.at.row);
  const dcol = clamp(target.col - from.col, 1 - Math.min(...cols), bounds.cols - Math.max(...cols));
  const drow = clamp(target.row - from.row, 1 - Math.min(...rows), bounds.rows - Math.max(...rows));

  const taken = new Set<string>();
  for (const cell of next.values()) taken.add(cellKey(cell));
  for (const move of moves) {
    const wanted = fitCell({ col: move.at.col + dcol, row: move.at.row + drow }, bounds);
    const free = firstFree(taken, wanted, bounds);
    taken.add(cellKey(free));
    next.set(move.key, free);
  }
  return next;
}

/**
 * Registry values are strings, so placements travel as JSON. Keys are sorted so
 * that saving the same arrangement twice produces byte-identical output and does
 * not wake every registry watcher for nothing.
 */
export function encodePlacements(placements: Placements): string {
  const out: Record<string, readonly [number, number]> = {};
  for (const key of [...placements.keys()].sort()) {
    const cell = placements.get(key);
    if (cell !== undefined) out[key] = [cell.col, cell.row];
  }
  return JSON.stringify(out);
}

/** One decoded entry, or `null`. Anything malformed is discarded, not trusted. */
function asCell(value: unknown): Cell | null {
  if (!Array.isArray(value)) return null;
  const pair: readonly unknown[] = value;
  const col = pair[0];
  const row = pair[1];
  if (typeof col !== 'number' || typeof row !== 'number') return null;
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 1 || row < 1) return null;
  return { col, row };
}

/**
 * The inverse, hardened. The registry is state that outlives the build that wrote
 * it and can be edited by hand, so a value this version does not recognise has to
 * degrade to "no saved positions" rather than throw in the middle of a render.
 */
export function decodePlacements(raw: string): Placements {
  const out = new Map<string, Cell>();
  if (raw === '') return out;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [key, value] of Object.entries(parsed)) {
    const cell = asCell(value);
    if (cell !== null) out.set(key, cell);
  }
  return out;
}
