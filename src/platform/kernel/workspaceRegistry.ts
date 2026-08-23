/**
 * Workspace Registry (spec §7, §61) — persistent workspaces, saved layouts,
 * views, tabs, pinned objects. A reload must not destroy professional context.
 *
 * Storage adapter is injectable: localStorage in the browser, in-memory in
 * tests, Supabase-backed later for cross-device persistence.
 */

import type { KernelError, Result, WorkspaceId } from './types.ts';
import { err, ok } from './types.ts';

export interface PanelLayout {
  readonly id: string;
  readonly kind: 'grid' | 'split' | 'inspector' | 'console' | 'library';
  /** Split ratio 0..1 when kind = split; column widths otherwise normalized. */
  readonly sizes: readonly number[];
}

export interface WorkspaceDocument {
  readonly id: WorkspaceId;
  readonly nameKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly layout: PanelLayout;
  /** Open objects per panel position (object refs as typeId/id pairs). */
  readonly openObjects: readonly { readonly objectTypeId: string; readonly objectId: string }[];
  readonly activeObjectId: string | null;
  /** Saved filters (§61: filters persisted only if saved). */
  readonly savedFilters: Readonly<Record<string, unknown>>;
  readonly pinnedObjectIds: readonly string[];
  readonly mode: 'live' | 'snapshot' | 'simulation';
}

interface SerializedState {
  version: 1;
  workspaces: WorkspaceDocument[];
  activeWorkspaceId: WorkspaceId | null;
}

export interface WorkspaceStorage {
  load(): SerializedState | null;
  save(state: SerializedState): void;
}

export class InMemoryWorkspaceStorage implements WorkspaceStorage {
  private state: SerializedState | null = null;
  load(): SerializedState | null {
    return this.state;
  }
  save(state: SerializedState): void {
    this.state = structuredClone(state);
  }
}

export class LocalStorageWorkspaceStorage implements WorkspaceStorage {
  private readonly key: string;

  constructor(key: string = 'platform.workspaceRegistry.v1') {
    this.key = key;
  }

  load(): SerializedState | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(this.key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SerializedState;
    } catch {
      return null;
    }
  }

  save(state: SerializedState): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(this.key, JSON.stringify(state));
  }
}

const WS_ERR = 'WORKSPACE_REGISTRY' as const;

const defaultLayout: PanelLayout = {
  id: 'default',
  kind: 'grid',
  sizes: [1],
};

export class WorkspaceRegistry {
  private readonly storage: WorkspaceStorage;
  private readonly workspaces = new Map<WorkspaceId, WorkspaceDocument>();
  private activeId: WorkspaceId | null = null;

  constructor(storage: WorkspaceStorage = new InMemoryWorkspaceStorage()) {
    this.storage = storage;
    const restored = storage.load();
    if (restored !== null && restored.version === 1) {
      for (const ws of restored.workspaces) this.workspaces.set(ws.id, ws);
      this.activeId = restored.activeWorkspaceId;
    }
  }

  create(input: { id?: WorkspaceId; nameKey: string }): WorkspaceDocument {
    const now = new Date().toISOString();
    const id: WorkspaceId =
      input.id ?? (`ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as WorkspaceId);
    const doc: WorkspaceDocument = {
      id,
      nameKey: input.nameKey,
      createdAt: now,
      updatedAt: now,
      layout: defaultLayout,
      openObjects: [],
      activeObjectId: null,
      savedFilters: {},
      pinnedObjectIds: [],
      mode: 'live',
    };
    this.workspaces.set(id, doc);
    this.activeId = id;
    this.persist();
    return doc;
  }

  get(id: WorkspaceId): Result<WorkspaceDocument, KernelError> {
    const ws = this.workspaces.get(id);
    if (!ws) return err({ code: 'NOT_FOUND', message: `Unknown workspace: ${id}`, details: { domain: WS_ERR } });
    return ok(ws);
  }

  list(): readonly WorkspaceDocument[] {
    return [...this.workspaces.values()];
  }

  active(): WorkspaceDocument | null {
    return this.activeId !== null ? (this.workspaces.get(this.activeId) ?? null) : null;
  }

  setActive(id: WorkspaceId): Result<null, KernelError> {
    if (!this.workspaces.has(id)) {
      return err({ code: 'NOT_FOUND', message: `Unknown workspace: ${id}`, details: { domain: WS_ERR } });
    }
    this.activeId = id;
    this.persist();
    return ok(null);
  }

  update(id: WorkspaceId, patch: Partial<Omit<WorkspaceDocument, 'id' | 'createdAt'>>): Result<WorkspaceDocument, KernelError> {
    const current = this.workspaces.get(id);
    if (!current) return err({ code: 'NOT_FOUND', message: `Unknown workspace: ${id}`, details: { domain: WS_ERR } });
    const updated: WorkspaceDocument = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.workspaces.set(id, updated);
    this.persist();
    return ok(updated);
  }

  close(id: WorkspaceId): Result<null, KernelError> {
    if (!this.workspaces.delete(id)) {
      return err({ code: 'NOT_FOUND', message: `Unknown workspace: ${id}`, details: { domain: WS_ERR } });
    }
    if (this.activeId === id) {
      const nextActive = this.workspaces.keys().next();
      this.activeId = nextActive.done ? null : (nextActive.value as WorkspaceId);
    }
    this.persist();
    return ok(null);
  }

  private persist(): void {
    this.storage.save({
      version: 1,
      workspaces: [...this.workspaces.values()],
      activeWorkspaceId: this.activeId,
    });
  }
}
