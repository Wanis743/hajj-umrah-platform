/**
 * Kernel assembly.
 *
 * This is the only place where the subsystems are wired to each other. Read the
 * constructor top to bottom and you have the whole dependency graph: nothing
 * under `core/` reaches sideways for a collaborator, everything is handed one.
 *
 * Boot order matters and is deliberate:
 *
 *   clock → event log → handles → bus → security → scheduler → process table
 *     → the System process (the pid kernel-attributed work is charged to)
 *     → registry → VFS + volumes → window manager → data broker → metrics
 *     → notifications → app registry → service host → syscall dispatcher
 *
 * `boot()` then mounts volumes, seeds first-run registry defaults, registers the
 * shipped services, starts the scheduler and brings up automatic services.
 * `shutdown()` reverses it, flushing every persisted store on the way out.
 *
 * The kernel never imports React or any product module other than the data
 * broker's Supabase gateway. The shell is injected through `attachShell`; that
 * inversion is what keeps this file testable and what stops an application from
 * ever reaching a kernel object.
 */
import {
  APP_IDS,
  CAPABILITIES,
  IPC_CHANNELS,
  REG,
  SYSTEM_APP_ID,
  fail,
  succeed,
  type AbiResult,
  type AppId,
  type Handle,
  type IpcMessage,
  type LaunchArgs,
  type Localized,
  type Pid,
  type SyscallName,
  type SyscallRequest,
  type SyscallResponse,
  type WindowId,
} from './abi';
import type {
  AppRegistrySubsystem,
  BusSubsystem,
  DataBrokerSubsystem,
  EventLogSubsystem,
  HandleTable,
  Kernel,
  KernelBootOptions,
  KernelClock,
  ProcessSubsystem,
  RegistrySubsystem,
  SchedulerSubsystem,
  SecuritySubsystem,
  ShellHost,
  WmSubsystem,
} from './contracts';
import { createAppRegistry } from './core/appregistry';
import { createBroker } from './core/broker';
import { createBus } from './core/bus';
import { createClock } from './core/clock';
import { EVENT_IDS, createEventLog } from './core/eventlog';
import { createHandleTable } from './core/handles';
import { createMetrics, type MetricsHandle } from './core/metrics';
import { createNotifications, type NotificationsHandle } from './core/notifications';
import { extname, join } from './core/paths';
import { createStorage, type KernelStorage } from './core/persist';
import { createProcesses } from './core/process';
import { createRegistry } from './core/registry';
import { createScheduler } from './core/scheduler';
import { createSecurity, intersectCapabilities } from './core/security';
import { createServices, type ServiceHostHandle } from './core/services';
import { createDispatcher, type DispatcherHandle } from './core/syscalls';
import { createSystemServices } from './core/systemservices';
import { createVfs, type VfsHandle } from './core/vfs';
import { createMemoryVolume, createPersistentVolume, createProjectionVolume, type ProjectionVolumeHandle } from './core/volumes';
import { createWm } from './core/wm';

/** The user profile root. One user per session, as on a workstation. */
const USER_FOLDER = 'C:\\Users\\finance';

/** Volume quotas: small enough to respect browser storage, large enough to work. */
const QUOTA_LOCAL = 64 * 1024 * 1024;
const QUOTA_SCRATCH = 16 * 1024 * 1024;
const QUOTA_LEDGER = 32 * 1024 * 1024;

/** How often resource accounting is sampled. Task Manager reads the result. */
const METRICS_INTERVAL_MS = 1_000;

const SYSTEM_PROCESS_NAME: Localized = { ar: 'النظام', fr: 'Système', en: 'System' };

const VOLUME_LABELS: Readonly<Record<'C' | 'X' | 'L', Localized>> = {
  C: { ar: 'القرص المحلي', fr: 'Disque local', en: 'Local Disk' },
  X: { ar: 'وحدة مؤقتة', fr: 'Volume temporaire', en: 'Scratch' },
  L: { ar: 'دفتر الأستاذ', fr: 'Grand livre', en: 'Ledger' },
};

