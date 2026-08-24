/**
 * Compatibility adapter (V12 §17.5): exposes the legacy `src/lib/kernel`
 * WorkspaceRegistry surface, backed by the NEW platform kernel
 * (`src/platform/kernel/workspaceRegistry`). This lets every V10 workspace
 * consume the single authoritative platform kernel without a behavioral
 * big-bang rewrite. All legacy imports are repointed here; the old
 * src/lib/kernel implementation is retired.
 *
 * Mapping:
 *   WorkspaceState (legacy)      <-> WorkspaceDocument (platform)
 *   createWorkspace(state)       -> create({id}) + setActive(id)
 *   getWorkspaces()              -> list()
 *   getActiveWorkspace()         -> active()
 *   setActiveWorkspace(id)       -> setActive(id)
 *   updateWorkspace(id, patch)   -> update(id, patch)
 *   subscribe(listener)          -> listener set + immediate emit
 */
import {
  WorkspaceRegistry as PlatformWorkspaceRegistry,
} from '../kernel/workspaceRegistry';
import type { WorkspaceId } from '../kernel/types';

export type CommandId = string;
export type PanelId = string;

/** Legacy panel shape preserved verbatim for V10 component compatibility. */
export interface PanelState {
  id: PanelId;
  title: string;
  type: string;
  componentType: string;
  props: Record<string, unknown>;
}

/** Legacy workspace shape preserved verbatim for V10 component compatibility. */
export interface WorkspaceState {
  id: string;
  name: string;
  panels: PanelState[];
  activePanelId: PanelId | null;
  isDirty: boolean;
}

export interface CommandContext {
  payload: Record<string, unknown>;
}

export interface CommandDefinition {
  id: CommandId;
  title: string;
  label?: string;
  description?: string;
  run: (ctx: CommandContext) => Promise<unknown> | unknown;
}

export interface Action {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: Error;
}

type Listener = (workspaces: WorkspaceState[]) => void;

/** Legacy metadata kept beside each platform document. */
interface LegacyDoc {
  name: string;
  panels: PanelState[];
  isDirty: boolean;
}

/**
 * Platform-backed registry exposing the legacy surface. One instance per app.
 */
export class WorkspaceRegistry {
  private readonly platform = new PlatformWorkspaceRegistry();
  private readonly legacy = new Map<string, LegacyDoc>();
  private readonly listeners = new Set<Listener>();

  private emit(): void {
    const snapshot = this.getWorkspaces();
    for (const l of this.listeners) l(snapshot);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Emit current state on subscription so React effects sync immediately.
    listener(this.getWorkspaces());
    return () => this.listeners.delete(listener);
  }

  createWorkspace(workspace: WorkspaceState): void {
    const wid = workspace.id as WorkspaceId;
    if (!this.legacy.has(wid)) {
      this.platform.create({ id: wid, nameKey: workspace.name });
    }
    this.legacy.set(wid, {
      name: workspace.name,
      panels: workspace.panels,
      isDirty: workspace.isDirty,
    });
    this.platform.setActive(wid);
    this.emit();
  }

  getWorkspaces(): WorkspaceState[] {
    return this.platform.list().map((doc) => {
      const meta = this.legacy.get(doc.id);
      return {
        id: doc.id,
        name: meta?.name ?? doc.nameKey,
        panels: meta?.panels ?? [],
        activePanelId: meta?.panels[0]?.id ?? null,
        isDirty: meta?.isDirty ?? false,
      };
    });
  }

  getActiveWorkspace(): WorkspaceState | undefined {
    const active = this.platform.active();
    if (!active) return undefined;
    return this.getWorkspaces().find((w) => w.id === active.id);
  }

  setActiveWorkspace(id: string): void {
    this.platform.setActive(id as WorkspaceId);
    this.emit();
  }

  updateWorkspace(
    id: string,
    updates: Partial<Pick<WorkspaceState, 'name' | 'isDirty'>>,
  ): void {
    const meta = this.legacy.get(id);
    if (!meta) return;
    if (updates.name !== undefined) meta.name = updates.name;
    if (updates.isDirty !== undefined) meta.isDirty = updates.isDirty;
    this.platform.update(id as WorkspaceId, {});
    this.emit();
  }
}

export type { WorkspaceId } from '../kernel/types';
