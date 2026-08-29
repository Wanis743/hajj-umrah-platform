/**
 * App host — the seam between a process and the code running inside it.
 *
 * This is the *only* module that constructs an `AppRuntime`. An application
 * receives that object through React context and can reach nothing else: no
 * kernel, no shell state, no Supabase client, no `localStorage`. Every method on
 * it bottoms out in `kernel.syscall(pid, …)`, which means every action an app
 * takes passes the dispatcher's capability, elevation and ownership gates.
 *
 * Two mechanics deserve a note:
 *
 * 1. **The mailbox is attached before the app renders.** `ipc.subscribe` fails
 *    with `INVALID_STATE` if the process has no sink, and React runs child
 *    effects before parent effects — so an app's `useIpc` would race a mailbox
 *    attached in an effect here. The instance therefore attaches on construction
 *    and the effect only re-attaches (which makes StrictMode's double-mount and
 *    a hot reload both safe).
 *
 * 2. **`subscribe` is synchronous, the syscall is not.** Handlers register
 *    locally at once so no message is missed between render and the kernel
 *    acknowledging the subscription; the bus handle is opened in the background
 *    and refcounted per channel.
 */
import { AlertOctagon, RotateCcw } from 'lucide-react';
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type {
  AbiResult,
  AppId,
  AppManifest,
  Handle,
  IpcMessage,
  LaunchArgs,
  MessageBoxSpec,
  NotificationSpec,
  Pid,
  SyscallName,
  SyscallRequest,
  SyscallResponse,
  ToastSpec,
  WindowId,
} from '../kernel/abi';
import type { Kernel } from '../kernel/contracts';
import { AppRuntimeProvider } from '../sdk/context';
import type { AppEntryProps, AppLocale, AppPackage, AppRuntime } from '../sdk/types';
import { Button, Spinner } from '../sdk/ui';
import { useKernel } from './bindings';

/** Shell-side event ids. Deliberately outside the kernel's `EVENT_IDS` block. */
const EVENT_APP_CRASHED = 1002;
const EVENT_APP_HANDLER_FAULT = 1004;

/**
 * Channels the kernel posts straight into the mailbox — a filesystem watch, a
 * registry watch or a timer, each scoped to one handle. There is no bus channel
 * behind them, so subscribing on the bus would open a subscription nobody ever
 * publishes to.
 */
const MAILBOX_PREFIXES: readonly string[] = ['fs/', 'registry/', 'timer/'];

const isMailboxChannel = (channel: string): boolean =>
  MAILBOX_PREFIXES.some((prefix) => channel.startsWith(prefix));

export interface AppInstanceSpec {
  readonly pid: Pid;
  readonly appId: AppId;
  readonly manifest: AppManifest;
  readonly window: WindowId | null;
  readonly args: LaunchArgs;
}

type Handler = (message: IpcMessage) => void;

interface ChannelEntry {
  readonly handlers: Set<Handler>;
  /** Bus handle, once the syscall has returned. */
  handle: Handle | null;
  /** True while `ipc.subscribe` is in flight, so we never open twice. */
  opening: boolean;
}

/** The core runtime, minus the locale the component layer swaps in. */
type CoreRuntime = Omit<AppRuntime, 'locale'>;

/* ------------------------------------------------------------------ *
 * Instance
 * ------------------------------------------------------------------ */

class AppInstance {
  private readonly channels = new Map<string, ChannelEntry>();
  private detach: (() => void) | null = null;
  private core: CoreRuntime | null = null;

  constructor(
    private readonly kernel: Kernel,
    readonly spec: AppInstanceSpec,
  ) {
    this.attach();
  }

  /** Idempotent: re-attaching also re-opens channels lost while detached. */
  attach(): void {
    if (this.detach !== null) return;
    this.detach = this.kernel.attachMailbox(this.spec.pid, (message) => {
      this.deliver(message);
    });
    for (const [channel, entry] of this.channels) {
      if (entry.handle === null && !entry.opening) void this.open(channel, entry);
    }
  }

  /**
   * Detaches the mailbox and drops bus handles, keeping the handler registry so
   * a re-mount resumes where it left off. Handles the process still owns are
   * reclaimed by the handle table when it is terminated.
   */
  release(): void {
    this.detach?.();
    this.detach = null;
    for (const entry of this.channels.values()) this.closeHandle(entry);
  }

  /**
   * The runtime object handed to the app. The core is built once per process, so
   * a language change produces a new identity (re-running app effects that
   * depend on the locale) while sharing all subscription machinery.
   */
  runtime(locale: AppLocale): AppRuntime {
    this.core ??= this.buildCore();
    return { ...this.core, locale };
  }

