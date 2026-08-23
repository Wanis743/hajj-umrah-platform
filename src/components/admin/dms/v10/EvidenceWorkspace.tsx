import React, { useState, useEffect } from 'react';
import { Package, Plus, Link as LinkIcon, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface EvidencePackage {
  id: string;
  name: string;
  linkedTo: string;
  status: string;
  docsCount: number;
}

interface EvidenceWorkspaceProps {
  registry?: WorkspaceRegistry;
}

export function EvidenceWorkspace({ registry }: EvidenceWorkspaceProps) {
  const [packages, setPackages] = useState<EvidencePackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPackages = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('evidence_packages')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(50);

        if (fetchError) throw fetchError;

        if (data) {
          setPackages((data as Array<Record<string, unknown>>).map(p => ({
            id: String(p.id || ''),
            name: String(p.name || 'Untitled Package'),
            linkedTo: String(p.polymorphic_type || 'None'),
            status: String(p.status || 'open'),
            docsCount: 0 // Mocking count since it requires a join
          })));
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred while fetching packages');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchPackages();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Evidence Workspace</h1>
          <p className="text-sm text-slate-400">Compile and review evidence packages</p>
        </div>
        <button className="flex items-center space-x-2 px-4 py-2 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 transition-all duration-200">
          <Plus className="w-4 h-4" strokeWidth={2} />
          <span>New Package</span>
        </button>
      </div>

      <div className="p-6 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-slate-400">Loading evidence packages...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl">
            {packages.map((pkg) => (
              <div 
                key={pkg.id}
                className="flex items-center justify-between p-4 bg-slate-900/40 border border-white/5 rounded-xl hover:border-white/10 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-indigo-500/10 rounded-lg">
                    <Package className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-200">{pkg.name}</h3>
                    <div className="flex items-center space-x-3 mt-1 text-sm text-slate-400">
                      <span className="flex items-center">
                        <LinkIcon className="w-3 h-3 mr-1" />
                        {pkg.linkedTo}
                      </span>
                      <span>•</span>
                      <span>{pkg.docsCount} documents</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4">
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                    pkg.status === 'open' ? 'bg-amber-500/10 text-amber-400' :
                    pkg.status === 'verified' ? 'bg-emerald-500/10 text-emerald-400' :
                    'bg-slate-500/10 text-slate-400'
                  }`}>
                    {pkg.status}
                  </span>
                  <button className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-emerald-400 transition-colors">
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
            
            {packages.length === 0 && (
              <div className="py-12 text-center text-slate-400 border border-dashed border-white/10 rounded-xl">
                <Package className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No evidence packages found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
