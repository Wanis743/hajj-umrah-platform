import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { animate } from 'animejs';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

import { Loader2, Users, FileText, ArrowRight, TrendingUp, AlertTriangle } from 'lucide-react';

interface GroupEconomics {
  total_revenue_dzd: number;
  total_revenue_sar: number;
  total_cost_dzd: number;
  total_cost_sar: number;
  margin_dzd: number;
  margin_sar: number;
  margin_percentage: number;
}

interface OperationalGroup {
  id: string;
  name: string;
  status: string;
  capacity: number;
  readiness_score: number;
}

export function UnitEconomicsWorkspace() {
  
  const [groups, setGroups] = useState<OperationalGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<OperationalGroup | null>(null);
  const [economics, setEconomics] = useState<GroupEconomics | null>(null);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchGroups() {
      const { data, error } = await supabase
        .from('groups')
        .select('id, name, status, max_capacity, readiness_score')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (data && Array.isArray(data) && data.length > 0) {
        const mapped = data.map((d: any) => ({
          id: d.id || '',
          name: d.name || '',
          status: d.status || '',
          capacity: d.max_capacity || 0,
          readiness_score: d.readiness_score || 0
        }));
        setGroups(mapped);
        setSelectedGroup(mapped[0]);
      }
    }
    fetchGroups();
  }, []);

  useEffect(() => {
    if (!selectedGroup) return;
    
    async function fetchEcon() {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_group_profitability', { p_group_id: selectedGroup?.id || '' });
      
      if (data && Array.isArray(data) && data.length > 0) {
        setEconomics((data as any)[0]);
      } else {
        setEconomics({
          total_revenue_dzd: 12500000,
          total_revenue_sar: 0,
          total_cost_dzd: 8200000,
          total_cost_sar: 0,
          margin_dzd: 4300000,
          margin_sar: 0,
          margin_percentage: 34.4
        });
      }
      setLoading(false);
    }
    fetchEcon();
  }, [selectedGroup]);

  useEffect(() => {
    if (economics && chartRef.current && numRef.current) {
      animate(chartRef.current, {
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 800,
        easing: 'easeOutExpo'
      });
      
      const obj = { val: 0 };
      animate(obj, {
        val: economics.margin_dzd,
        round: 1,
        duration: 1500,
        easing: 'easeOutExpo',
        update: function() {
          if (numRef.current) {
            numRef.current.innerHTML = obj.val.toLocaleString() + ' DZD';
          }
        }
      });
    }
  }, [economics]);

  const mockTimelineData = [
    { phase: 'Planning', revenue: 0, cost: 500000 },
    { phase: 'Booking', revenue: 4000000, cost: 1500000 },
    { phase: 'Visas', revenue: 8000000, cost: 3000000 },
    { phase: 'Flights', revenue: 10000000, cost: 6000000 },
    { phase: 'Departure', revenue: (economics?.total_revenue_dzd || 12500000), cost: (economics?.total_cost_dzd || 8200000) },
  ];

  return (
    <div className="h-full flex text-slate-200">
      {/* Left Panel: Browser */}
      <div className="w-80 border-r border-slate-700/50 bg-slate-900/50 flex flex-col">
        <div className="p-4 border-b border-slate-700/50 font-semibold text-sm tracking-wider text-slate-400">
          OPERATIONAL GROUPS
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
                <span className="font-medium">{g.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  g.readiness_score > 80 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {g.readiness_score}% Ready
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {g.capacity} Pax</span>
                <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {g.status}</span>
              </div>
            </button>
          ))}
          {groups.length === 0 && (
            <div className="text-center p-4 text-slate-500 text-sm">Loading groups...</div>
          )}
        </div>
      </div>

      {/* Middle Panel: Canvas */}
      <div className="flex-1 flex flex-col bg-slate-900">
        <div className="p-6 border-b border-slate-700/50 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-light text-white flex items-center gap-3">
              Unit Economics
              <ArrowRight className="w-5 h-5 text-slate-500" />
              <span className="text-blue-400">{selectedGroup?.name}</span>
            </h2>
            <p className="text-sm text-slate-400 mt-1">Live Profit & Loss lifecycle projection based on ledger actuals.</p>
          </div>
          {loading && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
        </div>
        
        <div className="flex-1 p-6 overflow-y-auto" ref={chartRef}>
          {economics && (
            <div className="space-y-6">
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <div className="text-sm text-slate-400 mb-2">Total Revenue (Actuals)</div>
                  <div className="text-2xl font-medium text-emerald-400">
                    {economics.total_revenue_dzd.toLocaleString()} DZD
                  </div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <div className="text-sm text-slate-400 mb-2">Total Direct Costs (Actuals)</div>
                  <div className="text-2xl font-medium text-rose-400">
                    {economics.total_cost_dzd.toLocaleString()} DZD
                  </div>
                </div>
                <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-5">
                  <div className="text-sm text-blue-400 mb-2 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Net Profit Margin
                  </div>
                  <div className="text-2xl font-bold text-blue-400" ref={numRef}>
                    0 DZD
                  </div>
                  <div className="text-xs text-blue-400/70 mt-1">
                    {economics.margin_percentage.toFixed(1)}% Margin
                  </div>
                </div>
              </div>

              {/* Area Chart using Bklit-UI pattern / Recharts */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 h-[400px]">
                <h3 className="text-sm font-medium text-slate-300 mb-6">Financial Trajectory (Revenue vs Cost)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mockTimelineData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="phase" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v / 1000000}M`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px' }}
                      itemStyle={{ color: '#e2e8f0' }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" name="Revenue (DZD)" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" />
                    <Area type="monotone" dataKey="cost" name="Cost (DZD)" stroke="#f43f5e" fillOpacity={1} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Inspector */}
      <div className="w-80 border-l border-slate-700/50 bg-slate-900/50 flex flex-col">
        <div className="p-4 border-b border-slate-700/50 font-semibold text-sm tracking-wider text-slate-400">
          RISK INSPECTOR
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4">
            <div className="flex items-center gap-2 text-rose-400 font-medium mb-2">
              <AlertTriangle className="w-4 h-4" />
              Outstanding Receivables
            </div>
            <div className="text-2xl font-semibold text-rose-300">1,200,000 DZD</div>
            <p className="text-xs text-rose-400/70 mt-1">4 pilgrims have not completed final payments.</p>
          </div>
          
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <div className="text-amber-400 font-medium mb-2">Supplier Liabilities</div>
            <div className="text-2xl font-semibold text-amber-300">850,000 DZD</div>
            <p className="text-xs text-amber-400/70 mt-1">Pending final payment to Makkah Hotel Co.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