  private buildCore(): CoreRuntime {
    const { pid, appId, manifest, window, args } = this.spec;
    return {
      pid,
      appId,
      manifest,
      window,
      args,
      invoke: (name, request) => this.invoke(name, request),
      subscribe: (channel, handler) => this.subscribe(channel, handler),
      publish: (channel, payload) => this.publish(channel, payload),
      toast: (spec) => this.toast(spec),
      notify: (spec) => this.notify(spec),
      confirm: (spec) => this.confirm(spec),
      setTitle: (title) => this.windowCall('window.setTitle', { title }),
      setDirty: (dirty) => this.windowCall('window.setDirty', { dirty }),
      setBadge: (badge) => this.windowCall('window.setBadge', { badge }),
      setProgress: (progress) => this.windowCall('window.setProgress', { progress }),
      close: () => this.windowCall('window.close', {}),
      launch: (target, launchArgs) => this.launch(target, launchArgs),
      openPath: (path) => this.openPath(path),
    };
  }

  /* ---------------- syscalls ---------------- */

  private invoke<K extends SyscallName>(
    name: K,
    request: SyscallRequest<K>,
  ): Promise<AbiResult<SyscallResponse<K>>> {
    return this.kernel.syscall(this.spec.pid, name, request);
  }

  /**
   * Window syscalls all take the window id, which the app never sees. A headless
   * instance resolves immediately instead of failing — an app should not have to
   * branch on whether it happens to own a window.
   */
  private async windowCall<K extends 'window.setTitle' | 'window.setDirty' | 'window.setBadge' | 'window.setProgress' | 'window.close'>(
    name: K,
    extra: Omit<SyscallRequest<K>, 'window'>,
  ): Promise<void> {
    const target = this.spec.window;
    if (target === null) return;
    await this.invoke(name, { ...extra, window: target } as SyscallRequest<K>);
  }

  private async publish(channel: string, payload: unknown): Promise<number> {
    const result = await this.invoke('ipc.publish', { channel, payload });
    return result.ok ? result.value.delivered : 0;
  }

  private async toast(spec: ToastSpec): Promise<void> {
    await this.invoke('shell.toast', spec);
  }

  private async notify(spec: NotificationSpec): Promise<void> {
    await this.invoke('shell.notify', spec);
  }

  private async confirm(spec: MessageBoxSpec): Promise<boolean> {
    const result = await this.invoke('shell.messageBox', spec);
    return result.ok && result.value.confirmed;
  }

  private async launch(appId: AppId, args?: LaunchArgs): Promise<void> {
    await this.invoke('shell.launch', { appId, args });
  }

  private async openPath(path: string): Promise<void> {
    await this.invoke('shell.openPath', { path });
  }

  /* ---------------- IPC ---------------- */

  private subscribe(channel: string, handler: Handler): () => void {
    let entry = this.channels.get(channel);
    if (entry === undefined) {
      entry = { handlers: new Set<Handler>(), handle: null, opening: false };
      this.channels.set(channel, entry);
    }
    const current = entry;
    current.handlers.add(handler);
    if (current.handle === null && !current.opening && this.detach !== null && !isMailboxChannel(channel)) {
      void this.open(channel, current);
    }

    return () => {
      current.handlers.delete(handler);
      if (current.handlers.size > 0) return;
      if (this.channels.get(channel) === current) this.channels.delete(channel);
      this.closeHandle(current);
    };
  }

  private async open(channel: string, entry: ChannelEntry): Promise<void> {
    entry.opening = true;
    const result = await this.invoke('ipc.subscribe', { channel });
    entry.opening = false;
    // A denial is not fatal: the app keeps receiving whatever the kernel posts
    // directly, and the dispatcher has already logged the reason.
    if (!result.ok) return;
    // The last handler may have unsubscribed while the syscall was in flight.
    if (entry.handlers.size === 0 || this.channels.get(channel) !== entry) {
      void this.invoke('ipc.unsubscribe', { handle: result.value.handle });
      return;
    }
    entry.handle = result.value.handle;
  }

  private closeHandle(entry: ChannelEntry): void {
    const { handle } = entry;
    if (handle === null) return;
    entry.handle = null;
    void this.invoke('ipc.unsubscribe', { handle });
  }

