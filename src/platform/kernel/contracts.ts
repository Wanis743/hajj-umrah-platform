/**
 * Kernel internals — subsystem contracts.
 *
 * Kernel-private: applications must never import this module (the boundary
 * gate enforces it). Each subsystem is implemented under `core/` against the
 * interface declared here, so subsystems compose without knowing each other's
 * implementation. Nothing in this file may import React or DOM-only APIs.
 */
import type { IsoTimestamp } from './types';
import type {
  AbiResult,
  AppId,
  AppInventoryRecord,
  AppManifest,
  Capability,
  CommandInvocation,
  CommandOutcome,
  DatasetName,
  DatasetPage,
  DatasetQuery,
  DesktopId,
  DocumentUploadRequest,
  DocumentUploadResult,
  DocumentUrlRequest,
  DocumentUrlResult,
  EventChannel,
  EventLevel,
  EventQuery,
  EventRecord,
  FileDialogSpec,
  FormFactor,
  Handle,
  IpcMessage,
  LaunchArgs,
  Localized,
  MessageBoxSpec,
  NotificationRecord,
  NotificationSpec,
  Pid,
  PowerAction,
  PrincipalInfo,
  ProcessInfo,
  ProcessKind,
  ProcessMetrics,
  ProcessPriority,
  RegistryEntry,
  RegistryValue,
  ServiceInfo,
  ServiceStartType,
  SnapZone,
  SyscallName,
  SyscallRequest,
  SyscallResponse,
  SystemMetrics,
  ToastSpec,
  VfsChange,
  VfsContentType,
  VfsStat,
  VfsVolumeInfo,
  WindowId,
  WindowInfo,
  WindowRect,
  WindowStateName,
} from './abi';

/* ------------------------------------------------------------------ *
 * Reactive primitive
 * ------------------------------------------------------------------ */

/**
 * Minimal observable used to bridge kernel state into React through
 * `useSyncExternalStore`. Snapshots are immutable; subscribers are notified
 * after a batched microtask so a burst of kernel mutations paints once.
 */
export interface KernelStore<T> {
  get(): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  subscribe(listener: () => void): () => void;
  /** Monotonic revision, useful for cheap equality checks and diagnostics. */
  readonly revision: number;
}

/* ------------------------------------------------------------------ *
 * Clock
 * ------------------------------------------------------------------ */

export interface KernelClock {
  /** Wall-clock epoch milliseconds. */
  now(): number;
  /** Monotonic high-resolution milliseconds since boot. */
  monotonic(): number;
  iso(): IsoTimestamp;
  /** Milliseconds since the kernel booted. */
  uptimeMs(): number;
}

/* ------------------------------------------------------------------ *
 * Logging (kernel-internal, routed to the event log)
 * ------------------------------------------------------------------ */

export interface KernelLogger {
  write(
    channel: EventChannel,
    level: EventLevel,
    eventId: number,
    source: string,
    message: string,
    data?: Readonly<Record<string, string | number | boolean | null>>,
    pid?: Pid | null,
  ): void;
}

/* ------------------------------------------------------------------ *
 * Event log
 * ------------------------------------------------------------------ */

export interface EventLogSubsystem extends KernelLogger {
  query(query: EventQuery): readonly EventRecord[];
  clear(channel: EventChannel): number;
  subscribe(listener: () => void): () => void;
  /** Total records currently retained across all channels. */
  size(): number;
}

/* ------------------------------------------------------------------ *
 * IPC bus
 * ------------------------------------------------------------------ */

export interface BusSubsystem {
  /** Returns the number of subscribers the message reached. */
  publish(from: Pid, channel: string, payload: unknown): number;
  subscribe(pid: Pid, channel: string, deliver: (message: IpcMessage) => void): Handle;
  unsubscribe(handle: Handle): boolean;
  /** Drops every subscription owned by a process (called on terminate). */
  dropProcess(pid: Pid): number;
  /** Channels with at least one live subscriber. */
  channels(): readonly string[];
  /** Messages delivered since boot — feeds the metrics collector. */
  deliveredCount(): number;
}

/* ------------------------------------------------------------------ *
 * Scheduler
 * ------------------------------------------------------------------ */

export type SchedulerWork = () => void;

export interface SchedulerTickContext {
  readonly tick: number;
  readonly deltaMs: number;
  readonly monotonic: number;
}

