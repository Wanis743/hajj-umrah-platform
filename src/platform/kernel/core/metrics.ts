/**
 * Metrics — real resource accounting, not decoration.
 *
 * Every number the Performance widget shows is derived from something the kernel
 * actually measured:
 *
 *   cpuPercent   scheduler time attributed to the pid in the last window,
 *                divided by the window's wall-clock length.
 *   memoryBytes  the process's own reported state size plus a per-handle and
 *                per-window allocation, which is the closest honest analogue of
 *                a working set inside a browser tab.
 *   syscalls     counted by the dispatcher.
 *   ioBytes      counted by the data broker on every dataset page.
 *   peakFrameMs  the longest single work item the scheduler ran for the pid —
 *                this is what "not responding" is derived from.
 */
import { type Pid, type ProcessMetrics, type SystemMetrics, type SystemMetricSample } from '../abi';
import type {
  BusSubsystem,
  DataBrokerSubsystem,
  HandleTable,
  KernelClock,
  MetricsSubsystem,
  ProcessSubsystem,
  SchedulerSubsystem,
  WmSubsystem,
} from '../contracts';
import { createSignal } from './store';

/** Samples retained for the sparklines: 60 × 1s ≈ one minute of history. */
const HISTORY_LENGTH = 60;

/**
 * Nominal ceiling used for the memory gauge. A browser tab has no hard limit we
 * can read, so the OS presents a fixed budget and reports pressure against it.
 */
const MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;

/** Per-object memory model, in bytes. Documented so the numbers are auditable. */
const COST = {
  processBase: 3 * 1024 * 1024,
  perHandle: 48 * 1024,
  perWindow: 1280 * 1024,
  perThread: 256 * 1024,
  /** Cached dataset bytes are charged to the process that requested them. */
  ioWeight: 2,
} as const;

/** A process is "not responding" once a single frame blocks this long. */
const UNRESPONSIVE_FRAME_MS = 1500;

interface SampleWindow {
  startedAt: number;
  cpuByPid: Map<number, number>;
  syscallsByPid: Map<number, number>;
}

class Metrics implements MetricsSubsystem {
  private readonly signal = createSignal();
  private readonly history: SystemMetricSample[] = [];
  private readonly latest = new Map<number, ProcessMetrics>();
  private window: SampleWindow;
  private systemSnapshot: SystemMetrics;
  private lastIoTotal = 0;

  constructor(
    private readonly clock: KernelClock,
    private readonly processes: ProcessSubsystem,
    private readonly scheduler: SchedulerSubsystem,
    private readonly handles: HandleTable,
    private readonly bus: BusSubsystem,
    private readonly wm: WmSubsystem,
    private readonly broker: () => DataBrokerSubsystem | null,
  ) {
    this.window = { startedAt: clock.monotonic(), cpuByPid: new Map(), syscallsByPid: new Map() };
    this.systemSnapshot = {
      sampledAt: clock.iso(),
      uptimeMs: 0,
      cpuPercent: 0,
      memoryBytes: 0,
      memoryLimitBytes: MEMORY_LIMIT_BYTES,
      processCount: 0,
      threadCount: 0,
      handleCount: 0,
      tickRate: 0,
      syscallRate: 0,
      history: [],
    };
  }

