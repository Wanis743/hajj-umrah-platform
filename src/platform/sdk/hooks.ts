/**
 * SDK hooks — the ergonomic layer over the syscall ABI.
 *
 * Every hook below is a thin wrapper around `runtime.invoke`. They handle
 * cancellation, invalidation and unmount cleanup so applications contain
 * business logic instead of plumbing.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AbiResult,
  DatasetName,
  IpcMessage,
  RegistryValue,
  SyscallName,
  SyscallRequest,
  SyscallResponse,
  VfsContentType,
  VfsStat,
} from '../kernel/abi';
import { REG } from '../kernel/abi';
import { AppRuntimeContext } from './context';
import {
  CHANNEL_APP_COMMAND,
  CHANNEL_DATA_INVALIDATED,
  type AppRuntime,
  type DatasetOptions,
  type DatasetState,
} from './types';

/** The runtime for the current app instance. Throws outside an app window. */
export function useApp(): AppRuntime {
  const runtime = useContext(AppRuntimeContext);
  if (!runtime) throw new Error('useApp() requires an app window host (AppRuntimeProvider).');
  return runtime;
}

/** Locale helpers (`t`, `tr`, `rtl`, `lang`). */
export function useLocale() {
  return useApp().locale;
}

/** Stable `invoke` reference for effect dependency lists. */
export function useSyscall() {
  const runtime = useApp();
  return useCallback(
    <K extends SyscallName>(name: K, request: SyscallRequest<K>) => runtime.invoke(name, request),
    [runtime],
  );
}

/* ------------------------------------------------------------------ *
 * Business data
 * ------------------------------------------------------------------ */

const queryKey = (dataset: string, options: DatasetOptions): string =>
  JSON.stringify([dataset, options.where ?? null, options.orderBy ?? null, options.limit ?? null, options.offset ?? null]);

/**
 * Reads a projected dataset through the data broker. Re-fetches automatically
 * when the broker invalidates the dataset (or anything in `watch`).
 */
export function useDataset(dataset: DatasetName, options: DatasetOptions = {}): DatasetState {
  const runtime = useApp();
  const key = queryKey(dataset, options);
  const enabled = options.enabled !== false;
  const watch = options.watch;

  const [state, setState] = useState<{
    rows: readonly Readonly<Record<string, unknown>>[];
    loading: boolean;
    error: string | null;
    fetchedAt: string | null;
    fromCache: boolean;
  }>({ rows: [], loading: enabled, error: null, fetchedAt: null, fromCache: false });

  const [nonce, setNonce] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    const current = optionsRef.current;
    void runtime
      .invoke('data.query', {
        dataset,
        where: current.where,
        orderBy: current.orderBy,
        limit: current.limit,
        offset: current.offset,
        maxAgeMs: current.maxAgeMs,
      })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setState({
            rows: result.value.rows,
            loading: false,
            error: null,
            fetchedAt: result.value.fetchedAt,
            fromCache: result.value.fromCache,
          });
        } else {
          setState((prev) => ({ ...prev, loading: false, error: result.error.message }));
        }
      });
    return () => {
      cancelled = true;
    };
    // `key` captures every query-shaping option.
  }, [runtime, dataset, key, enabled, nonce]);

  // Re-fetch on broker invalidation.
  useEffect(() => {
    const interesting = new Set<string>([dataset, ...(watch ?? [])]);
    return runtime.subscribe(CHANNEL_DATA_INVALIDATED, (message) => {
      const payload = message.payload;
      if (!payload || typeof payload !== 'object') return;
      const list = (payload as { datasets?: readonly string[] }).datasets ?? [];
      if (list.some((name) => interesting.has(name))) setNonce((n) => n + 1);
    });
  }, [runtime, dataset, watch]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo(
    () => ({ ...state, refetch }),
    [state, refetch],
  );
}

/** Typed projection of a dataset: rows are mapped through a guard/mapper. */
export function useMappedDataset<T>(
  dataset: DatasetName,
  map: (row: Readonly<Record<string, unknown>>) => T | null,
  options: DatasetOptions = {},
): { rows: readonly T[]; loading: boolean; error: string | null; refetch: () => void } {
  const state = useDataset(dataset, options);
  const rows = useMemo(() => {
    const out: T[] = [];
    for (const row of state.rows) {
      const mapped = map(row);
      if (mapped !== null) out.push(mapped);
    }
    return out;
    // `map` is expected to be a module-level pure function.
  }, [state.rows, map]);
  return { rows, loading: state.loading, error: state.error, refetch: state.refetch };
}

