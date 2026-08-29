/**
 * Scheduler — the kernel's execution engine.
 *
 * A single timer drives everything: deferred procedure calls queued by the
 * syscall layer, and periodic tick handlers registered by services and the
 * metrics sampler. Work is drained in priority order under a per-tick time
 * budget, so a busy service cannot starve the UI thread — the remainder simply
 * runs on the next tick.
 *
 * Every work item is timed and attributed to a pid. That accounting is what
 * makes Task Manager's CPU column real rather than decorative.
 */
import { type Handle, type Pid, type ProcessPriority } from '../abi';
import type {
  HandleTable,
  KernelClock,
  KernelLogger,
  SchedulerSubsystem,
  SchedulerTickContext,
  SchedulerWork,
} from '../contracts';
import { next } from './ids';

/** Base quantum. 60ms keeps services responsive without burning battery. */
const TICK_MS = 60;
/** Wall-clock budget for draining the DPC queue inside one tick. */
const DRAIN_BUDGET_MS = 8;

const PRIORITY_ORDER: readonly ProcessPriority[] = ['realtime', 'high', 'normal', 'low', 'idle'];

interface Dpc {
  readonly pid: Pid | null;
  readonly work: SchedulerWork;
}

interface TickHandler {
  readonly handle: Handle;
  readonly name: string;
  readonly everyMs: number;
  readonly handler: (ctx: SchedulerTickContext) => void;
  nextDueAt: number;
}

interface Accounting {
  cpuTimeMs: number;
  peakFrameMs: number;
}

class Scheduler implements SchedulerSubsystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly queues = new Map<ProcessPriority, Dpc[]>(
    PRIORITY_ORDER.map((priority) => [priority, [] as Dpc[]]),
  );

  private readonly tickHandlers = new Map<number, TickHandler>();
  private readonly accounting = new Map<number, Accounting>();

  private tickCount = 0;
  private windowTicks = 0;
  private windowStartedAt = 0;
  private lastTickAt = 0;
  private observedTickRate = 0;
  private microtaskScheduled = false;

  constructor(
    private readonly clock: KernelClock,
    private readonly log: KernelLogger,
    private readonly handles: HandleTable,
    /** Resolved lazily: the System process is spawned after the scheduler. */
    private readonly systemPid: () => Pid,
  ) {
    this.windowStartedAt = clock.monotonic();
    this.lastTickAt = clock.monotonic();
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastTickAt = this.clock.monotonic();
    this.windowStartedAt = this.lastTickAt;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  running(): boolean {
    return this.timer !== null;
  }

  queue(pid: Pid | null, priority: ProcessPriority, work: SchedulerWork): void {
    this.queues.get(priority)?.push({ pid, work });
    // Realtime work must not wait for the next timer edge.
    if (priority === 'realtime' && !this.microtaskScheduled) {
      this.microtaskScheduled = true;
      queueMicrotask(() => {
        this.microtaskScheduled = false;
        this.drain(Number.POSITIVE_INFINITY, ['realtime']);
      });
    }
  }

  addTickHandler(name: string, everyMs: number, handler: (ctx: SchedulerTickContext) => void): Handle {
    const handle = this.handles.open(this.systemPid(), 'timer', `tick:${name}`, () =>
      this.tickHandlers.delete(handle as number),
    );
    this.tickHandlers.set(handle as number, {
      handle,
      name,
      everyMs: Math.max(TICK_MS, everyMs),
      handler,
      nextDueAt: this.clock.monotonic() + Math.max(TICK_MS, everyMs),
    });
    return handle;
  }

  removeTickHandler(handle: Handle): boolean {
    if (!this.tickHandlers.has(handle as number)) return false;
    return this.handles.close(handle);
  }

  cpuTimeFor(pid: Pid): number {
    return this.accounting.get(pid as number)?.cpuTimeMs ?? 0;
  }

  peakFrameFor(pid: Pid): number {
    return this.accounting.get(pid as number)?.peakFrameMs ?? 0;
  }

  tickRate(): number {
    return this.observedTickRate;
  }

  dropProcess(pid: Pid): void {
    this.accounting.delete(pid as number);
    for (const [priority, queue] of this.queues) {
      this.queues.set(
        priority,
        queue.filter((dpc) => dpc.pid !== pid),
      );
    }
  }

  rollWindow(): void {
    const now = this.clock.monotonic();
    const elapsed = Math.max(1, now - this.windowStartedAt);
    this.observedTickRate = (this.windowTicks * 1000) / elapsed;
    this.windowTicks = 0;
    this.windowStartedAt = now;
    for (const entry of this.accounting.values()) entry.peakFrameMs = 0;
  }

  /* ---------------- internals ---------------- */

  private tick(): void {
    const now = this.clock.monotonic();
    const deltaMs = now - this.lastTickAt;
    this.lastTickAt = now;
    this.tickCount += 1;
    this.windowTicks += 1;

    this.drain(DRAIN_BUDGET_MS, PRIORITY_ORDER);

    const ctx: SchedulerTickContext = { tick: this.tickCount, deltaMs, monotonic: now };
    for (const entry of [...this.tickHandlers.values()]) {
      if (now < entry.nextDueAt) continue;
      // Re-arm from *now* so a slow handler cannot accumulate a backlog.
      entry.nextDueAt = now + entry.everyMs;
      this.run(this.systemPid(), entry.name, () => entry.handler(ctx));
    }
  }

  private drain(budgetMs: number, order: readonly ProcessPriority[]): void {
    const startedAt = this.clock.monotonic();
    for (const priority of order) {
      const queue = this.queues.get(priority);
      if (queue === undefined) continue;
      while (queue.length > 0) {
        if (this.clock.monotonic() - startedAt > budgetMs) return;
        const dpc = queue.shift();
        if (dpc === undefined) break;
        this.run(dpc.pid ?? this.systemPid(), 'dpc', dpc.work);
      }
    }
  }

  private run(pid: Pid, label: string, work: SchedulerWork): void {
    const startedAt = this.clock.monotonic();
    try {
      work();
    } catch (error) {
      this.log.write(
        'System',
        'error',
        1026,
        'Scheduler',
        `Work item "${label}" faulted`,
        { error: error instanceof Error ? error.message : String(error) },
        pid,
      );
    } finally {
      const elapsed = this.clock.monotonic() - startedAt;
      let entry = this.accounting.get(pid as number);
      if (entry === undefined) {
        entry = { cpuTimeMs: 0, peakFrameMs: 0 };
        this.accounting.set(pid as number, entry);
      }
      entry.cpuTimeMs += elapsed;
      if (elapsed > entry.peakFrameMs) entry.peakFrameMs = elapsed;
    }
  }
}

export function createScheduler(
  clock: KernelClock,
  log: KernelLogger,
  handles: HandleTable,
  systemPid: () => Pid,
): SchedulerSubsystem {
  return new Scheduler(clock, log, handles, systemPid);
}

/** Exposed so the metrics sampler can express its interval in ticks. */
export const SCHEDULER_TICK_MS = TICK_MS;

/** Stable id namespace for tick handler names, keeps diagnostics readable. */
export function tickHandlerName(prefix: string): string {
  return `${prefix}#${next('tickHandler')}`;
}
