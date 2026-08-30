/**
 * Process table.
 *
 * A process is what an application *is* to the kernel: a pid, a granted
 * capability set, a handle count, resource counters and zero or more windows.
 * Apps never see their own record directly — they read it back through
 * `process.self`, which is how the shell's performance surfaces and the app agree
 * on the truth.
 *
 * Termination is authoritative: the table closes the handles, drops the IPC
 * subscriptions, clears the scheduler accounting and closes the windows. An app
 * cannot refuse, because none of those live inside the app.
 */
import {
  fail,
  pid as toPid,
  succeed,
  type AbiResult,
  type AppId,
  type Capability,
  type LaunchArgs,
  type Localized,
  type Pid,
  type ProcessInfo,
  type ProcessPriority,
  type ProcessState,
  type Sid,
  type WindowId,
} from '../abi';
import type {
  BusSubsystem,
  HandleTable,
  KernelClock,
  KernelLogger,
  ProcessRecord,
  ProcessSubsystem,
  SchedulerSubsystem,
  SpawnRequest,
} from '../contracts';
import { EVENT_IDS } from './eventlog';
import { next } from './ids';
import { createSignal } from './store';

interface MutableProcess {
  readonly pid: Pid;
  readonly parent: Pid | null;
  readonly appId: AppId;
  readonly name: Localized;
  readonly kind: ProcessRecord['kind'];
  state: ProcessState;
  priority: ProcessPriority;
  readonly startedAt: ProcessRecord['startedAt'];
  readonly owner: Sid;
  readonly capabilities: readonly Capability[];
  elevated: boolean;
  windows: WindowId[];
  readonly threadCount: number;
  readonly args: LaunchArgs;
  readonly counters: ProcessRecord['counters'];
}

class Processes implements ProcessSubsystem {
  private readonly table = new Map<number, MutableProcess>();
  private readonly signal = createSignal();
  private readonly terminateHooks: ((record: ProcessRecord) => void)[] = [];

  constructor(
    private readonly clock: KernelClock,
    private readonly log: KernelLogger,
    private readonly handles: HandleTable,
    private readonly bus: BusSubsystem,
    private readonly scheduler: SchedulerSubsystem,
    private readonly ownerSid: () => Sid,
  ) {}

  spawn(request: SpawnRequest): ProcessRecord {
    const id = toPid(next('pid'));
    // Threads are a coarse model of the app's concurrency: a UI thread plus a
    // worker for services. It is reported, but nothing depends on it.
    const threadCount = request.kind === 'service' ? 2 : 1;
    const record: MutableProcess = {
      pid: id,
      parent: request.parent ?? null,
      appId: request.appId,
      name: request.name,
      kind: request.kind,
      state: 'starting',
      priority: request.priority ?? 'normal',
      startedAt: this.clock.iso(),
      owner: this.ownerSid(),
      capabilities: [...request.capabilities],
      elevated: false,
      windows: [],
      threadCount,
      args: request.args ?? {},
      counters: { syscalls: 0, messages: 0, ioBytes: 0, stateBytes: 0 },
    };
    this.table.set(id as number, record);
    this.log.write(
      'Security',
      'information',
      EVENT_IDS.processStarted,
      'Process',
      `Started ${request.name.en}`,
      { appId: request.appId as string, kind: request.kind, capabilities: request.capabilities.join(',') },
      id,
    );
    // Processes report `starting` for one turn so the shell can paint a
    // placeholder before the app's first render lands.
    queueMicrotask(() => {
      const live = this.table.get(id as number);
      if (live !== undefined && live.state === 'starting') {
        live.state = 'running';
        this.signal.bump();
      }
    });
    this.signal.bump();
    return this.snapshot(record);
  }

  terminate(target: Pid, force: boolean): AbiResult<true> {
    const record = this.table.get(target as number);
    if (record === undefined) return fail('NOT_FOUND', `No such process: ${target as number}`);
    if (record.kind === 'system' && !force) {
      return fail('PERMISSION_DENIED', 'System processes require a forced terminate');
    }

    record.state = 'terminated';
    this.table.delete(target as number);

    const closedHandles = this.handles.closeAll(target);
    const droppedSubscriptions = this.bus.dropProcess(target);
    this.scheduler.dropProcess(target);

    const snapshot = this.snapshot(record);
    for (const hook of this.terminateHooks) {
      try {
        hook(snapshot);
      } catch (error) {
        this.log.write(
          'System',
          'warning',
          EVENT_IDS.processExited,
          'Process',
          'Terminate hook faulted',
          { error: error instanceof Error ? error.message : String(error) },
          target,
        );
      }
    }

    this.log.write(
      'Security',
      'information',
      EVENT_IDS.processExited,
      'Process',
      `Exited ${record.name.en}`,
      { handles: closedHandles, subscriptions: droppedSubscriptions, forced: force },
      target,
    );
    this.signal.bump();
    return succeed(true);
  }

