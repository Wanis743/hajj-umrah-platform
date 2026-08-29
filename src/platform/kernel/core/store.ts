/**
 * Kernel store — the reactive primitive every subsystem publishes through.
 *
 * Notifications are coalesced into a microtask so a burst of kernel mutations
 * results in a single React paint. `revision` increments on every accepted
 * mutation, giving cheap change detection for diagnostics.
 */
import type { KernelStore } from '../contracts';

class Store<T> implements KernelStore<T> {
  private value: T;
  private listeners = new Set<() => void>();
  private scheduled = false;
  private rev = 0;

  constructor(initial: T) {
    this.value = initial;
  }

  get revision(): number {
    return this.rev;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    if (next === this.value) return;
    this.value = next;
    this.rev += 1;
    this.notify();
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const listener of [...this.listeners]) listener();
    });
  }
}

export function createStore<T>(initial: T): KernelStore<T> {
  return new Store(initial);
}

/**
 * A store whose value is a monotonic counter. Subsystems that keep their own
 * mutable maps use this as a "something changed" signal for React.
 */
export interface RevisionSignal {
  bump(): void;
  subscribe(listener: () => void): () => void;
  value(): number;
}

export function createSignal(): RevisionSignal {
  const store = createStore(0);
  return {
    bump: () => store.update((n) => n + 1),
    subscribe: (listener) => store.subscribe(listener),
    value: () => store.get(),
  };
}
