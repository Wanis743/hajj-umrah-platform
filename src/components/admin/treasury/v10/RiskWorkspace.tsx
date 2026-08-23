import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertOctagon, TrendingDown, Activity, ShieldAlert, BarChart3, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface RiskWorkspaceProps {
  registry: WorkspaceRegistry;
}

interface RiskEvent {
  id: string;
  category: string;
  name: string;
  probability: string;
  impact: string;
}

export function RiskWorkspace({ registry }: RiskWorkspaceProps) {
  const [events, setEvents] = useState<RiskEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRiskEvents = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('risk_events')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setEvents([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setEvents((data as Array<Record<string, unknown>>).map(e => ({
            id: String(e.id || ''),
            category: 'Operational', // Needs classification logic or field
            name: String(e.event_name || 'Risk Event'),
            probability: Number(e.probability || 0) > 60 ? 'HIGH' : Number(e.probability || 0) > 30 ? 'MEDIUM' : 'LOW',
            impact: String(e.impact || 'Unknown')
          })));
        } else {
          setEvents([
            { id: 'RSK-01', category: 'FX Risk', name: 'SAR/USD Peg Fluctuation', probability: 'LOW', impact: '$1.2M Exposure' },
            { id: 'RSK-02', category: 'Operational', name: 'Supplier Payment Delay', probability: 'MEDIUM', impact: 'Moderate' },
            { id: 'RSK-03', category: 'Market', name: 'Fuel Price Increase (Transport)', probability: 'HIGH', impact: 'Margin -2%' }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch risk events');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchRiskEvents();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-200">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p className="text-slate-400">Loading risk workspace...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-200 p-6">
        <AlertCircle className="w-8 h-8 text-rose-400 mb-4" />
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 text-slate-200">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-indigo-400" />
            Risk Management
          </h2>
          <p className="text-sm text-slate-400 mt-1">Enterprise risk assessment and mitigation tracking</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-slate-900/50 border border-white/5 rounded-xl">
          <div className="text-sm text-slate-400 mb-1">Total Value at Risk (VaR)</div>
          <div className="text-2xl font-semibold text-white">$4.2M</div>
          <div className="text-xs text-rose-400 mt-1 flex items-center">
            <TrendingDown className="w-3 h-3 mr-1" /> +$200k from last month
          </div>
        </div>
        <div className="p-4 bg-slate-900/50 border border-white/5 rounded-xl">
          <div className="text-sm text-slate-400 mb-1">Active High Risks</div>
          <div className="text-2xl font-semibold text-white">{events.filter(e => e.probability === 'HIGH').length}</div>
        </div>
      </div>

      <div className="bg-slate-900/40 border border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-800/30">
          <h3 className="font-medium text-slate-200 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400" />
            Risk Register
          </h3>
          <button className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">Add Risk Event</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 font-medium">Risk ID</th>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium">Event Description</th>
                <th className="px-6 py-3 font-medium">Probability</th>
                <th className="px-6 py-3 font-medium">Expected Impact</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {events.map((event) => (
                <tr key={event.id} className="hover:bg-white/5 transition-colors cursor-pointer group">
                  <td className="px-6 py-4 font-mono text-slate-300">{event.id.substring(0, 8)}</td>
                  <td className="px-6 py-4 text-slate-400">{event.category}</td>
                  <td className="px-6 py-4 font-medium text-slate-200">{event.name}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      event.probability === 'HIGH' ? 'bg-rose-500/10 text-rose-400' :
                      event.probability === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {event.probability}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-300">{event.impact}</td>
                  <td className="px-6 py-4 text-right">
                    <ChevronRight className="w-4 h-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No risk events recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
