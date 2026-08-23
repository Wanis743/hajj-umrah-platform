import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, Terminal, Send, Settings } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { WorkspaceState } from '../../../../lib/kernel/KernelTypes';

interface CopilotSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceRegistry: WorkspaceRegistry;
}

export function CopilotSidebar({ isOpen, onClose, workspaceRegistry }: CopilotSidebarProps) {
  const [messages, setMessages] = useState<{ id: string; text: string; sender: 'user' | 'ai' }[]>([]);
  const [input, setInput] = useState('');
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceState | undefined>(workspaceRegistry.getActiveWorkspace());

  useEffect(() => {
    const unsubscribe = workspaceRegistry.subscribe((workspaces) => {
      setActiveWorkspace(workspaces.find(w => w.id === workspaceRegistry.getActiveWorkspace()?.id));
    });
    return unsubscribe;
  }, [workspaceRegistry]);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages([...messages, { id: Date.now().toString(), text: input, sender: 'user' }]);
    setInput('');
    // Mock AI response
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        text: 'I understand you want to perform an action. Let me process that for you in ' + (activeWorkspace?.name || 'the system') + '.', 
        sender: 'ai' 
      }]);
    }, 500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed inset-y-0 right-0 w-96 backdrop-blur-md bg-slate-900/40 border-l border-white/10 z-50 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10 bg-slate-950/50">
            <div className="flex items-center gap-2 text-indigo-400">
              <Terminal className="w-5 h-5" />
              <h2 className="font-semibold tracking-tight">AI Copilot</h2>
            </div>
            <button 
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors rounded hover:bg-slate-800/50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Context Pane */}
          <div className="p-3 border-b border-white/10 bg-slate-900/20 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-400">
              <span>Context:</span>
              <span className="text-slate-200 font-medium">{activeWorkspace ? activeWorkspace.name : 'Global'}</span>
            </div>
            <Settings className="w-4 h-4 text-slate-500 hover:text-slate-300 cursor-pointer" />
          </div>

          {/* Chat Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
                <MessageSquare className="w-8 h-8 opacity-50" />
                <p>How can I assist you today?</p>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg p-3 text-sm ${
                    msg.sender === 'user' 
                      ? 'bg-indigo-500/20 text-indigo-100 border border-indigo-500/30' 
                      : 'bg-slate-800/50 text-slate-200 border border-white/5'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-white/10 bg-slate-950/80">
            <div className="flex items-center gap-2 bg-slate-900/50 border border-white/10 rounded-lg p-1 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all">
              <input 
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask Copilot..."
                className="flex-1 bg-transparent border-none focus:outline-none text-sm text-slate-200 px-3 py-2 placeholder-slate-500"
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-2 text-indigo-400 hover:bg-indigo-500/20 rounded disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
