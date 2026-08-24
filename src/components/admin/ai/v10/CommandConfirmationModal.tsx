import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Check, X, Database } from 'lucide-react';
import { CommandDefinition, CommandContext } from '../../../../platform/compat/workspaceRegistry';

interface CommandConfirmationModalProps {
  isOpen: boolean;
  command: CommandDefinition | null;
  context: CommandContext | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CommandConfirmationModal({
  isOpen,
  command,
  context,
  onConfirm,
  onCancel
}: CommandConfirmationModalProps) {
  if (!isOpen || !command) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
          className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-lg overflow-hidden backdrop-blur-md bg-slate-900/90 border border-amber-500/20 rounded-xl shadow-2xl shadow-black/50"
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-5 border-b border-white/5 bg-amber-500/5">
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-200 tracking-tight">
                Confirm Database Mutation
              </h2>
              <p className="text-sm text-amber-400/80">
                The AI is proposing an action that will modify data.
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Proposed Command
              </h3>
              <div className="flex items-center gap-2 p-3 bg-slate-950/50 border border-white/5 rounded-lg text-slate-200 font-medium">
                <Database className="w-4 h-4 text-slate-400" />
                {command.label}
              </div>
            </div>

            {command.description && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Description
                </h3>
                <p className="text-sm text-slate-300">
                  {command.description}
                </p>
              </div>
            )}

            {context && Object.keys(context).length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Execution Payload
                </h3>
                <div className="p-3 bg-slate-950/80 border border-white/5 rounded-lg overflow-x-auto">
                  <pre className="text-xs text-slate-400 font-mono">
                    {JSON.stringify(context, null, 2)}
                  </pre>
                </div>
              </div>
            )}
            
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-300/90">
                This action cannot be undone. Please verify the execution payload carefully before approving.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-5 border-t border-white/5 bg-slate-950/50">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800/50 rounded-lg transition-colors flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Reject
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 hover:text-amber-300 rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-amber-500/10"
            >
              <Check className="w-4 h-4" />
              Approve Execution
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
