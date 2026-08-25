import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { animate } from 'animejs';

import { Loader2, TrendingUp, Users, FileText, ArrowRight } from 'lucide-react';

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

/** Shape of rows returned by the `groups` list query (subset of DB columns actually used). */
interface GroupListRow extends Record<string, unknown> {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  max_capacity?: unknown;
  readiness_score?: unknown;
}

/** Row contract of the `get_group_profitability` RPC (RETURNS TABLE, unit_economics_engine.sql). */
interface GroupProfitabilityRow {
  total_revenue_dzd: number;
  total_revenue_sar: number;
  total_cost_dzd: number;
  total_cost_sar: number;
  margin_dzd: number;
  margin_sar: number;
  margin_percentage: number;
}

export function UnitEconomicsWorkspace() {
  
  const [groups, setGroups] = useState<OperationalGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<OperationalGroup | null>(null);
  const [economics, setEconomics] = useState<GroupEconomics | null>(null);
  const [econError, setEconError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchGroups() {
      const { data } = await supabase
        .from('groups')
        .select('id, name, status, max_capacity, readiness_score')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (data && Array.isArray(data) && data.length > 0) {
        const mapped = data.map((d: GroupListRow) => ({
          id: String(d['id'] ?? ''),
          name: String(d['name'] ?? ''),
          status: String(d['status'] ?? ''),
          capacity: Number(d['max_capacity'] ?? 0),
          readiness_score: Number(d['readiness_score'] ?? 0),
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

      if (error) {
        // §4 ZERO FAKE BUSINESS DATA: never substitute invented financials.
        setEconomics(null);
        setEconError(error.message);
      } else if (data && Array.isArray(data) && data.length > 0) {
        const row = data[0] as GroupProfitabilityRow;
        setEconomics({
          total_revenue_dzd: Number(row.total_revenue_dzd ?? 0),
          total_revenue_sar: Number(row.total_revenue_sar ?? 0),
          total_cost_dzd: Number(row.total_cost_dzd ?? 0),
          total_cost_sar: Number(row.total_cost_sar ?? 0),
          margin_dzd: Number(row.margin_dzd ?? 0),
          margin_sar: Number(row.margin_sar ?? 0),
          margin_percentage: Number(row.margin_percentage ?? 0),
        });
        setEconError(null);
      } else {
        // RPC returned no rows: show an explicit no-data state, not a fabricated P&L.
        setEconomics(null);
        setEconError(null);
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

  /**
   * §4 ZERO FAKE BUSINESS DATA: the former hard-coded phase timeline
   * (invented revenue/cost per phase) has been removed. A real lifecycle
   * trajectory requires a period-bucketed ledger source; rendering invented
   * points is forbidden. The chart section is hidden until that dataset exists.
   */

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
          {!loading && !economics && econError && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-slate-500">
              <p className="text-sm max-w-md">Could not load group profitability: {econError}</p>
            </div>
          )}
          {!loading && !economics && !econError && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-slate-500">
              <p className="text-sm">No profitability data for this group yet — it appears once the group has booked revenue or costs.</p>
            </div>
          )}
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

              {/* Lifecycle trajectory chart: intentionally not rendered until a real
                  period-bucketed ledger dataset exists (see §4 note above). */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-300 mb-2">Financial Trajectory (Revenue vs Cost)</h3>
                <p className="text-xs text-slate-500">
                  Requires a period-bucketed ledger dataset. Hidden rather than rendering invented phase values.
                </p>
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
          {/* §4 ZERO FAKE BUSINESS DATA: the previous hard-coded receivables/liabilities
              figures were removed. These panels render only values sourced from the
              profitability RPC once an AR/AP feed is wired to this workspace. */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
            <div className="text-slate-400 font-medium mb-1">Receivables</div>
            <p className="text-xs text-slate-500">Awaiting AR feed integration — no fabricated values are shown.</p>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
            <div className="text-slate-400 font-medium mb-1">Supplier Liabilities</div>
            <p className="text-xs text-slate-500">Awaiting AP feed integration — no fabricated values are shown.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
