import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { Customer360 } from './Customer360';
import { LeadDesk } from './LeadDesk';
import { QuoteBuilder } from './QuoteBuilder';

export {
  Customer360,
  LeadDesk,
  QuoteBuilder
};

export function registerCRMWorkspaces(registry: WorkspaceRegistry) {
  registry.createWorkspace({
    id: 'crm-workspace',
    name: 'CRM System',
    panels: [
      {
        id: 'crm-customer-360',
        title: 'Customer 360',
        type: 'customer-360',
        componentType: 'null',
        props: {},
      },
      {
        id: 'crm-lead-desk',
        title: 'Lead Desk',
        type: 'lead-desk',
        componentType: 'null',
        props: {},
      },
      {
        id: 'crm-quote-builder',
        title: 'Quote Builder',
        type: 'quote-builder',
        componentType: 'null',
        props: {},
      }
    ],
    activePanelId: 'crm-lead-desk',
    isDirty: false
  });
}