export interface SchedulerSubsystem {
  start(): void;
  stop(): void;
  running(): boolean;
  /** Queue a deferred procedure call attributed to `pid`. */
  queue(pid: Pid | null, priority: ProcessPriority, work: SchedulerWork): void;
  /** Register a repeating tick handler (services, samplers). */
  addTickHandler(name: string, everyMs: number, handler: (ctx: SchedulerTickContext) => void): Handle;
  removeTickHandler(handle: Handle): boolean;
  /** Per-process scheduler time consumed, in milliseconds. */
  cpuTimeFor(pid: Pid): number;
  /** Longest handler execution attributed to `pid` in the current window. */
  peakFrameFor(pid: Pid): number;
  /** Ticks executed per second over the last window. */
  tickRate(): number;
  /** Clears accounting for a terminated process. */
  dropProcess(pid: Pid): void;
  /** Resets the rolling window; the metrics collector calls this each sample. */
  rollWindow(): void;
}

/* ------------------------------------------------------------------ *
 * Handle table
 * ------------------------------------------------------------------ */

export type HandleKind = 'file' | 'fsWatch' | 'registryWatch' | 'subscription' | 'timer';

export interface HandleRecord {
  readonly handle: Handle;
  readonly pid: Pid;
  readonly kind: HandleKind;
  readonly target: string;
  readonly openedAt: IsoTimestamp;
  /** Called when the handle is closed or its owner terminates. */
  readonly dispose: () => void;
}

export interface HandleTable {
  open(pid: Pid, kind: HandleKind, target: string, dispose: () => void): Handle;
  close(handle: Handle): boolean;
  get(handle: Handle): HandleRecord | null;
  /** Closes every handle owned by a process. Returns how many were closed. */
  closeAll(pid: Pid): number;
  countFor(pid: Pid): number;
  total(): number;
  list(): readonly HandleRecord[];
}

/* ------------------------------------------------------------------ *
 * Process table
 * ------------------------------------------------------------------ */

export interface SpawnRequest {
  readonly appId: AppId;
  readonly name: Localized;
  readonly kind: ProcessKind;
  readonly capabilities: readonly Capability[];
  readonly parent?: Pid | null;
  readonly priority?: ProcessPriority;
  readonly args?: LaunchArgs;
}

export interface ProcessRecord extends ProcessInfo {
  readonly args: LaunchArgs;
  /** Counters maintained by the syscall dispatcher and data broker. */
  readonly counters: {
    syscalls: number;
    messages: number;
    ioBytes: number;
    stateBytes: number;
  };
}

export interface ProcessSubsystem {
  spawn(request: SpawnRequest): ProcessRecord;
  terminate(pid: Pid, force: boolean): AbiResult<true>;
  get(pid: Pid): ProcessRecord | null;
  list(): readonly ProcessRecord[];
  /** First live process for an app, used to honour `singleInstance`. */
  findByApp(appId: AppId): ProcessRecord | null;
  setPriority(pid: Pid, priority: ProcessPriority): AbiResult<ProcessInfo>;
  suspend(pid: Pid): AbiResult<ProcessInfo>;
  resume(pid: Pid): AbiResult<ProcessInfo>;
  /** Records a syscall against a process (dispatcher hook). */
  noteSyscall(pid: Pid): void;
  noteMessage(pid: Pid): void;
  noteIo(pid: Pid, bytes: number): void;
  noteStateBytes(pid: Pid, bytes: number): void;
  /** Marks a process as responsive/unresponsive from watchdog observations. */
  setState(pid: Pid, state: ProcessInfo['state']): void;
  attachWindow(pid: Pid, window: WindowId): void;
  detachWindow(pid: Pid, window: WindowId): void;
  grantElevation(pid: Pid): void;
  subscribe(listener: () => void): () => void;
  /** Registered when the process subsystem is constructed. */
  onTerminate(hook: (record: ProcessRecord) => void): void;
}

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

export interface ElevationRequest {
  readonly id: string;
  readonly pid: Pid;
  readonly appName: Localized;
  readonly capability: Capability;
  readonly reason: Localized;
  readonly requestedAt: IsoTimestamp;
}

