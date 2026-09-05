/**
 * Syscall dispatcher — the only door between an application and the kernel.
 *
 * Every request an app makes arrives here as `(caller, name, request)` and is
 * put through the same four gates, in order, before any subsystem is touched:
 *
 *   1. **Liveness** — the caller must be a live, non-terminated process.
 *   2. **Capability** — `SYSCALL_CAPABILITY[name]` must be in the process's
 *      frozen grant set (manifest request ∩ principal privileges). A denial is
 *      audited to the Security channel; the app just sees `PERMISSION_DENIED`.
 *   3. **Elevation** — privileged capabilities additionally need a live consent
 *      token. The dispatcher *awaits* the UAC prompt on the app's behalf, so no
 *      application ever contains elevation logic; it only sees the syscall take
 *      a little longer, or come back `ELEVATION_REQUIRED` if consent was denied.
 *   4. **Ownership** — a window, handle or timer may only be manipulated by the
 *      process that owns it, unless the caller holds `window.manage`.
 *
 * Two deliberate design points:
 *
 * - *Nothing here throws.* A subsystem fault is caught, logged as
 *   `syscallFault` and returned as `INTERNAL`, because an app crashing the
 *   kernel is exactly the failure mode a syscall boundary exists to prevent.
 * - *Asynchronous notifications go to the mailbox.* The ABI is strictly
 *   request/response, so watches, timers and IPC deliver through the per-process
 *   sink the shell attaches with `attachMailbox`, tagged with a channel name.
 */
import {
  COMMAND_CAPABILITY,
  DATA_COMMANDS,
  SYSCALL_CAPABILITY,
  fail,
  succeed,
  type AbiResult,
  type AppId,
  type Capability,
  type DataCommandName,
  type EventRecord,
  type Handle,
  type IpcMessage,
  type LaunchArgs,
  type Localized,
  type Pid,
  type SyscallName,
  type SyscallRequest,
  type SyscallResponse,
  type WindowId,
  type WindowInfo,
} from '../abi';
import type {
  AppRegistrySubsystem,
  BusSubsystem,
  DataBrokerSubsystem,
  DocumentSubsystem,
  EventLogSubsystem,
  HandleTable,
  KernelClock,
  MetricsSubsystem,
  NotificationSubsystem,
  ProcessRecord,
  ProcessSubsystem,
  RegistrySubsystem,
  SchedulerSubsystem,
  SecuritySubsystem,
  ServiceSubsystem,
  ShellHost,
  VfsSubsystem,
  WmSubsystem,
} from '../contracts';
import { IPC_CHANNELS } from './bus';
import { EVENT_IDS } from './eventlog';

/** Fastest a timer may fire — one scheduler tick. Below this it is a busy loop. */
const MIN_TIMER_MS = 50;

/** Default page cap for `fs.search`, so a broad query cannot stall a tick. */
const SEARCH_LIMIT = 200;

/** Syscalls whose effect is written to the audit trail after it succeeds. */
const AUDITED: Readonly<Partial<Record<SyscallName, number>>> = {
  'fs.writeText': EVENT_IDS.fileWrite,
  'fs.mkdir': EVENT_IDS.fileWrite,
  'fs.move': EVENT_IDS.fileWrite,
  'fs.copy': EVENT_IDS.fileWrite,
  'fs.remove': EVENT_IDS.fileDelete,
  'registry.set': EVENT_IDS.registryWrite,
  'registry.delete': EVENT_IDS.registryWrite,
};

/** Human-readable reasons shown in the UAC prompt, per capability. */
const ELEVATION_REASONS: Readonly<Record<string, Localized>> = {
  'ledger.post': {
    ar: 'تسجيل قيود في دفتر الأستاذ',
    fr: 'Écrire des écritures dans le grand livre',
    en: 'Write entries to the general ledger',
  },
  'ledger.close': {
    ar: 'إغلاق أو إعادة فتح فترة مالية',
    fr: 'Clôturer ou réouvrir une période comptable',
    en: 'Close or reopen an accounting period',
  },
  'process.terminate': {
    ar: 'التحكم في العمليات الجارية',
    fr: 'Contrôler les processus en cours',
    en: 'Control running processes',
  },
  'service.control': {
    ar: 'تشغيل أو إيقاف خدمات النظام',
    fr: 'Démarrer ou arrêter des services système',
    en: 'Start or stop system services',
  },
  'registry.write': {
    ar: 'تعديل إعدادات النظام',
    fr: 'Modifier les paramètres du système',
    en: 'Change machine-wide system settings',
  },
  power: {
    ar: 'إيقاف الجلسة أو إعادة تشغيلها',
    fr: 'Arrêter ou redémarrer la session',
    en: 'End or restart this session',
  },
};

