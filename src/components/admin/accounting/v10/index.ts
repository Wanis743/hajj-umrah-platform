import React from 'react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { JournalWorkbench } from './JournalWorkbench';
import { LedgerExplorer } from './LedgerExplorer';
import { ARWorkspace } from './ARWorkspace';

export function registerAccountingWorkspaces(registry: WorkspaceRegistry) {
  registry.createWorkspace({
    id: 'accounting-journal-workbench',
    name: 'Journal Workbench',
    panels: [
      {
        id: 'journal-workbench-main',
        title: 'Journal Workbench',
        type: 'component',
        componentType: '',
        props: {},
      }
    ],
    activePanelId: 'journal-workbench-main',
    isDirty: false,
  });

  registry.createWorkspace({
    id: 'accounting-ledger-explorer',
    name: 'Ledger Explorer',
    panels: [
      {
        id: 'ledger-explorer-main',
        title: 'Ledger Explorer',
        type: 'component',
        componentType: '',
        props: {},
      }
    ],
    activePanelId: 'ledger-explorer-main',
    isDirty: false,
  });

  registry.createWorkspace({
    id: 'accounting-ar-workspace',
    name: 'A/R Workspace',
    panels: [
      {
        id: 'ar-workspace-main',
        title: 'A/R Workspace',
        type: 'component',
        componentType: '',
        props: {},
      }
    ],
    activePanelId: 'ar-workspace-main',
    isDirty: false,
  });
}
