import React, { useEffect, useState } from 'react';
import { WorkspaceRegistry } from '@/lib/kernel/WorkspaceRegistry';
import { WorkspaceState, WorkspaceId } from '@/lib/kernel/KernelTypes';
import { ArrowLeft, LayoutDashboard, Search } from 'lucide-react';

// Import all v10 components
import { JournalWorkbench } from './accounting/v10/JournalWorkbench';
import { LedgerExplorer } from './accounting/v10/LedgerExplorer';
import { ARWorkspace } from './accounting/v10/ARWorkspace';

import { AnalysisWorkspace } from './bi/v10/AnalysisWorkspace';
import { VisualizationStudio } from './bi/v10/VisualizationStudio';
import { ReportBuilder } from './bi/v10/ReportBuilder';

import { Customer360 } from './crm/v10/Customer360';
import { LeadDesk } from './crm/v10/LeadDesk';
import { QuoteBuilder } from './crm/v10/QuoteBuilder';

import { ModelWorkspace } from './fpa/v10/ModelWorkspace';
import { ScenarioWorkspace } from './fpa/v10/ScenarioWorkspace';
import { PlanningWorkspace } from './fpa/v10/PlanningWorkspace';

import { SimulationWorkspace } from './simulation/v10/SimulationWorkspace';
import { OptimizationWorkspace } from './simulation/v10/OptimizationWorkspace';

import { TreasuryWorkspace } from './treasury/v10/TreasuryWorkspace';
import { ControlCenter } from './treasury/v10/ControlCenter';
import { RiskWorkspace } from './treasury/v10/RiskWorkspace';

import { AIAgentWorkspace } from './ai/v10/AIAgentWorkspace';
import { CopilotSidebar } from './ai/v10/CopilotSidebar';

export interface V10OperatingSystemProps {
  onBack: () => void;
}

export interface WorkspaceComponentProps {
  registry: WorkspaceRegistry;
}

const registry = new WorkspaceRegistry();

const ComponentMapper: Record<string, React.ComponentType<WorkspaceComponentProps>> = {
  'JournalWorkbench': JournalWorkbench,
  'LedgerExplorer': LedgerExplorer,
  'ARWorkspace': ARWorkspace,
  'AnalysisWorkspace': AnalysisWorkspace,
  'VisualizationStudio': VisualizationStudio,
  'ReportBuilder': ReportBuilder,
  'Customer360': Customer360,
  'LeadDesk': LeadDesk,
  'QuoteBuilder': QuoteBuilder,
  'ModelWorkspace': ModelWorkspace,
  'ScenarioWorkspace': ScenarioWorkspace,
  'PlanningWorkspace': PlanningWorkspace,
  'SimulationWorkspace': SimulationWorkspace,
  'OptimizationWorkspace': OptimizationWorkspace,
  'TreasuryWorkspace': TreasuryWorkspace,
  'ControlCenter': ControlCenter,
  'RiskWorkspace': RiskWorkspace,
  'AIAgentWorkspace': AIAgentWorkspace,
};

// Initialize all the v10 modules
let initialized = false;
if (!initialized) {
  
  const createWs = (id: string, name: string, componentType: string) => {
    registry.createWorkspace({
      id,
      name,
      panels: [{ id: `${id}-main`, title: name, type: 'component', componentType, props: {} }],
      activePanelId: `${id}-main`,
      isDirty: false
    });
  };

  createWs('accounting-journal', 'Journal Workbench', 'JournalWorkbench');
  createWs('accounting-ledger', 'Ledger Explorer', 'LedgerExplorer');
  createWs('accounting-ar', 'A/R Workspace', 'ARWorkspace');
  
  createWs('bi-analysis', 'Analysis Workspace', 'AnalysisWorkspace');
  createWs('bi-viz', 'Visualization Studio', 'VisualizationStudio');
  createWs('bi-report', 'Report Builder', 'ReportBuilder');
  
  createWs('crm-customer', 'Customer 360', 'Customer360');
  createWs('crm-leaddesk', 'Lead Desk', 'LeadDesk');
  createWs('crm-quote', 'Quote Builder', 'QuoteBuilder');

  createWs('fpa-model', 'Model Workspace', 'ModelWorkspace');
  createWs('fpa-scenario', 'Scenario Workspace', 'ScenarioWorkspace');
  createWs('fpa-planning', 'Planning Workspace', 'PlanningWorkspace');

  createWs('sim-montecarlo', 'Simulation Sandbox', 'SimulationWorkspace');
  createWs('sim-optimizer', 'Optimization Engine', 'OptimizationWorkspace');

  createWs('treasury-cash', 'Treasury & Cash', 'TreasuryWorkspace');
  createWs('treasury-control', 'Control Center', 'ControlCenter');
  createWs('treasury-risk', 'Risk Exposure', 'RiskWorkspace');

  createWs('ai-agent', 'AI Agent Console', 'AIAgentWorkspace');
  // CopilotSidebar is probably meant to be global, but we can mount it here

  initialized = true;
}

