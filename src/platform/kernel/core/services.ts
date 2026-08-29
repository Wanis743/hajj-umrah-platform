/**
 * Service Control Manager.
 *
 * Services are the kernel's background workers and they behave like Windows
 * services, not like `setInterval` callbacks:
 *
 *   - each one runs inside its own `service` process, so Task Manager can see
 *     its CPU, handles and syscall count;
 *   - each one runs as SYSTEM: its capability set is the manifest it declared,
 *     and it never raises an interactive consent prompt;
 *   - `dependsOn` is honoured at start time and again (in reverse) at stop time,
 *     so a dependency is never pulled out from under a dependent;
 *   - start type lives in `HKLM\SYSTEM\CurrentControlSet\Services\<name>`, which
 *     means the Services app, Regedit and the SCM all read the same truth;
 *   - a tick that throws is a fault: the service is respawned with a growing
 *     backoff and, once the restart policy is exhausted, left `faulted` with the
 *     error retained for the operator.
 *
 * The tick itself is dispatched as a deferred procedure call attributed to the
 * service's pid, so scheduler time lands on the right process. Time spent
 * awaiting the data broker is deliberately *not* attributed — that is I/O wait,
 * and charging it as CPU would make the metrics lie.
 */
import {
  REG,
  SYSTEM_APP_ID,
  fail,
  succeed,
  type AbiResult,
  type Handle,
  type Pid,
  type ServiceInfo,
  type ServiceStartType,
  type ServiceState,
  type SyscallName,
  type SyscallRequest,
  type SyscallResponse,
} from '../abi';
import type {
  BusSubsystem,
  KernelClock,
  KernelLogger,
  ProcessSubsystem,
  RegistrySubsystem,
  SchedulerSubsystem,
  ServiceContext,
  ServiceDefinition,
  ServiceSubsystem,
  VfsSubsystem,
} from '../contracts';
import type { IsoTimestamp } from '../types';
import { EVENT_IDS } from './eventlog';
import { createSignal } from './store';

/** Consecutive tick faults tolerated before a service is left `faulted`. */
const MAX_AUTO_RESTARTS = 3;

/**
 * How long `automaticDelayed` services wait after boot. Real Windows waits two
 * minutes; four seconds is the equivalent gesture at UI timescales — the shell
 * has painted and the user has seen their desktop before background work runs.
 */
const DELAYED_START_MS = 4_000;

/** Floor on tick intervals, so a mis-declared service cannot busy-spin. */
const MIN_INTERVAL_MS = 1_000;

const START_TYPES: readonly ServiceStartType[] = ['automatic', 'automaticDelayed', 'manual', 'disabled'];

const SOURCE = 'Service Control Manager';

/** The dispatcher signature the host needs to let a service issue syscalls. */
export type ServiceSyscall = <K extends SyscallName>(
  caller: Pid,
  name: K,
  request: SyscallRequest<K>,
) => Promise<AbiResult<SyscallResponse<K>>>;

export interface ServiceHostDeps {
  readonly clock: KernelClock;
  readonly log: KernelLogger;
  readonly registry: RegistrySubsystem;
  readonly vfs: VfsSubsystem;
  readonly bus: BusSubsystem;
  readonly processes: ProcessSubsystem;
  readonly scheduler: SchedulerSubsystem;
  /** Resolved lazily: the dispatcher is assembled after the service host. */
  readonly syscall: () => ServiceSyscall | null;
}

export interface ServiceHostHandle extends ServiceSubsystem {
  /** Stops every running service, newest dependency first. Used by shutdown. */
  stopAll(): void;
}

interface Runtime {
  readonly definition: ServiceDefinition;
  state: ServiceState;
  startType: ServiceStartType;
  pid: Pid | null;
  lastError: string | null;
  restarts: number;
  lastTickAt: IsoTimestamp | null;
  workCompleted: number;
  tickHandle: Handle | null;
  ctx: ServiceContext | null;
  /** Set while a tick is in flight, so slow ticks never overlap. */
  ticking: boolean;
  /** Consecutive faults since the last clean tick. */
  faults: number;
  /** Tick opportunities to skip as restart backoff. */
  cooldown: number;
}

