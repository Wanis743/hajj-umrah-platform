import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { PieChart as PieChartIcon, BarChart as BarChartIcon, LineChart as LineChartIcon, Settings, SlidersHorizontal, Save, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
  PieChart, Pie, Cell
} from 'recharts';

interface VisualizationStudioProps {
  registry: WorkspaceRegistry;
}

type ChartType = 'bar' | 'line' | 'pie';

interface BiVisualization {
  id: string;
  chart_type: string;
  report_id: string | null;
  dataset_id: string | null;
}

const mockData = [
  { name: 'Jan', revenue: 400000, bookings: 240 },
  { name: 'Feb', revenue: 300000, bookings: 139 },
  { name: 'Mar', revenue: 200000, bookings: 980 },
  { name: 'Apr', revenue: 278000, bookings: 390 },
  { name: 'May', revenue: 189000, bookings: 480 },
  { name: 'Jun', revenue: 239000, bookings: 380 },
  { name: 'Jul', revenue: 349000, bookings: 430 },
];

const mockPieData = [
  { name: 'Transport', value: 400 },
  { name: 'Accommodation', value: 300 },
  { name: 'Visas', value: 300 },
  { name: 'Services', value: 200 },
];

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export function VisualizationStudio({ registry }: VisualizationStudioProps) {
  const [activeChart, setActiveChart] = useState<ChartType>('bar');
  const [title, setTitle] = useState('Revenue vs Bookings');
  const [visualizations, setVisualizations] = useState<BiVisualization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVisualizations = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const { data, error: fetchError } = await supabase
          .from('bi_visualizations')
          .select('*')
          .limit(20);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setVisualizations([]);
            return;
          }
          throw fetchError;
        }

        if (data) {
          setVisualizations((data as Array<Record<string, unknown>>).map(v => ({
            id: String(v.id || ''),
            chart_type: String(v.chart_type || 'bar'),
            report_id: v.report_id ? String(v.report_id) : null,
            dataset_id: v.dataset_id ? String(v.dataset_id) : null
          })));
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch visualizations');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchVisualizations();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-transparent text-white/90">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p className="text-white/55">Loading visualization studio...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-transparent text-white/90 p-6">
        <AlertCircle className="w-8 h-8 text-rose-400 mb-4" />
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-transparent text-white/90">
      {/* Sidebar / Builder Tools */}
      <div className="w-64 border-r border-white/10 bg-white/[0.04]/30 flex flex-col">
        <div className="p-4 border-b border-white/10">
          <h3 className="font-medium tracking-tight mb-4">Chart Type</h3>
          <div className="flex gap-2">
            <button 
              onClick={() => setActiveChart('bar')}
              className={`p-2 rounded-lg border flex-1 flex justify-center items-center transition-colors ${activeChart === 'bar' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'border-white/10 text-white/55 hover:bg-white/[0.07]'}`}
            >
              <BarChartIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setActiveChart('line')}
              className={`p-2 rounded-lg border flex-1 flex justify-center items-center transition-colors ${activeChart === 'line' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'border-white/10 text-white/55 hover:bg-white/[0.07]'}`}
            >
              <LineChartIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setActiveChart('pie')}
              className={`p-2 rounded-lg border flex-1 flex justify-center items-center transition-colors ${activeChart === 'pie' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'border-white/10 text-white/55 hover:bg-white/[0.07]'}`}
            >
              <PieChartIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-6">
          <div>
            <div className="flex items-center justify-between text-sm mb-3">
              <span className="font-medium text-white/80">Data Source</span>
              <Settings className="w-4 h-4 text-white/40" />
            </div>
            <select className="w-full bg-white/[0.04]/50 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-indigo-500/50">
              <option>Pilgrim Volumes Dataset</option>
              <option>Revenue by Service</option>
              <option>Resource Utilization</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm mb-3">
              <span className="font-medium text-white/80">Dimensions</span>
              <SlidersHorizontal className="w-4 h-4 text-white/40" />
            </div>
            <div className="p-3 bg-white/[0.04]/50 border border-white/10 border-dashed rounded-lg text-center">
              <span className="text-xs text-white/40">Drop dimension here</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm mb-3">
              <span className="font-medium text-white/80">Measures</span>
              <SlidersHorizontal className="w-4 h-4 text-white/40" />
            </div>
            <div className="p-3 bg-white/[0.04]/50 border border-white/10 border-dashed rounded-lg text-center">
              <span className="text-xs text-white/40">Drop measure here</span>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <h4 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">Saved Visualizations</h4>
            {visualizations.length === 0 ? (
              <p className="text-sm text-white/55 italic">No saved charts</p>
            ) : (
              <ul className="space-y-2">
                {visualizations.map(v => (
                  <li key={v.id} className="text-sm text-white/80 bg-white/5 p-2 rounded truncate">{v.chart_type} chart ({v.id.substring(0, 8)})</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-white/10 bg-white/[0.04]/20 flex items-center justify-between">
          <input 
            type="text" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-transparent border-none focus:outline-none text-lg font-medium w-64 hover:bg-white/5 p-1 rounded transition-colors"
          />
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors text-sm font-medium">
            <Save className="w-4 h-4" />
            Save Chart
          </button>
        </div>

        <div className="flex-1 p-8 flex items-center justify-center bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')]">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-4xl aspect-[16/9] bg-white/[0.04]/60 backdrop-blur-sm border border-white/10 rounded-xl flex flex-col shadow-2xl p-6"
          >
            <h2 className="text-xl font-medium text-white/90 mb-6 text-center">{title}</h2>
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                {activeChart === 'bar' ? (
                  <BarChart data={mockData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" stroke="#94a3b8" tick={{fill: '#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val/1000}k`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#ffffff1a', borderRadius: '8px' }}
                      itemStyle={{ color: '#f8fafc' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                    <Bar yAxisId="left" dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} name="Revenue" />
                    <Bar yAxisId="right" dataKey="bookings" fill="#10b981" radius={[4, 4, 0, 0]} name="Bookings" />
                  </BarChart>
                ) : activeChart === 'line' ? (
                  <LineChart data={mockData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <YAxis stroke="#94a3b8" tick={{fill: '#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val/1000}k`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#ffffff1a', borderRadius: '8px' }}
                      itemStyle={{ color: '#f8fafc' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                    <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 6 }} name="Revenue" />
                  </LineChart>
                ) : (
                  <PieChart>
                    <Pie
                      data={mockPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={120}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {mockPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#ffffff1a', borderRadius: '8px' }}
                      itemStyle={{ color: '#f8fafc' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  </PieChart>
                )}
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