export function V10OperatingSystem({ onBack }: V10OperatingSystemProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<WorkspaceId | null>(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);

  useEffect(() => {
    setWorkspaces(registry.getWorkspaces());
    const initialWorkspaces = registry.getWorkspaces();
    if (initialWorkspaces.length > 0) {
      setActiveWorkspaceId(initialWorkspaces[0].id);
    }

    const unsubscribe = registry.subscribe((newWorkspaces) => {
      setWorkspaces([...newWorkspaces]);
      if (!activeWorkspaceId && newWorkspaces.length > 0) {
        setActiveWorkspaceId(newWorkspaces[0].id);
      }
    });
    return () => unsubscribe();
  }, [activeWorkspaceId]);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-50 overflow-hidden font-sans relative">
      {/* Sidebar Navigation */}
      <div className="w-64 border-r border-slate-800 bg-slate-900/50 backdrop-blur-md flex flex-col z-10 relative">
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-400" />
          </button>
          <div>
            <h1 className="font-semibold text-slate-100">OS V10</h1>
            <p className="text-xs text-slate-500">Enterprise Kernel</p>
          </div>
        </div>
        
        <div className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search workspaces..." 
              className="w-full bg-slate-950 border border-slate-800 rounded-md py-2 pl-9 pr-3 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-xs font-semibold text-slate-500 mb-2 px-3 uppercase tracking-wider">Workspaces</div>
          {workspaces.map(workspace => (
            <button
              key={workspace.id}
              onClick={() => setActiveWorkspaceId(workspace.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors ${
                activeWorkspaceId === workspace.id 
                  ? 'bg-blue-600/20 text-blue-400' 
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <span className="truncate">{workspace.name}</span>
              {workspace.isDirty && <span className="w-2 h-2 rounded-full bg-amber-500" />}
            </button>
          ))}
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-slate-950">
        {activeWorkspace ? (
          <>
            <div className="h-12 border-b border-slate-800 bg-slate-900/50 flex items-center px-4 backdrop-blur-md shrink-0">
              <h2 className="font-medium text-slate-200">{activeWorkspace.name}</h2>
              <button 
                onClick={() => setIsCopilotOpen(true)}
                className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-900/20"
              >
                <span>AI Copilot</span>
              </button>
            </div>
            
            <div className="flex-1 overflow-auto relative">
              {/* Render the active panel content */}
              {activeWorkspace.panels.map(panel => {
                const Component = ComponentMapper[panel.componentType];
                return (
                  <div 
                    key={panel.id} 
                    className={`absolute inset-0 transition-opacity duration-200 ${
                      activeWorkspace.activePanelId === panel.id || activeWorkspace.panels.length === 1 ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                    }`}
                  >
                    {Component ? <Component registry={registry} {...panel.props} /> : <div className="text-white p-4">Component not found</div>}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-4">
            <LayoutDashboard className="w-16 h-16 opacity-20" />
            <p>Select a workspace to begin</p>
          </div>
        )}
      </div>

      {/* Global AI Copilot Sidebar */}
      <CopilotSidebar isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} workspaceRegistry={registry} />
    </div>
  );
}
