/**
 * The five style objects every 360 pane is built out of.
 *
 * A `.ts` file rather than part of `pane.tsx` for a mechanical reason worth stating:
 * `react-refresh/only-export-components` is error-level here, and its
 * `allowConstantExport` escape hatch covers primitives only — an exported object
 * literal is a new identity on every refresh, so a component holding one across a
 * hot update would be holding a stale object. Data modules are exempt because they
 * export no components at all, which is the same reason `tones.ts` and `labels.ts`
 * are `.ts` while `cells.tsx` is not.
 *
 * Shared by `detail.tsx`, `lineage.tsx` and `shelves.tsx` because all three draw the
 * same rectangle. A pane that is 14px inside one file and 16px inside another is a
 * visible seam in a window that is supposed to have none.
 */
import type { CSSProperties } from 'react';

/** The pane itself: a column of sections, packed to the top so a short record does not stretch. */
export const PANE: CSSProperties = {
  display: 'grid',
  gap: 14,
  alignContent: 'start',
  padding: 14,
  minWidth: 0,
};

/** Secondary text at caption size — a key, a data type, a count nobody is meant to read first. */
export const CAPTION: CSSProperties = {
  color: 'var(--fx-text-tertiary)',
  fontSize: 'var(--fx-caption)',
};

/** Chips and counts on one baseline, wrapping rather than clipping in a 360px pane. */
export const WRAP: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

/**
 * One entry in a collection list.
 *
 * A rule above each entry rather than a card around it. Every collection these panes draw
 * is a list of short things — a dimension, a metric, a tile, an analysis — and four stacks
 * of cards down a 360px column would spend most of the width on borders.
 */
export const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderTop: '1px solid var(--fx-divider)',
  minWidth: 0,
};