export interface DispatcherDeps {
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
  readonly documents: DocumentSubsystem;
  readonly notifications: NotificationSubsystem;
  readonly apps: AppRegistrySubsystem;
  /** Resolved lazily: the shell attaches itself after the kernel is built. */
  readonly host: () => ShellHost | null;
  readonly launch: (id: AppId, args?: LaunchArgs) => Promise<AbiResult<{ pid: Pid; window: WindowId | null }>>;
  readonly openPath: (path: string) => Promise<AbiResult<{ pid: Pid | null }>>;
}

export interface DispatcherHandle {
  syscall<K extends SyscallName>(
    caller: Pid,
    name: K,
    request: SyscallRequest<K>,
  ): Promise<AbiResult<SyscallResponse<K>>>;
  attachMailbox(pid: Pid, deliver: (message: IpcMessage) => void): () => void;
  /** Kernel-side delivery, used to reactivate a running single-instance app. */
  post(target: Pid, channel: string, payload: unknown): void;
}

/** Narrows the erased request once, at the point of use. */
function as<K extends SyscallName>(request: unknown): SyscallRequest<K> {
  return request as SyscallRequest<K>;
}

class Dispatcher implements DispatcherHandle {
  private readonly mailboxes = new Map<number, (message: IpcMessage) => void>();

  constructor(private readonly deps: DispatcherDeps) {}

  attachMailbox(pid: Pid, deliver: (message: IpcMessage) => void): () => void {
    this.mailboxes.set(pid, deliver);
    return () => {
      if (this.mailboxes.get(pid) === deliver) this.mailboxes.delete(pid);
    };
  }

  async syscall<K extends SyscallName>(
    caller: Pid,
    name: K,
    request: SyscallRequest<K>,
  ): Promise<AbiResult<SyscallResponse<K>>> {
    const result = await this.guarded(caller, name, request);
    return result as AbiResult<SyscallResponse<K>>;
  }

  /* ---------------- gates ---------------- */

  private async guarded(caller: Pid, name: SyscallName, request: unknown): Promise<AbiResult<unknown>> {
    const record = this.deps.processes.get(caller);
    if (record === null) return fail('NOT_FOUND', `No such process: ${String(caller)}`);
    if (record.state === 'terminated') return fail('INVALID_STATE', 'The calling process has exited');
    if (SYSCALL_CAPABILITY[name] === undefined) return fail('NOT_SUPPORTED', `Unknown syscall: ${name}`);

    this.deps.processes.noteSyscall(caller);

    const authorized = await this.authorize(caller, name, record, request);
    if (!authorized.ok) return authorized;

    try {
      const outcome = await this.execute(caller, name, request);
      if (outcome.ok) this.audit(caller, name, request);
      return outcome;
    } catch (error) {
      // A subsystem bug must not escape into the caller's stack.
      this.deps.eventLog.write(
        'System',
        'error',
        EVENT_IDS.syscallFault,
        'Syscall',
        `${name} faulted: ${describe(error)}`,
        { syscall: name },
        caller,
      );
      return fail('INTERNAL', `${name} failed unexpectedly`, { detail: describe(error) });
    }
  }

  private async authorize(
    caller: Pid,
    name: SyscallName,
    record: ProcessRecord,
    request: unknown,
  ): Promise<AbiResult<true>> {
    const capability = SYSCALL_CAPABILITY[name];
    if (capability === null) return succeed(true);

    if (!record.capabilities.includes(capability)) {
      this.deps.eventLog.write(
        'Security',
        'warning',
        EVENT_IDS.capabilityDenied,
        'Syscall',
        `${record.name.en} was denied ${capability} for ${name}`,
        { syscall: name, capability, app: record.appId as string },
        caller,
      );
      return fail('PERMISSION_DENIED', `${name} requires the ${capability} capability`, { capability });
    }

    if (exemptFromElevation(name, request)) return succeed(true);
    return this.ensureElevated(caller, record, capability, name);
  }

