/**
 * Platform Kernel — unified entry (spec §7).
 *
 * One instance wires the kernel subsystems together with the exact
 * dependency direction the spec requires:
 *   commands → permission engine → audit; events → subscribers; jobs → artifacts.
 */

import { AuditLog, type AuditEvent } from './auditLog.ts';
import { CommandRegistry } from './commandRegistry.ts';
import { EventBus, type DomainEvent, type DomainEventType, type EventHandler } from './eventBus.ts';
import { JobEngine, type JobRecord } from './jobEngine.ts';
import { ObjectRegistry, type ObjectTypeDefinition } from './objectRegistry.ts';
import { PermissionEngine, type CommandPermissionRule } from './permissionEngine.ts';
import type { CommandId, KernelError, MinorUnits, Principal, Result } from './types.ts';
import { newCorrelationId } from './types.ts';
import { WorkspaceRegistry } from './workspaceRegistry.ts';

export class PlatformKernel {
  readonly objects = new ObjectRegistry();
  readonly permissions = new PermissionEngine();
  readonly commands = new CommandRegistry();
  readonly audit = new AuditLog();
  readonly events = new EventBus();
  readonly jobs = new JobEngine();
  readonly workspaces: WorkspaceRegistry;

  constructor(workspaceStorage?: ConstructorParameters<typeof WorkspaceRegistry>[0]) {
    this.workspaces = new WorkspaceRegistry(workspaceStorage);
  }

  /**
   * Execute a domain command through the full policy chain:
   * registry lookup → disabled check → authorization → confirmation → handler → audit.
   *
   * This is the ONLY sanctioned path for UI surfaces to invoke consequential actions.
   */
  async executeCommand(input: {
    commandId: CommandId;
    principal: Principal;
    target?: { readonly objectTypeId: string; readonly id: string };
    amount?: MinorUnits;
    payload?: Readonly<Record<string, unknown>>;
    reason?: string;
  }): Promise<Result<CommandOutcome, KernelError>> {
    const correlationId = newCorrelationId();

    const outcome = await this.commands.execute(
      input.commandId,
      {
        principal: input.principal,
        target:
          input.target !== undefined
            ? { typeId: input.target.objectTypeId, id: input.target.id }
            : undefined,
        amount: input.amount,
        payload: { ...(input.payload ?? {}), confirmed: input.payload?.['confirmed'] === true },
      },
      (id, principal, amount) => this.permissions.authorizeCommand(id, principal, amount),
    );

    if (!outcome.ok) {
      this.audit.append({
        actor: input.principal.userId,
        actorRoles: [...input.principal.roles],
        agencyId: input.principal.scope.agencyId,
        branchId: input.principal.scope.branchId,
        eventType: `${input.commandId}:DENIED`,
        objectTypeId: null,
        objectId: input.target?.id ?? null,
        correlationId,
        reason: input.reason ?? null,
        before: null,
        after: { code: outcome.error.code, message: outcome.error.message },
      });
      return outcome;
    }

    if (outcome.value.status === 'executed') {
      this.audit.append({
        actor: input.principal.userId,
        actorRoles: [...input.principal.roles],
        agencyId: input.principal.scope.agencyId,
        branchId: input.principal.scope.branchId,
        eventType: String(input.commandId),
        objectTypeId: null,
        objectId: input.target?.id ?? null,
        correlationId,
        reason: input.reason ?? null,
        before: null,
        after: { status: outcome.value.status, serverRef: outcome.value.serverRef ?? null },
      });
    }

    return {
      ok: true,
      value: { ...outcome.value, correlationId },
    };
  }

  /** Register an object type and mirror its rules into the permission engine. */
  registerObjectType(def: ObjectTypeDefinition): void {
    const result = this.objects.registerType(def);
    if (!result.ok) throw new Error(`kernel: ${result.error.message}`);
  }

  registerCommandRule(rule: CommandPermissionRule): void {
    this.permissions.addCommandRule(rule);
  }

  subscribe(events: readonly DomainEventType[] | null, handler: EventHandler): () => void {
    return this.events.subscribe(events, handler);
  }

  publish(event: Omit<DomainEvent, 'at'> & { at?: string }): Promise<Result<null, KernelError>> {
    return this.events.publish(event);
  }

  jobHistory(): readonly JobRecord[] {
    return this.jobs.list();
  }

  auditTrail(): readonly AuditEvent[] {
    return this.audit.query({ limit: 200 });
  }
}

export interface CommandOutcome {
  readonly status: 'executed' | 'rejected' | 'needs_confirmation' | 'disabled';
  readonly message?: string;
  readonly serverRef?: string;
  readonly correlationId?: string;
}
