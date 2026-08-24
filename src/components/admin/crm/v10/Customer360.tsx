import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Activity, Briefcase, FileText, Phone, Mail, MapPin, Calendar, Clock, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface Customer360Props {
  registry: WorkspaceRegistry;
}

interface ActivityEvent {
  id: string;
  type: 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE' | string;
  description: string;
  created_at: string;
}

interface Opportunity {
  id: string;
  name: string;
  stage: string;
  amount: number;
}

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  status: string;
  created_at: string;
}

export function Customer360({ registry }: Customer360Props) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCustomerData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch first lead as customer for demo purposes
        const { data: leadData, error: leadError } = await supabase
          .from('leads')
          .select('*')
          .limit(1)
          .single();

        if (leadError && leadError.code !== 'PGRST116') throw leadError;

        if (leadData) {
          setCustomer({
            id: leadData.id,
            name: ((leadData as Record<string, unknown>).first_name || 'Unknown') + ' ' + ((leadData as Record<string, unknown>).last_name || ''),
            email: String((leadData as Record<string, unknown>).email || ''),
            phone: String((leadData as Record<string, unknown>).phone || ''),
            location: 'Unknown',
            status: String((leadData as Record<string, unknown>).status || 'ACTIVE'),
            created_at: String((leadData as Record<string, unknown>).created_at || new Date().toISOString())
          });

          // Fetch related opportunities
          const { data: oppsData, error: oppsError } = await supabase
            .from('opportunities')
            .select('*')
            .eq('lead_id', leadData.id);

          if (oppsError) throw oppsError;
          setOpportunities((oppsData || []).map((o: unknown) => {
            const opp = o as Record<string, unknown>;
            return {
              id: String(opp.id || ''),
              name: String(opp.name || opp.title || 'Unknown'),
              stage: String(opp.stage || ''),
              amount: Number(opp.amount || opp.value || 0)
            };
          }));

          // Fetch related activities
          const { data: actsData, error: actsError } = await supabase
            .from('sales_activities')
            .select('*')
            .eq('lead_id', leadData.id)
            .order('created_at', { ascending: false });

          if (actsError) throw actsError;
          setActivities((actsData || []).map((a: unknown) => {
            const act = a as Record<string, unknown>;
            return {
              id: String(act.id || ''),
              type: String(act.type || act.activity_type || 'NOTE'),
              description: String(act.description || act.notes || ''),
              created_at: String(act.created_at || new Date().toISOString())
            };
          }));
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred while fetching customer data');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchCustomerData();
  }, []);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'CALL': return <Phone className="w-4 h-4 text-emerald-400" />;
      case 'EMAIL': return <Mail className="w-4 h-4 text-indigo-400" />;
      case 'MEETING': return <Calendar className="w-4 h-4 text-amber-400" />;
      case 'NOTE': return <FileText className="w-4 h-4 text-white/55" />;
      default: return <Activity className="w-4 h-4 text-white/55" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent text-white/90">
      <div className="flex items-center justify-between p-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Customer 360</h1>
          <p className="text-sm text-white/55 mt-1">Comprehensive view of customer interactions and history</p>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-white/55">
            <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
            <p>Loading customer profile...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-rose-400">
            <AlertCircle className="w-8 h-8 mb-4" />
            <p>{error}</p>
          </div>
        ) : !customer ? (
          <div className="flex flex-col items-center justify-center h-full text-white/55">
            <User className="w-12 h-12 mb-3 text-white/35" />
            <p>No customer found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Customer Profile Column */}
            <div className="lg:col-span-1 space-y-6">
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="p-6 bg-white/[0.04]/40 backdrop-blur-md border border-white/10 rounded-xl"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-16 rounded-full bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10 border-2 border-indigo-500/30 flex items-center justify-center">
                    <User className="w-8 h-8 text-white/55" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">{customer.name}</h2>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 mt-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" />
                      {customer.status}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-sm">
                    <Mail className="w-4 h-4 text-white/40" />
                    <span className="text-white/80">{customer.email || 'No email'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="w-4 h-4 text-white/40" />
                    <span className="text-white/80">{customer.phone || 'No phone'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <MapPin className="w-4 h-4 text-white/40" />
                    <span className="text-white/80">{customer.location || 'No location'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="w-4 h-4 text-white/40" />
                    <span className="text-white/80">Joined {new Date(customer.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </motion.div>

              {/* Opportunities */}
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.1 }}
                className="p-6 bg-white/[0.04]/40 backdrop-blur-md border border-white/10 rounded-xl"
              >
                <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-indigo-400" />
                  Opportunities
                </h3>
                <div className="space-y-3">
                  {opportunities.length === 0 ? (
                    <p className="text-sm text-white/40">No opportunities found.</p>
                  ) : (
                    opportunities.map((opp) => (
                      <div key={opp.id} className="p-3 bg-white/[0.05] rounded-lg border border-white/5">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-sm font-medium text-white/90">{opp.name}</span>
                          <span className="text-sm font-semibold text-white/90">${opp.amount || 0}</span>
                        </div>
                        <span className="text-xs text-white/55 uppercase tracking-wider">{opp.stage}</span>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>

            {/* Activity Feed Column */}
            <div className="lg:col-span-2">
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.2 }}
                className="p-6 bg-white/[0.04]/40 backdrop-blur-md border border-white/10 rounded-xl h-full"
              >
                <h3 className="text-base font-semibold mb-6 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  Activity Timeline
                </h3>
                
                {activities.length === 0 ? (
                  <p className="text-sm text-white/40">No activities recorded yet.</p>
                ) : (
                  <div className="relative pl-4 space-y-6">
                    <div className="absolute left-[15px] top-2 bottom-2 w-px bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10" />
                    {activities.map((activity, i) => (
                      <div key={activity.id} className="relative flex gap-4">
                        <div className="absolute -left-6 w-6 h-6 rounded-full bg-transparent border border-white/10 flex items-center justify-center z-10">
                          {getActivityIcon(activity.type)}
                        </div>
                        <div className="flex-1 bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10/20 p-4 rounded-lg border border-white/5">
                          <p className="text-sm text-white/80">{activity.description}</p>
                          <span className="text-xs text-white/40 mt-2 block">
                            {new Date(activity.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
