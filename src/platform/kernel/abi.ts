/**
 * Kernel ABI — the stable syscall surface between applications and the kernel.
 *
 * This module is the *only* contract an application is allowed to know about.
 * Applications never import kernel internals (`kernel/core/**`), never touch
 * Supabase, `localStorage`, `window` geometry or the shell: they issue
 * syscalls through the SDK and receive `Result` values back.
 *
 * Invariants enforced by `scripts/verify-os-boundary.mjs`:
 *   - `src/apps/**` may import `@/platform/sdk` and `@/platform/kernel/abi`
 *     only — never `@/platform/kernel/core/**` nor `@/platform/shell/**`.
 *   - `src/platform/kernel/**` may not import React or shell modules.
 *
 * Every syscall is capability-gated (§security) and audited (§eventlog).
 */
import type { Brand, IsoTimestamp, Result } from './types';

/* ------------------------------------------------------------------ *
 * Identity primitives
 * ------------------------------------------------------------------ */

/** Process id. Monotonic, never reused inside a boot session. */
export type Pid = Brand<number, 'Pid'>;
/** Kernel object handle (open file, watcher, timer, subscription). */
export type Handle = Brand<number, 'Handle'>;
/** Window id owned by a process. */
export type WindowId = Brand<string, 'WindowId'>;
/** Virtual desktop id. */
export type DesktopId = Brand<string, 'DesktopId'>;
/** Security identifier of a principal (user or system service). */
export type Sid = Brand<string, 'Sid'>;
/** Installed application identifier, e.g. `com.financeos.journal`. */
export type AppId = Brand<string, 'AppId'>;

export const pid = (value: number): Pid => value as Pid;
export const handle = (value: number): Handle => value as Handle;
export const windowId = (value: string): WindowId => value as WindowId;
export const desktopId = (value: string): DesktopId => value as DesktopId;
export const sid = (value: string): Sid => value as Sid;
export const appId = (value: string): AppId => value as AppId;

/** Tri-lingual label. The shell renders one branch per active language. */
export interface Localized {
  readonly ar: string;
  readonly fr: string;
  readonly en: string;
}

/* ------------------------------------------------------------------ *
 * Capabilities — the privilege vocabulary
 * ------------------------------------------------------------------ */

/**
 * A capability is requested in an app manifest and granted at spawn time as
 * the intersection of (manifest request × principal privileges). Syscalls
 * declare the capability they require; the dispatcher denies anything else.
 */
