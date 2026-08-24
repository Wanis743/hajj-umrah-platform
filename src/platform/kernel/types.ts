/**
 * Platform Kernel — Core Types (spec §7, §36, §63, §64)
 *
 * Foundational contracts for the rebuild kernel. Framework-agnostic,
 * erasable-types-only (runs under Node type stripping), zero `any`.
 *
 * Conventions:
 * - Branded string IDs prevent cross-entity ID comparison (§36).
 * - Money is carried as branded bigint minor units (§63: never binary float).
 * - Expected failures are `Result` values, never thrown (§72: structured errors).
 */

/** Nominal branding for IDs so unrelated ID spaces cannot be compared. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ObjectTypeId = Brand<string, 'ObjectTypeId'>;
export type ObjectId = Brand<string, 'ObjectId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type JobId = Brand<string, 'JobId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;

/** Money in minor units (e.g. cents/halalas). Authoritative amounts only. */
export type MinorUnits = Brand<bigint, 'MinorUnits'>;

export const objectTypeId = (value: string): ObjectTypeId => value as ObjectTypeId;
export const objectId = (value: string): ObjectId => value as ObjectId;
export const commandId = (value: string): CommandId => value as CommandId;
export const roleId = (value: string): RoleId => value as RoleId;
export const correlationId = (value: string): CorrelationId => value as CorrelationId;
export const minorUnits = (value: bigint): MinorUnits => value as MinorUnits;

/** Structured kernel error codes (§72: return structured error codes, not strings). */
export type KernelErrorCode =
  | 'PERMISSION_DENIED'
  | 'CONFIRMATION_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'INVALID_TRANSITION'
  | 'NOT_FOUND'
  | 'ALREADY_REGISTERED'
  | 'DISABLED'
  | 'CONFLICT';

export interface KernelError {
  readonly code: KernelErrorCode;
  readonly message: string;
  /** Machine-readable context (never contains PII or credentials). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Discriminated result — the only error channel for expected failures. */
export type Result<T, E = KernelError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends KernelError>(error: E): Result<never, E> => ({ ok: false, error });

/** Multi-tenant scope (§35: agency/branch scope verified server-side; mirrored here for UI gating). */
export interface ScopeContext {
  readonly agencyId: string;
  readonly branchId: string | null;
  /** Enterprise principals may act across branches within their agency. */
  readonly enterpriseWide: boolean;
}

/** The acting user as understood by the front-end kernel. */
export interface Principal {
  readonly userId: string;
  readonly roles: readonly RoleId[];
  readonly scope: ScopeContext;
  /**
   * Maximum single-action financial authority in minor units.
   * `null` means no financial authority (financial actions denied).
   */
  readonly financialAuthorityLimit: MinorUnits | null;
}

/** Reference to any business object in the shared graph (§6). */
export interface ObjectRef {
  readonly typeId: ObjectTypeId;
  readonly id: ObjectId;
  readonly agencyId: string;
  readonly branchId: string | null;
}

/** UTC ISO-8601 timestamp string. */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;

export const isoTimestamp = (value: string): IsoTimestamp => value as IsoTimestamp;

export const nowIso = (): IsoTimestamp => isoTimestamp(new Date().toISOString());

export const newCorrelationId = (): CorrelationId =>
  correlationId(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `corr-${Date.now()}-${crypto.randomUUID()}`,
  );
