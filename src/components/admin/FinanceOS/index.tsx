import { TrendingUp } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Target, Wallet, LineChart, FileSpreadsheet, 
  Scale, BookOpen, ShieldCheck, PieChart, ArrowLeft, Maximize2, 
  Zap, Search, Bell, X, Plus 
} from 'lucide-react';
import { JournalWorkspace } from './JournalWorkspace';
import { ChartOfAccounts } from './ChartOfAccounts';
import { ModelingWorkspace } from './ModelingWorkspace';
import { PlanningWorkspace } from './PlanningWorkspace';
import { ReconciliationWorkspace } from './ReconciliationWorkspace';
import { CloseCenter } from './CloseCenter';
import { ReportsWorkspace } from './ReportsWorkspace';
import { UnitEconomicsWorkspace } from './UnitEconomicsWorkspace';

export interface FinanceOSProps {
  onBack: () => void;
}

export type FinanceMode = 'JOURNAL' | 'LEDGER' | 'MODEL' | 'PLANNING' | 'RECONCILE' | 'CLOSE' | 'REPORTS' | 'UNIT_ECON';

interface WorkspaceTab {
  id: string;
  mode: FinanceMode;
  label: string;
}

export default function FinanceOS({ onBack }: FinanceOSProps) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: 'tab-1', mode: 'JOURNAL', label: 'Journal' }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const [showPalette, setShowPalette] = useState(false);

  // Global Keyboard Shortcut for Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openNewTab = (mode: FinanceMode, label: string) => {
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, mode, label }]);
    setActiveTabId(newId);
    setShowPalette(false);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (activeTabId === id && next.length > 0) {
        setActiveTabId(next[next.length - 1].id);
      } else if (next.length === 0) {
        // Fallback tab if all closed
        next.push({ id: `tab-${Date.now()}`, mode: 'JOURNAL', label: 'Journal' });
        setActiveTabId(next[0].id);
      }
      return next;
    });
  };

  const availableApps: { mode: FinanceMode; label: string; icon: React.ReactNode; desc: string }[] = [
    { mode: 'JOURNAL', label: 'Journal', icon: <BookOpen className="w-5 h-5 text-indigo-400" />, desc: 'Record and review general ledger entries.' },
    { mode: 'LEDGER', label: 'Chart of Accounts', icon: <Wallet className="w-5 h-5 text-emerald-400" />, desc: 'Manage account hierarchies and balances.' },
    { mode: 'MODEL', label: 'Modeling', icon: <LineChart className="w-5 h-5 text-amber-400" />, desc: 'Simulate financial projections and margins.' },
    { mode: 'PLANNING', label: 'Planning & Budgeting', icon: <Target className="w-5 h-5 text-blue-400" />, desc: 'Define budgets and track variance.' },
    { mode: 'RECONCILE', label: 'Reconciliation', icon: <Scale className="w-5 h-5 text-purple-400" />, desc: 'Match bank statements with journal lines.' },
    { mode: 'CLOSE', label: 'Close Center', icon: <ShieldCheck className="w-5 h-5 text-red-400" />, desc: 'Execute month-end and year-end procedures.' },
    { mode: 'REPORTS', label: 'Reports', icon: <PieChart className="w-5 h-5 text-cyan-400" />, desc: 'Generate standard financial statements.' },
    { mode: 'UNIT_ECON', label: 'Unit Economics', icon: <TrendingUp className="w-5 h-5 text-emerald-400" />, desc: 'Track profitability per operational group.' },
  ];

  return (
    <div className="relative flex flex-col h-screen w-full overflow-hidden bg-[#0a0a0a] text-white">
      {/* Liquid Aurora Background Effect */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px] animate-[spin_20s_linear_infinite]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-blue-600/10 blur-[140px] animate-[spin_25s_linear_infinite_reverse]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-purple-600/10 blur-[150px] animate-[pulse_10s_ease-in-out_infinite]" />
      </div>

      {/* Main Glassmorphic Container */}
      <div className="relative z-10 flex flex-col w-full h-full p-2 gap-2">
        
        {/* Top Header Glass Panel */}
        <div className="flex items-center justify-between h-14 px-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack} 
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-md transition-all text-white/70 hover:text-white"
              title="Back to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-3 border-l border-white/10 pl-4">
              <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.5)]">
                <Zap className="w-4 h-4 text-white fill-white/20" />
              </div>
              <h1 className="text-lg font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 hidden md:block">
                FINANCE <span className="font-light">OS</span>
              </h1>
            </div>
          </div>

          {/* IDE-Style Tabs */}
          <div className="flex-1 overflow-x-auto flex items-center mx-4 gap-1">
            {tabs.map(tab => (
              <div 
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer min-w-[120px] max-w-[200px] border ${
                  activeTabId === tab.id 
                    ? 'bg-white/10 text-white shadow-lg border-white/20' 
                    : 'bg-transparent text-white/50 border-transparent hover:bg-white/5'
                }`}
              >
                <span className="flex-1 truncate">{tab.label}</span>
                <button onClick={(e) => closeTab(tab.id, e)} className="hover:bg-white/20 p-0.5 rounded text-white/50 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button onClick={() => setShowPalette(true)} className="p-1.5 rounded-md hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* System Actions */}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowPalette(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-white/70 hover:text-white text-xs"
            >
              <Search className="w-4 h-4" />
              <span className="font-mono opacity-50">Cmd K</span>
            </button>
            <button className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
              <Bell className="w-4 h-4" />
            </button>
            <button className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white/70 hover:text-white">
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dynamic Workspace Area - Preserving Context with Hidden/Block */}
        <div className="flex-1 overflow-hidden rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl flex flex-col relative">
           <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
           <div className="relative z-10 w-full h-full p-2">
             <div className="w-full h-full rounded-lg border border-white/5 bg-black/40 backdrop-blur-md overflow-hidden">
                {tabs.map(tab => (
                  <div key={tab.id} className={`w-full h-full ${activeTabId === tab.id ? 'block' : 'hidden'}`}>
                    {tab.mode === 'JOURNAL' && <JournalWorkspace />}
                    {tab.mode === 'LEDGER' && <ChartOfAccounts />}
                    {tab.mode === 'MODEL' && <ModelingWorkspace />}
                    {tab.mode === 'PLANNING' && <PlanningWorkspace />}
                    {tab.mode === 'RECONCILE' && <ReconciliationWorkspace />}
                    {tab.mode === 'CLOSE' && <CloseCenter />}
                    {tab.mode === 'REPORTS' && <ReportsWorkspace />}
                    {tab.mode === 'UNIT_ECON' && <UnitEconomicsWorkspace />}
                  </div>
                ))}
             </div>
           </div>
        </div>

      </div>

      {/* Command Palette Overlay */}
      {showPalette && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={() => setShowPalette(false)}>
          <div 
            className="w-full max-w-2xl bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex items-center gap-3">
              <Search className="w-5 h-5 text-white/50" />
              <input 
                autoFocus
                type="text" 
                placeholder="Search apps, commands, or objects..." 
                className="w-full bg-transparent border-none outline-none text-lg text-white placeholder-white/30"
              />
              <button onClick={() => setShowPalette(false)} className="text-white/50 hover:text-white px-2 py-1 bg-white/5 rounded text-xs">ESC</button>
            </div>
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              <div className="px-3 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider">Apps & Workspaces</div>
              <div className="grid grid-cols-2 gap-2 p-2">
                {availableApps.map(app => (
                  <button 
                    key={app.mode}
                    onClick={() => openNewTab(app.mode, app.label)}
                    className="flex flex-col items-start gap-1 p-3 rounded-lg hover:bg-white/10 text-left transition-colors border border-transparent hover:border-white/10"
                  >
                    <div className="flex items-center gap-2">
                      {app.icon}
                      <span className="font-medium text-white/90">{app.label}</span>
                    </div>
                    <span className="text-xs text-white/50 line-clamp-1">{app.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
