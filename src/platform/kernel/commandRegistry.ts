/**
 * Command Registry (spec §7, §32, §72) — commands named after authoritative
 * domain actions, with confirmation rules and handler contracts.
 *
 * A command is registered once; UI surfaces (palette, buttons) execute through
 * the registry so that authorization + confirmation + audit are unavoidable.
 */

import type {
  CommandId,
  CorrelationId,
  KernelError,
  MinorUnits,
  Principal,
  Result,
} from './types.ts';
import { commandId as mkCommandId, err, ok } from './types.ts';

export interface ConfirmationContext {
  /** What the user is shown before execution (§32: confirmation + authorization context). */
  readonly titleKey: string;
  readonly summary: string;
}

export interface CommandEnvelope {
  readonly principal: Principal;
  /** Target object(s), when the command acts on one. */
  readonly target?: { readonly typeId: string; readonly id: string };
  /** Amount for authority-bounded commands (minor units). */
  readonly amount?: MinorUnits;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
}

export interface CommandResultData {
  readonly status: 'executed' | 'rejected' | 'needs_confirmation' | 'disabled';
  readonly message?: string;
  /** Server transaction reference when the command hit an RPC. */
  readonly serverRef?: string;
  readonly confirmation?: ConfirmationContext;
}

export type CommandHandler = (
  envelope: CommandEnvelope,
) => Promise<Result<CommandResultData, KernelError>>;

export interface CommandDefinition {
  readonly id: CommandId;
  /** i18n key (§38). */
  readonly labelKey: string;
  /** Keyboard shortcut, e.g. "mod+k" — display only; binding handled by shell. */
  readonly shortcut?: string;
  readonly scope: 'global' | 'workspace' | 'panel';
  /** When provided, the command appears disabled with this reason (§4: dead actions forbidden). */
  readonly disabledReasonKey?: string;
  readonly handler: CommandHandler;
}

const CMD_ERR = 'COMMAND_REGISTRY' as const;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(def: CommandDefinition): Result<null, KernelError> {
    if (this.commands.has(def.id)) {
      return err({
        code: 'ALREADY_REGISTERED',
        message: `Command already registered: ${def.id}`,
        details: { domain: CMD_ERR, commandId: def.id },
      });
    }
    this.commands.set(def.id, def);
    return ok(null);
  }

  get(id: CommandId): Result<CommandDefinition, KernelError> {
    const def = this.commands.get(id);
    if (!def) {
      return err({ code: 'NOT_FOUND', message: `Unknown command: ${id}`, details: { domain: CMD_ERR, commandId: id } });
    }
    return ok(def);
  }

  list(): readonly CommandDefinition[] {
    return [...this.commands.values()];
  }

  isEnabled(id: CommandId): boolean {
    const def = this.commands.get(id);
    return def !== undefined && def.disabledReasonKey === undefined;
  }

  /**
   * Execute a command after permission + confirmation policy checks.
   * The permission engine instance is injected to avoid a circular import.
   */
  async execute(
    id: CommandId,
    envelope: Omit<CommandEnvelope, 'correlationId'>,
    authorize: (
      id: CommandId,
      principal: Principal,
      amount?: MinorUnits,
    ) => Result<{ confirmationRequired: boolean }, KernelError>,
  ): Promise<Result<CommandResultData, KernelError>> {
    const defResult = this.get(id);
    if (!defResult.ok) return defResult;
    const def = defResult.value;

    if (def.disabledReasonKey !== undefined) {
      return ok({
        status: 'disabled',
        message: def.disabledReasonKey,
      });
    }

    const authz = authorize(id, envelope.principal, envelope.amount);
    if (!authz.ok) return authz;

    if (authz.value.confirmationRequired) {
      // First pass: surface the confirmation context instead of executing.
      // The caller re-executes with `confirmed: true` in the payload.
      if (envelope.payload['confirmed'] !== true) {
        return ok({
          status: 'needs_confirmation',
          confirmation: {
            titleKey: `${def.id}.confirm.title`,
            summary:
              typeof envelope.payload['confirmationSummary'] === 'string'
                ? envelope.payload['confirmationSummary']
                : `${def.labelKey} (${envelope.amount?.toString() ?? 'n/a'})`,
          },
        });
      }
    }

    const full: CommandEnvelope = { ...envelope, correlationId: newCorrelation() };
    return def.handler(full);
  }
}

function newCorrelation(): CorrelationId {
  const c: CorrelationId = globalCryptoUuid();
  return c;
}

function globalCryptoUuid(): CorrelationId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID() as CorrelationId;
  }
  return (`cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`) as CorrelationId;
}

export const COMMAND = {
  PostJournalEntry: mkCommandId('accounting.postJournalEntry'),
  RecordPayment: mkCommandId('accounting.recordPayment'),
  MatchStatementLine: mkCommandId('reconciliation.matchStatementLine'),
  CertifyReconciliation: mkCommandId('reconciliation.certify'),
  LockPeriod: mkCommandId('period.lock'),
  CreateScenario: mkCommandId('fpa.createScenario'),
  PublishPlan: mkCommandId('fpa.publishPlan'),
} as const;
