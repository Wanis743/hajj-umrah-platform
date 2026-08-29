/**
 * IPC bus — publish/subscribe between processes.
 *
 * Channels are flat strings; a subscription is a handle so the handle table can
 * tear it down when its owner dies. Delivery is synchronous but each subscriber
 * is isolated: a throwing handler cannot stop the rest of the fan-out.
 *
 * Well-known channels are declared in `IPC_CHANNELS` so apps and services agree
 * on names without importing each other.
 */
import { type Handle, type IpcMessage, type Pid } from '../abi';
import type { BusSubsystem, HandleTable, KernelClock, KernelLogger } from '../contracts';

interface Subscription {
  readonly handle: Handle;
  readonly pid: Pid;
  readonly channel: string;
  readonly deliver: (message: IpcMessage) => void;
}

class Bus implements BusSubsystem {
  private readonly byChannel = new Map<string, Map<number, Subscription>>();
  private readonly byHandle = new Map<number, Subscription>();
  private delivered = 0;

  constructor(
    private readonly clock: KernelClock,
    private readonly handles: HandleTable,
    private readonly log: KernelLogger,
  ) {}

  publish(from: Pid, channel: string, payload: unknown): number {
    const subscribers = this.byChannel.get(channel);
    if (!subscribers || subscribers.size === 0) return 0;
    const message: IpcMessage = { channel, from, at: this.clock.iso(), payload };
    let count = 0;
    // Snapshot: a handler may subscribe or unsubscribe during delivery.
    for (const subscription of [...subscribers.values()]) {
      try {
        subscription.deliver(message);
        count += 1;
        this.delivered += 1;
      } catch (error) {
        this.log.write(
          'System',
          'warning',
          1000,
          'Ipc',
          `Subscriber faulted on ${channel}`,
          { pid: subscription.pid as number, error: error instanceof Error ? error.message : String(error) },
          subscription.pid,
        );
      }
    }
    return count;
  }

  subscribe(pid: Pid, channel: string, deliver: (message: IpcMessage) => void): Handle {
    const handle = this.handles.open(pid, 'subscription', channel, () => this.detach(handle));
    const subscription: Subscription = { handle, pid, channel, deliver };
    let subscribers = this.byChannel.get(channel);
    if (!subscribers) {
      subscribers = new Map<number, Subscription>();
      this.byChannel.set(channel, subscribers);
    }
    subscribers.set(handle as number, subscription);
    this.byHandle.set(handle as number, subscription);
    return handle;
  }

  unsubscribe(handle: Handle): boolean {
    if (!this.byHandle.has(handle as number)) return false;
    // Route through the handle table so accounting stays consistent.
    return this.handles.close(handle);
  }

  dropProcess(pid: Pid): number {
    let dropped = 0;
    for (const subscription of [...this.byHandle.values()]) {
      if (subscription.pid === pid) {
        this.detach(subscription.handle);
        dropped += 1;
      }
    }
    return dropped;
  }

  channels(): readonly string[] {
    const live: string[] = [];
    for (const [channel, subscribers] of this.byChannel) {
      if (subscribers.size > 0) live.push(channel);
    }
    return live.sort();
  }

  deliveredCount(): number {
    return this.delivered;
  }

  /** Removes bookkeeping without touching the handle table (disposer path). */
  private detach(handle: Handle): void {
    const subscription = this.byHandle.get(handle as number);
    if (!subscription) return;
    this.byHandle.delete(handle as number);
    const subscribers = this.byChannel.get(subscription.channel);
    if (subscribers) {
      subscribers.delete(handle as number);
      if (subscribers.size === 0) this.byChannel.delete(subscription.channel);
    }
  }
}

export function createBus(clock: KernelClock, handles: HandleTable, log: KernelLogger): BusSubsystem {
  return new Bus(clock, handles, log);
}

/**
 * Well-known channels live in the ABI, because applications need the names to
 * subscribe. Re-exported here so kernel code keeps one import for bus concerns.
 */
export { IPC_CHANNELS } from '../abi';
