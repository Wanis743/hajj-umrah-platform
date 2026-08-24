import React, { useState } from 'react';
import { 
  Users, Plane, Search, Bell, Maximize2, 
  X, Plus, ArrowLeft, Target, FileText
} from 'lucide-react';
import { GroupControlCenter } from './GroupControlCenter';
// import { PilgrimWorkspace } from './PilgrimWorkspace'; // For Phase 2

export type OpsMode = 'GROUP_CONTROL' | 'PILGRIM_360' | 'VISA_PIPELINE' | 'FLIGHT_MANIFEST';

interface AppTab {
  id: string;
  mode: OpsMode;
  label: string;
}

interface OperationsOSProps {
  onBack: () => void;
}

export function OperationsOS({ onBack }: OperationsOSProps) {
  const [tabs, setTabs] = useState<AppTab[]>([
    { id: 't1', mode: 'GROUP_CONTROL', label: 'Mission Control' }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('t1');
  const [showPalette, setShowPalette] = useState(false);

  const availableApps = [
    { mode: 'GROUP_CONTROL' as OpsMode, label: 'Mission Control', icon: <Target className="w-5 h-5 text-blue-400" />, desc: '360° overview of operational groups.' },
    { mode: 'PILGRIM_360' as OpsMode, label: 'Pilgrim 360', icon: <Users className="w-5 h-5 text-emerald-400" />, desc: 'Individual passenger lifecycle & documents.' },
    { mode: 'VISA_PIPELINE' as OpsMode, label: 'Visa Pipeline', icon: <FileText className="w-5 h-5 text-amber-400" />, desc: 'B2B/Mofa visa batch processing.' },
    { mode: 'FLIGHT_MANIFEST' as OpsMode, label: 'Flight Manifests', icon: <Plane className="w-5 h-5 text-sky-400" />, desc: 'Airline ticketing and transport coordination.' }
  ];

  const openNewTab = (mode: OpsMode, label: string) => {
    const id = crypto.randomUUID();
    setTabs([...tabs, { id, mode, label }]);
    setActiveTabId(id);
    setShowPalette(false);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id && newTabs.length > 0) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  // Keyboard shortcut for Cmd+K
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative flex flex-col h-screen w-full overflow-hidden bg-[#0a0a0a] text-white">
      {/* Background Effect */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute bottom-[10%] -left-[10%] w-[30%] h-[40%] rounded-full bg-sky-600/10 blur-[130px]" />
      </div>

      {/* Main Container */}
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
              <div className="p-1.5 bg-gradient-to-br from-blue-500 to-sky-600 rounded-lg shadow-[0_0_15px_rgba(56,189,248,0.5)]">
                <Target className="w-4 h-4 text-white fill-white/20" />
              </div>
              <h1 className="text-lg font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 hidden md:block">
                OPERATIONS <span className="font-light">OS</span>
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
           <div className="relative z-10 w-full h-full p-2">
             <div className="w-full h-full rounded-lg border border-white/5 bg-black/40 backdrop-blur-md overflow-hidden">
                {tabs.length === 0 && (
                  <div className="flex items-center justify-center h-full flex-col text-white/30">
                    <Target className="w-16 h-16 mb-4 opacity-20" />
                    <p className="text-lg">No Workspaces Open</p>
                    <button onClick={() => setShowPalette(true)} className="mt-4 px-4 py-2 border border-white/10 rounded-lg hover:bg-white/5 text-white/60 transition-colors text-sm">
                      Open Command Palette (Cmd K)
                    </button>
                  </div>
                )}
                {tabs.map(tab => (
                  <div key={tab.id} className={`w-full h-full ${activeTabId === tab.id ? 'block' : 'hidden'}`}>
                    {tab.mode === 'GROUP_CONTROL' && <GroupControlCenter />}
                    {tab.mode !== 'GROUP_CONTROL' && (
                      <div className="flex items-center justify-center h-full text-slate-500">
                        Workspace "{tab.label}" is under construction (Phase 2).
                      </div>
                    )}
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
                placeholder="Search operations, pilgrims, or flights..." 
                className="w-full bg-transparent border-none outline-none text-lg text-white placeholder-white/30"
              />
              <button onClick={() => setShowPalette(false)} className="text-white/50 hover:text-white px-2 py-1 bg-white/5 rounded text-xs">ESC</button>
            </div>
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              <div className="px-3 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider">Operations Apps</div>
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
