/**
 * useJournalCommands (slice 3) — kernel execution hook for the workbench.
 * Keeps JournalWorkbench a pure composition surface.
 */

import { useCallback, useState } from 'react';
import type { PlatformKernel } from '../kernelBridge';
import { JOURNAL_COMMANDS } from './commands';
import type { Principal } from '../kernel/types.ts';

export interface UseJournalCommandsResult {
  readonly busy: 'draft' | 'approve' | null;
  readonly runDraft: (draft: unknown) => Promise<void>;
  readonly runApprove: (entryId: string, reason: string) => Promise<void>;
}

interface ExecuteOutcome {
  readonly ok: boolean;
  readonly value?: {
    readonly status: string;
    readonly message?: string;
  };
  readonly error?: { readonly message: string };
}

export function useJournalCommands(input: {
  readonly kernel: PlatformKernel;
  readonly wired: boolean;
  readonly principal: Principal | null;
  readonly toast: (msg: string, opts?: { readonly icon?: string }) => void;
  readonly toastSuccess: (msg: string) => void;
  readonly toastError: (msg: string) => void;
  readonly onDraftSaved: () => void;
  readonly onLedgerChanged: () => Promise<void> | void;
}): UseJournalCommandsResult {
  const { kernel, wired, principal, toast, toastSuccess, toastError, onDraftSaved, onLedgerChanged } = input;
  const [busy, setBusy] = useState<'draft' | 'approve' | null>(null);

  const execute = useCallback(
    async (
      kind: 'draft' | 'approve',
      payload: Record<string, unknown>,
      target?: { objectTypeId: string; id: string },
    ): Promise<void> => {
      if (principal === null || !wired) return;
      const commandId = kind === 'draft' ? JOURNAL_COMMANDS.CreateDraft : JOURNAL_COMMANDS.ApproveEntry;
      const reason = kind === 'approve' ? 'Journal approval' : 'Journal draft creation';
      setBusy(kind);
      try {
        let outcome: ExecuteOutcome = await kernel.executeCommand({
          commandId,
          principal,
          target,
          payload,
          reason,
        });
        // Confirmation policy: material financial actions require an explicit second pass.
        if (outcome.ok && outcome.value?.status === 'needs_confirmation') {
          toast(outcome.value.message ?? 'Confirm this action before posting', { icon: '⚠️' });
          outcome = await kernel.executeCommand({
            commandId,
            principal,
            target,
            payload: { ...payload, confirmed: true },
            reason,
          });
        }
        if (!outcome.ok) {
          toastError(outcome.error?.message ?? 'Command failed');
          return;
        }
        if (outcome.value?.status === 'executed') {
          toastSuccess(outcome.value.message ?? 'Done');
          if (kind === 'draft') onDraftSaved();
          await onLedgerChanged();
        }
      } finally {
        setBusy(null);
      }
    },
    [kernel, principal, wired, toast, toastSuccess, toastError, onDraftSaved, onLedgerChanged],
  );

  return {
    busy,
    runDraft: useCallback((draft: unknown) => execute('draft', { draft }), [execute]),
    runApprove: useCallback(
      (entryId: string, reasonText: string) =>
        execute('approve', { confirmed: true, reason: reasonText }, { objectTypeId: 'journal', id: entryId }),
      [execute],
    ),
  };
}
