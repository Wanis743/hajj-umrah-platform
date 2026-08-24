import React, { useState, useEffect } from 'react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { FileText, Plus, Move, LayoutGrid, Download, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../../../lib/supabase';

interface ReportBuilderProps {
  registry: WorkspaceRegistry;
}

interface BiReport {
  id: string;
  title: string;
}

export function ReportBuilder({ registry }: ReportBuilderProps) {
  const [pages, setPages] = useState<{id: string, title: string}[]>([]);
  const [activePage, setActivePage] = useState('p1');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('bi_reports')
          .select('*')
          .limit(10);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setPages([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setPages((data as Array<Record<string, unknown>>).map(r => ({
            id: String(r.id || ''),
            title: String(r.title || 'Untitled Report')
          })));
          setActivePage(String(data[0].id));
        } else {
          setPages([{ id: 'p1', title: 'Executive Summary' }]);
          setActivePage('p1');
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch reports');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchReports();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-transparent text-white/90">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p className="text-white/55">Loading report builder...</p>
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
      {/* Sidebar / Pages List */}
      <div className="w-64 border-r border-white/10 bg-white/[0.04]/30 flex flex-col">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-medium tracking-tight">Report Pages</h3>
          <button 
            onClick={() => {
              const newId = `p${Date.now()}`;
              setPages([...pages, { id: newId, title: `Page ${pages.length + 1}` }]);
              setActivePage(newId);
            }}
            className="p-1 text-white/55 hover:text-white/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => setActivePage(page.id)}
              className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-colors ${
                activePage === page.id 
                  ? 'bg-indigo-500/20 text-indigo-400' 
                  : 'text-white/55 hover:bg-white/[0.07] hover:text-white/90'
              }`}
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span className="truncate">{page.title}</span>
              </div>
              <Move className="w-3 h-3 opacity-0 group-hover:opacity-50" />
            </button>
          ))}
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex flex-col bg-transparent">
        <div className="p-4 border-b border-white/10 bg-white/[0.04]/20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-medium text-white/90">
              {pages.find(p => p.id === activePage)?.title || 'Untitled'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 text-white/55 hover:text-white/90 hover:bg-white/5 rounded-lg transition-colors">
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-white/[0.04]/50 border border-white/10 hover:bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10 text-white/90 rounded-lg transition-colors text-sm font-medium">
              <Download className="w-4 h-4 text-white/55" />
              Export PDF
            </button>
          </div>
        </div>

        <div className="flex-1 p-8 overflow-auto flex justify-center bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')]">
          <motion.div 
            key={activePage}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-4xl min-h-[842px] bg-white/[0.04]/80 backdrop-blur-md border border-white/10 shadow-2xl p-8 rounded-sm"
          >
            <div className="border-2 border-dashed border-white/10 rounded-lg h-32 flex items-center justify-center text-white/40 mb-6 hover:bg-white/5 transition-colors cursor-pointer">
              <span className="text-sm">Drag & Drop Visualization Header Here</span>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="border-2 border-dashed border-white/10 rounded-lg h-64 flex items-center justify-center text-white/40 hover:bg-white/5 transition-colors cursor-pointer">
                <span className="text-sm">Drop Chart Widget</span>
              </div>
              <div className="border-2 border-dashed border-white/10 rounded-lg h-64 flex items-center justify-center text-white/40 hover:bg-white/5 transition-colors cursor-pointer">
                <span className="text-sm">Drop Data Table</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