export const CAPABILITIES = [
  'fs.read',
  'fs.write',
  'registry.read',
  'registry.write',
  'ledger.read',
  'ledger.post',
  'ledger.close',
  'process.enumerate',
  'process.terminate',
  'service.control',
  'eventlog.read',
  'eventlog.write',
  'notify',
  'clipboard',
  'window.manage',
  'shell.launch',
  'settings.write',
  'power',
  'net.query',
  // A financial model is not the book. Editing one moves no money and posts no
  // entry, so it must not borrow `ledger.post` -- an app that asked for the right
  // to save a draft would have been handed the right to post a journal, and the
  // consent prompt would have said so, which is how people learn to click through
  // consent prompts. It is split in two because the two acts differ in kind:
  // `model.write` drafts, and `model.publish` freezes a version and stamps the
  // hash that every certificate and dashboard downstream will cite.
  'model.write',
  'model.publish',
  // Handing work to another stage is not doing the work. `spine.handoff` opens,
  // answers and closes the chain that says finance is waiting on operations; it
  // posts nothing and pays nobody. Borrowing `ledger.post` for it would have made
  // the Inbox -- an app whose entire job is to show you other people's requests --
  // an app that holds the right to write to the book.
  'spine.handoff',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Capabilities that require an elevation (UAC) consent before first use. */
export const PRIVILEGED_CAPABILITIES: readonly Capability[] = [
  'ledger.post',
  'ledger.close',
  'process.terminate',
  'service.control',
  'registry.write',
  'power',
  // Publishing is the act others rely on; drafting is not. Deliberately absent:
  // `model.write`, so editing a draft is as unceremonious as typing in a
  // spreadsheet, and -- more importantly -- so recording a certificate never
  // waits on consent. A prompt in front of a bad grade is a prompt somebody
  // learns to cancel.
  'model.publish',
];

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export type AbiErrorCode =
  | 'PERMISSION_DENIED'
  | 'ELEVATION_REQUIRED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_ARGUMENT'
  | 'INVALID_HANDLE'
  | 'INVALID_STATE'
  | 'QUOTA_EXCEEDED'
  | 'NOT_SUPPORTED'
  | 'IO_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'INTERNAL';

export interface AbiError {
  readonly code: AbiErrorCode;
  readonly message: string;
  readonly syscall?: SyscallName;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export type AbiResult<T> = Result<T, AbiError>;

export const abiError = (
  code: AbiErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): AbiError => ({ code, message, details });

export const fail = <T>(
  code: AbiErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): AbiResult<T> => ({ ok: false, error: abiError(code, message, details) });

export const succeed = <T>(value: T): AbiResult<T> => ({ ok: true, value });

/* ------------------------------------------------------------------ *
 * Virtual file system
 * ------------------------------------------------------------------ */

export type VfsNodeKind = 'file' | 'directory';

/**
 * Media type of a VFS file. Drives the icon the shell paints and which app
 * opens it (file associations live in the app manifest).
 */
export type VfsContentType =
  | 'text/plain'
  | 'text/markdown'
  | 'text/csv'
  | 'application/json'
  | 'application/vnd.financeos.sheet'
  | 'application/vnd.financeos.journal'
  | 'application/vnd.financeos.report'
  | 'application/vnd.financeos.shortcut'
  | 'application/octet-stream';

export interface VfsStat {
  /** Absolute Windows-style path, e.g. `C:\Users\finance\Desktop\notes.txt`. */
  readonly path: string;
  readonly name: string;
  readonly kind: VfsNodeKind;
  readonly contentType: VfsContentType;
  readonly size: number;
  readonly createdAt: IsoTimestamp;
  readonly modifiedAt: IsoTimestamp;
  readonly readOnly: boolean;
  /** Volume letter that owns the node (`C`, `X`, `L`). */
  readonly volume: string;
  /** Hidden nodes are skipped by file views unless "show hidden" is on. */
  readonly hidden: boolean;
}

export interface VfsVolumeInfo {
  readonly letter: string;
  readonly label: Localized;
  readonly kind: 'persistent' | 'memory' | 'projection';
  readonly readOnly: boolean;
  readonly usedBytes: number;
  readonly quotaBytes: number;
}

export type VfsChangeKind = 'created' | 'modified' | 'deleted';

export interface VfsChange {
  readonly kind: VfsChangeKind;
  readonly path: string;
  readonly at: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export type RegistryValue = string | number | boolean | readonly string[] | null;

export interface RegistryEntry {
  readonly key: string;
  readonly name: string;
  readonly value: RegistryValue;
  readonly modifiedAt: IsoTimestamp;
}

/** Well-known registry roots. Mirrors the Windows hive layout. */
export const REG = {
  /** Machine-wide policy and installed-app inventory. */
  machineApps: 'HKLM\\SOFTWARE\\FinanceOS\\Apps',
  machinePolicy: 'HKLM\\SOFTWARE\\FinanceOS\\Policy',
  machineServices: 'HKLM\\SYSTEM\\CurrentControlSet\\Services',
  /** Per-user desktop preferences. */
  userAppearance: 'HKCU\\Control Panel\\Appearance',
  userDesktop: 'HKCU\\Control Panel\\Desktop',
  userTaskbar: 'HKCU\\Software\\FinanceOS\\Taskbar',
  userSession: 'HKCU\\Software\\FinanceOS\\Session',
  userStart: 'HKCU\\Software\\FinanceOS\\Start',
  /** Per-app private settings root; append `\\<appId>`. */
  userAppSettings: 'HKCU\\Software\\FinanceOS\\AppSettings',
} as const;

/* ------------------------------------------------------------------ *
 * Processes, threads and scheduling
 * ------------------------------------------------------------------ */

export type ProcessState = 'starting' | 'running' | 'suspended' | 'notResponding' | 'terminated';
export type ProcessPriority = 'realtime' | 'high' | 'normal' | 'low' | 'idle';
export type ProcessKind = 'application' | 'service' | 'system' | 'shell';

export interface ProcessInfo {
  readonly pid: Pid;
  readonly parent: Pid | null;
  readonly appId: AppId;
  readonly name: Localized;
  readonly kind: ProcessKind;
  readonly state: ProcessState;
  readonly priority: ProcessPriority;
  readonly startedAt: IsoTimestamp;
  /** Owning principal. */
  readonly owner: Sid;
  readonly capabilities: readonly Capability[];
  readonly elevated: boolean;
  /** Windows currently owned by this process. */
  readonly windows: readonly WindowId[];
  /** Open kernel handles (files, watchers, timers, subscriptions). */
  readonly handleCount: number;
  readonly threadCount: number;
}

/** Sampled, real resource accounting — the performance surfaces read exactly this. */
export interface ProcessMetrics {
  readonly pid: Pid;
  /** Share of the last sampling window spent in this process, 0..100. */
  readonly cpuPercent: number;
  /** Accumulated scheduler time in milliseconds since spawn. */
  readonly cpuTimeMs: number;
  /** Estimated private working set in bytes (state + handles + buffers). */
  readonly memoryBytes: number;
  /** Syscalls issued since spawn. */
  readonly syscalls: number;
  /** IPC messages delivered since spawn. */
  readonly messages: number;
  /** Bytes read/written through the data broker since spawn. */
  readonly ioBytes: number;
  /** Longest single handler execution in the last window (responsiveness). */
  readonly peakFrameMs: number;
}

export interface SystemMetrics {
  readonly sampledAt: IsoTimestamp;
  readonly uptimeMs: number;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
  readonly memoryLimitBytes: number;
  readonly processCount: number;
  readonly threadCount: number;
  readonly handleCount: number;
  /** Scheduler ticks per second actually achieved. */
  readonly tickRate: number;
  /** Syscalls per second over the last window. */
  readonly syscallRate: number;
  readonly history: readonly SystemMetricSample[];
}

export interface SystemMetricSample {
  readonly at: number;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
  readonly syscallRate: number;
  readonly ioBytes: number;
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

export type ServiceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'faulted';
export type ServiceStartType = 'automatic' | 'automaticDelayed' | 'manual' | 'disabled';

export interface ServiceInfo {
  readonly name: string;
  readonly display: Localized;
  readonly description: Localized;
  readonly state: ServiceState;
  readonly startType: ServiceStartType;
  readonly pid: Pid | null;
  readonly dependsOn: readonly string[];
  readonly lastError: string | null;
  readonly restarts: number;
  readonly lastTickAt: IsoTimestamp | null;
  /** Work items completed since start — proof the service does real work. */
  readonly workCompleted: number;
}

/* ------------------------------------------------------------------ *
 * Event log
 * ------------------------------------------------------------------ */

export type EventChannel = 'System' | 'Application' | 'Security' | 'Setup';
export type EventLevel = 'critical' | 'error' | 'warning' | 'information' | 'verbose';

export interface EventRecord {
  readonly id: number;
  readonly channel: EventChannel;
  readonly level: EventLevel;
  /** Stable numeric event id, e.g. 4624 for "process signed in". */
  readonly eventId: number;
  readonly source: string;
  readonly at: IsoTimestamp;
  readonly pid: Pid | null;
  readonly message: string;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EventQuery {
  readonly channel?: EventChannel;
  readonly levels?: readonly EventLevel[];
  readonly source?: string;
  readonly search?: string;
  readonly since?: IsoTimestamp;
  readonly limit?: number;
}

/* ------------------------------------------------------------------ *
 * Windowing (app-visible subset — the shell owns geometry)
 * ------------------------------------------------------------------ */

export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type WindowStateName = 'normal' | 'minimized' | 'maximized' | 'snapped' | 'fullscreen';

/**
 * The six Windows 11 snap zones plus quadrants. `zone` indexes the layout the
 * user picked from the snap flyout.
 */
export type SnapZone =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | 'leftThird'
  | 'centerThird'
  | 'rightThird'
  | 'leftTwoThirds'
  | 'rightTwoThirds';

/**
 * How much room the shell has to work with.
 *
 * A desktop metaphor is a claim about the display, not about the software: free
 * dragging, thirteen snap zones and a 640px Start menu are all bets on a pointer
 * and a wide viewport. Below that width the same window manager has to behave
 * like a phone's — one window at a time, filling the space it is given.
 *
 * It lives in the ABI rather than in the shell because both sides need the same
 * answer: the window manager decides geometry from it, the shell decides chrome
 * density from it, and a disagreement between the two would put a maximized
 * window under a taskbar. One pure function, no ambient state, no measuring —
 * the shell measures and the kernel is told, as with every other viewport fact.
 *
 * `desktop` is deliberately the widest band: everything at or above it behaves
 * exactly as it did before form factors existed.
 */
export type FormFactor = 'compact' | 'medium' | 'desktop';

/** Lower bound of each band, in CSS pixels of shell width. */
export const FORM_FACTOR_MIN_WIDTH = { compact: 0, medium: 700, desktop: 1024 } as const;

export function formFactorFor(width: number): FormFactor {
  if (width >= FORM_FACTOR_MIN_WIDTH.desktop) return 'desktop';
  if (width >= FORM_FACTOR_MIN_WIDTH.medium) return 'medium';
  return 'compact';
}

export interface WindowInfo {
  readonly id: WindowId;
  readonly pid: Pid;
  readonly appId: AppId;
  readonly title: string;
  readonly rect: WindowRect;
  readonly state: WindowStateName;
  readonly zone: SnapZone | null;
  readonly desktop: DesktopId;
  readonly z: number;
  readonly focused: boolean;
  readonly alwaysOnTop: boolean;
  /** Unsaved-changes marker; close asks for confirmation. */
  readonly dirty: boolean;
  /** Progress in the taskbar button, 0..1, or null for none. */
  readonly progress: number | null;
  /** Optional taskbar badge (unread count style). */
  readonly badge: number | null;
}

/* ------------------------------------------------------------------ *
 * Shell surfaces an app can drive
 * ------------------------------------------------------------------ */

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastSpec {
  readonly kind: ToastKind;
  readonly title: string;
  readonly body?: string;
  /** Auto-dismiss delay in ms; 0 pins the toast until dismissed. */
  readonly timeoutMs?: number;
}

export interface NotificationSpec {
  readonly kind: ToastKind;
  readonly title: string;
  readonly body: string;
  /** Clicking the notification launches this app (defaults to the sender). */
  readonly launch?: AppId;
  /** Optional deep link handed to the app as launch args. */
  readonly args?: Readonly<Record<string, string>>;
  readonly actions?: readonly NotificationAction[];
}

export interface NotificationAction {
  readonly id: string;
  readonly label: Localized;
}

export interface NotificationRecord extends NotificationSpec {
  readonly id: string;
  readonly source: AppId;
  readonly at: IsoTimestamp;
  readonly read: boolean;
}

export type DialogKind = 'info' | 'warning' | 'error' | 'question';

export interface MessageBoxSpec {
  readonly kind: DialogKind;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel?: Localized;
  readonly cancelLabel?: Localized;
  /** Destructive dialogs paint the confirm button red. */
  readonly destructive?: boolean;
}

export interface FileDialogSpec {
  readonly mode: 'open' | 'save';
  readonly title?: string;
  readonly startPath?: string;
  readonly suggestedName?: string;
  readonly contentTypes?: readonly VfsContentType[];
}

/* ------------------------------------------------------------------ *
 * Data broker — the only route to business data
 * ------------------------------------------------------------------ */

/**
 * Datasets the kernel is willing to project to applications. Each maps to a
 * read-only, scope-checked query inside the data driver; apps cannot express
 * arbitrary SQL and cannot mutate through this path.
 */
export const DATASETS = [
  'accounts',
  'journalEntries',
  'journalLines',
  'bankAccounts',
  'bankStatements',
  'bankTransactions',
  'fiscalPeriods',
  'budgets',
  'budgetLines',
  'costCenters',
  'trialBalance',
  'supplierBills',
  'invoices',
  'payments',
  'groups',
  'exchangeRates',
  'closeTasks',
  'auditTrail',
  // Modelling. These three resolve to SECURITY DEFINER functions rather than to a
  // table projection, which is why `DatasetRow` earns its `unknown` values here:
  // `modelingSpec` is a single nested document, returned as a one-row page. The
  // alternative was six table datasets and a client-side assembly, which would
  // have been a second answer to "what is a model" sitting next to the one the
  // database already gives.
  'modelingModels',
  'modelingSpec',
  'modelingCertificates',
  // The spine. `spineInbox` is a list, `spineChain` is one nested document returned
  // as a one-row page, and `spineOverview` is the shape of the board. All three are
  // SECURITY DEFINER functions for the same reason the modelling three are: the
  // ordering rule that makes a chain readable -- handoffs by `seq`, events by time --
  // belongs beside the column that defines it, not in a client that would have to
  // re-derive it and could disagree.
  'spineInbox',
  'spineChain',
  'spineOverview',
  // The controls register. Both are plain table projections, unlike the six above:
  // there is no ordering rule or nesting for the database to own here, and the
  // generic `where` already reaches `control_id`, which is the only filter the UI
  // needs. Adding read RPCs would mean writing SECURITY DEFINER functions whose
  // whole body is a select the table's own policy already scopes correctly.
  'financialControls',
  'controlTests',
] as const;

export type DatasetName = (typeof DATASETS)[number];

export type DatasetFilterValue = string | number | boolean | null | readonly string[];

export interface DatasetQuery {
  readonly dataset: DatasetName;
  readonly where?: Readonly<Record<string, DatasetFilterValue>>;
  readonly orderBy?: { readonly column: string; readonly ascending?: boolean };
  readonly limit?: number;
  readonly offset?: number;
  /** Serve from the broker cache when the entry is younger than this (ms). */
  readonly maxAgeMs?: number;
}

/** A projected row. Values stay `unknown`; apps narrow with their own guards. */
export type DatasetRow = Readonly<Record<string, unknown>>;

export interface DatasetPage {
  readonly dataset: DatasetName;
  readonly rows: readonly DatasetRow[];
  readonly fetchedAt: IsoTimestamp;
  readonly fromCache: boolean;
  readonly complete: boolean;
  readonly bytes: number;
}

/**
 * Business commands. Every entry is a server-side RPC that enforces its own
 * authorization; the kernel adds capability checks, elevation and audit.
 */
export const LEDGER_COMMANDS = [
  'journal.create',
  'journal.post',
  'journal.void',
  'account.create',
  'account.update',
  'reconcile.match',
  'reconcile.unmatch',
  'period.close',
  'period.reopen',
  'budget.upsert',
  'closeTask.complete',
] as const;

export type LedgerCommandName = (typeof LEDGER_COMMANDS)[number];

/**
 * Modelling commands.
 *
 * A separate list rather than more entries in `LEDGER_COMMANDS`, because none of
 * these touch the book: they write a model document, and the whole argument for
 * the `model.write` capability is that the two are different acts. Folding them
 * into a constant called `LEDGER_COMMANDS` would have made the name a lie in the
 * one place a reader goes to find out what an app may do.
 *
 * `model.certificate.record` is here rather than being derived server-side on
 * publish because a certificate is a *measurement*, taken by the engine in the
 * browser against a model the user is looking at. The command stores the grade
 * and the hash it was taken against; the database decides whether that hash is
 * still current. Neither side can quietly award a better grade than was measured.
 */
export const MODEL_COMMANDS = [
  'model.create',
  'model.update',
  'model.publish',
  'model.revise',
  'model.archive',
  'model.assumption.upsert',
  'model.assumption.delete',
  'model.row.upsert',
  'model.row.delete',
  'model.scenario.upsert',
  'model.scenario.delete',
  'model.override.set',
  'model.override.clear',
  'model.certificate.record',
] as const;

export type ModelCommandName = (typeof MODEL_COMMANDS)[number];

/**
 * Spine commands.
 *
 * Six, because the migration exposes six wrappers, and the list is deliberately
 * that short. A handoff can be opened, taken, finished, refused; a chain can be
 * started and ended. There is no `spine.handoff.reassign` and no
 * `spine.handoff.reopen`, because the database refuses both: DONE, DECLINED and
 * SUPERSEDED are terminal, and the way to ask a question twice is to ask it again,
 * where the ledger can show that you did.
 *
 * `spine.handoff.decline` carries a required note. Every other command here takes
 * one optionally. That asymmetry is the whole of the spine's opinion about refusal:
 * the person who says no is the person holding the context nobody else has.
 */
export const SPINE_COMMANDS = [
  'spine.chain.open',
  'spine.handoff.open',
  'spine.handoff.accept',
  'spine.handoff.complete',
  'spine.handoff.decline',
  'spine.chain.close',
] as const;

export type SpineCommandName = (typeof SPINE_COMMANDS)[number];

/**
 * The controls register. Three commands, and the shape of the list is the design:
 * there is no `controls.delete`.
 *
 * `controls.upsert` is a PUT and not a PATCH -- the server writes code,
 * description, owner and frequency from its arguments unconditionally, so an
 * omitted description clears the stored one. The form has to send every field.
 *
 * `controls.test` is the one that matters. It writes a history row and moves the
 * register's four latest-result columns in the same transaction, which is why the
 * client holds no UPDATE on either table: a client that could write one without
 * the other could leave `last_result = 'passed'` above a history that says
 * otherwise, and a register that disagrees with its own evidence is worse than no
 * register at all.
 *
 * `controls.retire` ends a control's life without deleting it: the row stays, its
 * history stays readable, and it stops accepting tests. Deleting one would take
 * every test ever recorded against it through `on delete cascade`, so no command
 * offers to.
 */
export const CONTROL_COMMANDS = [
  'controls.upsert',
  'controls.test',
  'controls.retire',
] as const;

export type ControlCommandName = (typeof CONTROL_COMMANDS)[number];

/** Every command `data.command` will carry, whatever subsystem answers it. */
export const DATA_COMMANDS = [
  ...LEDGER_COMMANDS,
  ...MODEL_COMMANDS,
  ...SPINE_COMMANDS,
  ...CONTROL_COMMANDS,
] as const;

export type DataCommandName =
  | LedgerCommandName
  | ModelCommandName
  | SpineCommandName
  | ControlCommandName;

export interface CommandInvocation {
  readonly command: DataCommandName;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Idempotency key; the broker de-duplicates retries within a session. */
  readonly requestId?: string;
}

export interface CommandOutcome {
  readonly command: DataCommandName;
  readonly at: IsoTimestamp;
  readonly result: DatasetRow | null;
  /** Datasets the broker invalidated as a result. */
  readonly invalidated: readonly DatasetName[];
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

export interface IpcMessage {
  readonly channel: string;
  readonly from: Pid;
  readonly at: IsoTimestamp;
  readonly payload: unknown;
}

/**
 * Well-known IPC channels — part of the published ABI, because an app needs the
 * names to subscribe. The `system/` prefix is reserved: the dispatcher refuses
 * publishes to it from anything but the kernel and its services, so an app can
 * trust that a message on one of these channels really came from the system.
 */
export const IPC_CHANNELS = {
  /** `{ datasets: DatasetName[] }` — broker cache invalidated, refetch. */
  dataChanged: 'system/data-changed',
  /** `{ command, ok }` — a ledger command completed. */
  ledgerCommand: 'system/ledger-command',
  /** `{ theme, accent, language }` — appearance changed in Settings. */
  appearance: 'system/appearance',
  /** `{ path, kind }` — filesystem mutation, for any open file view. */
  fileChanged: 'system/file-changed',
  /** `{ period, action }` — a fiscal period opened or closed. */
  periodChanged: 'system/period-changed',
  /** `{ id, title }` — an approval landed in the Inbox. */
  approval: 'system/approval',
  /** `{ level }` — service health degraded, surfaced by the shell. */
  health: 'system/health',
  /**
   * `{}` — the installed-app inventory changed: an install, a removal, a pin or
   * a launch count. Start, the taskbar and Settings all render that inventory,
   * so one broadcast keeps every view of it honest.
   */
  appsChanged: 'system/apps-changed',
  /** `{ command, args }` — palette or jump-list command routed to an app. */
  appCommand: 'system/app-command',
  /**
   * `{ args }` — a running single-instance app was launched again. Delivered
   * point-to-point through the process mailbox, not broadcast.
   */
  activate: 'shell/activate',
} as const;


/* ------------------------------------------------------------------ *
 * Clock and timers
 * ------------------------------------------------------------------ */

export type TimerKind = 'timeout' | 'interval';

export interface TimerInfo {
  readonly handle: Handle;
  readonly pid: Pid;
  readonly kind: TimerKind;
  readonly everyMs: number;
  readonly fired: number;
}

/* ------------------------------------------------------------------ *
 * Power / session
 * ------------------------------------------------------------------ */

export type PowerAction = 'lock' | 'signOut' | 'restart' | 'shutdown' | 'sleep';

/* ------------------------------------------------------------------ *
 * The syscall table
 * ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-empty-object-type -- `{}` is the
   deliberate "no arguments" request shape for parameterless syscalls. */
export interface SyscallMap {
  /* ---- file system ------------------------------------------------ */
  'fs.stat': { req: { path: string }; res: VfsStat };
  'fs.list': { req: { path: string; showHidden?: boolean }; res: readonly VfsStat[] };
  'fs.readText': { req: { path: string }; res: { content: string; stat: VfsStat } };
  'fs.writeText': {
    req: { path: string; content: string; contentType?: VfsContentType; createOnly?: boolean };
    res: VfsStat;
  };
  'fs.mkdir': { req: { path: string; recursive?: boolean }; res: VfsStat };
  'fs.remove': { req: { path: string; recursive?: boolean }; res: { removed: number } };
  'fs.move': { req: { from: string; to: string; overwrite?: boolean }; res: VfsStat };
  'fs.copy': { req: { from: string; to: string; overwrite?: boolean }; res: VfsStat };
  'fs.volumes': { req: {}; res: readonly VfsVolumeInfo[] };
  'fs.search': { req: { root: string; query: string; limit?: number }; res: readonly VfsStat[] };
  'fs.watch': { req: { path: string; recursive?: boolean }; res: { handle: Handle } };
  'fs.unwatch': { req: { handle: Handle }; res: { closed: true } };

  /* ---- registry --------------------------------------------------- */
  'registry.get': { req: { key: string; name: string }; res: { value: RegistryValue } };
  'registry.set': { req: { key: string; name: string; value: RegistryValue }; res: RegistryEntry };
  'registry.delete': { req: { key: string; name?: string }; res: { deleted: number } };
  'registry.enumKeys': { req: { key: string }; res: readonly string[] };
  'registry.enumValues': { req: { key: string }; res: readonly RegistryEntry[] };
  'registry.watch': { req: { key: string }; res: { handle: Handle } };
  'registry.unwatch': { req: { handle: Handle }; res: { closed: true } };

  /* ---- process ---------------------------------------------------- */
  'process.self': { req: {}; res: ProcessInfo };
  'process.list': { req: {}; res: readonly ProcessInfo[] };
  'process.metrics': { req: { pid?: Pid }; res: readonly ProcessMetrics[] };
  'process.terminate': { req: { pid: Pid; force?: boolean }; res: { terminated: true } };
  'process.setPriority': { req: { pid: Pid; priority: ProcessPriority }; res: ProcessInfo };
  'process.suspend': { req: { pid: Pid }; res: ProcessInfo };
  'process.resume': { req: { pid: Pid }; res: ProcessInfo };
  'system.metrics': { req: {}; res: SystemMetrics };

  /* ---- services --------------------------------------------------- */
  'service.list': { req: {}; res: readonly ServiceInfo[] };
  'service.start': { req: { name: string }; res: ServiceInfo };
  'service.stop': { req: { name: string }; res: ServiceInfo };
  'service.restart': { req: { name: string }; res: ServiceInfo };
  'service.setStartType': { req: { name: string; startType: ServiceStartType }; res: ServiceInfo };

  /* ---- event log -------------------------------------------------- */
  'eventlog.write': {
    req: {
      channel: EventChannel;
      level: EventLevel;
      eventId: number;
      message: string;
      data?: Readonly<Record<string, string | number | boolean | null>>;
    };
    res: EventRecord;
  };
  'eventlog.query': { req: EventQuery; res: readonly EventRecord[] };
  'eventlog.clear': { req: { channel: EventChannel }; res: { cleared: number } };

  /* ---- data broker ------------------------------------------------ */
  'data.query': { req: DatasetQuery; res: DatasetPage };
  'data.invalidate': { req: { datasets: readonly DatasetName[] }; res: { invalidated: number } };
  'data.command': { req: CommandInvocation; res: CommandOutcome };

  /* ---- app inventory ---------------------------------------------- */
  /**
   * The installed-software inventory. `available` is what the OS image can still
   * supply — an app the user removed is gone from `list` but stays here, the way
   * a Windows inbox app can be reinstalled without a download.
   */
  'apps.list': { req: {}; res: readonly AppInventoryRecord[] };
  'apps.available': { req: {}; res: readonly AppManifest[] };
  'apps.setPinned': { req: { appId: AppId; pinned: boolean }; res: AppInventoryRecord };
  'apps.install': { req: { appId: AppId }; res: AppInventoryRecord };
  'apps.uninstall': { req: { appId: AppId }; res: { uninstalled: true } };

  /* ---- shell / windowing ------------------------------------------ */
  'shell.launch': { req: { appId: AppId; args?: Readonly<Record<string, string>> }; res: { pid: Pid } };
  'shell.openPath': { req: { path: string }; res: { pid: Pid | null } };
  'shell.toast': { req: ToastSpec; res: { id: string } };
  'shell.notify': { req: NotificationSpec; res: NotificationRecord };
  'shell.messageBox': { req: MessageBoxSpec; res: { confirmed: boolean } };
  'shell.fileDialog': { req: FileDialogSpec; res: { path: string | null } };
  'shell.clipboardWrite': { req: { text: string }; res: { written: true } };
  'shell.clipboardRead': { req: {}; res: { text: string } };

  'window.setTitle': { req: { window: WindowId; title: string }; res: WindowInfo };
  'window.setDirty': { req: { window: WindowId; dirty: boolean }; res: WindowInfo };
  'window.setProgress': { req: { window: WindowId; progress: number | null }; res: WindowInfo };
  'window.setBadge': { req: { window: WindowId; badge: number | null }; res: WindowInfo };
  'window.close': { req: { window: WindowId }; res: { closed: true } };
  'window.snap': { req: { window: WindowId; zone: SnapZone }; res: WindowInfo };
  'window.list': { req: {}; res: readonly WindowInfo[] };

  /* ---- ipc -------------------------------------------------------- */
  'ipc.publish': { req: { channel: string; payload: unknown }; res: { delivered: number } };
  'ipc.subscribe': { req: { channel: string }; res: { handle: Handle } };
  'ipc.unsubscribe': { req: { handle: Handle }; res: { closed: true } };

  /* ---- timers ----------------------------------------------------- */
  'timer.set': { req: { kind: TimerKind; everyMs: number }; res: { handle: Handle } };
  'timer.clear': { req: { handle: Handle }; res: { closed: true } };

  /* ---- security --------------------------------------------------- */
  'security.principal': { req: {}; res: PrincipalInfo };
  'security.elevate': { req: { reason: Localized; capability: Capability }; res: { granted: boolean; expiresAt: IsoTimestamp | null } };
  'security.check': { req: { capability: Capability }; res: { granted: boolean; elevationRequired: boolean } };

  /* ---- power ------------------------------------------------------ */
  'power.request': { req: { action: PowerAction }; res: { accepted: true } };
}
/* eslint-enable @typescript-eslint/no-empty-object-type */

export type SyscallName = keyof SyscallMap;
export type SyscallRequest<K extends SyscallName> = SyscallMap[K]['req'];
export type SyscallResponse<K extends SyscallName> = SyscallMap[K]['res'];

/** Capability required by each syscall. `null` = unprivileged. */
export const SYSCALL_CAPABILITY: { readonly [K in SyscallName]: Capability | null } = {
  'fs.stat': 'fs.read',
  'fs.list': 'fs.read',
  'fs.readText': 'fs.read',
  'fs.writeText': 'fs.write',
  'fs.mkdir': 'fs.write',
  'fs.remove': 'fs.write',
  'fs.move': 'fs.write',
  'fs.copy': 'fs.write',
  'fs.volumes': 'fs.read',
  'fs.search': 'fs.read',
  'fs.watch': 'fs.read',
  'fs.unwatch': null,
  'registry.get': 'registry.read',
  'registry.set': 'registry.write',
  'registry.delete': 'registry.write',
  'registry.enumKeys': 'registry.read',
  'registry.enumValues': 'registry.read',
  'registry.watch': 'registry.read',
  'registry.unwatch': null,
  'process.self': null,
  'process.list': 'process.enumerate',
  'process.metrics': 'process.enumerate',
  'process.terminate': 'process.terminate',
  'process.setPriority': 'process.terminate',
  'process.suspend': 'process.terminate',
  'process.resume': 'process.terminate',
  'system.metrics': 'process.enumerate',
  'service.list': 'process.enumerate',
  'service.start': 'service.control',
  'service.stop': 'service.control',
  'service.restart': 'service.control',
  'service.setStartType': 'service.control',
  'eventlog.write': 'eventlog.write',
  'eventlog.query': 'eventlog.read',
  'eventlog.clear': 'eventlog.write',
  'data.query': 'ledger.read',
  'data.invalidate': 'ledger.read',
  'data.command': 'ledger.read',
  // The inventory *is* the `HKLM\SOFTWARE\FinanceOS\Apps` hive, so reading it
  // through `apps.*` costs exactly what reading it through `registry.*` costs —
  // no capability laundering. A pin is a per-user preference; installing and
  // removing rewrite the machine hive, and so ask for consent like any other
  // `registry.write`.
  'apps.list': 'registry.read',
  'apps.available': 'registry.read',
  'apps.setPinned': 'settings.write',
  'apps.install': 'registry.write',
  'apps.uninstall': 'registry.write',
  'shell.launch': 'shell.launch',
  'shell.openPath': 'shell.launch',
  'shell.toast': 'notify',
  'shell.notify': 'notify',
  'shell.messageBox': null,
  'shell.fileDialog': 'fs.read',
  'shell.clipboardWrite': 'clipboard',
  'shell.clipboardRead': 'clipboard',
  'window.setTitle': null,
  'window.setDirty': null,
  'window.setProgress': null,
  'window.setBadge': null,
  'window.close': null,
  'window.snap': 'window.manage',
  'window.list': 'window.manage',
  'ipc.publish': null,
  'ipc.subscribe': null,
  'ipc.unsubscribe': null,
  'timer.set': null,
  'timer.clear': null,
  'security.principal': null,
  'security.elevate': null,
  'security.check': null,
  'power.request': 'power',
};

/**
 * Per-command capability. `data.command` needs `ledger.read` to reach the
 * broker and then the command's own capability to execute.
 */
export const COMMAND_CAPABILITY: { readonly [K in DataCommandName]: Capability } = {
  'journal.create': 'ledger.post',
  'journal.post': 'ledger.post',
  'journal.void': 'ledger.post',
  'account.create': 'ledger.post',
  'account.update': 'ledger.post',
  'reconcile.match': 'ledger.post',
  'reconcile.unmatch': 'ledger.post',
  'period.close': 'ledger.close',
  'period.reopen': 'ledger.close',
  'budget.upsert': 'ledger.post',
  'closeTask.complete': 'ledger.post',
  'model.create': 'model.write',
  'model.update': 'model.write',
  // Publish and revise are the pair that move a version in and out of view, so
  // they share the privileged capability. Archive does not: it hides a model and
  // `model.archive` with `archived: false` brings it back, which is a filing
  // decision, not a claim about a number.
  'model.publish': 'model.publish',
  'model.revise': 'model.publish',
  'model.archive': 'model.write',
  'model.assumption.upsert': 'model.write',
  'model.assumption.delete': 'model.write',
  'model.row.upsert': 'model.write',
  'model.row.delete': 'model.write',
  'model.scenario.upsert': 'model.write',
  'model.scenario.delete': 'model.write',
  'model.override.set': 'model.write',
  'model.override.clear': 'model.write',
  'model.certificate.record': 'model.write',
  'spine.chain.open': 'spine.handoff',
  'spine.handoff.open': 'spine.handoff',
  'spine.handoff.accept': 'spine.handoff',
  'spine.handoff.complete': 'spine.handoff',
  'spine.handoff.decline': 'spine.handoff',
  'spine.chain.close': 'spine.handoff',
  // All three controls commands map to `ledger.close`, which Close already holds
  // and which is privileged. Recording that a control passed is signing an
  // assurance, and one deliberate consent per session is the right price for a
  // signature -- the same price the period close itself pays. Splitting the three
  // across two capabilities would mean the act of retiring a control was cheaper
  // than the act of testing it, which is backwards: retirement is the one that
  // stops a check from ever running again.
  'controls.upsert': 'ledger.close',
  'controls.test': 'ledger.close',
  'controls.retire': 'ledger.close',
};

/* ------------------------------------------------------------------ *
 * Principal
 * ------------------------------------------------------------------ */

export interface PrincipalInfo {
  readonly sid: Sid;
  readonly displayName: string;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly capabilities: readonly Capability[];
  /** True while a time-limited elevation token is held. */
  readonly elevated: boolean;
  readonly elevationExpiresAt: IsoTimestamp | null;
  readonly agencyId: string | null;
  readonly branchId: string | null;
}

/* ------------------------------------------------------------------ *
 * Application manifests — how the kernel learns an app exists
 * ------------------------------------------------------------------ */

export type AppCategoryId =
  | 'accounting'
  | 'analysis'
  | 'planning'
  | 'treasury'
  | 'productivity'
  | 'system';

export interface AppCommandDef {
  readonly id: string;
  readonly title: Localized;
  /** Accelerator shown in menus, e.g. `Ctrl+S`. Purely descriptive. */
  readonly accelerator?: string;
  readonly args?: Readonly<Record<string, string>>;
}

export interface AppFileAssociation {
  readonly contentType: VfsContentType;
  readonly extensions: readonly string[];
}

export interface AppManifest {
  readonly id: AppId;
  readonly name: Localized;
  readonly description: Localized;
  readonly version: string;
  readonly publisher: string;
  readonly category: AppCategoryId;
  /** Lucide icon name resolved by the shell icon registry. */
  readonly icon: string;
  readonly capabilities: readonly Capability[];
  readonly defaultSize: { readonly w: number; readonly h: number };
  readonly minSize: { readonly w: number; readonly h: number };
  readonly resizable: boolean;
  readonly singleInstance: boolean;
  /** Pinned to the taskbar out of the box. */
  readonly pinned: boolean;
  /** Shortcut placed on the desktop at first boot. */
  readonly desktopShortcut: boolean;
  /** Ships with the OS image and cannot be uninstalled. */
  readonly systemComponent: boolean;
  readonly fileAssociations?: readonly AppFileAssociation[];
  /** Jump-list entries surfaced on taskbar right-click and Start context. */
  readonly jumpList?: readonly AppCommandDef[];
  /** Commands published to the global palette (Win+Q). */
  readonly commands?: readonly AppCommandDef[];
  /** Search keywords for Start / palette matching. */
  readonly keywords?: readonly string[];
}

/**
 * One row of the installed-software inventory.
 *
 * The manifest is what the publisher declared; everything beside it is what this
 * machine and this user have since done with it. It lives in the ABI rather than
 * behind it because Start, the taskbar and Settings all have to show the same
 * record, and none of them is allowed to read the registry hive it is kept in.
 */
export interface AppInventoryRecord {
  readonly manifest: AppManifest;
  readonly installedAt: IsoTimestamp;
  readonly pinned: boolean;
  /** Policy can disable an app without uninstalling it. */
  readonly enabled: boolean;
  /** Launch count, used for Start-menu "most used". */
  readonly launches: number;
  readonly lastLaunchedAt: IsoTimestamp | null;
}

/** Launch arguments handed to an app process at spawn. */
export type LaunchArgs = Readonly<Record<string, string>>;

/* ------------------------------------------------------------------ *
 * Well-known app ids (typed so the shell and apps agree)
 * ------------------------------------------------------------------ */

export const APP_IDS = {
  settings: appId('com.financeos.settings'),
  eventViewer: appId('com.financeos.eventviewer'),
  registryEditor: appId('com.financeos.regedit'),
  notepad: appId('com.financeos.notepad'),
  calculator: appId('com.financeos.calculator'),
  sheets: appId('com.financeos.sheets'),
  inbox: appId('com.financeos.inbox'),
  dashboard: appId('com.financeos.dashboard'),
  journal: appId('com.financeos.journal'),
  ledger: appId('com.financeos.ledger'),
  reconcile: appId('com.financeos.reconcile'),
  close: appId('com.financeos.close'),
  budgets: appId('com.financeos.budgets'),
  modeling: appId('com.financeos.modeling'),
  statements: appId('com.financeos.statements'),
  profitability: appId('com.financeos.profitability'),
  treasury: appId('com.financeos.treasury'),
} as const;

/** Kernel-owned pseudo app id used by system processes. */
export const SYSTEM_APP_ID = appId('com.financeos.system');
