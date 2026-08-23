/**
 * Permission Engine (spec §7, §35) — resource + action + branch + role +
 * financial-authority checks in one trusted place.
 *
 * Front-end role: gate UI and pre-flight commands with identical semantics to
 * the server. This layer is defense-in-depth; the server remains authoritative.
 */

import type {
  CommandId,
  KernelError,
  MinorUnits,
  ObjectTypeId,
  Principal,
  Result,
} from './types.ts';
import { err, minorUnits, ok } from './types.ts';

export type FinancialImpact = 'none' | 'informational' | 'material' | 'irreversible';

export interface ResourcePermissionRule {
  readonly resourceType: ObjectTypeId;
  readonly action: string;
  readonly requiredRoles: readonly string[];
}

export interface CommandPermissionRule {
  readonly commandId: CommandId;
  /** Roles allowed to execute at all. Empty = any authenticated principal. */
  readonly requiredRoles: readonly string[];
  readonly financialImpact: FinancialImpact;
  /** Commands with material/irreversible impact require explicit confirmation context. */
  readonly requiresConfirmation: boolean;
  /**
   * Whether the amount being acted on counts against the principal's
   * financial authority limit. `null` = not amount-bounded.
   */
  readonly boundedByAuthority: boolean;
}

const PERM_ERR = 'PERMISSION_ENGINE' as const;

export class PermissionEngine {
  private readonly resources = new Map<string, ResourcePermissionRule>();
  private readonly commands = new Map<CommandId, CommandPermissionRule>();

  addResourceRule(rule: ResourcePermissionRule): void {
    this.resources.set(`${rule.resourceType}:${rule.action}`, rule);
  }

  addCommandRule(rule: CommandPermissionRule): void {
    this.commands.set(rule.commandId, rule);
  }

  getCommandRule(commandId: CommandId): Result<CommandPermissionRule, KernelError> {
    const rule = this.commands.get(commandId);
    if (!rule) {
      return err({
        code: 'NOT_FOUND',
        message: `No permission rule for command: ${commandId}`,
        details: { domain: PERM_ERR, commandId },
      });
    }
    return ok(rule);
  }

  canAccessResource(
    resourceType: ObjectTypeId,
    action: string,
    principal: Principal,
  ): boolean {
    const rule = this.resources.get(`${resourceType}:${action}`);
    if (!rule) return true; // unregistered resources default open at UI layer; server still gates
    if (rule.requiredRoles.length === 0) return true;
    return principal.roles.some((r) => rule.requiredRoles.includes(r));
  }

  /**
   * Full command authorization check including financial authority bounds.
   * On success returns whether the caller must present a confirmation context.
   */
  authorizeCommand(
    commandId: CommandId,
    principal: Principal,
    amount?: MinorUnits,
  ): Result<{ confirmationRequired: boolean }, KernelError> {
    const ruleResult = this.getCommandRule(commandId);
    if (!ruleResult.ok) return ruleResult;
    const rule = ruleResult.value;

    if (rule.requiredRoles.length > 0 && !principal.roles.some((r) => rule.requiredRoles.includes(r))) {
      return err({
        code: 'PERMISSION_DENIED',
        message: `Role requirement not met for ${commandId}`,
        details: { domain: PERM_ERR, commandId, required: rule.requiredRoles },
      });
    }

    if (amount !== undefined && rule.boundedByAuthority) {
      if (principal.financialAuthorityLimit === null) {
        return err({
          code: 'PERMISSION_DENIED',
          message: `Principal has no financial authority for ${commandId}`,
          details: { domain: PERM_ERR, commandId },
        });
      }
      if (amount > principal.financialAuthorityLimit) {
        return err({
          code: 'PERMISSION_DENIED',
          message: `Amount exceeds financial authority limit for ${commandId}`,
          details: {
            domain: PERM_ERR,
            commandId,
            requested: amount.toString(),
            limit: principal.financialAuthorityLimit.toString(),
          },
        });
      }
    }

    return ok({
      confirmationRequired:
        rule.requiresConfirmation ||
        rule.financialImpact === 'material' ||
        rule.financialImpact === 'irreversible',
    });
  }

  /** Convenience: the zero-amount constant for non-financial checks. */
  static get noAmount(): MinorUnits {
    return minorUnits(0n);
  }
}
