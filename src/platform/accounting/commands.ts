/**
 * Accounting commands — kernel wiring for the journal lifecycle (slice 3).
 *
 * Every consequential action goes through PlatformKernel.executeCommand so
 * authorization, confirmation policy and audit are unavoidable (§4/§7/§72).
 * The Supabase caller is injected (hexagonal seam) so the command layer is
 * unit-testable under Node without network or path aliases.
 */

import { toMinorUnits } from '../../lib/money.ts';
import {
  minorUnits,
  ok,
  commandId,
  type KernelError,
  type Result,
} from '../kernel/types.ts';
import type {
  CommandDefinition,
  CommandEnvelope,
  CommandResultData,
} from '../kernel/commandRegistry.ts';
import { buildPostArgs, nextReference, parsePostResult, rpcError } from './journalService.ts';

export const JOURNAL_COMMANDS = {
  CreateDraft: commandId('accounting.createJournalDraft'),
  ApproveEntry: commandId('accounting.approveJournalEntry'),
} as const;

/** Roles allowed to draft/approve; server re-verifies via staff_role()/has_permission(). */
export const APPROVER_ROLES: readonly string[] = ['ADMIN', 'CONTROLLER', 'ACCOUNTANT'];

/** Minimal RPC surface actually used by these commands. */
export interface AccountingRpcCaller {
  postJournalEntry(args: {
    p_reference: string;
    p_description: string;
    p_entry_date: string;
    p_lines: readonly {
      account_id: string;
      debit: string;
      credit: string;
      currency_code: string;
      memo: string;
    }[];
  }): Promise<unknown>;
  approveJournalEntry(args: { p_journal_id: string; p_correlation_id: string | null; p_reason: string | null }): Promise<unknown>;
}

interface RpcLikeError {
  readonly code?: unknown;
  readonly message?: unknown;
}

function unwrap(promise: Promise<unknown>): Promise<{ data: unknown; error: KernelError | null }> {
  return promise.then(
    (data) => ({ data, error: null }),
    (cause: unknown) => ({
      data: null,
      error: rpcError(
        typeof cause === 'object' && cause !== null && ('code' in cause || 'message' in cause)
          ? (cause as RpcLikeError)
          : cause,
      ),
    }),
  );
}

export function createJournalDraftCommand(rpc: AccountingRpcCaller): CommandDefinition {
  return {
    id: JOURNAL_COMMANDS.CreateDraft,
    labelKey: 'command.accounting.createJournalDraft',
    scope: 'workspace',
    handler: async (envelope: CommandEnvelope): Promise<Result<CommandResultData, KernelError>> => {
      const raw = envelope.payload['draft'];
      if (typeof raw !== 'object' || raw === null) {
        return {
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: 'Missing journal draft payload', details: { domain: 'ACCOUNTING' } },
        };
      }
      const draft = raw as Record<string, unknown>;
      // Reference is assigned here (single authority) unless supplied.
      let reference: string;
      if (typeof draft['reference'] === 'string' && draft['reference'].length > 0) {
        reference = draft['reference'];
      } else {
        reference = nextReference();
        draft['reference'] = reference;
      }
      if (
        typeof draft['description'] !== 'string' ||
        typeof draft['entryDate'] !== 'string' ||
        !Array.isArray(draft['lines'])
      ) {
        return {
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: 'Malformed journal draft payload', details: { domain: 'ACCOUNTING' } },
        };
      }
      const args = buildPostArgs({
        reference,
        description: draft['description'],
        entryDate: draft['entryDate'],
        lines: draft['lines'] as Parameters<typeof buildPostArgs>[0]['lines'],
      });
      const { data, error } = await unwrap(rpc.postJournalEntry(args));
      if (error !== null) return { ok: false, error };
      const parsed = parsePostResult(data);
      if (!parsed.ok) return parsed;
      return ok({
        status: 'executed',
        message: `Draft ${reference} created`,
        serverRef: parsed.value,
      });
    },
  };
}

export function approveJournalEntryCommand(rpc: AccountingRpcCaller): CommandDefinition {
  return {
    id: JOURNAL_COMMANDS.ApproveEntry,
    labelKey: 'command.accounting.approveJournalEntry',
    scope: 'workspace',
    handler: async (envelope: CommandEnvelope): Promise<Result<CommandResultData, KernelError>> => {
      const target = envelope.target;
      if (target === undefined || target.id.length === 0) {
        return {
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: 'No journal entry targeted', details: { domain: 'ACCOUNTING' } },
        };
      }
      const reason = typeof envelope.payload['reason'] === 'string' ? envelope.payload['reason'] : null;
      const { data, error } = await unwrap(
        rpc.approveJournalEntry({ p_journal_id: target.id, p_correlation_id: null, p_reason: reason }),
      );
      if (error !== null) return { ok: false, error };
      const success =
        typeof data === 'object' && data !== null && (data as Record<string, unknown>)['success'] === true;
      if (!success) {
        return {
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: 'Approval RPC returned no success flag', details: { domain: 'ACCOUNTING' } },
        };
      }
      return ok({
        status: 'executed',
        message: reason !== null ? `Posted (${reason})` : 'Posted to ledger',
        serverRef: target.id,
      });
    },
  };
}

/** Register both commands + their permission rules on a kernel instance. */
export function registerAccountingCommands(
  kernel: {
    commands: { register: (def: CommandDefinition) => Result<null, KernelError> };
    registerCommandRule: (rule: Parameters<import('../kernel/index.ts').PlatformKernel['registerCommandRule']>[0]) => void;
  },
  rpc: AccountingRpcCaller,
): void {
  void kernel.commands.register(createJournalDraftCommand(rpc));
  void kernel.commands.register(approveJournalEntryCommand(rpc));

  kernel.registerCommandRule({
    commandId: JOURNAL_COMMANDS.CreateDraft,
    requiredRoles: APPROVER_ROLES,
    financialImpact: 'none', // creating a DRAFT mutates nothing authoritative
    requiresConfirmation: false,
    boundedByAuthority: false,
  });
  kernel.registerCommandRule({
    commandId: JOURNAL_COMMANDS.ApproveEntry,
    requiredRoles: APPROVER_ROLES,
    financialImpact: 'material', // posting moves the ledger → confirmation required
    requiresConfirmation: false,
    boundedByAuthority: true,
  });
}

/** Production caller backed by the real Supabase client. Imported lazily by the UI layer. */
export async function supabaseAccountingRpc(): Promise<AccountingRpcCaller> {
  const { supabase } = await import('@/lib/supabase');
  return {
    postJournalEntry: async (args) => {
      const { data, error } = await supabase.rpc('post_journal_entry', args);
      if (error !== null) throw error;
      return data;
    },
    approveJournalEntry: async (args) => {
      const { data, error } = await supabase.rpc('approve_journal_entry', args);
      if (error !== null) throw error;
      return data;
    },
  };
}

/** Re-export for callers composing envelopes. */
export { minorUnits, toMinorUnits };