/** Runs a ledger command with loading state, toasts and dataset invalidation. */
export function useLedgerCommand() {
  const runtime = useApp();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      invocation: SyscallRequest<'data.command'>,
      messages?: { success?: string; failure?: string },
    ): Promise<boolean> => {
      setRunning(true);
      setError(null);
      const result = await runtime.invoke('data.command', invocation);
      setRunning(false);
      if (result.ok) {
        if (messages?.success) await runtime.toast({ kind: 'success', title: messages.success });
        return true;
      }
      setError(result.error.message);
      await runtime.toast({
        kind: result.error.code === 'PERMISSION_DENIED' ? 'warning' : 'error',
        title: messages?.failure ?? result.error.code,
        body: result.error.message,
      });
      return false;
    },
    [runtime],
  );

  return { run, running, error };
}

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

export function useDirectory(path: string | null, showHidden = false) {
  const runtime = useApp();
  const [entries, setEntries] = useState<readonly VfsStat[]>([]);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void runtime.invoke('fs.list', { path, showHidden }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setEntries(result.value);
        setError(null);
      } else {
        setEntries([]);
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, path, showHidden, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { entries, loading, error, reload };
}

export function useTextFile(path: string | null) {
  const runtime = useApp();
  const [content, setContent] = useState('');
  const [stat, setStat] = useState<VfsStat | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (path === null) {
      setContent('');
      setStat(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void runtime.invoke('fs.readText', { path }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setContent(result.value.content);
        setStat(result.value.stat);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, path]);

  const save = useCallback(
    async (target: string, next: string, contentType?: VfsContentType): Promise<boolean> => {
      const result = await runtime.invoke('fs.writeText', { path: target, content: next, contentType });
      if (result.ok) {
        setStat(result.value);
        setContent(next);
        return true;
      }
      setError(result.error.message);
      return false;
    },
    [runtime],
  );

  return { content, setContent, stat, loading, error, save };
}

/* ------------------------------------------------------------------ *
 * Settings (per-app registry island)
 * ------------------------------------------------------------------ */

/**
 * A persisted per-app setting under `HKCU\Software\FinanceOS\AppSettings\<id>`.
 * Reads are synchronous-after-mount; writes go through the registry syscall.
 */
export function useSetting<T extends RegistryValue>(
  name: string,
  fallback: T,
): [T, (next: T) => void] {
  const runtime = useApp();
  const key = `${REG.userAppSettings}\\${runtime.appId}`;
  const [value, setValue] = useState<T>(fallback);
  // The default is a *type probe*, not an input: the read below only accepts a
  // stored value whose type matches it. Pinning it to first render keeps the
  // probe stable even if the caller passes a fresh literal every render, which
  // is also why re-reading on it would be wrong rather than merely wasteful.
  const probe = useRef(fallback);

  useEffect(() => {
    let cancelled = false;
    void runtime.invoke('registry.get', { key, name }).then((result) => {
      if (cancelled || !result.ok) return;
      const stored = result.value.value;
      if (stored !== null && stored !== undefined && typeof stored === typeof probe.current) {
        setValue(stored as T);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, key, name]);

  const write = useCallback(
    (next: T) => {
      setValue(next);
      void runtime.invoke('registry.set', { key, name, value: next });
    },
    [runtime, key, name],
  );

  return [value, write];
}

/* ------------------------------------------------------------------ *
 * IPC, timers, polling
 * ------------------------------------------------------------------ */

export function useIpc(channel: string, handler: (message: IpcMessage) => void): void {
  const runtime = useApp();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => runtime.subscribe(channel, (message) => ref.current(message)), [runtime, channel]);
}

/**
 * Handles palette / jump-list commands addressed to this app. The shell
 * publishes `{ appId, commandId, args }` on the app-command channel.
 *
 * Two arrival paths, both handled here so no app has to know the difference:
 * a *warm* command arrives over IPC, while a command that had to start the app
 * first arrives as the `command` launch argument (the kernel folds it into the
 * args, the way `explorer.exe /select,…` carries its verb). Without the second
 * path a jump-list entry would do nothing whenever the app was not running.
 */
export function useAppCommands(handler: (commandId: string, args: Readonly<Record<string, string>>) => void): void {
  const runtime = useApp();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () =>
      runtime.subscribe(CHANNEL_APP_COMMAND, (message) => {
        const payload = message.payload as
          | { appId?: string; commandId?: string; args?: Readonly<Record<string, string>> }
          | null;
        if (!payload || payload.appId !== runtime.appId || !payload.commandId) return;
        ref.current(payload.commandId, payload.args ?? {});
      }),
    [runtime],
  );

  // Cold-start verb: fires once per process, after the first render has run so
  // the handler sees initialised state.
  const cold = useRef(false);
  useEffect(() => {
    const command = runtime.args.command;
    if (cold.current || command === undefined || command === '') return;
    cold.current = true;
    ref.current(command, runtime.args);
  }, [runtime]);
}

/** Kernel-scheduled interval. Cleared automatically when the process exits. */
export function useKernelInterval(everyMs: number, callback: () => void): void {
  const runtime = useApp();
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (everyMs <= 0) return;
    const id = window.setInterval(() => ref.current(), everyMs);
    void runtime.invoke('eventlog.write', {
      channel: 'Application',
      level: 'verbose',
      eventId: 3001,
      message: `timer armed (${everyMs}ms)`,
    });
    return () => window.clearInterval(id);
  }, [runtime, everyMs]);
}

/** Repeatedly issues a syscall — Task Manager, Event Viewer, tray widgets. */
export function usePolledSyscall<K extends SyscallName>(
  name: K,
  request: SyscallRequest<K>,
  everyMs: number,
): { data: SyscallResponse<K> | null; error: string | null; refresh: () => void } {
  const runtime = useApp();
  const [data, setData] = useState<SyscallResponse<K> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(request);
  const [nonce, setNonce] = useState(0);
  // `key` is the structural identity of the request, and it is what restarts the
  // timer. The ref carries the request object itself so a tick always sends the
  // newest one without a change of object identity counting as a new poll.
  const latest = useRef(request);
  latest.current = request;

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void (runtime.invoke(name, latest.current) as Promise<AbiResult<SyscallResponse<K>>>).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setData(result.value);
          setError(null);
        } else {
          setError(result.error.message);
        }
      });
    };
    run();
    if (everyMs <= 0) return () => {
      cancelled = true;
    };
    const id = window.setInterval(run, everyMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [runtime, name, key, everyMs, nonce]);

  return { data, error, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

/* ------------------------------------------------------------------ *
 * Window chrome
 * ------------------------------------------------------------------ */

/** Keeps the window title in sync with app state (document-title semantics). */
export function useWindowTitle(title: string): void {
  const runtime = useApp();
  useEffect(() => {
    void runtime.setTitle(title);
  }, [runtime, title]);
}

/** Marks the window dirty so closing prompts to save. */
export function useDirtyState(dirty: boolean): void {
  const runtime = useApp();
  useEffect(() => {
    void runtime.setDirty(dirty);
  }, [runtime, dirty]);
}

/** Taskbar badge, e.g. unread approvals. */
export function useWindowBadge(badge: number | null): void {
  const runtime = useApp();
  useEffect(() => {
    void runtime.setBadge(badge);
    return () => {
      void runtime.setBadge(null);
    };
  }, [runtime, badge]);
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

/** Async action with loading/error state and automatic error toasts. */
export function useAsyncAction<TArgs extends readonly unknown[]>(
  action: (...args: TArgs) => Promise<void>,
): { run: (...args: TArgs) => void; running: boolean; error: string | null } {
  const runtime = useApp();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(action);
  ref.current = action;

  const run = useCallback(
    (...args: TArgs) => {
      setRunning(true);
      setError(null);
      void ref
        .current(...args)
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          setError(message);
          void runtime.toast({ kind: 'error', title: message });
        })
        .finally(() => setRunning(false));
    },
    [runtime],
  );

  return { run, running, error };
}

/** Reads the acting principal (roles, capabilities, elevation state). */
export function usePrincipal() {
  const { data } = usePolledSyscall('security.principal', {}, 15_000);
  return data;
}

/** True when the app holds a capability (after elevation, if required). */
export function useCapability(capability: SyscallRequest<'security.check'>['capability']) {
  const { data } = usePolledSyscall('security.check', { capability }, 20_000);
  return {
    granted: data?.granted ?? false,
    elevationRequired: data?.elevationRequired ?? false,
  };
}
