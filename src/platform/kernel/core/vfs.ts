/**
 * Virtual file system — path routing, watchers and cross-volume operations.
 *
 * Volumes own storage; this layer owns the namespace. It resolves a
 * volume-qualified path to its volume, enforces the read-only rule, implements
 * move/copy (including across volumes), runs recursive search and dispatches
 * watcher callbacks. Every app file operation lands here through a syscall.
 */
import {
  fail,
  succeed,
  type AbiResult,
  type VfsChange,
  type VfsContentType,
  type VfsStat,
  type VfsVolumeInfo,
} from '../abi';
import type { KernelLogger, VfsSubsystem, VfsVolume } from '../contracts';
import { EVENT_IDS } from './eventlog';
import { basename, contains, dirname, extname, join, normalize, parse, relative, volumeOf } from './paths';
import { createSignal } from './store';

interface Watcher {
  readonly path: string;
  readonly recursive: boolean;
  readonly deliver: (change: VfsChange) => void;
}

/** Content type inferred from an extension when the caller does not say. */
const EXTENSION_TYPES: Readonly<Record<string, VfsContentType>> = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.fsheet': 'application/vnd.financeos.sheet',
  '.fjournal': 'application/vnd.financeos.journal',
  '.freport': 'application/vnd.financeos.report',
  '.lnk': 'application/vnd.financeos.shortcut',
};

export function contentTypeFor(path: string): VfsContentType {
  return EXTENSION_TYPES[extname(path)] ?? 'application/octet-stream';
}

/** Standard folders created under the user profile at first boot. */
const PROFILE_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Reports', 'Statements', 'Templates'] as const;

class Vfs implements VfsSubsystem {
  private readonly mounted = new Map<string, VfsVolume>();
  private readonly watchers = new Set<Watcher>();
  private readonly signal = createSignal();
  private readonly unhooks: (() => void)[] = [];

  constructor(private readonly log: KernelLogger) {}

  mount(volume: VfsVolume): void {
    const letter = volume.letter.toUpperCase();
    this.mounted.set(letter, volume);
    // Volumes report *volume-relative* paths; the namespace layer qualifies them.
    this.unhooks.push(
      volume.onChange((change) =>
        this.dispatch({
          kind: change.kind,
          path: change.path === '' ? `${letter}:\\` : `${letter}:\\${change.path}`,
          at: change.at,
        }),
      ),
    );
    this.log.write('System', 'information', EVENT_IDS.volumeMounted, 'Vfs', `Mounted ${letter}:`, {
      kind: volume.kind,
      readOnly: volume.readOnly,
      quotaBytes: volume.quotaBytes,
    });
    this.signal.bump();
  }

  /** Detaches every volume change hook. Called during shutdown. */
  unmountAll(): void {
    for (const unhook of this.unhooks) unhook();
    this.unhooks.length = 0;
    this.mounted.clear();
    this.watchers.clear();
    this.signal.bump();
  }

