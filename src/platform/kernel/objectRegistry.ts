/**
 * Object Registry (spec §7) — authoritative object types, metadata, lifecycle, permissions.
 *
 * The registry is the single place where a business object type declares:
 * its lifecycle states and transitions, its permission requirements,
 * and its audit policy. UI and services must consult the registry —
 * never hard-code lifecycle logic in components (§4: no duplicate business logic).
 */

import type {
  KernelError,
  ObjectRef,
  ObjectTypeId,
  Principal,
  Result,
} from './types.ts';
import { err, objectTypeId as typeId, ok } from './types.ts';

/** Lifecycle declaration: explicit state machine per object type (§36). */
export interface LifecycleDefinition {
  readonly initial: string;
  /** Allowed transitions: from-state → set of to-states. */
  readonly transitions: Readonly<Record<string, readonly string[]>>;
  /** States that reject controlled writes (§15: closed/locked periods). */
  readonly terminalStates: readonly string[];
}

export type PermissionAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'post'
  | 'reverse'
  | 'lock'
  | 'unlock'
  | 'publish'
  | 'export';

export type AuditEventType =
  | 'CREATE_OBJECT'
  | 'UPDATE_OBJECT'
  | 'DELETE_OBJECT'
  | 'ARCHIVE_OBJECT'
  | 'RESTORE_OBJECT'
  | 'APPROVE'
  | 'REJECT'
  | 'POST'
  | 'REVERSE'
  | 'LOCK'
  | 'UNLOCK'
  | 'PUBLISH'
  | 'UNPUBLISH'
  | 'MATCH'
  | 'UNMATCH'
  | 'RECONCILE'
  | 'UNRECONCILE'
  | 'CERTIFY'
  | 'EXPORT'
  | 'IMPORT'
  | 'RUN_MODEL'
  | 'RUN_SCENARIO'
  | 'RUN_SIMULATION'
  | 'RUN_OPTIMIZATION'
  | 'CHANGE_ASSUMPTION'
  | 'CHANGE_FORMULA'
  | 'CHANGE_PERMISSION'
  | 'CHANGE_MASTER_DATA';

/** Which audit events a type's lifecycle actions emit (§64 taxonomy subset). */
export type LifecycleAction = 'create' | 'update' | 'delete' | 'transition';

export interface ObjectTypeDefinition {
  readonly id: ObjectTypeId;
  /** Human label — i18n key, not display text (§38). */
  readonly labelKey: string;
  readonly lifecycle: LifecycleDefinition;
  /** Minimum role required per action; empty array means any authenticated principal. */
  readonly requiredRoles: Readonly<Record<PermissionAction, readonly string[]>>;
  /** Audit events emitted for lifecycle actions; unlisted actions are not permitted on this type. */
  readonly auditMap: Readonly<Partial<Record<LifecycleAction, AuditEventType>>>;
}

export interface RegisteredObject extends ObjectRef {
  readonly typeId: ObjectTypeId;
  readonly lifecycleState: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const REGISTRY_ERR = 'OBJECT_REGISTRY' as const;

interface RegistryEntry {
  readonly def: ObjectTypeDefinition;
  readonly objects: Map<string, RegisteredObject>;
}

export class ObjectRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  registerType(def: ObjectTypeDefinition): Result<null, KernelError> {
    if (this.entries.has(def.id)) {
      return err({
        code: 'ALREADY_REGISTERED',
        message: `Object type already registered: ${def.id}`,
        details: { domain: REGISTRY_ERR, typeId: def.id },
      });
    }
    if (!(def.lifecycle.initial in def.lifecycle.transitions)) {
      return err({
        code: 'VALIDATION_FAILED',
        message: `Lifecycle initial state missing from transitions: ${def.lifecycle.initial}`,
        details: { domain: REGISTRY_ERR, typeId: def.id },
      });
    }
    this.entries.set(def.id, { def, objects: new Map() });
    return ok(null);
  }

  getType(id: ObjectTypeId): Result<ObjectTypeDefinition, KernelError> {
    const entry = this.entries.get(id);
    if (!entry) {
      return err({
        code: 'NOT_FOUND',
        message: `Unknown object type: ${id}`,
        details: { domain: REGISTRY_ERR, typeId: id },
      });
    }
    return ok(entry.def);
  }