  get(target: Pid): ProcessRecord | null {
    const record = this.table.get(target as number);
    return record === undefined ? null : this.snapshot(record);
  }

  list(): readonly ProcessRecord[] {
    return [...this.table.values()]
      .map((record) => this.snapshot(record))
      .sort((a, b) => (a.pid as number) - (b.pid as number));
  }

  findByApp(app: AppId): ProcessRecord | null {
    for (const record of this.table.values()) {
      if (record.appId === app && record.state !== 'terminated') return this.snapshot(record);
    }
    return null;
  }

  setPriority(target: Pid, priority: ProcessPriority): AbiResult<ProcessInfo> {
    const record = this.table.get(target as number);
    if (record === undefined) return fail('NOT_FOUND', `No such process: ${target as number}`);
    const previous = record.priority;
    record.priority = priority;
    this.log.write(
      'System',
      'information',
      EVENT_IDS.processPriority,
      'Process',
      `Priority ${previous} → ${priority}`,
      { app: record.appId as string },
      target,
    );
    this.signal.bump();
    return succeed(this.snapshot(record));
  }

  suspend(target: Pid): AbiResult<ProcessInfo> {
    const record = this.table.get(target as number);
    if (record === undefined) return fail('NOT_FOUND', `No such process: ${target as number}`);
    if (record.kind === 'system') return fail('PERMISSION_DENIED', 'System processes cannot be suspended');
    if (record.state === 'suspended') return succeed(this.snapshot(record));
    record.state = 'suspended';
    this.log.write('System', 'information', EVENT_IDS.processSuspended, 'Process', 'Suspended', undefined, target);
    this.signal.bump();
    return succeed(this.snapshot(record));
  }

  resume(target: Pid): AbiResult<ProcessInfo> {
    const record = this.table.get(target as number);
    if (record === undefined) return fail('NOT_FOUND', `No such process: ${target as number}`);
    if (record.state !== 'suspended') return succeed(this.snapshot(record));
    record.state = 'running';
    this.log.write('System', 'information', EVENT_IDS.processResumed, 'Process', 'Resumed', undefined, target);
    this.signal.bump();
    return succeed(this.snapshot(record));
  }

  noteSyscall(target: Pid): void {
    const record = this.table.get(target as number);
    if (record !== undefined) record.counters.syscalls += 1;
  }

  noteMessage(target: Pid): void {
    const record = this.table.get(target as number);
    if (record !== undefined) record.counters.messages += 1;
  }

  noteIo(target: Pid, bytes: number): void {
    const record = this.table.get(target as number);
    if (record !== undefined) record.counters.ioBytes += Math.max(0, bytes);
  }

  noteStateBytes(target: Pid, bytes: number): void {
    const record = this.table.get(target as number);
    if (record !== undefined) record.counters.stateBytes = Math.max(0, bytes);
  }

  setState(target: Pid, state: ProcessState): void {
    const record = this.table.get(target as number);
    if (record === undefined || record.state === state) return;
    record.state = state;
    this.signal.bump();
  }

  attachWindow(target: Pid, window: WindowId): void {
    const record = this.table.get(target as number);
    if (record === undefined || record.windows.includes(window)) return;
    record.windows = [...record.windows, window];
    this.signal.bump();
  }

  detachWindow(target: Pid, window: WindowId): void {
    const record = this.table.get(target as number);
    if (record === undefined) return;
    const filtered = record.windows.filter((candidate) => candidate !== window);
    if (filtered.length === record.windows.length) return;
    record.windows = filtered;
    this.signal.bump();
  }

  grantElevation(target: Pid): void {
    const record = this.table.get(target as number);
    if (record === undefined || record.elevated) return;
    record.elevated = true;
    this.signal.bump();
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  onTerminate(hook: (record: ProcessRecord) => void): void {
    this.terminateHooks.push(hook);
  }

  private snapshot(record: MutableProcess): ProcessRecord {
    return {
      pid: record.pid,
      parent: record.parent,
      appId: record.appId,
      name: record.name,
      kind: record.kind,
      state: record.state,
      priority: record.priority,
      startedAt: record.startedAt,
      owner: record.owner,
      capabilities: record.capabilities,
      elevated: record.elevated,
      windows: [...record.windows],
      handleCount: this.handles.countFor(record.pid),
      threadCount: record.threadCount,
      args: record.args,
      counters: record.counters,
    };
  }
}

export function createProcesses(
  clock: KernelClock,
  log: KernelLogger,
  handles: HandleTable,
  bus: BusSubsystem,
  scheduler: SchedulerSubsystem,
  ownerSid: () => Sid,
): ProcessSubsystem {
  return new Processes(clock, log, handles, bus, scheduler, ownerSid);
}