  volumes(): readonly VfsVolumeInfo[] {
    return [...this.mounted.values()]
      .map((volume) => ({
        letter: volume.letter,
        label: volume.label,
        kind: volume.kind,
        readOnly: volume.readOnly,
        usedBytes: volume.usedBytes(),
        quotaBytes: volume.quotaBytes,
      }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
  }

  stat(path: string): AbiResult<VfsStat> {
    const resolved = this.route(path);
    if (!resolved.ok) return resolved;
    const stat = resolved.value.volume.stat(resolved.value.rest);
    return stat === null ? fail('NOT_FOUND', `Path not found: ${normalize(path)}`) : succeed(stat);
  }

  list(path: string, showHidden: boolean): AbiResult<readonly VfsStat[]> {
    const resolved = this.route(path);
    if (!resolved.ok) return resolved;
    const entries = resolved.value.volume.list(resolved.value.rest);
    if (entries === null) return fail('NOT_FOUND', `Folder not found: ${normalize(path)}`);
    return succeed(showHidden ? entries : entries.filter((entry) => !entry.hidden));
  }

  readText(path: string): AbiResult<{ content: string; stat: VfsStat }> {
    const resolved = this.route(path);
    if (!resolved.ok) return resolved;
    const { volume, rest } = resolved.value;
    const stat = volume.stat(rest);
    if (stat === null) return fail('NOT_FOUND', `File not found: ${normalize(path)}`);
    if (stat.kind !== 'file') return fail('INVALID_ARGUMENT', `${stat.name} is a folder`);
    const content = volume.readText(rest);
    return content === null ? fail('IO_ERROR', `Unable to read ${stat.path}`) : succeed({ content, stat });
  }

  writeText(
    path: string,
    content: string,
    contentType: VfsContentType,
    createOnly: boolean,
  ): AbiResult<VfsStat> {
    const resolved = this.route(path);
    if (!resolved.ok) return resolved;
    const { volume, rest } = resolved.value;
    if (createOnly && volume.stat(rest) !== null) {
      return fail('ALREADY_EXISTS', `File already exists: ${normalize(path)}`);
    }
    const result = volume.writeText(rest, content, contentType);
    if (result.ok) this.signal.bump();
    return result;
  }

  mkdir(path: string, recursive: boolean): AbiResult<VfsStat> {
    const resolved = this.route(path);
    if (!resolved.ok) return resolved;
    const result = resolved.value.volume.mkdir(resolved.value.rest, recursive);
    if (result.ok) this.signal.bump();
    return result;
  }

  remove(path: string, recursive: boolean): AbiResult<number> {
    const resolved = this.route(path);
    if (!resolved.ok) return resolved;
    const result = resolved.value.volume.remove(resolved.value.rest, recursive);
    if (result.ok) this.signal.bump();
    return result;
  }

  move(from: string, to: string, overwrite: boolean): AbiResult<VfsStat> {
    if (contains(from, to) && !this.samePath(from, to)) {
      return fail('INVALID_ARGUMENT', 'Cannot move a folder into itself');
    }
    const copied = this.copy(from, to, overwrite);
    if (!copied.ok) return copied;
    const removed = this.remove(from, true);
    if (!removed.ok) {
      // The destination now exists but the source survived: report the failure
      // rather than pretend the move happened.
      return fail('IO_ERROR', `Copied to ${copied.value.path} but could not remove ${normalize(from)}`);
    }
    return copied;
  }

  copy(from: string, to: string, overwrite: boolean): AbiResult<VfsStat> {
    const source = this.stat(from);
    if (!source.ok) return source;

    const destinationExists = this.stat(to);
    if (destinationExists.ok && !overwrite) {
      return fail('ALREADY_EXISTS', `Destination already exists: ${normalize(to)}`);
    }

    if (source.value.kind === 'file') {
      const read = this.readText(from);
      if (!read.ok) return read;
      return this.writeText(to, read.value.content, source.value.contentType, false);
    }

    // Directory: create the destination then copy children depth-first.
    const created = this.mkdir(to, true);
    if (!created.ok) return created;
    const children = this.list(from, true);
    if (!children.ok) return children;
    for (const child of children.value) {
      const nested = this.copy(child.path, join(to, child.name), overwrite);
      if (!nested.ok) return nested;
    }
    return this.stat(to);
  }

  search(root: string, query: string, limit: number): AbiResult<readonly VfsStat[]> {
    const needle = query.trim().toLowerCase();
    if (needle === '') return succeed([]);
    const start = this.stat(root);
    if (!start.ok) return start;

    const found: VfsStat[] = [];
    const queue: string[] = [start.value.path];
    let visited = 0;
    // Breadth-first with a hard node budget: search must stay interactive.
    while (queue.length > 0 && found.length < limit && visited < 20000) {
      const current = queue.shift();
      if (current === undefined) break;
      const entries = this.list(current, true);
      if (!entries.ok) continue;
      for (const entry of entries.value) {
        visited += 1;
        if (entry.name.toLowerCase().includes(needle)) {
          found.push(entry);
          if (found.length >= limit) break;
        }
        if (entry.kind === 'directory') queue.push(entry.path);
      }
    }
    return succeed(found);
  }

  watch(path: string, recursive: boolean, deliver: (change: VfsChange) => void): () => void {
    const watcher: Watcher = { path: normalize(path), recursive, deliver };
    this.watchers.add(watcher);
    return () => {
      this.watchers.delete(watcher);
    };
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  ensureUserProfile(userFolder: string): void {
    this.mkdir(userFolder, true);
    for (const folder of PROFILE_FOLDERS) this.mkdir(join(userFolder, folder), true);
  }

  /** Resolves a path to its volume plus the volume-relative remainder. */
  private route(path: string): AbiResult<{ volume: VfsVolume; rest: string }> {
    const parsed = parse(path);
    if (parsed === null) {
      return fail('INVALID_ARGUMENT', `Not an absolute path: ${path}`, { path });
    }
    const volume = this.mounted.get(parsed.volume);
    if (volume === undefined) {
      return fail('NOT_FOUND', `No such volume: ${parsed.volume}:`, { volume: parsed.volume });
    }
    return succeed({ volume, rest: parsed.segments.join('\\') });
  }

  private samePath(a: string, b: string): boolean {
    return normalize(a).toLowerCase() === normalize(b).toLowerCase();
  }

  private dispatch(change: VfsChange): void {
    for (const watcher of [...this.watchers]) {
      const matches = watcher.recursive
        ? contains(watcher.path, change.path)
        : this.samePath(watcher.path, dirname(change.path)) || this.samePath(watcher.path, change.path);
      if (!matches) continue;
      try {
        watcher.deliver(change);
      } catch {
        /* a faulting watcher must not block the rest */
      }
    }
    this.signal.bump();
  }
}

/** The concrete VFS, exposing `unmountAll` for the kernel's shutdown path. */
export interface VfsHandle extends VfsSubsystem {
  unmountAll(): void;
}

export function createVfs(log: KernelLogger): VfsHandle {
  return new Vfs(log);
}

/** Name shown in a file dialog's address bar for a volume root. */
export function displayName(path: string): string {
  return relative(path) === '' ? `${volumeOf(path) ?? '?'}:` : basename(path);
}
