import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { DocumentLibrary } from './DocumentLibrary';
import { EvidenceWorkspace } from './EvidenceWorkspace';
import { ExtractionReview } from './ExtractionReview';

export { DocumentLibrary, EvidenceWorkspace, ExtractionReview };

export function registerDmsWorkspaces(registry: WorkspaceRegistry) {
  registry.createWorkspace({
    id: 'dms-library',
    name: 'Document Library',
    panels: [
      {
        id: 'dms-library-main',
        title: 'Library',
        type: 'dms-library',
        componentType: 'null',
        props: {},
      },
    ],
    activePanelId: 'dms-library-main',
    isDirty: false,
  });

  registry.createWorkspace({
    id: 'dms-evidence',
    name: 'Evidence Workspace',
    panels: [
      {
        id: 'dms-evidence-main',
        title: 'Evidence',
        type: 'dms-evidence',
        componentType: 'null',
        props: {},
      },
    ],
    activePanelId: 'dms-evidence-main',
    isDirty: false,
  });

  registry.createWorkspace({
    id: 'dms-extraction',
    name: 'Extraction Review',
    panels: [
      {
        id: 'dms-extraction-main',
        title: 'Extraction',
        type: 'dms-extraction',
        componentType: 'null',
        props: {},
      },
    ],
    activePanelId: 'dms-extraction-main',
    isDirty: false,
  });
}
