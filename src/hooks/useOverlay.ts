/**
 * Overlay plumbing — the four behaviours every dialog, sheet and popover on
 * the public site needs and none of them had.
 *
 * They are here rather than inside each component because getting them wrong
 * is invisible on a desktop and unusable on a phone: a modal that does not
 * lock the body scrolls the page behind it under your thumb, and one that
 * does not answer Escape traps a keyboard user inside it.
 *
 * Every hook is a no-op while `active` is false, so a closed overlay costs
 * one comparison per render and installs no listeners.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * Freezes the page behind an overlay.
 *
 * Counted, not a boolean: two overlays can legitimately be open at once (a
 * package modal opened from a mobile sheet), and the first one to close must
 * not unlock the body while the second is still up.
 */
let lockCount = 0;

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    document.body.classList.add('gl-locked');
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.body.classList.remove('gl-locked');
    };
  }, [active]);
}

/**
 * Escape closes the overlay.
 *
 * The handler is held in a ref so a caller passing an inline arrow does not
 * reinstall the listener on every render — and so the listener always calls
 * the newest closure rather than the one captured when it was attached.
 */
export function useDismissOnEscape(active: boolean, onDismiss: () => void): void {
  const sink = useRef(onDismiss);
  sink.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        sink.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/**
 * Keeps Tab inside the overlay and hands focus back where it came from.
 *
 * The query is re-run on every Tab rather than cached, because a dialog whose
 * content changes (a package modal switching tabs) would otherwise cycle
 * through elements that are no longer there.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (root === null) return;
    const restoreTo = document.activeElement as HTMLElement | null;

    // Focus the panel itself, not its first button: landing on "Reserve"
    // would let a stray Enter book a trip.
    root.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      if (!event.shiftKey && (current === last || current === root)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (current === first || current === root)) {
        event.preventDefault();
        last.focus();
      }
    };

    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      restoreTo?.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}

/**
 * Which in-page section the reader is actually looking at.
 *
 * `rootMargin` pulls the top edge down past the fixed header and the bottom
 * edge up, so the "current" section is the one occupying the middle band of
 * the viewport rather than whichever one happens to touch the top pixel.
 */
export function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');

  useEffect(() => {
    const targets = key
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible !== undefined) setActive(visible.target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5] },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return active;
}
