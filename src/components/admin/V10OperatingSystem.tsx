import React, { useEffect, useState } from 'react';
import { WorkspaceRegistry } from '@/lib/kernel/WorkspaceRegistry';
import { WorkspaceState, WorkspaceId } from '@/lib/kernel/KernelTypes';
import { ArrowLeft, LayoutDashboard, Search, BookOpen, Landmark, Users, LineChart, FlaskConical, Shield } from 'lucide-react';

// Import all v10 components
import { JournalWorkbench as PlatformJournalWorkbench } from '../../platform/accounting/JournalWorkbench';
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

export interface V10OperatingSystemProps {
  onBack: () => void;
}

export interface WorkspaceComponentProps {
  registry: WorkspaceRegistry;
}

const registry = new WorkspaceRegistry();

const ComponentMapper: Record<string, React.ComponentType<WorkspaceComponentProps>> = {
  'JournalWorkbench': () => <PlatformJournalWorkbench />,
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

  initialized = true;
}

const NAV_GROUPS: { label: string; icon: React.ComponentType<{ className?: string }>; prefix: string }[] = [
  { label: 'Accounting', icon: BookOpen, prefix: 'accounting-' },
  { label: 'Business Intelligence', icon: LineChart, prefix: 'bi-' },
  { label: 'CRM', icon: Users, prefix: 'crm-' },
  { label: 'Planning & Modeling', icon: Landmark, prefix: 'fpa-' },
  { label: 'Simulation', icon: FlaskConical, prefix: 'sim-' },
  { label: 'Treasury & Risk', icon: Shield, prefix: 'treasury-' },
];

/**
 * Finance OS — liquid glass shell.
 *
 * Design language: translucent layered glass over a soft ambient gradient,
 * hairline white borders at low opacity, inner highlights on interactive
 * surfaces, and specular top edges. No flat opaque panels.
 */
export function V10OperatingSystem({ onBack }: V10OperatingSystemProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<WorkspaceId | null>(null);
  const [query, setQuery] = useState('');

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
  const q = query.trim().toLowerCase();

  return (
    <div className="relative flex h-screen w-full overflow-hidden font-sans text-white">
      {/* Ambient background — the layers the glass sits on */}
      <div className="absolute inset-0 bg-[#070b14]" />
      <div className="absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-blue-600/25 blur-[140px]" />
      <div className="absolute -right-32 top-1/4 h-[30rem] w-[30rem] rounded-full bg-indigo-500/20 blur-[130px]" />
      <div className="absolute -bottom-48 left-1/3 h-[34rem] w-[34rem] rounded-full bg-cyan-400/15 blur-[150px]" />

      {/* Sidebar — liquid glass panel */}
      <aside className="relative z-10 flex w-72 flex-col border-r border-white/10 bg-white/[0.06] backdrop-blur-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          <button
            onClick={onBack}
            className="rounded-xl border border-white/10 bg-white/5 p-2 transition-all hover:border-white/20 hover:bg-white/10 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5 text-white/70" />
          </button>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-white">Finance OS</h1>
            <p className="text-[11px] text-white/40">Liquid workspace</p>
          </div>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/35" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workspaces..."
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] py-2 pl-9 pr-3 text-sm text-white/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] placeholder:text-white/30 focus:border-white/25 focus:bg-white/10 focus:outline-none"
            />
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3 pb-6">
          {NAV_GROUPS.map(({ label, icon: Icon, prefix }) => {
            const items = workspaces.filter(
              (w) => w.id.startsWith(prefix) && (!q || w.name.toLowerCase().includes(q)),
            );
            if (items.length === 0) return null;
            return (
              <div key={label}>
                <div className="mb-1.5 flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
                <div className="space-y-1">
                  {items.map((workspace) => {
                    const isActive = activeWorkspaceId === workspace.id;
                    return (
                      <button
                        key={workspace.id}
                        onClick={() => setActiveWorkspaceId(workspace.id)}
                        className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ${
                          isActive
                            ? 'border border-white/20 bg-white/[0.12] font-medium text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15),0_8px_24px_-8px_rgba(59,130,246,0.45)]'
                            : 'border border-transparent text-white/60 hover:border-white/10 hover:bg-white/[0.06] hover:text-white/90'
                        }`}
                      >
                        <span className="truncate">{workspace.name}</span>
                        {workspace.isDirty && (
                          <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-amber-300 shadow-[0_0_8px_2px_rgba(252,211,77,0.5)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom sheen */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />
      </aside>

      {/* Main area */}
      <main className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {activeWorkspace ? (
          <>
            {/* Title bar — floating glass strip */}
            <div className="mx-4 mt-4 flex h-13 shrink-0 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.07] px-5 py-3 backdrop-blur-2xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.12)]">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_2px_rgba(110,231,183,0.55)]" />
                <h2 className="text-sm font-semibold tracking-wide text-white/95">{activeWorkspace.name}</h2>
              </div>
              <span className="text-[11px] uppercase tracking-widest text-white/35">server-authoritative</span>
            </div>

            {/* Panel surface */}
            <div className="relative mx-4 mb-4 mt-3 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-xl shadow-[0_16px_48px_-16px_rgba(0,0,0,0.65)]">
              {/* Specular highlight along the panel's top edge */}
              <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
              {activeWorkspace.panels.map((panel) => {
                const Component = ComponentMapper[panel.componentType];
                const visible =
                  activeWorkspace.activePanelId === panel.id || activeWorkspace.panels.length === 1;
                return (
                  <div
                    key={panel.id}
                    className={`absolute inset-0 transition-opacity duration-200 ${
                      visible ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
                    }`}
                  >
                    {Component ? (
                      <Component registry={registry} {...panel.props} />
                    ) : (
                      <div className="p-6 text-white/50">Component not found</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center space-y-4 text-white/40">
            <LayoutDashboard className="h-16 w-16 opacity-20" />
            <p>Select a workspace to begin</p>
          </div>
        )}
      </main>
    </div>
  );
}
