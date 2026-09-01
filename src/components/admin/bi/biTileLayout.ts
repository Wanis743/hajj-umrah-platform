/**
 * The dashboard grid, as arithmetic.
 *
 * A dashboard's geometry lives in four integers per tile, and every rule about them is
 * already written down twice -- once in `bi_dashboard_tiles`' check constraints and once
 * in whatever editor moves a tile. This file is the second of those, deliberately kept
 * as pure functions in a `.ts` file so the panel that draws the grid holds no arithmetic
 * and the arithmetic holds no React.
 *
 * Three rules here are stricter than the database's, and each one is a choice rather
 * than a duplication:
 *
 * 1. `grid_w` may be 1 in the database. The editor's floor is 2, because one twelfth of
 *    a grid is narrower than the axis labels of anything drawn inside it, and a tile
 *    that cannot show its own chart is not a smaller tile but a broken one.
 * 2. The database checks each row on its own -- `grid_x + grid_w <= 12` is a per-tile
 *    constraint -- so nothing in it stops two tiles from claiming the same cells. CSS
 *    grid would happily draw them on top of each other. `canMove` refuses that here,
 *    because two charts stacked in one cell is not a layout anyone chose.
 * 3. Moving a tile to the top of the grid also makes it first in the stacked reading
 *    order. `layoutDiff` renumbers `sort_order` from the layout's own reading order, so
 *    the phone view and the server's `order by sort_order, grid_y, grid_x` do not end up
 *    describing yesterday's arrangement.
 *
 * Below the wide breakpoint the grid is one column and the geometry is not applied at
 * all. A twelve-column grid on a 375px screen gives each column 31px; a two-column tile
 * would be 62px wide. The stacked order is the grid's own reading order, so nothing is
 * lost there but the geometry -- which is also why the layout editor is not offered at
 * that width: there is no visible geometry to edit.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BiDashboardTile, BiTileGrid, BiTileLayoutChange } from '@/types/bi';

/** The database's column count, and the only number in this file that is not a
 *  preference: `bi_dashboard_tiles_fits` is written against it. */
export const GRID_COLUMNS = 12;

/** One row unit, in pixels. A default tile is `grid_h` 4, so 336px of cell -- four rows
 *  and the three gaps between them -- for 218px of chart once the panel's own chrome is
 *  taken out. */
export const GRID_ROW_PX = 72;

/** The gap between cells, which is `gap-4` on the container. Named here because a tile
 *  four rows tall spans three of these too, and a chart sized without them would leave a
 *  band of empty panel under it. */
export const GRID_GAP_PX = 16;

/** What a tile spends on its title, its subtitle, its meta line and the panel's
 *  padding, before any of its height reaches the chart. */
const TILE_CHROME_PX = 118;

/** The smallest chart worth drawing. `TILE_MIN_H` is chosen so this floor is never the
 *  binding constraint -- a chart clamped taller than its cell would overflow it. */
const CHART_MIN_PX = 96;

/** Height used by the stacked one-column view, where `grid_h` means nothing. */
const CHART_STACKED_PX = 240;

/** The nudge controls sit inside the cell while arranging, so the chart gives up their
 *  height rather than pushing the tile out of its own row. */
const NUDGE_ROW_PX = 34;

export const TILE_MIN_W = 2;
export const TILE_MIN_H = 3;
/** The database's own ceiling on `grid_h`. */
export const TILE_MAX_H = 24;

/** `xl` in the house Tailwind config, so the CSS breakpoint and the JS one agree. */
export const GRID_WIDE_QUERY = '(min-width: 1280px)';

/** Tile id to geometry. A map rather than an array because every operation here is
 *  "this one tile, moved", and an array would make each of them a search first. */
export type TileLayout = ReadonlyMap<string, BiTileGrid>;

/**
 * The eight moves a tile can make.
 *
 * Nudges rather than a mouse drag, and that is the interaction choice worth defending: a
 * twelve-column grid whose only editor is a drag cannot be used from a keyboard at all,
 * and the constraint the database enforces is far easier to state as a disabled button
 * than as a drop target that silently refuses.
 */
export type TileNudge =
  | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  | 'WIDER' | 'NARROWER' | 'TALLER' | 'SHORTER';

/** The layout the server sent, as the base every edit is measured against. */
export function tileLayout(tiles: readonly BiDashboardTile[]): TileLayout {
  return new Map(tiles.map((tile) => [tile.id, tile.grid]));
}

/**
 * The move applied to one tile's own four integers, or `null` when a per-tile rule
 * forbids it.
 *
 * `DOWN` has no ceiling because `grid_y` has none: the grid grows implicit rows under a
 * tile pushed past the last one, which is the same thing the database allows.
 */
export function nextGrid(grid: BiTileGrid, move: TileNudge): BiTileGrid | null {
  switch (move) {
    case 'LEFT': return grid.x > 0 ? { ...grid, x: grid.x - 1 } : null;
    case 'RIGHT': return grid.x + grid.w < GRID_COLUMNS ? { ...grid, x: grid.x + 1 } : null;
    case 'UP': return grid.y > 0 ? { ...grid, y: grid.y - 1 } : null;
    case 'DOWN': return { ...grid, y: grid.y + 1 };
    case 'WIDER': return grid.x + grid.w < GRID_COLUMNS ? { ...grid, w: grid.w + 1 } : null;
    case 'NARROWER': return grid.w > TILE_MIN_W ? { ...grid, w: grid.w - 1 } : null;
    case 'TALLER': return grid.h < TILE_MAX_H ? { ...grid, h: grid.h + 1 } : null;
    case 'SHORTER': return grid.h > TILE_MIN_H ? { ...grid, h: grid.h - 1 } : null;
  }
}

