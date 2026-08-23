import { WorkspaceState, WorkspaceId } from './KernelTypes';

type Listener = (state: WorkspaceState[]) => void;

export class WorkspaceRegistry {
  private workspaces: WorkspaceState[] = [];
  private activeWorkspaceId: WorkspaceId | null = null;
  private listeners: Set<Listener> = new Set();

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.workspaces));
  }

  public createWorkspace(workspace: WorkspaceState): void {
    this.workspaces.push(workspace);
    if (!this.activeWorkspaceId) {
      this.activeWorkspaceId = workspace.id;
    }
    this.notify();
  }

  public getWorkspaces(): WorkspaceState[] {
    return this.workspaces;
  }

  public getActiveWorkspace(): WorkspaceState | undefined {
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId);
  }

  public setActiveWorkspace(id: WorkspaceId): void {
    if (this.workspaces.some((w) => w.id === id)) {
      this.activeWorkspaceId = id;
      this.notify();
    }
  }

  public updateWorkspace(id: WorkspaceId, updates: Partial<WorkspaceState>): void {
    this.workspaces = this.workspaces.map((w) => (w.id === id ? { ...w, ...updates } : w));
    this.notify();
  }
}
