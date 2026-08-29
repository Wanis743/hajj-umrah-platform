/**
 * VFS volumes.
 *
 * Three volume kinds back the file system:
 *   `C:` persistent — the user's documents, survives reload via `KernelStorage`.
 *   `X:` memory     — scratch space, cleared at shutdown (temp files, exports).
 *   `L:` projection — a read-only *view* of ledger data published by a service,
 *                     so the chart of accounts is browsable in Explorer.
 *
 * All three share one tree implementation: an in-memory directory graph with
 * case-insensitive lookup and case-preserving names, exactly like NTFS.
 */
import {
  fail,
  succeed,
  type AbiResult,
  type Localized,
  type VfsChange,
  type VfsContentType,
  type VfsNodeKind,
  type VfsStat,
  type VfsVolumeInfo,
} from '../abi';
import type { IsoTimestamp } from '../types';
import type { KernelClock, VfsVolume } from '../contracts';
import { isValidName } from './paths';
import { createFlusher, isRecord, type Flusher, type KernelStorage } from './persist';

interface Node {
  name: string;
  kind: VfsNodeKind;
  contentType: VfsContentType;
  content: string;
  createdAt: IsoTimestamp;
  modifiedAt: IsoTimestamp;
  readOnly: boolean;
  hidden: boolean;
  /** Present for directories only; keyed by lower-cased name. */
  children?: Map<string, Node>;
}

interface TreeOptions {
  readonly letter: string;
  readonly label: Localized;
  readonly kind: VfsVolumeInfo['kind'];
  readonly readOnly: boolean;
  readonly quotaBytes: number;
  readonly clock: KernelClock;
  /** Called after every accepted mutation so a persistent volume can flush. */
  readonly onMutate?: () => void;
}