/** Two rectangles in grid units, sharing at least one cell. */
function overlaps(a: BiTileGrid, b: BiTileGrid): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether the move is both legal on its own and clear of every other tile. Drives the
 *  `disabled` on each of the eight buttons, so a refusal is visible before it is
 *  attempted rather than after. */
export function canMove(layout: TileLayout, id: string, move: TileNudge): boolean {
  const grid = layout.get(id);
  if (grid === undefined) return false;
  const next = nextGrid(grid, move);
  if (next === null) return false;
  for (const [otherId, other] of layout) {
    if (otherId !== id && overlaps(next, other)) return false;
  }
  return true;
}

/** The layout with one tile moved, or the same layout back when the move is refused --
 *  so a handler can dispatch unconditionally and a refused nudge is a no-op rather than
 *  an exception to catch. */
export function moveTile(layout: TileLayout, id: string, move: TileNudge): TileLayout {
  if (!canMove(layout, id, move)) return layout;
  const grid = layout.get(id);
  if (grid === undefined) return layout;
  const next = nextGrid(grid, move);
  if (next === null) return layout;
  const copy = new Map(layout);
  copy.set(id, next);
  return copy;
}

/** The grid's reading order: top row first, then left to right, with the server's own
 *  `sort_order` breaking a tie so two tiles in the same cell -- which only the server
 *  can produce -- keep a stable order. */
function readingOrder(tiles: readonly BiDashboardTile[], draft: TileLayout): BiDashboardTile[] {
  return [...tiles].sort((a, b) => {
    const ga = draft.get(a.id) ?? a.grid;
    const gb = draft.get(b.id) ?? b.grid;
    if (ga.y !== gb.y) return ga.y - gb.y;
    if (ga.x !== gb.x) return ga.x - gb.x;
    return a.sort_order - b.sort_order;
  });
}

/**
 * What actually changed, as the rows `biCommands.tile.relayout` will write.
 *
 * Only moved tiles are included. `relayout` applies one row at a time and every row it
 * writes is an audited update, so sending a tile back its own coordinates would spend an
 * audit row to say nothing.
 */
export function layoutDiff(
  tiles: readonly BiDashboardTile[], draft: TileLayout,
): BiTileLayoutChange[] {
  const changes: BiTileLayoutChange[] = [];
  readingOrder(tiles, draft).forEach((tile, index) => {
    const grid = draft.get(tile.id) ?? tile.grid;
    const moved = grid.x !== tile.grid.x || grid.y !== tile.grid.y
      || grid.w !== tile.grid.w || grid.h !== tile.grid.h;
    if (!moved && tile.sort_order === index) return;
    changes.push({
      id: tile.id,
      grid_x: grid.x,
      grid_y: grid.y,
      grid_w: grid.w,
      grid_h: grid.h,
      sort_order: index,
    });
  });
  return changes;
}

/** The tiles in the order they should be read, which is the order they are stacked in
 *  when the grid is one column. */
export function orderedTiles(
  tiles: readonly BiDashboardTile[], draft: TileLayout,
): BiDashboardTile[] {
  return readingOrder(tiles, draft);
}

/** Where the tile sits. Empty at narrow widths: the geometry is not applied at all
 *  there, so a one-column stack does not need to be overridden back out of it. */
export function gridStyle(grid: BiTileGrid, wide: boolean): CSSProperties {
  if (!wide) return {};
  return {
    gridColumn: `${grid.x + 1} / span ${grid.w}`,
    gridRow: `${grid.y + 1} / span ${grid.h}`,
  };
}

/** How much of the cell is left for the chart once the tile's own chrome is out. A tile
 *  `h` rows tall owns `h` rows and the `h - 1` gaps between them, less the nudge row when
 *  the grid is being arranged. */
export function chartHeight(h: number, wide: boolean, arranging = false): number {
  if (!wide) return CHART_STACKED_PX;
  const cell = h * GRID_ROW_PX + (h - 1) * GRID_GAP_PX - TILE_CHROME_PX;
  return Math.max(CHART_MIN_PX, cell - (arranging ? NUDGE_ROW_PX : 0));
}

/** One tile's geometry as a sentence, for the control group's accessible name: a
 *  screen reader driving the nudge buttons needs to hear where the tile is now. */
export function gridSummary(grid: BiTileGrid): string {
  return `${grid.w}×${grid.h} @ ${grid.x + 1},${grid.y + 1}`;
}

/**
 * Whether the grid is wide enough to be a grid.
 *
 * The listener mirrors the house pattern in `Navbar.tsx`: `matchMedia` plus a `change`
 * listener, because rotating a phone crosses the breakpoint without a remount and a
 * layout editor that stayed open at 375px would be editing something invisible.
 */
export function useWideGrid(): boolean {
  const [wide, setWide] = useState(
    () => (typeof window === 'undefined' ? true : window.matchMedia(GRID_WIDE_QUERY).matches),
  );

  useEffect(() => {
    const query = window.matchMedia(GRID_WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return wide;
}
