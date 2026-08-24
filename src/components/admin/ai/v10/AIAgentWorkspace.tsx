import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { BrainCircuit, Activity, Clock, Terminal, ChevronRight, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';

interface AIAgentWorkspaceProps {
  registry: WorkspaceRegistry;
}

interface AgentEvent {
  id: string;
  timestamp: string;
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'mutation_proposal';
  content: string;
  metadata?: Record<string, unknown>;
  status?: 'success' | 'error' | 'pending';
}

const MOCK_EVENTS: AgentEvent[] = [
  {
    id: '1',
    timestamp: '2026-08-22T10:00:00Z',
    type: 'reasoning',
    content: 'User requested to cancel booking #B-7721. I need to verify the booking status first.',
  },
  {
    id: '2',
    timestamp: '2026-08-22T10:00:02Z',
    type: 'tool_call',
    content: 'fetch_booking_details',
    metadata: { booking_id: 'B-7721' },
    status: 'success'
  },
  {
    id: '3',
    timestamp: '2026-08-22T10:00:05Z',
    type: 'tool_result',
    content: 'Booking status is CONFIRMED. Associated flights found. Cancellation policy allows full refund within 48h.',
    status: 'success'
  },
  {
    id: '4',
    timestamp: '2026-08-22T10:00:10Z',
    type: 'reasoning',
    content: 'I will propose a database mutation to update the booking status and trigger the refund process.',
  },
  {
    id: '5',
    timestamp: '2026-08-22T10:00:15Z',
    type: 'mutation_proposal',
    content: 'cancel_booking_with_refund',
    metadata: { booking_id: 'B-7721', refund_amount: 1500, currency: 'USD' },
    status: 'pending'
  }
];

export function AIAgentWorkspace({ registry }: AIAgentWorkspaceProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  
  const selectedEvent = MOCK_EVENTS.find(e => e.id === selectedEventId);
  const activeWorkspaceName = registry.getActiveWorkspace()?.name || 'Global';

  const renderEventIcon = (event: AgentEvent) => {
    switch (event.type) {
      case 'reasoning':
        return <BrainCircuit className="w-4 h-4 text-indigo-400" />;
      case 'tool_call':
        return <Wrench className="w-4 h-4 text-amber-400" />;
      case 'tool_result':
        return event.status === 'success' 
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          : <XCircle className="w-4 h-4 text-rose-400" />;
      case 'mutation_proposal':
        return <Terminal className="w-4 h-4 text-rose-400" />;
      default:
        return <Activity className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="h-full w-full flex flex-col backdrop-blur-md bg-slate-900/40 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10 bg-slate-950/50">
        <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
          <BrainCircuit className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-200 tracking-tight">AI Agent Audit Workspace</h2>
          <p className="text-sm text-slate-400">Context: {activeWorkspaceName}. Deep-dive into agent reasoning, tool calls, and proposed mutations.</p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Timeline List */}
        <div className="w-1/2 md:w-1/3 flex flex-col border-r border-white/10 bg-slate-950/30 overflow-y-auto">
          {MOCK_EVENTS.map(event => (
            <button
              key={event.id}
              onClick={() => setSelectedEventId(event.id)}
              className={`flex items-start gap-3 p-4 border-b border-white/5 text-left transition-colors ${
                selectedEventId === event.id 
                  ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' 
                  : 'hover:bg-slate-800/30 border-l-2 border-l-transparent'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {renderEventIcon(event)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    {event.type.replace('_', ' ')}
                  </span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-sm text-slate-400 truncate">
                  {event.content}
                </p>
              </div>
              <ChevronRight className={`w-4 h-4 shrink-0 self-center ${selectedEventId === event.id ? 'text-indigo-400' : 'text-slate-600'}`} />
            </button>
          ))}
        </div>

        {/* Detail View */}
        <div className="flex-1 bg-slate-900/50 overflow-y-auto">
          <motion.div 
            key={selectedEventId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="p-6 h-full"
          >
            {selectedEvent ? (
              <div className="space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-white/10">
                  {renderEventIcon(selectedEvent)}
                  <h3 className="text-lg font-semibold text-slate-200 capitalize">
                    {selectedEvent.type.replace('_', ' ')} Detail
                  </h3>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Content
                  </span>
                  <div className="p-4 bg-slate-950/50 border border-white/5 rounded-lg text-slate-300 text-sm leading-relaxed">
                    {selectedEvent.content}
                  </div>
                </div>

                {selectedEvent.metadata && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Metadata / Payload
                    </span>
                    <div className="p-4 bg-slate-950/80 border border-white/5 rounded-lg overflow-x-auto">
                      <pre className="text-xs text-slate-400 font-mono">
                        {JSON.stringify(selectedEvent.metadata, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {selectedEvent.status && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Execution Status
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${
                        selectedEvent.status === 'success' 
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                          : selectedEvent.status === 'error'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}>
                        {selectedEvent.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-3">
                <BrainCircuit className="w-12 h-12 opacity-20" />
                <p>Select an event from the timeline to view details.</p>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
