/* eslint-disable react-refresh/only-export-components -- this module deliberately
   publishes the kernel context object next to its provider; the consumer hooks
   belong with it because they are the only sanctioned way to read it. */
/**
 * Shell ↔ React bindings.
 *
 * Kernel subsystems are plain observables: they expose `subscribe(listener)` and
 * getter methods that return fresh snapshots. `useKernelView` is the single
 * bridge — it subscribes for the component's lifetime and re-reads on every
 * notification, which is exactly the semantics a shell surface wants (a taskbar
 * that repaints when the window list changes and at no other time).
 *
 * Nothing here talks to an application. Apps get `AppRuntime`, never a kernel.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AbiResult, Localized, ToastSpec } from '../kernel/abi';
import type { Kernel } from '../kernel/contracts';
import { intlLocaleFor } from '../sdk/format';
import type { AppLang, AppLocale } from '../sdk';
import { readAppearance, type Appearance, type ShellLang } from './appearance';
import type { ShellHostController, ShellHostSnapshot } from './host';

/* ------------------------------------------------------------------ *
 * Kernel context
 * ------------------------------------------------------------------ */

const KernelContext = createContext<Kernel | null>(null);

export function KernelProvider({ kernel, children }: { kernel: Kernel; children: ReactNode }) {
  return <KernelContext.Provider value={kernel}>{children}</KernelContext.Provider>;
}

/** The booted kernel. Shell-only: applications must never call this. */
export function useKernel(): Kernel {
  const kernel = useContext(KernelContext);
  if (kernel === null) throw new Error('useKernel() requires <KernelProvider>.');
  return kernel;
}

/* ------------------------------------------------------------------ *
 * Observable bridge
 * ------------------------------------------------------------------ */

export interface KernelObservable {
  subscribe(listener: () => void): () => void;
}

/**
 * Re-renders the component whenever `source` notifies, then returns a fresh
 * read. Subsystem getters allocate, so this deliberately avoids
 * `useSyncExternalStore` (whose snapshot must be referentially stable) and uses
 * an explicit invalidation counter instead.
 */
export function useKernelView<T>(source: KernelObservable, read: () => T): T {
  const [, invalidate] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => source.subscribe(invalidate), [source]);
  return read();
}

/** Same bridge for two subsystems at once (windows + processes, say). */
export function useKernelView2<T>(a: KernelObservable, b: KernelObservable, read: () => T): T {
  const [, invalidate] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => a.subscribe(invalidate), [a]);
  useEffect(() => b.subscribe(invalidate), [b]);
  return read();
}

/** Shell-host state (toasts, modal dialogs) — snapshots here *are* stable. */
export function useShellHostState(controller: ShellHostController): ShellHostSnapshot {
  return useSyncExternalStore(
    useCallback((listener: () => void) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.snapshot(), [controller]),
  );
}

/* ------------------------------------------------------------------ *
 * Shell host context
 * ------------------------------------------------------------------ */

const HostContext = createContext<ShellHostController | null>(null);

export function ShellHostProvider({
  controller,
  children,
}: {
  controller: ShellHostController;
  children: ReactNode;
}) {
  return <HostContext.Provider value={controller}>{children}</HostContext.Provider>;
}

/** The shell's own host controller. Chrome surfaces use it to raise toasts. */
export function useShellHostController(): ShellHostController {
  const controller = useContext(HostContext);
  if (controller === null) throw new Error('useShellHostController() requires <ShellHostProvider>.');
  return controller;
}

/**
 * Raises a toast from the shell itself. Chrome actions (launching a blocked app,
 * a failed power request) report through the same surface an app would use, so
 * the user never has to tell the difference.
 */
export function useToast(): (spec: ToastSpec) => void {
  const controller = useShellHostController();
  return useCallback(
    (spec: ToastSpec) => {
      controller.push(spec);
    },
    [controller],
  );
}

/**
 * Runs a kernel call that may fail and toasts the reason when it does. Every
 * shell affordance that maps onto an `AbiResult` goes through this, so a denial
 * is never silent.
 */
export function useKernelAction(): (
  title: string,
  run: () => Promise<AbiResult<unknown>>,
) => Promise<boolean> {
  const toast = useToast();
  return useCallback(
    async (title: string, run: () => Promise<AbiResult<unknown>>) => {
      const result = await run();
      if (result.ok) return true;
      toast({ kind: 'error', title, body: result.error.message });
      return false;
    },
    [toast],
  );
}

/* ------------------------------------------------------------------ *
 * Appearance
 * ------------------------------------------------------------------ */

/** The live appearance model, re-read whenever the registry changes. */
export function useAppearance(): Appearance {
  const kernel = useKernel();
  return useKernelView(kernel.registry, () => readAppearance(kernel.registry));
}

/* ------------------------------------------------------------------ *
 * Locale
 * ------------------------------------------------------------------ */

/** Arabic and Algerian Arabic share strings and direction. */
const isRtl = (lang: ShellLang): boolean => lang === 'ar' || lang === 'dz';

const pick = (text: Localized, lang: ShellLang): string =>
  lang === 'fr' ? text.fr : lang === 'en' ? text.en : text.ar;

/** Builds the locale object handed to apps and used by the shell chrome. */
export function makeLocale(lang: ShellLang): AppLocale {
  const rtl = isRtl(lang);
  return {
    lang: lang as AppLang,
    rtl,
    t: (text: Localized) => pick(text, lang),
    tr: (ar: string, fr: string, en: string) => pick({ ar, fr, en }, lang),
    intlLocale: intlLocaleFor(lang as AppLang),
  };
}

/** The shell's own locale, derived from the appearance registry key. */
export function useShellLocale(): AppLocale {
  const { language } = useAppearance();
  return useMemo(() => makeLocale(language), [language]);
}

/* ------------------------------------------------------------------ *
 * Clock
 * ------------------------------------------------------------------ */

/**
 * A ticking wall clock for the tray. Aligns to the next boundary so the minute
 * flips when the real minute does, rather than up to a period late.
 */
export function useWallClock(periodMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const delay = periodMs - (Date.now() % periodMs);
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [periodMs]);
  return now;
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/**
 * Global shortcut handler. Registered in the capture phase on the shell root so
 * an app's own handlers never swallow Win-key chords.
 */
export function useGlobalKeys(handler: (event: KeyboardEvent) => void): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handler(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [handler]);
}

/** Closes a flyout when the pointer goes down anywhere outside it. */
export function useDismissOnOutside(active: boolean, onDismiss: () => void, selector: string): void {
  useEffect(() => {
    if (!active) return;
    const listener = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(selector) !== null) return;
      onDismiss();
    };
    // Deferred so the click that opened the flyout does not immediately close it.
    const id = window.setTimeout(() => window.addEventListener('pointerdown', listener), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', listener);
    };
  }, [active, onDismiss, selector]);
}