  /**
   * Resolves elevation for a capability, prompting if needed. Service processes
   * run as SYSTEM and are elevated at spawn, so they never prompt.
   */
  private async ensureElevated(
    caller: Pid,
    record: ProcessRecord,
    capability: Capability,
    subject: string,
  ): Promise<AbiResult<true>> {
    if (record.elevated) return succeed(true);
    if (this.deps.security.isElevated(capability)) return succeed(true);

    const reason = ELEVATION_REASONS[capability] ?? {
      ar: `يتطلب الإذن ${capability}`,
      fr: `Nécessite l'autorisation ${capability}`,
      en: `Requires the ${capability} privilege`,
    };
    const granted = await this.deps.security.requestElevation(caller, record.name, capability, reason);
    if (!granted) {
      return fail('ELEVATION_REQUIRED', `${subject} was not permitted to use ${capability}`, { capability });
    }
    return succeed(true);
  }

  /* ---------------- dispatch ---------------- */

  private async execute(caller: Pid, name: SyscallName, request: unknown): Promise<AbiResult<unknown>> {
    if (name.startsWith('fs.')) return this.handleFs(caller, name, request);
    if (name.startsWith('registry.')) return this.handleRegistry(caller, name, request);
    if (name.startsWith('process.') || name === 'system.metrics') return this.handleProcess(caller, name, request);
    if (name.startsWith('service.')) return this.handleService(name, request);
    if (name.startsWith('eventlog.')) return this.handleEventLog(caller, name, request);
    if (name.startsWith('data.')) return this.handleData(caller, name, request);
    if (name.startsWith('docs.')) return this.handleDocs(caller, name, request);
    if (name.startsWith('apps.')) return this.handleApps(name, request);
    if (name.startsWith('shell.')) return this.handleShell(caller, name, request);
    if (name.startsWith('window.')) return this.handleWindow(caller, name, request);
    if (name.startsWith('ipc.')) return this.handleIpc(caller, name, request);
    if (name.startsWith('timer.')) return this.handleTimer(caller, name, request);
    if (name.startsWith('security.')) return this.handleSecurity(caller, name, request);
    if (name === 'power.request') return this.handlePower(caller, request);
    return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
  }

  /**
   * The file syscalls, split along the line that matters: reads answer from the
   * volume and are done, writes have to tell the rest of the system what moved.
   * A read that is not a read returns `null` so the two halves compose without
   * either of them owning a second copy of the "unknown syscall" answer.
   */
  private handleFs(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    return this.handleFsRead(caller, name, request) ?? this.handleFsWrite(caller, name, request);
  }

