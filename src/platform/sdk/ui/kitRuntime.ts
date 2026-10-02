/**
 * What a control may ask the process about itself.
 *
 * A control sometimes has to speak before an app does: the drawer toggles in
 * `AppFrame` are labelled "Navigation", a tile's resize grip has to announce
 * what it resizes, and a reader pane's back button needs a word on it. None of
 * those strings belong to any app, so none of them can be passed in as props
 * eighteen times over. The same goes for the two presentation choices an app
 * declares in its manifest rather than at a call site — its accent and its
 * density — which `AppFrame` has to read somewhere.
 *
 * All three hooks degrade when there is no runtime: to English, to
 * left-to-right, and to the user's accent at comfortable density. That is what
 * lets any component in this folder be rendered in isolation — in a test, in a
 * story, or inside the shell's own chrome, which has no app process behind it.
 *
 * This lives in its own module for a lint reason worth writing down:
 * `react-refresh/only-export-components` rejects a non-component export from a
 * file that exports components, so a hook cannot sit beside the controls that
 * use it. Keeping it here is what stops the four-line helper being copied into
 * every new file in the kit.
 */
import { useContext } from 'react';
import type { AppAccent, AppDensity } from '../../kernel/abi';
import { AppRuntimeContext } from '../context';

/** Tri-lingual inline label, resolved for the current process. */
export function useKitLabels(): (ar: string, fr: string, en: string) => string {
  const runtime = useContext(AppRuntimeContext);
  return runtime === null ? (_ar, _fr, en) => en : runtime.locale.tr;
}

/**
 * True when the app is reading right-to-left.
 *
 * Only the handful of places that cannot be expressed in logical CSS need this —
 * a pointer delta, an arrow key, a `clientX` measured from a box's left edge.
 * Everything that can say `marginInlineStart` says that instead and never asks.
 */
export function useKitRtl(): boolean {
  const runtime = useContext(AppRuntimeContext);
  return runtime === null ? false : runtime.locale.rtl;
}

/** What the running app declared about how it wants to look. */
export interface KitAppearance {
  /** `null` means inherit the user's accent, which is right for system tools. */
  readonly accent: AppAccent | null;
  readonly density: AppDensity;
}

/**
 * The manifest's `accent` and `density`, defaulted.
 *
 * Read from the process rather than passed down, because `AppFrame` is the one
 * element that has to publish them and no app should have to repeat in a prop
 * what it already declared in its manifest.
 */
export function useKitAppearance(): KitAppearance {
  const runtime = useContext(AppRuntimeContext);
  return {
    accent: runtime?.manifest.accent ?? null,
    density: runtime?.manifest.density ?? 'comfortable',
  };
}