/**
 * The revision of the shipped default set, bumped whenever a default below
 * changes. It is what makes a changed default reach a profile that already
 * exists: the seed pass only writes absent values, so without this a returning
 * user would keep the *old* image's default forever and never see the new one.
 */
const DEFAULTS_REVISION = 2;

/** A default value, and the earlier defaults it retires. */
type DefaultValue = string | number | boolean;
type RegistryDefault = readonly [key: string, name: string, value: DefaultValue, supersedes?: readonly DefaultValue[]];

/**
 * First-run defaults, written only when a value is absent — a returning user
 * keeps their preferences and a wiped profile comes back to a sane desktop.
 *
 * The fourth element, where present, lists values an *earlier* image shipped as
 * this default. On a revision bump a stored value still equal to one of them is
 * a default nobody chose, so it moves forward; anything else is a deliberate
 * setting and is left exactly as the user left it. That distinction is the whole
 * point — a new default must not be an excuse to overwrite a preference.
 */
const REGISTRY_DEFAULTS: readonly RegistryDefault[] = [
  [REG.userAppearance, 'Theme', 'dark'],
  [REG.userAppearance, 'Accent', '#0067c0'],
  [REG.userAppearance, 'Transparency', true],
  [REG.userAppearance, 'Animations', true],
  [REG.userAppearance, 'Language', 'en'],
  // Revision 2 replaced the Bloom gradient with the Summit photograph.
  [REG.userDesktop, 'Wallpaper', 'summit', ['fluent-bloom']],
  [REG.userDesktop, 'IconSize', 'medium'],
  [REG.userDesktop, 'ShowIcons', true],
  [REG.userTaskbar, 'Alignment', 'center'],
  [REG.userTaskbar, 'AutoHide', false],
  [REG.userTaskbar, 'ShowSearch', true],
  [REG.userTaskbar, 'ShowTaskView', true],
  [REG.userTaskbar, 'ShowWidgets', true],
  [REG.userStart, 'Layout', 'pinned'],
  [REG.userStart, 'ShowRecommended', true],
  [REG.userSession, 'ConfirmSignOut', true],
  [REG.userSession, 'LockOnIdleMinutes', 0],
  [REG.machinePolicy, 'MachineName', 'FINANCE-OS'],
  [REG.machinePolicy, 'ProductName', 'FinanceOS 11 Enterprise'],
  [REG.machinePolicy, 'Build', '11.0.26100'],
];

class KernelImpl implements Kernel {
  readonly clock: KernelClock;
  readonly eventLog: EventLogSubsystem;
  readonly handles: HandleTable;
  readonly bus: BusSubsystem;
  readonly security: SecuritySubsystem;
  readonly scheduler: SchedulerSubsystem;
  readonly processes: ProcessSubsystem;
  readonly registry: RegistrySubsystem;
  readonly vfs: VfsHandle;
  readonly wm: WmSubsystem;
  readonly notifications: NotificationsHandle;
  readonly apps: AppRegistrySubsystem;
  readonly data: DataBrokerSubsystem;
  readonly metrics: MetricsHandle;
  readonly services: ServiceHostHandle;

  private readonly storage: KernelStorage;
  /** Kernel-attributed work (ticks, projections, broker fan-out) runs as this. */
  private readonly systemPid: Pid;
  /** The ledger projection, republished by the indexer service. */
  private readonly ledgerVolume: ProjectionVolumeHandle;
  private readonly dispatcher: DispatcherHandle;

  private shell: ShellHost | null = null;
  private metricsTick: Handle | null = null;
  private up = false;
  /** Guards the windowless-process reaper against its own side effects. */
  private reaping = false;

