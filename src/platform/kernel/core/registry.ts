/**
 * Registry — hierarchical configuration store, the substrate under Settings.
 *
 * Two hives, as on Windows: `HKLM` for machine-wide policy and the installed-app
 * inventory, `HKCU` for the signed-in user's preferences. Keys are
 * case-insensitive for lookup and case-preserving for display. Apps get a
 * private island at `HKCU\Software\FinanceOS\AppSettings\<appId>` and cannot
 * read a sibling app's island — the syscall dispatcher enforces that.
 *
 * `HKLM\SYSTEM\CurrentControlSet\Services` is volatile: it is rebuilt from the
 * service table at every boot so a stale hive cannot resurrect a dead service.
 */
import type { RegistryEntry, RegistryValue } from '../abi';
import type { KernelClock, KernelLogger, RegistrySubsystem } from '../contracts';
import { EVENT_IDS } from './eventlog';
import { createFlusher, isRecord, type Flusher, type KernelStorage } from './persist';
import { createSignal } from './store';

/** Keys under these roots are never written to storage. */
const VOLATILE_ROOTS = ['hklm\\system\\currentcontrolset\\services'];

interface KeyNode {
  /** Display casing of the full key path. */
  readonly display: string;
  readonly values: Map<string, RegistryEntry>;
}

function canonical(key: string): string {
  return key.trim().replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/\\$/, '');
}

function isVolatile(key: string): boolean {
  const lower = canonical(key).toLowerCase();
  return VOLATILE_ROOTS.some((root) => lower === root || lower.startsWith(`${root}\\`));
}

function isRegistryValue(value: unknown): value is RegistryValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return true;
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

class Registry implements RegistrySubsystem {
  private readonly keys = new Map<string, KeyNode>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private readonly signal = createSignal();
  private readonly flusher: Flusher;

  constructor(
    private readonly clock: KernelClock,
    private readonly storage: KernelStorage,
    private readonly storageKey: string,
    private readonly log: KernelLogger,
  ) {
    this.flusher = createFlusher(400, () => this.persist());
    this.load();
  }

  get(key: string, name: string): RegistryValue | undefined {
    const node = this.keys.get(canonical(key).toLowerCase());
    return node?.values.get(name.toLowerCase())?.value;
  }

  getString(key: string, name: string, fallback: string): string {
    const value = this.get(key, name);
    return typeof value === 'string' ? value : fallback;
  }

  getNumber(key: string, name: string, fallback: number): number {
    const value = this.get(key, name);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  getBoolean(key: string, name: string, fallback: boolean): boolean {
    const value = this.get(key, name);
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1) return true;
    if (value === 'false' || value === 0) return false;
    return fallback;
  }

  set(key: string, name: string, value: RegistryValue): RegistryEntry {
    const display = canonical(key);
    const index = display.toLowerCase();
    let node = this.keys.get(index);
    if (!node) {
      node = { display, values: new Map<string, RegistryEntry>() };
      this.keys.set(index, node);
    }
    const entry: RegistryEntry = { key: display, name, value, modifiedAt: this.clock.iso() };
    const previous = node.values.get(name.toLowerCase());
    node.values.set(name.toLowerCase(), entry);

    if (previous === undefined || !sameValue(previous.value, value)) {
      if (!isVolatile(display)) this.flusher.schedule();
      this.notify(display);
      this.signal.bump();
    }
    return entry;
  }

  delete(key: string, name?: string): number {
    const display = canonical(key);
    const index = display.toLowerCase();
    let removed = 0;

    if (name !== undefined) {
      const node = this.keys.get(index);
      if (node?.values.delete(name.toLowerCase()) === true) removed = 1;
      if (node !== undefined && node.values.size === 0) this.keys.delete(index);
    } else {
      // Deleting a key removes the whole subtree, like `reg delete /f`.
      for (const [candidate, node] of [...this.keys]) {
        if (candidate === index || candidate.startsWith(`${index}\\`)) {
          removed += node.values.size;
          this.keys.delete(candidate);
        }
      }
    }

    if (removed > 0) {
      if (!isVolatile(display)) this.flusher.schedule();
      this.notify(display);
      this.signal.bump();
      this.log.write('System', 'information', EVENT_IDS.registryWrite, 'Registry', `Deleted ${display}`, {
        values: removed,
      });
    }
    return removed;
  }

  enumKeys(key: string): readonly string[] {
    const index = canonical(key).toLowerCase();
    const prefix = index === '' ? '' : `${index}\\`;
    const children = new Set<string>();
    for (const node of this.keys.values()) {
      const lower = node.display.toLowerCase();
      if (!lower.startsWith(prefix) || lower === index) continue;
      const rest = node.display.slice(prefix.length);
      const cut = rest.indexOf('\\');
      children.add(cut === -1 ? rest : rest.slice(0, cut));
    }
    return [...children].sort((a, b) => a.localeCompare(b));
  }

  enumValues(key: string): readonly RegistryEntry[] {
    const node = this.keys.get(canonical(key).toLowerCase());
    if (!node) return [];
    return [...node.values.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  watch(key: string, deliver: () => void): () => void {
    const index = canonical(key).toLowerCase();
    let listeners = this.watchers.get(index);
    if (!listeners) {
      listeners = new Set<() => void>();
      this.watchers.set(index, listeners);
    }
    listeners.add(deliver);
    return () => {
      const current = this.watchers.get(index);
      if (!current) return;
      current.delete(deliver);
      if (current.size === 0) this.watchers.delete(index);
    };
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  flush(): void {
    this.flusher.flush();
  }

  /** Fires watchers on the key and every ancestor (recursive by design). */
  private notify(key: string): void {
    const lower = key.toLowerCase();
    for (const [watched, listeners] of this.watchers) {
      if (lower === watched || lower.startsWith(`${watched}\\`)) {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            /* a faulting watcher must not block the rest */
          }
        }
      }
    }
  }

  private persist(): void {
    const payload: Record<string, Record<string, RegistryValue>> = {};
    for (const node of this.keys.values()) {
      if (isVolatile(node.display)) continue;
      const values: Record<string, RegistryValue> = {};
      for (const entry of node.values.values()) values[entry.name] = entry.value;
      payload[node.display] = values;
    }
    const ok = this.storage.write(this.storageKey, JSON.stringify(payload));
    if (!ok) {
      this.log.write('System', 'error', EVENT_IDS.quotaExceeded, 'Registry', 'Registry flush failed: storage quota', {
        keys: Object.keys(payload).length,
      });
    }
  }

  private load(): void {
    const raw = this.storage.read(this.storageKey);
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.log.write('System', 'warning', EVENT_IDS.registryWrite, 'Registry', 'Registry hive corrupt; starting clean');
      return;
    }
    if (!isRecord(parsed)) return;
    const at = this.clock.iso();
    for (const [key, values] of Object.entries(parsed)) {
      if (!isRecord(values)) continue;
      const display = canonical(key);
      if (display === '' || isVolatile(display)) continue;
      const node: KeyNode = { display, values: new Map<string, RegistryEntry>() };
      for (const [name, value] of Object.entries(values)) {
        if (!isRegistryValue(value)) continue;
        node.values.set(name.toLowerCase(), { key: display, name, value, modifiedAt: at });
      }
      this.keys.set(display.toLowerCase(), node);
    }
  }
}

function sameValue(a: RegistryValue, b: RegistryValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

export function createRegistry(
  clock: KernelClock,
  storage: KernelStorage,
  namespace: string,
  log: KernelLogger,
): RegistrySubsystem {
  return new Registry(clock, storage, `${namespace}:registry`, log);
}
