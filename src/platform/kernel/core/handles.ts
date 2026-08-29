/**
 * Handle table — every kernel object a process holds open.
 *
 * Open files, filesystem watchers, registry watchers, IPC subscriptions and
 * timers are all handles. The table owns their disposal, which is what makes
 * process termination *complete*: killing a pid closes its handles, which
 * unsubscribes its watchers and clears its timers with no cooperation from the
 * app. Task Manager's "Handles" column reads `countFor`.
 */
import { handle as toHandle, type Handle, type Pid } from '../abi';
import type { HandleKind, HandleRecord, HandleTable } from '../contracts';
import type { KernelClock } from '../contracts';
import { next } from './ids';

class Table implements HandleTable {
  private readonly records = new Map<number, HandleRecord>();
  private readonly byPid = new Map<number, Set<number>>();

  constructor(private readonly clock: KernelClock) {}

  open(pid: Pid, kind: HandleKind, target: string, dispose: () => void): Handle {
    const id = toHandle(next('handle'));
    this.records.set(id as number, {
      handle: id,
      pid,
      kind,
      target,
      openedAt: this.clock.iso(),
      dispose,
    });
    let owned = this.byPid.get(pid as number);
    if (!owned) {
      owned = new Set<number>();
      this.byPid.set(pid as number, owned);
    }
    owned.add(id as number);
    return id;
  }

  close(target: Handle): boolean {
    const record = this.records.get(target as number);
    if (!record) return false;
    this.records.delete(target as number);
    this.byPid.get(record.pid as number)?.delete(target as number);
    // A throwing disposer must not strand the rest of the table.
    try {
      record.dispose();
    } catch {
      return true;
    }
    return true;
  }

  get(target: Handle): HandleRecord | null {
    return this.records.get(target as number) ?? null;
  }

  closeAll(pid: Pid): number {
    const owned = this.byPid.get(pid as number);
    if (!owned) return 0;
    // Snapshot: disposers may themselves close handles.
    const ids = [...owned];
    this.byPid.delete(pid as number);
    let closed = 0;
    for (const id of ids) {
      if (this.close(toHandle(id))) closed += 1;
    }
    return closed;
  }

  countFor(pid: Pid): number {
    return this.byPid.get(pid as number)?.size ?? 0;
  }

  total(): number {
    return this.records.size;
  }

  list(): readonly HandleRecord[] {
    return [...this.records.values()];
  }
}

export function createHandleTable(clock: KernelClock): HandleTable {
  return new Table(clock);
}