  constructor(private readonly options: KernelBootOptions) {
    this.clock = createClock();
    this.eventLog = createEventLog(this.clock);
    this.handles = createHandleTable(this.clock);
    this.bus = createBus(this.clock, this.handles, this.eventLog);
    this.security = createSecurity(this.clock, this.eventLog);
    // The scheduler resolves the System pid lazily: the process table it will be
    // created from does not exist yet.
    this.scheduler = createScheduler(this.clock, this.eventLog, this.handles, () => this.systemPid);
    this.processes = createProcesses(
      this.clock,
      this.eventLog,
      this.handles,
      this.bus,
      this.scheduler,
      () => this.security.principal().sid,
    );
    this.systemPid = this.processes.spawn({
      appId: SYSTEM_APP_ID,
      name: SYSTEM_PROCESS_NAME,
      kind: 'system',
      capabilities: [...CAPABILITIES],
      priority: 'realtime',
    }).pid;
    this.processes.grantElevation(this.systemPid);

    this.storage = createStorage(options.ephemeral === true);
    this.registry = createRegistry(this.clock, this.storage, options.namespace, this.eventLog);
    this.vfs = createVfs(this.eventLog);
    this.ledgerVolume = createProjectionVolume('L', VOLUME_LABELS.L, QUOTA_LEDGER, this.clock);
    this.wm = createWm(this.eventLog);
    this.data = createBroker(this.clock, this.eventLog, this.bus, this.processes, this.security, this.systemPid);
    this.metrics = createMetrics(
      this.clock,
      this.processes,
      this.scheduler,
      this.handles,
      this.bus,
      this.wm,
      () => this.data,
    );
    this.notifications = createNotifications(this.clock, this.storage, options.namespace);
    this.apps = createAppRegistry(this.clock, this.registry, this.eventLog);
    this.services = createServices({
      clock: this.clock,
      log: this.eventLog,
      registry: this.registry,
      vfs: this.vfs,
      bus: this.bus,
      processes: this.processes,
      scheduler: this.scheduler,
      // Resolved lazily: the dispatcher is assembled after the service host.
      syscall: () => (caller, name, request) => this.dispatcher.syscall(caller, name, request),
    });
    this.dispatcher = createDispatcher({
      clock: this.clock,
      eventLog: this.eventLog,
      bus: this.bus,
      scheduler: this.scheduler,
      handles: this.handles,
      processes: this.processes,
      security: this.security,
      vfs: this.vfs,
      registry: this.registry,
      services: this.services,
      metrics: this.metrics,
      wm: this.wm,
      data: this.data,
      notifications: this.notifications,
      apps: this.apps,
      host: () => this.shell,
      launch: (id, args) => this.launch(id, args),
      openPath: (path) => this.openPath(path),
    });

    // A terminated process must not leave orphaned windows behind.
    this.processes.onTerminate((record) => {
      this.wm.closeForProcess(record.pid);
    });

    // The inventory is shared state — a pin or a removal in Start changes it,
    // Start, the taskbar and Settings draw it. The registry's own listeners are
    // shell-side; this bridge is what lets an *app* see an install, a removal or
    // a pin without polling for it.
    this.apps.subscribe(() => {
      this.bus.publish(this.systemPid, IPC_CHANNELS.appsChanged, {});
    });

    // …and the converse: an application exits when its last window closes. The
    // WM owns window lifetime, so the kernel watches it rather than leaving a
    // headless application running that the user has no way to reach again.
    this.wm.subscribe(() => {
      this.reapWindowless();
    });
  }

  attachShell(host: ShellHost): void {
    this.shell = host;
  }

  attachMailbox(pid: Pid, deliver: (message: IpcMessage) => void): () => void {
    return this.dispatcher.attachMailbox(pid, deliver);
  }

  booted(): boolean {
    return this.up;
  }

  syscall<K extends SyscallName>(
    caller: Pid,
    name: K,
    request: SyscallRequest<K>,
  ): Promise<AbiResult<SyscallResponse<K>>> {
    return this.dispatcher.syscall(caller, name, request);
  }

  /* ---------------- lifecycle ---------------- */

