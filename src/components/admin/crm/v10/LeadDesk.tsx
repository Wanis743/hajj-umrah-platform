import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Filter, Phone, Mail, User, Clock, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface LeadDeskProps {
  registry: WorkspaceRegistry;
}

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'LOST' | string;
  source: string;
  created_at: string;
}

export function LeadDesk({ registry }: LeadDeskProps) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeads = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const { data, error: supabaseError } = await supabase
          .from('leads')
          .select('*')
          .order('created_at', { ascending: false });

        if (supabaseError) throw supabaseError;
        setLeads((data || []).map((d: unknown) => {
          const lead = d as Record<string, unknown>;
          return {
            id: String(lead.id || ''),
            name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown',
            email: String(lead.email || ''),
            phone: String(lead.phone || ''),
            status: String(lead.status || 'NEW'),
            source: String(lead.source || ''),
            created_at: String(lead.created_at || new Date().toISOString())
          };
        }));
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred while fetching leads');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeads();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'NEW': return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
      case 'CONTACTED': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'QUALIFIED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'LOST': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      default: return 'text-white/55 bg-slate-500/10 border-slate-500/20';
    }
  };

  const filteredLeads = leads.filter(lead => 
    (lead.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (lead.email?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-transparent text-white/90">
      <div className="flex items-center justify-between p-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Lead Desk</h1>
          <p className="text-sm text-white/55 mt-1">Manage and track inbound leads</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/55" />
            <input 
              type="text" 
              placeholder="Search leads..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white/[0.04]/50 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-indigo-500/50 transition-colors w-64"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white/[0.04]/50 border border-white/10 rounded-lg hover:bg-white/[0.07] transition-colors">
            <Filter className="w-4 h-4 text-white/55" />
            Filter
            <ChevronDown className="w-4 h-4 text-white/55" />
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors">
            <Plus className="w-4 h-4" />
            New Lead
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-white/55">
            <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
            <p>Loading leads...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-rose-400">
            <AlertCircle className="w-8 h-8 mb-4" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredLeads.map((lead, i) => (
              <motion.div 
                key={lead.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.05 }}
                className="flex items-center justify-between p-4 bg-white/[0.04]/40 backdrop-blur-md border border-white/10 rounded-xl hover:bg-white/[0.07] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10 flex items-center justify-center border border-white/5">
                    <User className="w-5 h-5 text-white/55" />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-white/90">{lead.name || 'Unnamed Lead'}</h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-white/55">
                      <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {lead.email || 'No email'}</span>
                      <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {lead.phone || 'No phone'}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-end gap-1">
                    <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(lead.status)}`}>
                      {lead.status || 'UNKNOWN'}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-white/40">
                      <Clock className="w-3 h-3" /> {new Date(lead.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
            {filteredLeads.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-white/40">
                <User className="w-12 h-12 mb-3 text-white/35" />
                <p>No leads found matching your criteria</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