export interface SecuritySubsystem {
  principal(): PrincipalInfo;
  /** Called by the shell whenever the authenticated user changes. */
  setPrincipal(next: {
    sid: string;
    displayName: string;
    email: string | null;
    roles: readonly string[];
    agencyId: string | null;
    branchId: string | null;
  }): void;
  /** Capabilities the principal may delegate to an app. */
  grantable(): readonly Capability[];
  /** Does the principal hold this capability at all? */
  holds(capability: Capability): boolean;
  /** Is a live elevation token covering this capability? */
  isElevated(capability: Capability): boolean;
  /**
   * Requests consent. Resolves once the shell answers the prompt (or
   * immediately when the capability needs no elevation / is already granted).
   */
  requestElevation(pid: Pid, appName: Localized, capability: Capability, reason: Localized): Promise<boolean>;
  /** Pending prompts for the shell to render. */
  pending(): readonly ElevationRequest[];
  /** Shell response path. */
  resolveElevation(id: string, granted: boolean): void;
  revokeElevation(): void;
  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ *
 * Virtual file system
 * ------------------------------------------------------------------ */

export interface VfsVolume {
  readonly letter: string;
  readonly label: Localized;
  readonly kind: VfsVolumeInfo['kind'];
  readonly readOnly: boolean;
  readonly quotaBytes: number;
  stat(relativePath: string): VfsStat | null;
  list(relativePath: string): readonly VfsStat[] | null;
  readText(relativePath: string): string | null;
  writeText(relativePath: string, content: string, contentType: VfsContentType): AbiResult<VfsStat>;
  mkdir(relativePath: string, recursive: boolean): AbiResult<VfsStat>;
  remove(relativePath: string, recursive: boolean): AbiResult<number>;
  usedBytes(): number;
  /** Notifies the VFS of out-of-band changes (projection volumes refreshing). */
  onChange(listener: (change: VfsChange) => void): () => void;
}

export interface VfsSubsystem {
  mount(volume: VfsVolume): void;
  volumes(): readonly VfsVolumeInfo[];
  stat(path: string): AbiResult<VfsStat>;
  list(path: string, showHidden: boolean): AbiResult<readonly VfsStat[]>;
  readText(path: string): AbiResult<{ content: string; stat: VfsStat }>;
  writeText(path: string, content: string, contentType: VfsContentType, createOnly: boolean): AbiResult<VfsStat>;
  mkdir(path: string, recursive: boolean): AbiResult<VfsStat>;
  remove(path: string, recursive: boolean): AbiResult<number>;
  move(from: string, to: string, overwrite: boolean): AbiResult<VfsStat>;
  copy(from: string, to: string, overwrite: boolean): AbiResult<VfsStat>;
  search(root: string, query: string, limit: number): AbiResult<readonly VfsStat[]>;
  watch(path: string, recursive: boolean, deliver: (change: VfsChange) => void): () => void;
  subscribe(listener: () => void): () => void;
  /** Ensures the standard folder tree exists (Desktop, Documents, …). */
  ensureUserProfile(userFolder: string): void;
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export interface RegistrySubsystem {
  get(key: string, name: string): RegistryValue | undefined;
  getString(key: string, name: string, fallback: string): string;
  getNumber(key: string, name: string, fallback: number): number;
  getBoolean(key: string, name: string, fallback: boolean): boolean;
  set(key: string, name: string, value: RegistryValue): RegistryEntry;
  delete(key: string, name?: string): number;
  enumKeys(key: string): readonly string[];
  enumValues(key: string): readonly RegistryEntry[];
  watch(key: string, deliver: () => void): () => void;
  subscribe(listener: () => void): () => void;
  /** Flushes pending writes to the persistence layer immediately. */
  flush(): void;
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

export interface ServiceContext {
  readonly pid: Pid;
  readonly clock: KernelClock;
  readonly log: KernelLogger;
  readonly registry: RegistrySubsystem;
  readonly vfs: VfsSubsystem;
  readonly bus: BusSubsystem;
  /** Increment the service's completed-work counter. */
  readonly noteWork: (units?: number) => void;
  /** Issue a syscall as this service process. */
  readonly invoke: <K extends SyscallName>(
    name: K,
    request: SyscallRequest<K>,
  ) => Promise<AbiResult<SyscallResponse<K>>>;
}

export interface ServiceDefinition {
  readonly name: string;
  readonly display: Localized;
  readonly description: Localized;
  readonly startType: ServiceStartType;
  readonly dependsOn?: readonly string[];
  readonly capabilities: readonly Capability[];
  /** How often `tick` runs while the service is running. */
  readonly intervalMs: number;
  /** One-shot init; throwing faults the service. */
  start?(ctx: ServiceContext): void | Promise<void>;
  /** Periodic work; throwing increments the fault counter and restarts. */
  tick?(ctx: ServiceContext): void | Promise<void>;
  stop?(ctx: ServiceContext): void;
}

export interface ServiceSubsystem {
  register(definition: ServiceDefinition): void;
  list(): readonly ServiceInfo[];
  start(name: string): Promise<AbiResult<ServiceInfo>>;
  stop(name: string): AbiResult<ServiceInfo>;
  restart(name: string): Promise<AbiResult<ServiceInfo>>;
  setStartType(name: string, startType: ServiceStartType): AbiResult<ServiceInfo>;
  /** Starts every `automatic` service, honouring dependency order. */
  startAutomatic(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

export interface MetricsSubsystem {
  sample(): void;
  system(): SystemMetrics;
  forProcess(pid: Pid): ProcessMetrics | null;
  all(): readonly ProcessMetrics[];
  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ *
 * Window manager
 * ------------------------------------------------------------------ */

export interface WmViewport {
  readonly w: number;
  readonly h: number;
  /** Reserved edges: taskbar height at the bottom, etc. */
  readonly insetTop: number;
  readonly insetBottom: number;
}

export interface CreateWindowRequest {
  readonly pid: Pid;
  readonly appId: AppId;
  readonly title: string;
  readonly defaultSize: { readonly w: number; readonly h: number };
  readonly minSize: { readonly w: number; readonly h: number };
  readonly resizable: boolean;
}

export interface WmSubsystem {
  setViewport(viewport: WmViewport): void;
  viewport(): WmViewport;
  /**
   * Which windowing policy the current viewport width earns. Derived, never
   * set: the shell publishes a width, the answer follows from it, and both
   * sides read it from the same pure function in the ABI.
   */
  formFactor(): FormFactor;
  create(request: CreateWindowRequest): WindowInfo;
  close(id: WindowId): boolean;
  get(id: WindowId): WindowInfo | null;
  list(): readonly WindowInfo[];
  /** Windows on the active virtual desktop, painting order (ascending z). */
  visible(): readonly WindowInfo[];
  focus(id: WindowId): void;
  focused(): WindowId | null;
  setRect(id: WindowId, rect: WindowRect): void;
  setState(id: WindowId, state: WindowStateName): void;
  snap(id: WindowId, zone: SnapZone): WindowInfo | null;
  /** Geometry a zone occupies for the current viewport — drives snap previews. */
  zoneRect(zone: SnapZone): WindowRect;
  minimize(id: WindowId): void;
  restore(id: WindowId): void;
  toggleMaximize(id: WindowId): void;
  setAlwaysOnTop(id: WindowId, value: boolean): void;
  setTitle(id: WindowId, title: string): WindowInfo | null;
  setDirty(id: WindowId, dirty: boolean): WindowInfo | null;
  setProgress(id: WindowId, progress: number | null): WindowInfo | null;
  setBadge(id: WindowId, badge: number | null): WindowInfo | null;
  cascade(): void;
  tile(): void;
  minimizeAll(): void;
  /** Virtual desktops. */
  desktops(): readonly { readonly id: DesktopId; readonly name: string }[];
  activeDesktop(): DesktopId;
  addDesktop(name?: string): DesktopId;
  removeDesktop(id: DesktopId): boolean;
  switchDesktop(id: DesktopId): void;
  moveToDesktop(window: WindowId, desktop: DesktopId): void;
  renameDesktop(id: DesktopId, name: string): void;
  /** Alt+Tab ordering: most-recently-used first. */
  mruOrder(): readonly WindowInfo[];
  closeForProcess(pid: Pid): number;
  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ *
 * Data broker
 * ------------------------------------------------------------------ */

export interface DataBrokerSubsystem {
  query(pid: Pid, query: DatasetQuery): Promise<AbiResult<DatasetPage>>;
  invalidate(datasets: readonly DatasetName[]): number;
  command(pid: Pid, invocation: CommandInvocation): Promise<AbiResult<CommandOutcome>>;
  /** Cache statistics for Settings' storage and About surfaces. */
  stats(): { readonly entries: number; readonly bytes: number; readonly hits: number; readonly misses: number };
  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ *
 * Document store
 * ------------------------------------------------------------------ */

/**
 * Bytes, as opposed to rows.
 *
 * Separate from the broker because a document is not a dataset and not a
 * command: filing one is a three-call storage protocol with a rollback in the
 * middle, and the whole of it has to be on this side of the ABI so an app cannot
 * leave a reserved row pointing at a path with nothing behind it. Separate from
 * the VFS because a document has a review state, a version chain, a checksum the
 * server also computed and an expiry date, and a file tree knows none of that.
 */
export interface DocumentSubsystem {
  /** Hash, reserve, PUT, finalize — and discard the row if the PUT fails. */
  upload(pid: Pid, request: DocumentUploadRequest): Promise<AbiResult<DocumentUploadResult>>;
  /** Records the read, then mints the link. In that order. */
  signedUrl(pid: Pid, request: DocumentUrlRequest): Promise<AbiResult<DocumentUrlResult>>;
}

/* ------------------------------------------------------------------ *
 * Shell host — implemented by the React shell, called by the kernel
 * ------------------------------------------------------------------ */

export interface ShellHost {
  toast(spec: ToastSpec): string;
  notify(record: NotificationRecord): void;
  messageBox(spec: MessageBoxSpec): Promise<boolean>;
  fileDialog(spec: FileDialogSpec): Promise<string | null>;
  clipboardWrite(text: string): Promise<boolean>;
  clipboardRead(): Promise<string>;
  power(action: PowerAction): void;
}

/* ------------------------------------------------------------------ *
 * Notification centre (kernel-side store; the shell renders it)
 * ------------------------------------------------------------------ */

export interface NotificationSubsystem {
  push(source: AppId, spec: NotificationSpec): NotificationRecord;
  list(): readonly NotificationRecord[];
  unreadCount(): number;
  markAllRead(): void;
  dismiss(id: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ *
 * App registry
 * ------------------------------------------------------------------ */

/**
 * The public inventory row, unchanged from the ABI: what Settings shows a person
 * and what Start shows the shell are the same record, so there is only one.
 */
export type InstalledApp = AppInventoryRecord;

export interface AppRegistrySubsystem {
  install(manifest: AppManifest): InstalledApp;
  uninstall(id: AppId): AbiResult<true>;
  list(): readonly InstalledApp[];
  get(id: AppId): InstalledApp | null;
  /**
   * Every manifest the OS image has supplied this session, installed or not.
   * Uninstalling forgets the *installation*, not the media it came from — which
   * is what makes a removed app restorable without a reload.
   */
  catalogue(): readonly AppManifest[];
  /** Re-installs a removed app from the catalogue. */
  restore(id: AppId): AbiResult<InstalledApp>;
  /**
   * Apps this user uninstalled. The host re-installs the OS image on every boot,
   * so it consults this list to leave a removed app removed.
   */
  removed(): readonly AppId[];
  setPinned(id: AppId, pinned: boolean): void;
  noteLaunch(id: AppId): void;
  /** Resolves the app that owns a file's content type. */
  handlerFor(contentType: VfsContentType, extension: string): AppId | null;
  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ *
 * The kernel facade
 * ------------------------------------------------------------------ */

export interface KernelBootOptions {
  /** Storage namespace for persisted volumes and the registry. */
  readonly namespace: string;
  /** Skip persistence (used by tests and the boot self-check). */
  readonly ephemeral?: boolean;
}

export interface Kernel {
  readonly clock: KernelClock;
  readonly eventLog: EventLogSubsystem;
  readonly bus: BusSubsystem;
  readonly scheduler: SchedulerSubsystem;
  readonly handles: HandleTable;
  readonly processes: ProcessSubsystem;
  readonly security: SecuritySubsystem;
  readonly vfs: VfsSubsystem;
  readonly registry: RegistrySubsystem;
  readonly services: ServiceSubsystem;
  readonly metrics: MetricsSubsystem;
  readonly wm: WmSubsystem;
  readonly data: DataBrokerSubsystem;
  readonly notifications: NotificationSubsystem;
  readonly apps: AppRegistrySubsystem;

  /** Attaches the shell implementation of user-facing primitives. */
  attachShell(host: ShellHost): void;

  /**
   * Registers a process's IPC delivery sink and returns a detach function.
   *
   * Shell-only: the app host calls this when it materialises a process, because
   * the syscall ABI is request/response and has nowhere to put a callback. Every
   * asynchronous notification an app receives — IPC messages, filesystem watch
   * events, timer fires — arrives here, tagged with the channel it came from.
   */
  attachMailbox(pid: Pid, deliver: (message: IpcMessage) => void): () => void;

  /** Boots the kernel: mounts volumes, loads the registry, starts services. */
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  booted(): boolean;

  /** The one entry point applications use (via the SDK). */
  syscall<K extends SyscallName>(
    caller: Pid,
    name: K,
    request: SyscallRequest<K>,
  ): Promise<AbiResult<SyscallResponse<K>>>;

  /** Launches an installed app, honouring single-instance semantics. */
  launch(id: AppId, args?: LaunchArgs): Promise<AbiResult<{ pid: Pid; window: WindowId | null }>>;

  /** Opens a VFS path with its associated application. */
  openPath(path: string): Promise<AbiResult<{ pid: Pid | null }>>;

  /**
   * Routes a command — a jump-list task or a palette entry — to an application.
   *
   * A running app receives it over `IPC_CHANNELS.appCommand` and is brought
   * forward; a cold app is launched with the command in its arguments. Shell-only:
   * the command channel is `system/`-reserved, so no application could publish
   * this itself, which is exactly the point.
   */
  sendCommand(id: AppId, commandId: string, args?: LaunchArgs): Promise<AbiResult<{ pid: Pid | null }>>;
}