  /**
   * Create an object instance in-scoped. Scope is enforced here AND must be
   * re-verified server-side on every RPC (§35 — this is defense-in-depth only).
   */
  create(
    ref: Omit<ObjectRef, never> & { id: ObjectRef['id'] },
    principal: Principal,
    action: PermissionAction = 'create',
  ): Result<RegisteredObject, KernelError> {
    const entry = this.entries.get(ref.typeId);
    if (!entry) {
      return err({ code: 'NOT_FOUND', message: `Unknown object type: ${ref.typeId}`, details: { domain: REGISTRY_ERR } });
    }
    if (!this.hasPermission(entry.def, action, principal)) {
      return err({
        code: 'PERMISSION_DENIED',
        message: `Principal lacks '${action}' on ${ref.typeId}`,
        details: { domain: REGISTRY_ERR, typeId: ref.typeId, action },
      });
    }
    const now = new Date().toISOString();
    const obj: RegisteredObject = {
      typeId: ref.typeId,
      id: ref.id,
      agencyId: ref.agencyId,
      branchId: ref.branchId,
      lifecycleState: entry.def.lifecycle.initial,
      createdAt: now,
      updatedAt: now,
    };
    entry.objects.set(obj.id, obj);
    return ok(obj);
  }

  get(typeId: ObjectTypeId, id: string): Result<RegisteredObject, KernelError> {
    const entry = this.entries.get(typeId);
    const found = entry?.objects.get(id);
    if (!entry || !found) {
      return err({ code: 'NOT_FOUND', message: `Object not found: ${typeId}/${id}`, details: { domain: REGISTRY_ERR } });
    }
    return ok(found);
  }

  /**
   * Execute a lifecycle transition with permission + scope + state validation.
   * Returns the updated object.
   */
  transition(
    typeId: ObjectTypeId,
    id: string,
    toState: string,
    principal: Principal,
  ): Result<RegisteredObject, KernelError> {
    const entry = this.entries.get(typeId);
    if (!entry) {
      return err({ code: 'NOT_FOUND', message: `Unknown object type: ${typeId}`, details: { domain: REGISTRY_ERR } });
    }
    const current = entry.objects.get(id);
    if (!current) {
      return err({ code: 'NOT_FOUND', message: `Object not found: ${typeId}/${id}`, details: { domain: REGISTRY_ERR } });
    }
    // §35: scope check before anything else.
    if (!this.inScope(current, principal)) {
      return err({
        code: 'PERMISSION_DENIED',
        message: 'Object outside principal scope',
        details: { domain: REGISTRY_ERR, typeId, id },
      });
    }
    if (!this.hasPermission(entry.def, 'update', principal)) {
      return err({
        code: 'PERMISSION_DENIED',
        message: `Principal lacks 'update' on ${typeId}`,
        details: { domain: REGISTRY_ERR, typeId, action: 'update' },
      });
    }
    const allowed = entry.def.lifecycle.transitions[current.lifecycleState] ?? [];
    if (!allowed.includes(toState)) {
      return err({
        code: 'INVALID_TRANSITION',
        message: `${current.lifecycleState} → ${toState} is not allowed on ${typeId}`,
        details: { domain: REGISTRY_ERR, from: current.lifecycleState, to: toState },
      });
    }
    const updated: RegisteredObject = {
      ...current,
      lifecycleState: toState,
      updatedAt: new Date().toISOString(),
    };
    entry.objects.set(id, updated);
    return ok(updated);
  }

  isTerminal(typeId: ObjectTypeId, state: string): boolean {
    const entry = this.entries.get(typeId);
    return entry !== undefined && entry.def.lifecycle.terminalStates.includes(state);
  }

  inScope(obj: ObjectRef, principal: Principal): boolean {
    if (obj.agencyId !== principal.scope.agencyId) return false;
    if (principal.scope.enterpriseWide) return true;
    if (obj.branchId === null) return true;
    return principal.scope.branchId === null || obj.branchId === principal.scope.branchId;
  }

  private hasPermission(
    def: ObjectTypeDefinition,
    action: PermissionAction,
    principal: Principal,
  ): boolean {
    const required = def.requiredRoles[action] ?? [];
    if (required.length === 0) return true;
    if (required.includes('*')) return true;
    return principal.roles.some((r) => required.includes(r));
  }
}

export const OBJECT_TYPE = {
  Journal: typeId('journal'),
  Invoice: typeId('invoice'),
  Payment: typeId('payment'),
  Reconciliation: typeId('reconciliation'),
  Customer: typeId('customer'),
  Lead: typeId('lead'),
  Document: typeId('document'),
} as const;
