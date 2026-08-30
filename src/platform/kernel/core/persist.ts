/**
 * Persistence backend for the registry and the `C:` volume.
 *
 * The kernel is the *only* layer allowed to touch `localStorage` — apps reach
 * storage through the VFS and the registry, which is what makes their state
 * inspectable in Regedit instead of hidden in browser storage.
 *
 * Writes are coalesced through a flusher so a burst of registry sets costs one
 * serialization, and every access is defensive: private-browsing modes and
 * quota exhaustion must degrade to memory rather than fault the kernel.
 */

export interface KernelStorage {
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
  /** Keys under a prefix, prefix included. */
  keys(prefix: string): readonly string[];
  /** True when writes survive a reload. */
  readonly durable: boolean;
  /** Approximate bytes currently stored under `prefix`. */
  usage(prefix: string): number;
}

class MemoryStorage implements KernelStorage {
  readonly durable = false;
  private readonly map = new Map<string, string>();

  read(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  write(key: string, value: string): boolean {
    this.map.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(prefix: string): readonly string[] {
    return [...this.map.keys()].filter((key) => key.startsWith(prefix));
  }

  usage(prefix: string): number {
    let bytes = 0;
    for (const [key, value] of this.map) {
      if (key.startsWith(prefix)) bytes += key.length + value.length;
    }
    return bytes;
  }
}

class WebStorage implements KernelStorage {
  readonly durable = true;

  constructor(private readonly backing: Storage) {}

  read(key: string): string | null {
    try {
      return this.backing.getItem(key);
    } catch {
      return null;
    }
  }

  write(key: string, value: string): boolean {
    try {
      this.backing.setItem(key, value);
      return true;
    } catch {
      // Quota exhausted or storage disabled mid-session.
      return false;
    }
  }

  remove(key: string): void {
    try {
      this.backing.removeItem(key);
    } catch {
      /* nothing to do — the entry is unreachable either way */
    }
  }

  keys(prefix: string): readonly string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < this.backing.length; i += 1) {
        const key = this.backing.key(i);
        if (key !== null && key.startsWith(prefix)) out.push(key);
      }
    } catch {
      return out;
    }
    return out;
  }

  usage(prefix: string): number {
    let bytes = 0;
    for (const key of this.keys(prefix)) {
      bytes += key.length + (this.read(key)?.length ?? 0);
    }
    return bytes;
  }
}

/**
 * Resolves the best available backend. `ephemeral` forces memory, which the
 * boot self-check and tests rely on for isolation.
 */
export function createStorage(ephemeral: boolean): KernelStorage {
  if (ephemeral) return new MemoryStorage();
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return new MemoryStorage();
    }
    // Probe: Safari private mode throws on the first write, not on access.
    const probe = '__financeos_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new WebStorage(window.localStorage);
  } catch {
    return new MemoryStorage();
  }
}

export interface Flusher {
  /** Marks state dirty; the write happens on the next idle window. */
  schedule(): void;
  /** Writes immediately if dirty. */
  flush(): void;
  dispose(): void;
}

/**
 * Coalesces writes. Registry sets during boot number in the hundreds; without
 * this each one would serialize the whole hive.
 */
export function createFlusher(delayMs: number, write: () => void): Flusher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const run = () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    write();
  };

  return {
    schedule() {
      dirty = true;
      if (timer !== null) return;
      timer = setTimeout(run, delayMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      dirty = false;
    },
  };
}

/** Parses persisted JSON, returning `null` on any corruption. */
export function readJson<T>(storage: KernelStorage, key: string, guard: (value: unknown) => value is T): T | null {
  const raw = storage.read(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArrayOf<T>(guard: (value: unknown) => value is T) {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}