class ServiceHost implements ServiceHostHandle {
  private readonly table = new Map<string, Runtime>();
  private readonly signal = createSignal();
  private delayedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ServiceHostDeps) {}

  register(definition: ServiceDefinition): void {
    if (this.table.has(definition.name)) return;

    // A previously persisted start type wins over the compiled default: that is
    // the whole point of exposing it in the registry.
    const key = this.keyFor(definition.name);
    const persisted = this.deps.registry.getString(key, 'Start', '');
    const startType = isStartType(persisted) ? persisted : definition.startType;

    this.table.set(definition.name, {
      definition,
      state: 'stopped',
      startType,
      pid: null,
      lastError: null,
      restarts: 0,
      lastTickAt: null,
      workCompleted: 0,
      tickHandle: null,
      ctx: null,
      ticking: false,
      faults: 0,
      cooldown: 0,
    });

    this.deps.registry.set(key, 'DisplayName', definition.display.en);
    this.deps.registry.set(key, 'Description', definition.description.en);
    this.deps.registry.set(key, 'Start', startType);
    this.deps.registry.set(key, 'DependOnService', [...(definition.dependsOn ?? [])]);
    this.deps.registry.set(key, 'IntervalMs', definition.intervalMs);
    this.signal.bump();
  }

  list(): readonly ServiceInfo[] {
    return [...this.table.values()]
      .map((runtime) => this.info(runtime))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async start(name: string): Promise<AbiResult<ServiceInfo>> {
    const runtime = this.table.get(name);
    if (runtime === undefined) return fail('NOT_FOUND', `No such service: ${name}`);
    if (runtime.state === 'running' || runtime.state === 'starting') return succeed(this.info(runtime));
    if (runtime.startType === 'disabled') return fail('INVALID_STATE', `Service ${name} is disabled`);
    return this.launch(runtime, new Set<string>());
  }

  stop(name: string): AbiResult<ServiceInfo> {
    const runtime = this.table.get(name);
    if (runtime === undefined) return fail('NOT_FOUND', `No such service: ${name}`);
    if (runtime.state === 'stopped' || runtime.state === 'faulted') return succeed(this.info(runtime));

    // Never orphan a dependent: it goes down first, exactly as `net stop` does.
    for (const dependent of this.dependentsOf(name)) {
      if (dependent.state === 'running' || dependent.state === 'starting') this.stop(dependent.definition.name);
    }

    this.halt(runtime, 'stopped');
    runtime.lastError = null;
    this.deps.log.write('System', 'information', EVENT_IDS.serviceStopped, SOURCE, `${name} stopped`);
    this.signal.bump();
    return succeed(this.info(runtime));
  }

  async restart(name: string): Promise<AbiResult<ServiceInfo>> {
    const runtime = this.table.get(name);
    if (runtime === undefined) return fail('NOT_FOUND', `No such service: ${name}`);

    // Dependents stopped by the cascade are brought back afterwards.
    const dependents = this.dependentsOf(name)
      .filter((candidate) => candidate.state === 'running')
      .map((candidate) => candidate.definition.name);

    const stopped = this.stop(name);
    if (!stopped.ok) return stopped;

    runtime.faults = 0;
    runtime.cooldown = 0;
    runtime.restarts += 1;
    const started = await this.start(name);

    for (const dependent of dependents) {
      if (this.table.get(dependent)?.state !== 'running') await this.start(dependent);
    }
    return started;
  }

  setStartType(name: string, startType: ServiceStartType): AbiResult<ServiceInfo> {
    const runtime = this.table.get(name);
    if (runtime === undefined) return fail('NOT_FOUND', `No such service: ${name}`);
    if (runtime.startType === startType) return succeed(this.info(runtime));

    const previous = runtime.startType;
    runtime.startType = startType;
    this.deps.registry.set(this.keyFor(name), 'Start', startType);
    this.deps.log.write(
      'System',
      'information',
      EVENT_IDS.serviceStartTypeChanged,
      SOURCE,
      `${name} start type ${previous} → ${startType}`,
    );

    if (startType === 'disabled' && (runtime.state === 'running' || runtime.state === 'starting')) {
      for (const dependent of this.dependentsOf(name)) {
        if (dependent.state === 'running' || dependent.state === 'starting') this.stop(dependent.definition.name);
      }
      this.halt(runtime, 'stopped');
    }
    this.signal.bump();
    return succeed(this.info(runtime));
  }

  async startAutomatic(): Promise<void> {
    const order = this.topological();

    for (const runtime of order) {
      if (runtime.startType !== 'automatic') continue;
      const result = await this.start(runtime.definition.name);
      if (!result.ok) {
        this.deps.log.write('System', 'error', EVENT_IDS.serviceFaulted, SOURCE, `${runtime.definition.name} failed to start`, {
          error: result.error.message,
        });
      }
    }

    const delayed = order.filter((runtime) => runtime.startType === 'automaticDelayed');
    if (delayed.length === 0) return;

    this.delayedTimer = setTimeout(() => {
      this.delayedTimer = null;
      void (async () => {
        for (const runtime of delayed) {
          if (runtime.state === 'stopped') await this.start(runtime.definition.name);
        }
      })();
    }, DELAYED_START_MS);
  }

  stopAll(): void {
    if (this.delayedTimer !== null) {
      clearTimeout(this.delayedTimer);
      this.delayedTimer = null;
    }
    // Reverse dependency order: dependents shut down before what they rely on.
    for (const runtime of [...this.topological()].reverse()) {
      if (runtime.state === 'stopped' || runtime.state === 'faulted') continue;
      this.halt(runtime, 'stopped');
    }
    this.signal.bump();
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  /* ---------------- internals ---------------- */

  private async launch(runtime: Runtime, visiting: Set<string>): Promise<AbiResult<ServiceInfo>> {
    const name = runtime.definition.name;
    if (visiting.has(name)) return fail('INVALID_STATE', `Circular service dependency at ${name}`);
    visiting.add(name);

    for (const dependency of runtime.definition.dependsOn ?? []) {
      const target = this.table.get(dependency);
      if (target === undefined) {
        return fail('NOT_FOUND', `${name} depends on missing service ${dependency}`);
      }
      if (target.state === 'running') continue;
      if (target.startType === 'disabled') {
        return fail('INVALID_STATE', `${name} depends on disabled service ${dependency}`);
      }
      const started = await this.launch(target, visiting);
      if (!started.ok) {
        return fail('INVALID_STATE', `${name} blocked: dependency ${dependency} — ${started.error.message}`);
      }
    }

    runtime.state = 'starting';
    runtime.lastError = null;
    this.deps.log.write('System', 'information', EVENT_IDS.serviceStarting, SOURCE, `${name} starting`);
    this.signal.bump();

    const record = this.deps.processes.spawn({
      appId: SYSTEM_APP_ID,
      name: runtime.definition.display,
      kind: 'service',
      capabilities: runtime.definition.capabilities,
      priority: 'low',
    });
    // Services run as SYSTEM. Their capabilities are the declared set and they
    // are elevated by construction, so privileged syscalls never prompt.
    this.deps.processes.grantElevation(record.pid);

    runtime.pid = record.pid;
    runtime.workCompleted = 0;
    runtime.lastTickAt = null;
    runtime.ctx = this.contextFor(runtime);

    try {
      await runtime.definition.start?.(runtime.ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.halt(runtime, 'faulted');
      runtime.lastError = message;
      this.deps.log.write('System', 'error', EVENT_IDS.serviceFaulted, SOURCE, `${name} failed to initialise`, {
        error: message,
      });
      this.signal.bump();
      return fail('INTERNAL', `${name} failed to initialise: ${message}`);
    }

    runtime.state = 'running';
    runtime.cooldown = 0;
    if (runtime.definition.tick !== undefined && runtime.definition.intervalMs > 0) {
      const everyMs = Math.max(MIN_INTERVAL_MS, runtime.definition.intervalMs);
      runtime.tickHandle = this.deps.scheduler.addTickHandler(`service:${name}`, everyMs, () => {
        // Queued as a DPC so scheduler accounting charges the service's pid.
        this.deps.scheduler.queue(runtime.pid, 'low', () => {
          void this.runTick(runtime);
        });
      });
    }

    this.deps.log.write(
      'System',
      'information',
      EVENT_IDS.serviceStarted,
      SOURCE,
      `${name} entered the running state`,
      { intervalMs: runtime.definition.intervalMs, capabilities: runtime.definition.capabilities.join(',') },
      record.pid,
    );
    this.signal.bump();
    return succeed(this.info(runtime));
  }

  private async runTick(runtime: Runtime): Promise<void> {
    if (runtime.state !== 'running' || runtime.ctx === null) return;
    if (runtime.ticking) return;
    if (runtime.cooldown > 0) {
      runtime.cooldown -= 1;
      return;
    }

    runtime.ticking = true;
    try {
      await runtime.definition.tick?.(runtime.ctx);
      runtime.lastTickAt = this.deps.clock.iso();
      runtime.faults = 0;
      this.signal.bump();
    } catch (error) {
      await this.handleFault(runtime, error);
    } finally {
      runtime.ticking = false;
    }
  }

  private async handleFault(runtime: Runtime, error: unknown): Promise<void> {
    const name = runtime.definition.name;
    const message = error instanceof Error ? error.message : String(error);
    runtime.faults += 1;
    runtime.lastError = message;
    this.deps.log.write('System', 'error', EVENT_IDS.serviceFaulted, SOURCE, `${name} faulted`, {
      error: message,
      consecutiveFaults: runtime.faults,
    }, runtime.pid);

    if (runtime.faults > MAX_AUTO_RESTARTS) {
      this.halt(runtime, 'faulted');
      runtime.lastError = message;
      this.deps.log.write(
        'System',
        'critical',
        EVENT_IDS.serviceFaulted,
        SOURCE,
        `${name} exhausted its restart policy and will stay stopped`,
        { consecutiveFaults: runtime.faults, restarts: runtime.restarts },
      );
      this.signal.bump();
      return;
    }

    // Respawn in place with a growing backoff, carrying the fault count so the
    // policy can still be exhausted.
    const faults = runtime.faults;
    this.halt(runtime, 'stopped');
    runtime.restarts += 1;
    const started = await this.launch(runtime, new Set<string>());
    runtime.faults = faults;
    runtime.lastError = message;
    if (started.ok) {
      runtime.cooldown = faults;
      this.deps.log.write('System', 'warning', EVENT_IDS.serviceRestarted, SOURCE, `${name} restarted after a fault`, {
        consecutiveFaults: faults,
        restarts: runtime.restarts,
      });
    }
    this.signal.bump();
  }

  private halt(runtime: Runtime, nextState: ServiceState): void {
    runtime.state = 'stopping';

    if (runtime.tickHandle !== null) {
      this.deps.scheduler.removeTickHandler(runtime.tickHandle);
      runtime.tickHandle = null;
    }

    if (runtime.ctx !== null) {
      try {
        runtime.definition.stop?.(runtime.ctx);
      } catch (error) {
        this.deps.log.write(
          'System',
          'warning',
          EVENT_IDS.serviceFaulted,
          SOURCE,
          `${runtime.definition.name} threw while stopping`,
          { error: error instanceof Error ? error.message : String(error) },
          runtime.pid,
        );
      }
    }

    if (runtime.pid !== null) {
      this.deps.processes.terminate(runtime.pid, true);
      runtime.pid = null;
    }

    runtime.ctx = null;
    runtime.ticking = false;
    runtime.state = nextState;
  }

  private contextFor(runtime: Runtime): ServiceContext {
    const servicePid = runtime.pid;
    if (servicePid === null) throw new Error('Service context requested before the process was spawned');

    return {
      pid: servicePid,
      clock: this.deps.clock,
      log: this.deps.log,
      registry: this.deps.registry,
      vfs: this.deps.vfs,
      bus: this.deps.bus,
      noteWork: (units = 1) => {
        runtime.workCompleted += Math.max(0, Math.trunc(units));
        this.signal.bump();
      },
      invoke: async (name, request) => {
        const dispatch = this.deps.syscall();
        if (dispatch === null) return fail('INVALID_STATE', 'The syscall dispatcher is not attached yet');
        if (runtime.pid === null) return fail('INVALID_STATE', `Service ${runtime.definition.name} is not running`);
        return dispatch(runtime.pid, name, request);
      },
    };
  }

  private info(runtime: Runtime): ServiceInfo {
    return {
      name: runtime.definition.name,
      display: runtime.definition.display,
      description: runtime.definition.description,
      state: runtime.state,
      startType: runtime.startType,
      pid: runtime.pid,
      dependsOn: [...(runtime.definition.dependsOn ?? [])],
      lastError: runtime.lastError,
      restarts: runtime.restarts,
      lastTickAt: runtime.lastTickAt,
      workCompleted: runtime.workCompleted,
    };
  }

  private dependentsOf(name: string): readonly Runtime[] {
    return [...this.table.values()].filter((runtime) => (runtime.definition.dependsOn ?? []).includes(name));
  }

  /** Kahn's algorithm, name-stable. Any cycle is appended so nothing is lost. */
  private topological(): readonly Runtime[] {
    const pending = [...this.table.values()].sort((a, b) => a.definition.name.localeCompare(b.definition.name));
    const placed = new Set<string>();
    const order: Runtime[] = [];

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const runtime of pending) {
        const name = runtime.definition.name;
        if (placed.has(name)) continue;
        const ready = (runtime.definition.dependsOn ?? []).every(
          (dependency) => placed.has(dependency) || !this.table.has(dependency),
        );
        if (!ready) continue;
        placed.add(name);
        order.push(runtime);
        progressed = true;
      }
    }

    for (const runtime of pending) {
      if (!placed.has(runtime.definition.name)) order.push(runtime);
    }
    return order;
  }

  private keyFor(name: string): string {
    return `${REG.machineServices}\\${name}`;
  }
}

function isStartType(value: string): value is ServiceStartType {
  return (START_TYPES as readonly string[]).includes(value);
}

export function createServices(deps: ServiceHostDeps): ServiceHostHandle {
  return new ServiceHost(deps);
}