function splitRelative(relativePath: string): string[] {
  return relativePath
    .replace(/\//g, '\\')
    .split('\\')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

class TreeVolume implements VfsVolume {
  readonly letter: string;
  readonly label: Localized;
  readonly kind: VfsVolumeInfo['kind'];
  readonly quotaBytes: number;

  protected root: Node;
  protected readonly clock: KernelClock;
  private readonly listeners = new Set<(change: VfsChange) => void>();
  private mutable: boolean;
  private readonly onMutate: (() => void) | undefined;

  constructor(options: TreeOptions) {
    this.letter = options.letter.toUpperCase();
    this.label = options.label;
    this.kind = options.kind;
    this.quotaBytes = options.quotaBytes;
    this.mutable = !options.readOnly;
    this.clock = options.clock;
    this.onMutate = options.onMutate;
    const at = options.clock.iso();
    this.root = {
      name: '',
      kind: 'directory',
      contentType: 'application/octet-stream',
      content: '',
      createdAt: at,
      modifiedAt: at,
      readOnly: options.readOnly,
      hidden: false,
      children: new Map<string, Node>(),
    };
  }

  get readOnly(): boolean {
    return !this.mutable;
  }

  /* ---------------- reads ---------------- */

  stat(relativePath: string): VfsStat | null {
    const node = this.resolve(splitRelative(relativePath));
    return node === null ? null : this.toStat(node, splitRelative(relativePath));
  }

  list(relativePath: string): readonly VfsStat[] | null {
    const segments = splitRelative(relativePath);
    const node = this.resolve(segments);
    if (node === null || node.kind !== 'directory' || node.children === undefined) return null;
    return [...node.children.values()]
      .map((child) => this.toStat(child, [...segments, child.name]))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  readText(relativePath: string): string | null {
    const node = this.resolve(splitRelative(relativePath));
    return node !== null && node.kind === 'file' ? node.content : null;
  }

  usedBytes(): number {
    let bytes = 0;
    const walk = (node: Node) => {
      bytes += node.name.length * 2;
      if (node.kind === 'file') bytes += node.content.length * 2;
      if (node.children) for (const child of node.children.values()) walk(child);
    };
    walk(this.root);
    return bytes;
  }

  /* ---------------- writes ---------------- */

  writeText(relativePath: string, content: string, contentType: VfsContentType): AbiResult<VfsStat> {
    if (!this.mutable) return fail('PERMISSION_DENIED', `Volume ${this.letter}: is read-only`);
    const segments = splitRelative(relativePath);
    const name = segments[segments.length - 1];
    if (name === undefined) return fail('INVALID_ARGUMENT', 'A file name is required');
    if (!isValidName(name)) return fail('INVALID_ARGUMENT', `Invalid file name: ${name}`);

    const parent = this.resolve(segments.slice(0, -1));
    if (parent === null || parent.children === undefined) {
      return fail('NOT_FOUND', `Directory not found: ${segments.slice(0, -1).join('\\')}`);
    }

    const existing = parent.children.get(name.toLowerCase());
    if (existing !== undefined && existing.kind === 'directory') {
      return fail('ALREADY_EXISTS', `${name} is a directory`);
    }
    if (existing !== undefined && existing.readOnly) {
      return fail('PERMISSION_DENIED', `${name} is read-only`);
    }

    const delta = (content.length - (existing?.content.length ?? 0)) * 2;
    if (delta > 0 && this.usedBytes() + delta > this.quotaBytes) {
      return fail('QUOTA_EXCEEDED', `Volume ${this.letter}: is full`, { quotaBytes: this.quotaBytes });
    }

    const at = this.clock.iso();
    const node: Node = existing ?? {
      name,
      kind: 'file',
      contentType,
      content: '',
      createdAt: at,
      modifiedAt: at,
      readOnly: false,
      hidden: name.startsWith('.'),
    };
    node.content = content;
    node.contentType = contentType;
    node.modifiedAt = at;
    parent.children.set(name.toLowerCase(), node);
    parent.modifiedAt = at;

    this.mutated({ kind: existing === undefined ? 'created' : 'modified', path: segments.join('\\'), at });
    return succeed(this.toStat(node, segments));
  }

  mkdir(relativePath: string, recursive: boolean): AbiResult<VfsStat> {
    if (!this.mutable) return fail('PERMISSION_DENIED', `Volume ${this.letter}: is read-only`);
    const segments = splitRelative(relativePath);
    if (segments.length === 0) return succeed(this.toStat(this.root, []));

    let cursor = this.root;
    for (let i = 0; i < segments.length; i += 1) {
      const name = segments[i];
      if (!isValidName(name)) return fail('INVALID_ARGUMENT', `Invalid folder name: ${name}`);
      if (cursor.children === undefined) return fail('INVALID_STATE', `${cursor.name} is not a directory`);
      const existing = cursor.children.get(name.toLowerCase());
      if (existing !== undefined) {
        if (existing.kind === 'file') return fail('ALREADY_EXISTS', `${name} is a file`);
        if (i === segments.length - 1 && !recursive) {
          return fail('ALREADY_EXISTS', `Folder already exists: ${name}`);
        }
        cursor = existing;
        continue;
      }
      if (!recursive && i < segments.length - 1) {
        return fail('NOT_FOUND', `Parent folder missing: ${segments.slice(0, i + 1).join('\\')}`);
      }
      const at = this.clock.iso();
      const created: Node = {
        name,
        kind: 'directory',
        contentType: 'application/octet-stream',
        content: '',
        createdAt: at,
        modifiedAt: at,
        readOnly: false,
        hidden: name.startsWith('.'),
        children: new Map<string, Node>(),
      };
      cursor.children.set(name.toLowerCase(), created);
      cursor.modifiedAt = at;
      cursor = created;
      this.mutated({ kind: 'created', path: segments.slice(0, i + 1).join('\\'), at });
    }
    return succeed(this.toStat(cursor, segments));
  }

  remove(relativePath: string, recursive: boolean): AbiResult<number> {
    if (!this.mutable) return fail('PERMISSION_DENIED', `Volume ${this.letter}: is read-only`);
    const segments = splitRelative(relativePath);
    if (segments.length === 0) return fail('INVALID_ARGUMENT', 'Cannot remove a volume root');

    const parent = this.resolve(segments.slice(0, -1));
    const name = segments[segments.length - 1];
    if (parent === null || parent.children === undefined) return fail('NOT_FOUND', `Not found: ${relativePath}`);
    const node = parent.children.get(name.toLowerCase());
    if (node === undefined) return fail('NOT_FOUND', `Not found: ${relativePath}`);
    if (node.readOnly) return fail('PERMISSION_DENIED', `${node.name} is read-only`);
    if (node.kind === 'directory' && node.children !== undefined && node.children.size > 0 && !recursive) {
      return fail('INVALID_STATE', `Folder is not empty: ${node.name}`);
    }

    const removed = countNodes(node);
    parent.children.delete(name.toLowerCase());
    const at = this.clock.iso();
    parent.modifiedAt = at;
    this.mutated({ kind: 'deleted', path: segments.join('\\'), at });
    return succeed(removed);
  }

  onChange(listener: (change: VfsChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ---------------- internals ---------------- */

  protected resolve(segments: readonly string[]): Node | null {
    let cursor: Node = this.root;
    for (const segment of segments) {
      if (cursor.children === undefined) return null;
      const next = cursor.children.get(segment.toLowerCase());
      if (next === undefined) return null;
      cursor = next;
    }
    return cursor;
  }

  protected toStat(node: Node, segments: readonly string[]): VfsStat {
    return {
      path: segments.length === 0 ? `${this.letter}:\\` : `${this.letter}:\\${segments.join('\\')}`,
      name: segments.length === 0 ? `${this.letter}:` : node.name,
      kind: node.kind,
      contentType: node.contentType,
      size: node.kind === 'file' ? node.content.length : (node.children?.size ?? 0),
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
      readOnly: this.readOnly || node.readOnly,
      volume: this.letter,
      hidden: node.hidden,
    };
  }

  protected mutated(change: VfsChange): void {
    this.onMutate?.();
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        /* a faulting watcher must not abort the write */
      }
    }
  }

  /** Serializes the tree for persistence. Directories keep their metadata. */
  protected serialize(): SerializedNode {
    const encode = (node: Node): SerializedNode => ({
      n: node.name,
      k: node.kind === 'directory' ? 'd' : 'f',
      t: node.contentType,
      c: node.kind === 'file' ? node.content : '',
      a: node.createdAt as string,
      m: node.modifiedAt as string,
      r: node.readOnly,
      h: node.hidden,
      ch: node.children === undefined ? undefined : [...node.children.values()].map(encode),
    });
    return encode(this.root);
  }

  protected hydrate(serialized: unknown): boolean {
    const decode = (value: unknown): Node | null => {
      if (!isRecord(value)) return null;
      const name = typeof value.n === 'string' ? value.n : null;
      const kind = value.k === 'd' ? 'directory' : value.k === 'f' ? 'file' : null;
      if (name === null || kind === null) return null;
      const at = this.clock.iso();
      const node: Node = {
        name,
        kind,
        contentType: typeof value.t === 'string' ? (value.t as VfsContentType) : 'application/octet-stream',
        content: typeof value.c === 'string' ? value.c : '',
        createdAt: (typeof value.a === 'string' ? value.a : at) as IsoTimestamp,
        modifiedAt: (typeof value.m === 'string' ? value.m : at) as IsoTimestamp,
        readOnly: value.r === true,
        hidden: value.h === true,
      };
      if (kind === 'directory') {
        node.children = new Map<string, Node>();
        if (Array.isArray(value.ch)) {
          for (const raw of value.ch) {
            const child = decode(raw);
            if (child !== null) node.children.set(child.name.toLowerCase(), child);
          }
        }
      }
      return node;
    };
    const root = decode(serialized);
    if (root === null || root.kind !== 'directory') return false;
    this.root = root;
    this.root.name = '';
    this.root.readOnly = this.readOnly;
    return true;
  }

  /** Replaces the whole tree — used by projection volumes on refresh. */
  protected replaceRoot(children: Map<string, Node>): void {
    this.root.children = children;
    this.root.modifiedAt = this.clock.iso();
  }

  protected makeNode(
    name: string,
    kind: VfsNodeKind,
    contentType: VfsContentType,
    content: string,
    readOnly: boolean,
  ): Node {
    const at = this.clock.iso();
    const node: Node = {
      name,
      kind,
      contentType,
      content,
      createdAt: at,
      modifiedAt: at,
      readOnly,
      hidden: false,
    };
    if (kind === 'directory') node.children = new Map<string, Node>();
    return node;
  }

  protected setMutable(value: boolean): void {
    this.mutable = value;
  }
}

interface SerializedNode {
  n: string;
  k: 'd' | 'f';
  t: string;
  c: string;
  a: string;
  m: string;
  r: boolean;
  h: boolean;
  ch?: SerializedNode[];
}

function countNodes(node: Node): number {
  let count = 1;
  if (node.children) for (const child of node.children.values()) count += countNodes(child);
  return count;
}

/* ------------------------------------------------------------------ *
 * `C:` — persistent
 * ------------------------------------------------------------------ */

class PersistentVolume extends TreeVolume {
  private readonly flusher: Flusher;

  constructor(
    options: Omit<TreeOptions, 'onMutate' | 'kind' | 'readOnly'>,
    private readonly storage: KernelStorage,
    private readonly storageKey: string,
  ) {
    // `schedule` is a late-bound hook: the base constructor may fire `onMutate`
    // before the flusher exists, so the indirection keeps that a no-op.
    let schedule: (() => void) | null = null;
    super({ ...options, kind: 'persistent', readOnly: false, onMutate: () => schedule?.() });
    this.flusher = createFlusher(500, () => {
      this.storage.write(this.storageKey, JSON.stringify(this.serialize()));
    });
    schedule = () => this.flusher.schedule();
    this.load();
  }

  flush(): void {
    this.flusher.flush();
  }

  private load(): void {
    const raw = this.storage.read(this.storageKey);
    if (raw === null) return;
    try {
      this.hydrate(JSON.parse(raw));
    } catch {
      /* corrupt image — boot with an empty volume rather than faulting */
    }
  }
}

export interface PersistentVolumeHandle extends VfsVolume {
  flush(): void;
}

export function createPersistentVolume(
  letter: string,
  label: Localized,
  quotaBytes: number,
  clock: KernelClock,
  storage: KernelStorage,
  namespace: string,
): PersistentVolumeHandle {
  return new PersistentVolume(
    { letter, label, quotaBytes, clock },
    storage,
    `${namespace}:volume:${letter.toUpperCase()}`,
  );
}

/* ------------------------------------------------------------------ *
 * `X:` — memory
 * ------------------------------------------------------------------ */

export function createMemoryVolume(
  letter: string,
  label: Localized,
  quotaBytes: number,
  clock: KernelClock,
): VfsVolume {
  return new TreeVolume({ letter, label, quotaBytes, clock, kind: 'memory', readOnly: false });
}

/* ------------------------------------------------------------------ *
 * `L:` — ledger projection
 * ------------------------------------------------------------------ */

export interface ProjectedEntry {
  /** Relative path inside the volume, e.g. `Accounts\\1000 - Cash.json`. */
  readonly path: string;
  readonly contentType: VfsContentType;
  readonly content: string;
}

export interface ProjectionVolumeHandle extends VfsVolume {
  /** Atomically replaces the projected tree. Called by the indexer service. */
  publish(entries: readonly ProjectedEntry[]): void;
  lastPublishedAt(): IsoTimestamp | null;
}

class ProjectionVolume extends TreeVolume implements ProjectionVolumeHandle {
  private publishedAt: IsoTimestamp | null = null;

  constructor(options: Omit<TreeOptions, 'kind' | 'readOnly' | 'onMutate'>) {
    super({ ...options, kind: 'projection', readOnly: true });
  }

  publish(entries: readonly ProjectedEntry[]): void {
    const children = new Map<string, Node>();
    for (const entry of entries) {
      const segments = splitRelative(entry.path);
      if (segments.length === 0) continue;
      let level = children;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const name = segments[i];
        let folder = level.get(name.toLowerCase());
        if (folder === undefined || folder.kind !== 'directory') {
          folder = this.makeNode(name, 'directory', 'application/octet-stream', '', true);
          level.set(name.toLowerCase(), folder);
        }
        folder.children ??= new Map<string, Node>();
        level = folder.children;
      }
      const fileName = segments[segments.length - 1];
      level.set(fileName.toLowerCase(), this.makeNode(fileName, 'file', entry.contentType, entry.content, true));
    }
    this.replaceRoot(children);
    this.publishedAt = this.clock.iso();
    // Volume-relative: `''` means "the whole volume changed".
    this.mutated({ kind: 'modified', path: '', at: this.publishedAt });
  }

  lastPublishedAt(): IsoTimestamp | null {
    return this.publishedAt;
  }
}

export function createProjectionVolume(
  letter: string,
  label: Localized,
  quotaBytes: number,
  clock: KernelClock,
): ProjectionVolumeHandle {
  return new ProjectionVolume({ letter, label, quotaBytes, clock });
}