  private deliver(message: IpcMessage): void {
    const entry = this.channels.get(message.channel);
    if (entry === undefined) return;
    for (const handler of [...entry.handlers]) {
      try {
        handler(message);
      } catch (error) {
        // One bad handler must not stop delivery to the others, and must not
        // escape into kernel code that is mid-syscall.
        this.kernel.eventLog.write(
          'Application',
          'error',
          EVENT_APP_HANDLER_FAULT,
          'AppHost',
          `Message handler faulted on ${message.channel}`,
          { appId: this.spec.appId as string, error: describe(error) },
          this.spec.pid,
        );
      }
    }
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

/**
 * Creates (and owns) the instance backing one window. Constructed during render
 * so the mailbox exists before any child effect can subscribe; released on
 * unmount, at which point the kernel has either already terminated the process
 * or is about to.
 */
function useAppInstance(spec: AppInstanceSpec): AppInstance {
  const kernel = useKernel();
  const [instance] = useState(() => new AppInstance(kernel, spec));
  useEffect(() => {
    instance.attach();
    return () => {
      instance.release();
    };
  }, [instance]);
  return instance;
}

/** The runtime for this instance, re-identified when the locale changes. */
function useAppRuntime(instance: AppInstance, locale: AppLocale): AppRuntime {
  return useMemo(() => instance.runtime(locale), [instance, locale]);
}

/* ------------------------------------------------------------------ *
 * Lazy entry resolution
 * ------------------------------------------------------------------ */

const entries = new Map<string, ComponentType<AppEntryProps>>();

/**
 * One lazy component per app id, cached for the session — a second window of the
 * same app reuses the already-downloaded chunk instead of suspending again.
 */
function entryFor(pkg: AppPackage): ComponentType<AppEntryProps> {
  const id = pkg.manifest.id as string;
  const cached = entries.get(id);
  if (cached !== undefined) return cached;
  const Entry = lazy(pkg.load) as ComponentType<AppEntryProps>;
  entries.set(id, Entry);
  return Entry;
}

/* ------------------------------------------------------------------ *
 * Crash containment
 * ------------------------------------------------------------------ */

interface BoundaryProps {
  readonly children: ReactNode;
  /** Bumped by the parent to force a remount after a crash. */
  readonly generation: number;
  readonly onCrash: (error: Error, info: ErrorInfo) => void;
  readonly fallback: (error: Error, retry: () => void) => ReactNode;
}

interface BoundaryState {
  readonly error: Error | null;
  readonly generation: number;
}

/**
 * A crashing app takes down its own window and nothing else. Without this a
 * single bad render would unmount the whole desktop — the one failure mode a
 * shell may never have.
 */
class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, generation: this.props.generation };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    // A new generation means the user asked for a restart; clear the error.
    return props.generation === state.generation ? null : { error: null, generation: props.generation };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onCrash(error, info);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error !== null) return this.props.fallback(error, this.retry);
    return this.props.children;
  }
}

export interface CrashPaneProps {
  readonly title: string;
  readonly detail: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}

/** The in-window "this app stopped working" pane, styled like a Fluent dialog. */
export function CrashPane({ title, detail, retryLabel, onRetry }: CrashPaneProps) {
  return (
    <div className="fx-crash">
      <AlertOctagon size={40} strokeWidth={1.6} className="fx-crash-glyph" />
      <p className="fx-title-text">{title}</p>
      <p className="fx-crash-detail fx-mono">{detail}</p>
      <Button icon={RotateCcw} variant="accent" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Surface
 * ------------------------------------------------------------------ */

export interface AppSurfaceProps {
  readonly pkg: AppPackage | null;
  readonly spec: AppInstanceSpec;
  readonly locale: AppLocale;
}

/**
 * Renders one application inside its window: instance, runtime, provider,
 * suspense while the chunk downloads, and a crash boundary around all of it.
 */
export function AppSurface({ pkg, spec, locale }: AppSurfaceProps) {
  const kernel = useKernel();
  const instance = useAppInstance(spec);
  const runtime = useAppRuntime(instance, locale);
  const [generation, setGeneration] = useState(0);

  if (pkg === null) {
    return (
      <CrashPane
        title={locale.tr('التطبيق غير مثبت', 'Application introuvable', 'Application not installed')}
        detail={spec.appId as string}
        retryLabel={locale.tr('إغلاق', 'Fermer', 'Close')}
        onRetry={() => {
          void runtime.close();
        }}
      />
    );
  }

  const Entry = entryFor(pkg);
  const name = locale.t(pkg.manifest.name);

  return (
    <AppErrorBoundary
      generation={generation}
      onCrash={(error, info) => {
        kernel.eventLog.write(
          'Application',
          'error',
          EVENT_APP_CRASHED,
          'AppHost',
          `${pkg.manifest.name.en} stopped working`,
          {
            appId: spec.appId as string,
            error: error.message,
            component: info.componentStack?.split('\n')[1]?.trim() ?? null,
          },
          spec.pid,
        );
      }}
      fallback={(error, retry) => (
        <CrashPane
          title={locale.tr(`توقف ${name} عن العمل`, `${name} ne répond plus`, `${name} stopped working`)}
          detail={error.message}
          retryLabel={locale.tr('إعادة التشغيل', 'Redémarrer', 'Restart')}
          onRetry={() => {
            // Both are needed: the boundary clears its error, and the new
            // generation remounts the entry so its state starts clean.
            retry();
            setGeneration((value) => value + 1);
          }}
        />
      )}
    >
      <AppRuntimeProvider runtime={runtime}>
        <Suspense fallback={<AppLoading label={name} />}>
          <div key={generation} className="fx-app-root">
            <Entry runtime={runtime} />
          </div>
        </Suspense>
      </AppRuntimeProvider>
    </AppErrorBoundary>
  );
}

function AppLoading({ label }: { label: string }) {
  return (
    <div className="fx-app-loading">
      <Spinner size={22} />
      <span className="fx-caption-text">{label}</span>
    </div>
  );
}
