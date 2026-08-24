import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { AnalysisWorkspace } from './AnalysisWorkspace';
import { VisualizationStudio } from './VisualizationStudio';
import { ReportBuilder } from './ReportBuilder';

export {
  AnalysisWorkspace,
  VisualizationStudio,
  ReportBuilder
};

export function registerBIWorkspaces(registry: WorkspaceRegistry) {
  registry.createWorkspace({
    id: 'bi-workspace',
    name: 'BI & Analytics',
    panels: [
      {
        id: 'bi-analysis',
        title: 'Analysis',
        type: 'analysis-workspace',
        componentType: 'null',
        props: {},
      },
      {
        id: 'bi-viz-studio',
        title: 'Visualization Studio',
        type: 'visualization-studio',
        componentType: 'null',
        props: {},
      },
      {
        id: 'bi-report-builder',
        title: 'Report Builder',
        type: 'report-builder',
        componentType: 'null',
        props: {},
      }
    ],
    activePanelId: 'bi-analysis',
    isDirty: false
  });
}