  async boot(): Promise<void> {
    if (this.up) return;
    const startedAt = this.clock.monotonic();
    this.eventLog.write('Setup', 'information', EVENT_IDS.bootStarted, 'Kernel', 'Boot started', {
      namespace: this.options.namespace,
      durable: this.storage.durable,
    });

    this.mountVolumes();
    this.seedRegistry();

    for (const definition of createSystemServices({ ledgerVolume: this.ledgerVolume, userFolder: USER_FOLDER })) {
      this.services.register(definition);
    }

    this.metricsTick = this.scheduler.addTickHandler('metrics', METRICS_INTERVAL_MS, () => {
      this.metrics.sample();
    });
    this.scheduler.start();

    await this.services.startAutomatic();

    this.up = true;
    this.eventLog.write('Setup', 'information', EVENT_IDS.bootCompleted, 'Kernel', 'Boot completed', {
      ms: Math.round(this.clock.monotonic() - startedAt),
      volumes: this.vfs.volumes().length,
      services: this.services.list().length,
    });
  }

  async shutdown(): Promise<void> {
    if (!this.up) return;
    this.up = false;
    this.eventLog.write('Setup', 'information', EVENT_IDS.shutdownStarted, 'Kernel', 'Shutdown started');

    this.services.stopAll();

    // Applications go before the scheduler stops, so their terminate hooks and
    // handle disposal still run on a live kernel.
    for (const record of this.processes.list()) {
      if (record.kind === 'system') continue;
      this.processes.terminate(record.pid, true);
    }

    if (this.metricsTick !== null) {
      this.scheduler.removeTickHandler(this.metricsTick);
      this.metricsTick = null;
    }
    this.scheduler.stop();

    this.registry.flush();
    this.notifications.flush();
    this.vfs.unmountAll();

    this.eventLog.write('Setup', 'information', EVENT_IDS.shutdownCompleted, 'Kernel', 'Shutdown completed');
    await Promise.resolve();
  }

  /* ---------------- launching ---------------- */

  async launch(id: AppId, args?: LaunchArgs): Promise<AbiResult<{ pid: Pid; window: WindowId | null }>> {
    const installed = this.apps.get(id);
    if (installed === null) return fail('NOT_FOUND', `No such application: ${id as string}`);
    if (!installed.enabled) {
      return fail('PERMISSION_DENIED', `${installed.manifest.name.en} has been blocked by policy`);
    }
    const { manifest } = installed;

    if (manifest.singleInstance) {
      const running = this.processes.findByApp(id);
      if (running !== null) return succeed(this.activate(running.pid, args));
    }

    const capabilities = intersectCapabilities(manifest.capabilities, this.security.grantable());
    const record = this.processes.spawn({
      appId: id,
      name: manifest.name,
      kind: 'application',
      capabilities,
      args,
      priority: 'normal',
    });

    const window = this.wm.create({
      pid: record.pid,
      appId: id,
      title: manifest.name.en,
      defaultSize: manifest.defaultSize,
      minSize: manifest.minSize,
      resizable: manifest.resizable,
    });
    this.processes.attachWindow(record.pid, window.id);
    this.wm.focus(window.id);
    this.apps.noteLaunch(id);

    this.eventLog.write(
      'Application',
      'information',
      EVENT_IDS.appLaunched,
      'Kernel',
      `Launched ${manifest.name.en}`,
      { appId: id as string, granted: capabilities.length, requested: manifest.capabilities.length },
      record.pid,
    );
    return succeed({ pid: record.pid, window: window.id });
  }

  async openPath(path: string): Promise<AbiResult<{ pid: Pid | null }>> {
    const stat = this.vfs.stat(path);
    if (!stat.ok) return stat;

    // No file manager ships in this image, so a folder opens at a prompt in that
    // folder; files go to whoever claims their content type.
    const target =
      stat.value.kind === 'directory'
        ? APP_IDS.terminal
        : this.apps.handlerFor(stat.value.contentType, extname(path));
    if (target === null) {
      return fail('NOT_SUPPORTED', `No installed application opens ${extname(path) || 'this file'}`, { path });
    }

    const launched = await this.launch(target, { path });
    return launched.ok ? succeed({ pid: launched.value.pid }) : launched;
  }

