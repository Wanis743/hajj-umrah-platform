/**
 * Shell UI state.
 *
 * Everything the desktop shows *around* the windows: which flyout is open, the
 * live snap preview, the Alt+Tab overlay, which full-screen surface (boot, lock,
 * shutdown) is up. None of it belongs in the kernel — a flyout is not a system
 * object — and none of it belongs to a single component either, so it lives in
 * one reducer the root owns and passes down.
 *
 * Kept free of JSX so it can be reasoned about (and unit-tested) on its own.
 */
import { useMemo, useReducer } from 'react';
import type { SnapZone, WindowId } from '../kernel/abi';

/** The mutually exclusive taskbar surfaces. Opening one closes the others. */
export type FlyoutName = 'start' | 'search' | 'taskview' | 'widgets' | 'quick' | 'notifications' | 'calendar';

/** Full-screen shell surfaces. `desktop` is the normal state. */
export type ScreenName = 'boot' | 'desktop' | 'lock' | 'shutdown' | 'restart' | 'signout';

export interface SnapAnchor {
  readonly x: number;
  readonly y: number;
  readonly window: WindowId;
}

export interface ShellUi {
  readonly screen: ScreenName;
  readonly flyout: FlyoutName | null;
  /** Zone a dragged window would land in, painted behind the window. */
  readonly snapHint: SnapZone | null;
  /** Snap-layout flyout position, when hovering a maximize button. */
  readonly snapFlyout: SnapAnchor | null;
  /** Index into the MRU list while Alt+Tab is held; null when not switching. */
  readonly switcher: number | null;
}

type Action =
  | { readonly type: 'flyout'; readonly name: FlyoutName | null }
  | { readonly type: 'toggle'; readonly name: FlyoutName }
  | { readonly type: 'snapHint'; readonly zone: SnapZone | null }
  | { readonly type: 'snapFlyout'; readonly anchor: SnapAnchor | null }
  | { readonly type: 'switcher'; readonly index: number | null }
  | { readonly type: 'screen'; readonly screen: ScreenName };

export interface ShellActions {
  toggleFlyout(name: FlyoutName): void;
  openFlyout(name: FlyoutName): void;
  closeFlyout(): void;
  setSnapHint(zone: SnapZone | null): void;
  setSnapFlyout(anchor: SnapAnchor | null): void;
  setSwitcher(index: number | null): void;
  setScreen(screen: ScreenName): void;
}

function reduce(state: ShellUi, action: Action): ShellUi {
  switch (action.type) {
    case 'flyout':
      return state.flyout === action.name ? state : { ...state, flyout: action.name };
    case 'toggle':
      return { ...state, flyout: state.flyout === action.name ? null : action.name };
    case 'snapHint':
      return state.snapHint === action.zone ? state : { ...state, snapHint: action.zone };
    case 'snapFlyout':
      return { ...state, snapFlyout: action.anchor };
    case 'switcher':
      return state.switcher === action.index ? state : { ...state, switcher: action.index };
    case 'screen':
      // Leaving the desktop dismisses whatever was floating above it.
      return { ...state, screen: action.screen, flyout: null, snapFlyout: null, switcher: null };
  }
}

/** The shell's UI state plus a stable action bundle. */
export function useShellUi(initialScreen: ScreenName): readonly [ShellUi, ShellActions] {
  const [state, dispatch] = useReducer(reduce, {
    screen: initialScreen,
    flyout: null,
    snapHint: null,
    snapFlyout: null,
    switcher: null,
  });

  const actions = useMemo<ShellActions>(
    () => ({
      toggleFlyout: (name) => dispatch({ type: 'toggle', name }),
      openFlyout: (name) => dispatch({ type: 'flyout', name }),
      closeFlyout: () => dispatch({ type: 'flyout', name: null }),
      setSnapHint: (zone) => dispatch({ type: 'snapHint', zone }),
      setSnapFlyout: (anchor) => dispatch({ type: 'snapFlyout', anchor }),
      setSwitcher: (index) => dispatch({ type: 'switcher', index }),
      setScreen: (screen) => dispatch({ type: 'screen', screen }),
    }),
    [],
  );

  return [state, actions] as const;
}