  sample(): void {
    const now = this.clock.monotonic();
    const elapsedMs = Math.max(1, now - this.window.startedAt);
    const records = this.processes.list();

    let totalCpu = 0;
    let totalMemory = 0;
    let totalThreads = 0;
    let totalSyscalls = 0;
    let totalIo = 0;

    const nextCpu = new Map<number, number>();
    const nextSyscalls = new Map<number, number>();

    for (const record of records) {
      const key = record.pid as number;
      const cpuTimeMs = this.scheduler.cpuTimeFor(record.pid);
      const previousCpu = this.window.cpuByPid.get(key) ?? 0;
      const cpuDelta = Math.max(0, cpuTimeMs - previousCpu);
      nextCpu.set(key, cpuTimeMs);

      const previousSyscalls = this.window.syscallsByPid.get(key) ?? 0;
      const syscallDelta = Math.max(0, record.counters.syscalls - previousSyscalls);
      nextSyscalls.set(key, record.counters.syscalls);

      const cpuPercent = Math.min(100, (cpuDelta / elapsedMs) * 100);
      const memoryBytes =
        COST.processBase +
        record.handleCount * COST.perHandle +
        record.windows.length * COST.perWindow +
        record.threadCount * COST.perThread +
        record.counters.stateBytes +
        record.counters.ioBytes / COST.ioWeight;

      const peakFrameMs = this.scheduler.peakFrameFor(record.pid);

      this.latest.set(key, {
        pid: record.pid,
        cpuPercent: round(cpuPercent, 1),
        cpuTimeMs: round(cpuTimeMs, 0),
        memoryBytes: Math.round(memoryBytes),
        syscalls: record.counters.syscalls,
        messages: record.counters.messages,
        ioBytes: record.counters.ioBytes,
        peakFrameMs: round(peakFrameMs, 1),
      });

      // Watchdog: a long frame marks the process unresponsive; recovery is
      // automatic on the next window where it behaves.
      if (record.state === 'running' && peakFrameMs > UNRESPONSIVE_FRAME_MS) {
        this.processes.setState(record.pid, 'notResponding');
      } else if (record.state === 'notResponding' && peakFrameMs <= UNRESPONSIVE_FRAME_MS) {
        this.processes.setState(record.pid, 'running');
      }

      totalCpu += cpuPercent;
      totalMemory += memoryBytes;
      totalThreads += record.threadCount;
      totalSyscalls += syscallDelta;
      totalIo += record.counters.ioBytes;
    }

    // Drop metrics for processes that have exited.
    for (const key of [...this.latest.keys()]) {
      if (!records.some((record) => (record.pid as number) === key)) this.latest.delete(key);
    }

    const brokerStats = this.broker()?.stats();
    const sample: SystemMetricSample = {
      at: this.clock.now(),
      cpuPercent: round(Math.min(100, totalCpu), 1),
      memoryBytes: Math.round(totalMemory + (brokerStats?.bytes ?? 0)),
      syscallRate: round((totalSyscalls * 1000) / elapsedMs, 1),
      ioBytes: Math.max(0, totalIo - this.lastIoTotal),
    };
    this.lastIoTotal = totalIo;
    this.history.push(sample);
    if (this.history.length > HISTORY_LENGTH) this.history.splice(0, this.history.length - HISTORY_LENGTH);

    this.systemSnapshot = {
      sampledAt: this.clock.iso(),
      uptimeMs: this.clock.uptimeMs(),
      cpuPercent: sample.cpuPercent,
      memoryBytes: sample.memoryBytes,
      memoryLimitBytes: MEMORY_LIMIT_BYTES,
      processCount: records.length,
      threadCount: totalThreads,
      handleCount: this.handles.total(),
      tickRate: round(this.scheduler.tickRate(), 1),
      syscallRate: sample.syscallRate,
      history: [...this.history],
    };

    this.window = { startedAt: now, cpuByPid: nextCpu, syscallsByPid: nextSyscalls };
    this.scheduler.rollWindow();
    this.signal.bump();
  }

  system(): SystemMetrics {
    return this.systemSnapshot;
  }

  forProcess(target: Pid): ProcessMetrics | null {
    return this.latest.get(target as number) ?? null;
  }

  all(): readonly ProcessMetrics[] {
    return [...this.latest.values()].sort((a, b) => b.cpuPercent - a.cpuPercent);
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  /** Diagnostics surfaced by Settings' About page. */
  counters(): Readonly<Record<string, number>> {
    return {
      ipcChannels: this.bus.channels().length,
      ipcDelivered: this.bus.deliveredCount(),
      windows: this.wm.list().length,
      handles: this.handles.total(),
      cacheEntries: this.broker()?.stats().entries ?? 0,
    };
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface MetricsHandle extends MetricsSubsystem {
  counters(): Readonly<Record<string, number>>;
}

export function createMetrics(
  clock: KernelClock,
  processes: ProcessSubsystem,
  scheduler: SchedulerSubsystem,
  handles: HandleTable,
  bus: BusSubsystem,
  wm: WmSubsystem,
  broker: () => DataBrokerSubsystem | null,
): MetricsHandle {
  return new Metrics(clock, processes, scheduler, handles, bus, wm, broker);
}

export const METRICS_MEMORY_LIMIT_BYTES = MEMORY_LIMIT_BYTES;