  async sendCommand(id: AppId, commandId: string, args?: LaunchArgs): Promise<AbiResult<{ pid: Pid | null }>> {
    const installed = this.apps.get(id);
    if (installed === null) return fail('NOT_FOUND', `No such application: ${id as string}`);

    const running = this.processes.findByApp(id);
    if (running === null) {
      // Cold: the command travels as a launch argument, which the app reads once
      // at start-up. Same contract as `explorer.exe /select,…`.
      const launched = await this.launch(id, { ...args, command: commandId });
      return launched.ok ? succeed({ pid: launched.value.pid }) : launched;
    }

    this.bus.publish(this.systemPid, IPC_CHANNELS.appCommand, { appId: id, commandId, args: args ?? {} });
    const window = running.windows[0];
    if (window !== undefined) {
      this.wm.restore(window);
      this.wm.focus(window);
    }
    return succeed({ pid: running.pid });
  }

  /* ---------------- internals ---------------- */

  /**
   * Brings a running single-instance app forward and hands it the new launch
   * arguments, so "open this file" reuses the window instead of spawning a
   * second copy — the behaviour every real shell has.
   */
  private activate(target: Pid, args?: LaunchArgs): { pid: Pid; window: WindowId | null } {
    const window = this.processes.get(target)?.windows[0] ?? null;
    if (window !== null) {
      this.wm.restore(window);
      this.wm.focus(window);
    }
    if (args !== undefined && Object.keys(args).length > 0) {
      this.dispatcher.post(target, IPC_CHANNELS.activate, { args });
    }
    return { pid: target, window };
  }

  /**
   * Terminates application processes whose windows have all been closed.
   * Re-entrant by construction — terminating a process closes its windows,
   * which notifies the WM again — so the pass guards itself.
   */
  private reapWindowless(): void {
    if (this.reaping) return;
    this.reaping = true;
    try {
      for (const record of this.processes.list()) {
        // A process that never had a window is a deliberate headless launch.
        if (record.kind !== 'application' || record.windows.length === 0) continue;
        if (record.windows.some((id) => this.wm.get(id) !== null)) continue;
        this.processes.terminate(record.pid, false);
      }
    } finally {
      this.reaping = false;
    }
  }

  private mountVolumes(): void {
    this.vfs.mount(
      createPersistentVolume('C', VOLUME_LABELS.C, QUOTA_LOCAL, this.clock, this.storage, this.options.namespace),
    );
    this.vfs.mount(createMemoryVolume('X', VOLUME_LABELS.X, QUOTA_SCRATCH, this.clock));
    this.vfs.mount(this.ledgerVolume);

    this.vfs.ensureUserProfile(USER_FOLDER);
    this.vfs.mkdir(join(USER_FOLDER, 'Documents', 'Backups'), true);
    this.vfs.mkdir('C:\\Windows\\System32', true);
    this.vfs.mkdir('X:\\Windows\\Temp', true);
  }

  private seedRegistry(): void {
    // A profile written by an older image is behind on defaults; one written by
    // this image is not, and its values are all the user's own from here on.
    const behind = this.registry.getNumber(REG.userSession, 'DefaultsRevision', 0) < DEFAULTS_REVISION;

    for (const [key, name, value, supersedes] of REGISTRY_DEFAULTS) {
      const stored = this.registry.get(key, name);
      if (stored === undefined) {
        this.registry.set(key, name, value);
        continue;
      }
      // Only a value still sitting on a default this image retired: a setting the
      // user actually chose is never touched, on any revision.
      if (behind && supersedes?.some((retired) => retired === stored) === true) {
        this.registry.set(key, name, value);
      }
    }
    if (behind) this.registry.set(REG.userSession, 'DefaultsRevision', DEFAULTS_REVISION);

    // Always refreshed: these describe *this* boot, not a stored preference.
    this.registry.set(REG.userSession, 'LastBootAt', this.clock.iso());
    this.registry.set(REG.machinePolicy, 'StorageDurable', this.storage.durable);
  }
}

/**
 * Builds a kernel. Nothing starts until `boot()` is awaited, so a caller can
 * install app manifests and set the principal against a quiet kernel first.
 */
export function createKernel(options: KernelBootOptions): Kernel {
  return new KernelImpl(options);
}

/** The profile root, exported so the shell can label "This PC" consistently. */
export const KERNEL_USER_FOLDER = USER_FOLDER;
