/**
 * Container-relative layout.
 *
 * The rest of this kit sizes itself in pixels, which is the right answer for a
 * desktop window and the wrong answer for every other shape a window can take.
 * A media query cannot help here, because an app is not the viewport: it is a
 * box inside a window inside a shell that is itself embedded in a page, and one
 * 1280px screen holds both a maximised Treasury at 1280 and a quarter-snapped
 * Journal at 640. The only number an app can honestly react to is the width of
 * its own frame.
 *
 * So this module measures that box and nothing else. `fitRails` is a pure
 * function of the measurement — no React, no DOM — so the fold thresholds can
 * be asserted directly; `useElementWidth` is the only part that needs a browser.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';

/**
 * The narrowest content column a frame may squeeze an app into before it starts
 * folding chrome away instead.
 *
 * 160 is not a taste judgement, it is the largest value that changes nothing on
 * a desktop. Every app's manifest declares a `minSize`, and the tightest content
 * column any of them leaves at its own minimum is Journal's — 760 − 236 − 324 =
 * 200px. A threshold at or below 200 therefore cannot fold a rail that is
 * visible today at a size the window manager can actually produce on a desktop,
 * and 160 keeps 40px of margin for the window's own border and padding.
 */
export const CONTENT_MIN = 160;

/** Which rails have been folded out of the flow, and so need a way back in. */
export interface RailFit {
  readonly nav: boolean;
  readonly aside: boolean;
}

const UNFOLDED: RailFit = { nav: false, aside: false };

/**
 * Decides which rails a frame of `width` can still afford to keep in flow.
 *
 * The inspector goes first and the navigation second, because an app that has
 * lost its detail pane is inconvenienced while an app that has lost its
 * navigation is unusable. Pass `0` or `null` for a rail the frame does not have.
 *
 * A width of `0` means "not measured yet" and folds nothing: the observer's
 * first reading arrives before paint, and guessing in the meantime would flash
 * the wrong layout on whichever guess turned out to be wrong.
 */
export function fitRails(
  width: number,
  navWidth: number | null,
  asideWidth: number | null,
  contentMin: number = CONTENT_MIN,
): RailFit {
  if (!Number.isFinite(width) || width <= 0) return UNFOLDED;
  const nav = navWidth === null ? 0 : Math.max(0, navWidth);
  const aside = asideWidth === null ? 0 : Math.max(0, asideWidth);
  const foldAside = aside > 0 && width < nav + aside + contentMin;
  // Whatever the aside gave back counts towards keeping the navigation.
  const remaining = foldAside ? width : width - aside;
  const foldNav = nav > 0 && remaining < nav + contentMin;
  return foldNav || foldAside ? { nav: foldNav, aside: foldAside } : UNFOLDED;
}

/** Where a `SplitPane` puts its two panes and its grip, for one measured width. */
export interface SplitGeometry {
  readonly column: boolean;
  readonly stacked: boolean;
  readonly first: CSSProperties;
  readonly grip: CSSProperties;
}

/**
 * Below two minimums there is no honest horizontal split left, so each pane
 * takes the full width and they divide the height instead. The grip goes with
 * it: dragging a 5px handle is a mouse gesture, and nothing this narrow has a
 * mouse. Above that the stored size is merely clamped, which is what keeps a
 * pane dragged wide from overflowing a window later made narrow.
 */
export function splitGeometry(
  direction: 'horizontal' | 'vertical',
  width: number,
  size: number,
  min: number,
): SplitGeometry {
  const horizontal = direction === 'horizontal';
  const stacked = horizontal && width > 0 && width < min * 2;
  const column = stacked || !horizontal;
  const extent = horizontal && width > 0 ? Math.max(min, Math.min(size, Math.max(min, width - min))) : size;
  return {
    column,
    stacked,
    first: {
      width: column ? undefined : extent,
      height: column && !stacked ? extent : undefined,
      flex: stacked ? 1 : 'none',
    },
    grip: {
      width: column ? undefined : 5,
      height: column ? (stacked ? 1 : 5) : undefined,
      cursor: stacked ? undefined : horizontal ? 'col-resize' : 'row-resize',
    },
  };
}

/**
 * Measures one element's content width, starting before the first paint.
 *
 * The layout effect reads the box synchronously and only then attaches the
 * observer: a `ResizeObserver` callback is a task of its own, so relying on it
 * alone would let one frame of desktop layout paint on a phone.
 */
export function useElementWidth<T extends HTMLElement>(): readonly [MutableRefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, width] as const;
}