  private handleFsRead(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> | null {
    const { vfs } = this.deps;
    switch (name) {
      case 'fs.stat':
        return vfs.stat(as<'fs.stat'>(request).path);
      case 'fs.list': {
        const r = as<'fs.list'>(request);
        return vfs.list(r.path, r.showHidden ?? false);
      }
      case 'fs.readText': {
        const outcome = vfs.readText(as<'fs.readText'>(request).path);
        if (outcome.ok) this.deps.processes.noteIo(caller, outcome.value.stat.size);
        return outcome;
      }
      case 'fs.volumes':
        return succeed(vfs.volumes());
      case 'fs.search': {
        const r = as<'fs.search'>(request);
        return vfs.search(r.root, r.query, clampLimit(r.limit, SEARCH_LIMIT));
      }
      case 'fs.watch': {
        const r = as<'fs.watch'>(request);
        return this.openWatch(caller, 'fsWatch', r.path, (deliver) =>
          vfs.watch(r.path, r.recursive ?? false, deliver),
        );
      }
      case 'fs.unwatch':
        return this.closeOwned(caller, as<'fs.unwatch'>(request).handle, 'fsWatch');
      default:
        return null;
    }
  }

  private handleFsWrite(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    const { vfs } = this.deps;
    switch (name) {
      case 'fs.writeText': {
        const r = as<'fs.writeText'>(request);
        const outcome = vfs.writeText(r.path, r.content, r.contentType ?? 'text/plain', r.createOnly ?? false);
        if (outcome.ok) {
          this.deps.processes.noteIo(caller, outcome.value.size);
          this.announceFile(caller, r.path, 'modified');
        }
        return outcome;
      }
      case 'fs.mkdir': {
        const r = as<'fs.mkdir'>(request);
        const outcome = vfs.mkdir(r.path, r.recursive ?? true);
        if (outcome.ok) this.announceFile(caller, r.path, 'created');
        return outcome;
      }
      case 'fs.remove': {
        const r = as<'fs.remove'>(request);
        const outcome = vfs.remove(r.path, r.recursive ?? false);
        if (!outcome.ok) return outcome;
        this.announceFile(caller, r.path, 'deleted');
        return succeed({ removed: outcome.value });
      }
      case 'fs.move': {
        const r = as<'fs.move'>(request);
        const outcome = vfs.move(r.from, r.to, r.overwrite ?? false);
        if (outcome.ok) {
          this.announceFile(caller, r.from, 'deleted');
          this.announceFile(caller, r.to, 'created');
        }
        return outcome;
      }
      case 'fs.copy': {
        const r = as<'fs.copy'>(request);
        const outcome = vfs.copy(r.from, r.to, r.overwrite ?? false);
        if (outcome.ok) this.announceFile(caller, r.to, 'created');
        return outcome;
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private handleRegistry(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    const { registry } = this.deps;
    switch (name) {
      case 'registry.get': {
        const r = as<'registry.get'>(request);
        return succeed({ value: registry.get(r.key, r.name) ?? null });
      }
      case 'registry.set': {
        const r = as<'registry.set'>(request);
        return succeed(registry.set(r.key, r.name, r.value));
      }
      case 'registry.delete': {
        const r = as<'registry.delete'>(request);
        return succeed({ deleted: registry.delete(r.key, r.name) });
      }
      case 'registry.enumKeys':
        return succeed(registry.enumKeys(as<'registry.enumKeys'>(request).key));
      case 'registry.enumValues':
        return succeed(registry.enumValues(as<'registry.enumValues'>(request).key));
      case 'registry.watch': {
        const key = as<'registry.watch'>(request).key;
        return this.openWatch(caller, 'registryWatch', key, (deliver) =>
          registry.watch(key, () => {
            deliver({ key });
          }),
        );
      }
      case 'registry.unwatch':
        return this.closeOwned(caller, as<'registry.unwatch'>(request).handle, 'registryWatch');
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private handleProcess(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    const { processes, metrics } = this.deps;
    switch (name) {
      case 'process.self': {
        const record = processes.get(caller);
        return record === null ? fail('NOT_FOUND', 'The calling process has exited') : succeed(strip(record));
      }
      case 'process.list':
        return succeed(processes.list().map(strip));
      case 'process.metrics': {
        const target = as<'process.metrics'>(request).pid;
        if (target === undefined) return succeed(metrics.all());
        const single = metrics.forProcess(target);
        return succeed(single === null ? [] : [single]);
      }
      case 'process.terminate': {
        const r = as<'process.terminate'>(request);
        // Refusing self-termination keeps the shell in charge of window teardown.
        if (r.pid === caller) return fail('INVALID_ARGUMENT', 'A process cannot terminate itself');
        const outcome = processes.terminate(r.pid, r.force ?? false);
        return outcome.ok ? succeed({ terminated: true as const }) : outcome;
      }
      case 'process.setPriority': {
        const r = as<'process.setPriority'>(request);
        return processes.setPriority(r.pid, r.priority);
      }
      case 'process.suspend': {
        const r = as<'process.suspend'>(request);
        if (r.pid === caller) return fail('INVALID_ARGUMENT', 'A process cannot suspend itself');
        return processes.suspend(r.pid);
      }
      case 'process.resume':
        return processes.resume(as<'process.resume'>(request).pid);
      case 'system.metrics':
        return succeed(metrics.system());
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private async handleService(name: SyscallName, request: unknown): Promise<AbiResult<unknown>> {
    const { services } = this.deps;
    switch (name) {
      case 'service.list':
        return succeed(services.list());
      case 'service.start':
        return services.start(as<'service.start'>(request).name);
      case 'service.stop':
        return services.stop(as<'service.stop'>(request).name);
      case 'service.restart':
        return services.restart(as<'service.restart'>(request).name);
      case 'service.setStartType': {
        const r = as<'service.setStartType'>(request);
        return services.setStartType(r.name, r.startType);
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private handleEventLog(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    const { eventLog, processes } = this.deps;
    switch (name) {
      case 'eventlog.write': {
        const r = as<'eventlog.write'>(request);
        const source = processes.get(caller)?.name.en ?? 'Application';
        eventLog.write(r.channel, r.level, r.eventId, source, r.message, r.data, caller);
        const written = eventLog.query({ channel: r.channel, limit: 1 })[0];
        return written === undefined
          ? fail('INTERNAL', 'The event was accepted but could not be read back')
          : succeed(written satisfies EventRecord);
      }
      case 'eventlog.query':
        return succeed(eventLog.query(as<'eventlog.query'>(request)));
      case 'eventlog.clear': {
        const r = as<'eventlog.clear'>(request);
        // Security is the audit trail; clearing it from an app is never allowed.
        if (r.channel === 'Security') {
          return fail('PERMISSION_DENIED', 'The Security channel cannot be cleared');
        }
        return succeed({ cleared: eventLog.clear(r.channel) });
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private async handleData(caller: Pid, name: SyscallName, request: unknown): Promise<AbiResult<unknown>> {
    const { data } = this.deps;
    switch (name) {
      case 'data.query':
        return data.query(caller, as<'data.query'>(request));
      case 'data.invalidate':
        return succeed({ invalidated: data.invalidate(as<'data.invalidate'>(request).datasets) });
      case 'data.command': {
        const invocation = as<'data.command'>(request);
        const record = this.deps.processes.get(caller);
        if (record === null) return fail('NOT_FOUND', 'The calling process has exited');
        if (!isDataCommand(invocation.command)) {
          return fail('INVALID_ARGUMENT', `Unknown command: ${String(invocation.command)}`);
        }
        // Prompt for the command's own privilege here, so the broker only ever
        // sees an already-consented caller and apps stay free of UAC logic.
        const consented = await this.ensureElevated(
          caller,
          record,
          COMMAND_CAPABILITY[invocation.command],
          invocation.command,
        );
        if (!consented.ok) return consented;
        return data.command(caller, invocation);
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  /**
   * Documents — bytes, where `handleData` moves rows.
   *
   * No elevation code, and that is not an omission: `guarded` has already run
   * `ensureElevated` for `SYSCALL_CAPABILITY['docs.upload']`, and `dms.write` is
   * outside `PRIVILEGED_CAPABILITIES`, so consent is not what stands between an
   * app and a filing. The capability gate is. Filing a document is ordinary work
   * for whoever was granted it; the thing that would need a prompt is the money
   * it eventually supports, and that costs `ledger.post`.
   *
   * Also thin, for the same reason `handleApps` is: the whole three-call storage
   * protocol lives in the document store, because a protocol split across a
   * syscall boundary can be abandoned halfway by the app that started it.
   */
  private async handleDocs(caller: Pid, name: SyscallName, request: unknown): Promise<AbiResult<unknown>> {
    const { documents } = this.deps;
    switch (name) {
      case 'docs.upload':
        return documents.upload(caller, as<'docs.upload'>(request));
      case 'docs.signedUrl':
        return documents.signedUrl(caller, as<'docs.signedUrl'>(request));
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  /**
   * The installed-software inventory.
   *
   * Thin on purpose: the app registry already owns the machine/user split, the
   * removal list and the "system components cannot be uninstalled" rule, so this
   * only translates between its methods and the ABI's shapes. `apps.install`
   * restores from the image rather than taking a manifest, because an app may not
   * hand the kernel a manifest — that is how an app would grant itself
   * capabilities it was never installed with.
   */
  private handleApps(name: SyscallName, request: unknown): AbiResult<unknown> {
    const { apps } = this.deps;
    switch (name) {
      case 'apps.list':
        return succeed(apps.list());
      case 'apps.available':
        return succeed(apps.catalogue());
      case 'apps.setPinned': {
        const r = as<'apps.setPinned'>(request);
        apps.setPinned(r.appId, r.pinned);
        const record = apps.get(r.appId);
        return record === null ? fail('NOT_FOUND', `No such application: ${r.appId as string}`) : succeed(record);
      }
      case 'apps.install':
        return apps.restore(as<'apps.install'>(request).appId);
      case 'apps.uninstall': {
        const outcome = apps.uninstall(as<'apps.uninstall'>(request).appId);
        return outcome.ok ? succeed({ uninstalled: true as const }) : outcome;
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private async handleShell(caller: Pid, name: SyscallName, request: unknown): Promise<AbiResult<unknown>> {
    const host = this.deps.host();
    switch (name) {
      case 'shell.launch': {
        const r = as<'shell.launch'>(request);
        const outcome = await this.deps.launch(r.appId, r.args);
        return outcome.ok ? succeed({ pid: outcome.value.pid }) : outcome;
      }
      case 'shell.openPath':
        return this.deps.openPath(as<'shell.openPath'>(request).path);
      case 'shell.notify': {
        const spec = as<'shell.notify'>(request);
        const source = this.deps.processes.get(caller)?.appId;
        if (source === undefined) return fail('NOT_FOUND', 'The calling process has exited');
        const record = this.deps.notifications.push(source, spec);
        host?.notify(record);
        return succeed(record);
      }
      default:
        if (host === null) return fail('INVALID_STATE', 'No shell is attached to this kernel');
        return this.handleShellHost(host, name, request);
    }
  }

  private async handleShellHost(
    host: ShellHost,
    name: SyscallName,
    request: unknown,
  ): Promise<AbiResult<unknown>> {
    switch (name) {
      case 'shell.toast':
        return succeed({ id: host.toast(as<'shell.toast'>(request)) });
      case 'shell.messageBox':
        return succeed({ confirmed: await host.messageBox(as<'shell.messageBox'>(request)) });
      case 'shell.fileDialog':
        return succeed({ path: await host.fileDialog(as<'shell.fileDialog'>(request)) });
      case 'shell.clipboardWrite': {
        const written = await host.clipboardWrite(as<'shell.clipboardWrite'>(request).text);
        return written ? succeed({ written: true as const }) : fail('INTERNAL', 'The clipboard rejected the write');
      }
      case 'shell.clipboardRead':
        return succeed({ text: await host.clipboardRead() });
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private handleWindow(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    const { wm } = this.deps;
    if (name === 'window.list') return succeed(wm.list());

    const target = (request as { window?: WindowId }).window;
    if (target === undefined) return fail('INVALID_ARGUMENT', 'A window id is required');
    const owned = this.assertWindowOwner(caller, target);
    if (!owned.ok) return owned;

    switch (name) {
      case 'window.setTitle': {
        const r = as<'window.setTitle'>(request);
        return required(wm.setTitle(r.window, r.title), r.window);
      }
      case 'window.setDirty': {
        const r = as<'window.setDirty'>(request);
        return required(wm.setDirty(r.window, r.dirty), r.window);
      }
      case 'window.setProgress': {
        const r = as<'window.setProgress'>(request);
        return required(wm.setProgress(r.window, r.progress), r.window);
      }
      case 'window.setBadge': {
        const r = as<'window.setBadge'>(request);
        return required(wm.setBadge(r.window, r.badge), r.window);
      }
      case 'window.close': {
        const closed = wm.close(as<'window.close'>(request).window);
        return closed ? succeed({ closed: true as const }) : fail('NOT_FOUND', 'No such window');
      }
      case 'window.snap': {
        const r = as<'window.snap'>(request);
        return required(wm.snap(r.window, r.zone), r.window);
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private handleIpc(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    const { bus } = this.deps;
    switch (name) {
      case 'ipc.publish': {
        const r = as<'ipc.publish'>(request);
        if (r.channel.startsWith('system/')) {
          // Reserved namespace: only the kernel and its services speak there.
          const record = this.deps.processes.get(caller);
          if (record?.kind !== 'service' && record?.kind !== 'system') {
            return fail('PERMISSION_DENIED', 'The system/ channel namespace is reserved');
          }
        }
        return succeed({ delivered: bus.publish(caller, r.channel, r.payload) });
      }
      case 'ipc.subscribe': {
        const r = as<'ipc.subscribe'>(request);
        const sink = this.mailboxes.get(caller);
        if (sink === undefined) return fail('INVALID_STATE', 'This process has no message sink attached');
        const opened = bus.subscribe(caller, r.channel, (message) => {
          sink(message);
        });
        return succeed({ handle: opened });
      }
      case 'ipc.unsubscribe': {
        const target = as<'ipc.unsubscribe'>(request).handle;
        const owner = this.deps.handles.get(target);
        if (owner === null || owner.pid !== caller) return fail('NOT_FOUND', 'No such subscription');
        return bus.unsubscribe(target) ? succeed({ closed: true as const }) : fail('NOT_FOUND', 'No such subscription');
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private handleTimer(caller: Pid, name: SyscallName, request: unknown): AbiResult<unknown> {
    if (name === 'timer.clear') return this.closeOwned(caller, as<'timer.clear'>(request).handle, 'timer');
    if (name !== 'timer.set') return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);

    const r = as<'timer.set'>(request);
    if (!Number.isFinite(r.everyMs)) return fail('INVALID_ARGUMENT', 'everyMs must be a finite number');
    const everyMs = Math.max(MIN_TIMER_MS, Math.round(r.everyMs));
    const kind = r.kind === 'timeout' ? 'timeout' : 'interval';

    let tick: Handle | null = null;
    const timer = this.deps.handles.open(caller, 'timer', `${kind}:${everyMs}ms`, () => {
      if (tick !== null) this.deps.scheduler.removeTickHandler(tick);
    });
    tick = this.deps.scheduler.addTickHandler(`timer:${String(caller)}:${String(timer)}`, everyMs, () => {
      this.post(caller, `timer/${String(timer)}`, { handle: timer, kind, everyMs });
      // A timeout is a one-shot: closing the handle removes the tick handler.
      if (kind === 'timeout') this.deps.handles.close(timer);
    });
    return succeed({ handle: timer });
  }

  private async handleSecurity(caller: Pid, name: SyscallName, request: unknown): Promise<AbiResult<unknown>> {
    const { security, processes } = this.deps;
    switch (name) {
      case 'security.principal':
        return succeed(security.principal());
      case 'security.check': {
        const capability = as<'security.check'>(request).capability;
        const record = processes.get(caller);
        const granted = record?.capabilities.includes(capability) ?? false;
        return succeed({
          granted,
          elevationRequired: granted && !(record?.elevated ?? false) && !security.isElevated(capability),
        });
      }
      case 'security.elevate': {
        const r = as<'security.elevate'>(request);
        const record = processes.get(caller);
        if (record === null) return fail('NOT_FOUND', 'The calling process has exited');
        if (!record.capabilities.includes(r.capability)) {
          return fail('PERMISSION_DENIED', `This app was not granted ${r.capability}`, { capability: r.capability });
        }
        const granted = await security.requestElevation(caller, record.name, r.capability, r.reason);
        return succeed({ granted, expiresAt: granted ? security.principal().elevationExpiresAt : null });
      }
      default:
        return fail('NOT_SUPPORTED', `Unhandled syscall: ${name}`);
    }
  }

  private handlePower(caller: Pid, request: unknown): AbiResult<unknown> {
    const host = this.deps.host();
    if (host === null) return fail('INVALID_STATE', 'No shell is attached to this kernel');
    const action = as<'power.request'>(request).action;
    this.deps.eventLog.write(
      'System',
      'information',
      EVENT_IDS.powerRequested,
      'Power',
      `Power action requested: ${action}`,
      { action },
      caller,
    );
    host.power(action);
    return succeed({ accepted: true as const });
  }

  /* ---------------- helpers ---------------- */

  /** Opens a watch handle whose events are delivered to the caller's mailbox. */
  private openWatch(
    caller: Pid,
    kind: 'fsWatch' | 'registryWatch',
    target: string,
    attach: (deliver: (payload: unknown) => void) => () => void,
  ): AbiResult<{ handle: Handle }> {
    let opened: Handle | null = null;
    const channel = kind === 'fsWatch' ? 'fs' : 'registry';
    const detach = attach((payload) => {
      if (opened !== null) this.post(caller, `${channel}/${String(opened)}`, payload);
    });
    opened = this.deps.handles.open(caller, kind, target, detach);
    return succeed({ handle: opened });
  }

  private closeOwned(
    caller: Pid,
    target: Handle,
    kind: 'fsWatch' | 'registryWatch' | 'timer',
  ): AbiResult<{ closed: true }> {
    const record = this.deps.handles.get(target);
    if (record === null || record.pid !== caller || record.kind !== kind) {
      return fail('NOT_FOUND', `No such ${kind} handle`);
    }
    this.deps.handles.close(target);
    return succeed({ closed: true as const });
  }

  /** A window may only be driven by its owner, or by a window manager app. */
  private assertWindowOwner(caller: Pid, target: WindowId): AbiResult<true> {
    const window = this.deps.wm.get(target);
    if (window === null) return fail('NOT_FOUND', 'No such window');
    if (window.pid === caller) return succeed(true);
    if (this.deps.processes.get(caller)?.capabilities.includes('window.manage') === true) return succeed(true);
    return fail('PERMISSION_DENIED', 'That window belongs to another process');
  }

  /** Delivers a kernel-originated message into a process's mailbox. */
  post(target: Pid, channel: string, payload: unknown): void {
    const sink = this.mailboxes.get(target);
    if (sink === undefined) return;
    this.deps.processes.noteMessage(target);
    sink({ channel, from: target, at: this.deps.clock.iso(), payload });
  }

  /** Broadcasts a filesystem mutation so open file views refresh themselves. */
  private announceFile(caller: Pid, path: string, kind: 'created' | 'modified' | 'deleted'): void {
    this.deps.bus.publish(caller, IPC_CHANNELS.fileChanged, { path, kind });
  }

  private audit(caller: Pid, name: SyscallName, request: unknown): void {
    const eventId = AUDITED[name];
    if (eventId === undefined) return;
    const subject = subjectOf(request);
    const security = name.startsWith('registry.');
    this.deps.eventLog.write(
      security ? 'Security' : 'Application',
      security ? 'information' : 'verbose',
      eventId,
      'Syscall',
      `${name} ${subject}`,
      { syscall: name, target: subject },
      caller,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Free functions
 * ------------------------------------------------------------------ */

/**
 * Per-user settings writes do not prompt; machine-wide ones do. This mirrors
 * Windows, where HKCU is yours to change and HKLM asks for consent, and it is
 * the reason Settings can persist a theme without a UAC dialog on every toggle.
 */
function exemptFromElevation(name: SyscallName, request: unknown): boolean {
  if (name !== 'registry.set' && name !== 'registry.delete') return false;
  const key = (request as { key?: unknown }).key;
  return typeof key === 'string' && key.toUpperCase().startsWith('HKCU');
}

/**
 * Both families, one gate.
 *
 * Written against `DATA_COMMANDS` rather than the ledger's eleven so that adding a
 * command in `abi.ts` makes it callable here without a second edit. The check is
 * still a check: an unknown string is refused before `COMMAND_CAPABILITY` is
 * indexed with it, which is what keeps a bad payload from choosing its own
 * capability.
 */
function isDataCommand(value: string): value is DataCommandName {
  return (DATA_COMMANDS as readonly string[]).includes(value);
}

/** Drops the kernel-private fields so apps only ever see the public shape. */
function strip(record: ProcessRecord) {
  const { counters: _counters, args: _args, ...info } = record;
  return info;
}

function required(window: WindowInfo | null, id: WindowId): AbiResult<WindowInfo> {
  return window === null ? fail('NOT_FOUND', `No such window: ${String(id)}`) : succeed(window);
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.trunc(value)), fallback);
}

/** Best-effort description of what a mutation touched, for the audit record. */
function subjectOf(request: unknown): string {
  if (typeof request !== 'object' || request === null) return '';
  const shape = request as { path?: unknown; to?: unknown; key?: unknown; name?: unknown };
  if (typeof shape.path === 'string') return shape.path;
  if (typeof shape.to === 'string') return shape.to;
  if (typeof shape.key === 'string') {
    return typeof shape.name === 'string' ? `${shape.key}\\${shape.name}` : shape.key;
  }
  return '';
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

export function createDispatcher(deps: DispatcherDeps): DispatcherHandle {
  return new Dispatcher(deps);
}
