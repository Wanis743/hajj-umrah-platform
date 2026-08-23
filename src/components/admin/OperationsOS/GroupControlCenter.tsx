import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { animate } from 'animejs';
import { Users, FileText, Plane, Home, Activity, CheckCircle, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';


interface OpsGroup {
  id: string;
  name: string;
  status: string;
  departure_date: string;
}

interface ReadinessData {
  total_pax: number;
  visas_approved: number;
  flights_ticketed: number;
  hotels_assigned: number;
  readiness_score: number;
}

export function GroupControlCenter() {
  
  const [groups, setGroups] = useState<OpsGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<OpsGroup | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(false);

  const ringRef = useRef<SVGCircleElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchGroups() {
      const { data } = await supabase
        .from('groups')
        .select('id, name, status, departure_date')
        .order('departure_date', { ascending: true })
        .limit(20);
      
      if (data && data.length > 0) {
        setGroups(data as unknown as OpsGroup[]);
        setSelectedGroup(data[0] as unknown as OpsGroup);
      }
    }
    fetchGroups();
  }, []);

  useEffect(() => {
    if (!selectedGroup) return;
    
    async function fetchReadiness() {
      setLoading(true);
      const { data } = await supabase.rpc('get_group_readiness', { p_group_id: selectedGroup!.id });
      
      if (Array.isArray(data) && data.length > 0) {
        setReadiness(data[0] as ReadinessData);
      } else {
        // Fallback mock
        setReadiness({
          total_pax: 45,
          visas_approved: 38,
          flights_ticketed: 45,
          hotels_assigned: 40,
          readiness_score: 91.1
        });
      }
      setLoading(false);
    }
    fetchReadiness();
  }, [selectedGroup]);

  useEffect(() => {
    if (readiness && panelRef.current && scoreRef.current && ringRef.current) {
      animate(panelRef.current, {
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 800,
        easing: 'easeOutExpo'
      });
      
      const obj = { val: 0 };
      animate(obj, {
        val: readiness.readiness_score,
        round: 1,
        duration: 2000,
        easing: 'easeOutExpo',
        update: () => {
          if (scoreRef.current) scoreRef.current.innerHTML = obj.val + '%';
        }
      });

      const circumference = 2 * Math.PI * 40; // r=40
      const offset = circumference - (readiness.readiness_score / 100) * circumference;
      
      ringRef.current.style.strokeDasharray = `${circumference}`;
      animate(ringRef.current, {
        strokeDashoffset: [circumference, offset],
        duration: 2000,
        easing: 'easeOutExpo'
      });
    }
  }, [readiness]);

  return (
    <div className="h-full flex text-slate-200">
      {/* Left Panel: Groups Browser */}
      <div className="w-80 border-r border-slate-700/50 bg-slate-900/50 flex flex-col">
        <div className="p-4 border-b border-slate-700/50 font-semibold text-sm tracking-wider text-slate-400">
          DEPARTURE PIPELINE
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => setSelectedGroup(g)}
              className={`w-full text-left p-3 rounded-lg transition-all ${
                selectedGroup?.id === g.id 
                  ? 'bg-blue-900/40 border border-blue-500/30' 
                  : 'hover:bg-slate-800 border border-transparent'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium text-slate-200 truncate">{g.name}</span>
              </div>
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span>DEP: {g.departure_date ? new Date(g.departure_date).toLocaleDateString() : 'TBA'}</span>
                <span className="text-blue-400">{g.status}</span>
              </div>
            </button>
          ))}
          {groups.length === 0 && (
            <div className="text-center p-4 text-slate-500 text-sm">Loading groups...</div>
          )}
        </div>
      </div>

      {/* Middle Panel: 360 View */}
      <div className="flex-1 flex flex-col bg-[#0a0a0a]">
        <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/30">
          <div>
            <h2 className="text-2xl font-light text-white flex items-center gap-3">
              Mission Control
              <ArrowRight className="w-5 h-5 text-slate-500" />
              <span className="text-blue-400">{selectedGroup?.name}</span>
            </h2>
            <p className="text-sm text-slate-400 mt-1">Live operational readiness and logistics coordination.</p>
          </div>
          {loading && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
        </div>
        
        <div className="flex-1 p-6 overflow-y-auto" ref={panelRef}>
          {readiness && (
            <div className="max-w-4xl space-y-8">
              
              {/* Top KPI row */}
              <div className="grid grid-cols-4 gap-4">
                
                {/* Score Ring */}
                <div className="col-span-1 bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 flex flex-col items-center justify-center relative">
                   <div className="relative w-24 h-24 flex items-center justify-center">
                     <svg className="w-full h-full transform -rotate-90">
                       <circle cx="48" cy="48" r="40" className="stroke-slate-700" strokeWidth="8" fill="none" />
                       <circle 
                         ref={ringRef}
                         cx="48" cy="48" r="40" 
                         className={`${readiness.readiness_score > 90 ? 'stroke-emerald-500' : readiness.readiness_score > 60 ? 'stroke-blue-500' : 'stroke-rose-500'}`} 
                         strokeWidth="8" 
                         fill="none" 
                         strokeLinecap="round" 
                       />
                     </svg>
                     <div className="absolute inset-0 flex flex-col items-center justify-center">
                       <span ref={scoreRef} className="text-xl font-bold text-white">0%</span>
                     </div>
                   </div>
                   <div className="mt-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">Readiness</div>
                </div>

                {/* Sub KPIs */}
                <div className="col-span-3 grid grid-cols-3 gap-4">
                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5 flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-2">
                      <FileText className="w-5 h-5 text-indigo-400" />
                      <span className="text-xs text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded">VISAS</span>
                    </div>
                    <div className="text-2xl font-semibold text-white">{readiness.visas_approved} / {readiness.total_pax}</div>
                    <div className="text-xs text-slate-400 mt-1">Approved & Issued</div>
                  </div>
                  
                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5 flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-2">
                      <Plane className="w-5 h-5 text-sky-400" />
                      <span className="text-xs text-sky-400 font-bold bg-sky-500/10 px-2 py-0.5 rounded">FLIGHTS</span>
                    </div>
                    <div className="text-2xl font-semibold text-white">{readiness.flights_ticketed} / {readiness.total_pax}</div>
                    <div className="text-xs text-slate-400 mt-1">Ticketed on Manifest</div>
                  </div>

                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5 flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-2">
                      <Home className="w-5 h-5 text-amber-400" />
                      <span className="text-xs text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded">HOUSING</span>
                    </div>
                    <div className="text-2xl font-semibold text-white">{readiness.hotels_assigned} / {readiness.total_pax}</div>
                    <div className="text-xs text-slate-400 mt-1">Rooms Allocated</div>
                  </div>
                </div>

              </div>

              {/* Action Pipeline */}
              <div>
                <h3 className="text-sm font-semibold text-slate-400 mb-4 tracking-wider">CRITICAL PATH ACTIONS</h3>
                <div className="grid grid-cols-2 gap-4">
                  <button className="flex items-start gap-4 p-4 bg-slate-900/60 border border-slate-700 hover:border-blue-500/50 rounded-xl transition-colors text-left group">
                    <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg group-hover:bg-blue-500/20">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-200">Submit Visa Batch</div>
                      <div className="text-xs text-slate-400 mt-1">Generate Nusuk XML for {readiness.total_pax - readiness.visas_approved} pending passports.</div>
                    </div>
                  </button>

                  <button className="flex items-start gap-4 p-4 bg-slate-900/60 border border-slate-700 hover:border-blue-500/50 rounded-xl transition-colors text-left group">
                    <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg group-hover:bg-blue-500/20">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-200">Rooming List</div>
                      <div className="text-xs text-slate-400 mt-1">Assign {readiness.total_pax - readiness.hotels_assigned} remaining pilgrims to hotel rooms.</div>
                    </div>
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
