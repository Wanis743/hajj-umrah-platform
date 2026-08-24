import React from 'react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { TreasuryWorkspace } from './TreasuryWorkspace';
import { ControlCenter } from './ControlCenter';
import { RiskWorkspace } from './RiskWorkspace';

export function registerTreasuryWorkspaces(registry: WorkspaceRegistry) {
  registry.createWorkspace({
    id: 'treasury-cash',
    name: 'Treasury & Cash',
    panels: [
      {
        id: 'treasury-cash-main',
        title: 'Treasury & Cash',
        type: 'component',
        componentType: '',
        props: {},
      }
    ],
    activePanelId: 'treasury-cash-main',
    isDirty: false
  });

  registry.createWorkspace({
    id: 'treasury-controls',
    name: 'Control Center',
    panels: [
      {
        id: 'treasury-controls-main',
        title: 'Control Center',
        type: 'component',
        componentType: '',
        props: {},
      }
    ],
    activePanelId: 'treasury-controls-main',
    isDirty: false
  });

  registry.createWorkspace({
    id: 'treasury-risk',
    name: 'Risk & Exposure',
    panels: [
      {
        id: 'treasury-risk-main',
        title: 'Risk & Exposure',
        type: 'component',
        componentType: '',
        props: {},
      }
    ],
    activePanelId: 'treasury-risk-main',
    isDirty: false
  });
}

export { TreasuryWorkspace, ControlCenter, RiskWorkspace };
