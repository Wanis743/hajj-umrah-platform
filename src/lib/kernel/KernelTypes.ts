export type CommandId = string;
export type WorkspaceId = string;
export type PanelId = string;

export interface CommandDefinition {
  id: CommandId;
  label: string;
  description?: string;
  shortcut?: string[];
  scope: 'global' | 'workspace' | 'panel';
  execute: (context: CommandContext) => Promise<void> | void;
}

export interface CommandContext {
  workspaceId?: WorkspaceId;
  panelId?: PanelId;
  [key: string]: unknown;
}

export interface WorkspaceState {
  id: WorkspaceId;
  name: string;
  panels: PanelState[];
  activePanelId: PanelId | null;
  isDirty: boolean;
}

export interface PanelState {
  id: PanelId;
  title: string;
  type: string;
  componentType: string;
  props: Record<string, unknown>;
}

export interface Action {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: Error;
}

