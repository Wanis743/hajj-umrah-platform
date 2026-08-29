/**
 * `useContextMenu` — right-click menu state for apps.
 *
 * Lives outside the component modules so React Fast Refresh boundaries stay
 * intact (a module may not export both components and hooks).
 */
import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';

export interface ContextMenuState<T> {
  readonly x: number;
  readonly y: number;
  readonly target: T;
}

export interface ContextMenuController<T> {
  readonly menu: ContextMenuState<T> | null;
  /** Call from `onContextMenu`; prevents the browser menu. */
  readonly open: (event: ReactMouseEvent | PointerEvent, target: T) => void;
  readonly openAt: (x: number, y: number, target: T) => void;
  readonly close: () => void;
}

export function useContextMenu<T>(): ContextMenuController<T> {
  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null);

  const open = useCallback((event: ReactMouseEvent | PointerEvent, target: T) => {
    event.preventDefault();
    if ('stopPropagation' in event) event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, target });
  }, []);

  const openAt = useCallback((x: number, y: number, target: T) => setMenu({ x, y, target }), []);
  const close = useCallback(() => setMenu(null), []);

  return { menu, open, openAt, close };
}
