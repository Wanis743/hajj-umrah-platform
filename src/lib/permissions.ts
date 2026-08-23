export type Role = 'ADMIN' | 'MANAGER' | 'AGENT' | 'GUIDE' | 'FINANCE';

export type ResourceAction = 
  | 'exports.read'
  | 'exports.create'
  | 'exports.pii';

export const RBAC_MATRIX: Record<Role, ResourceAction[]> = {
  ADMIN: ['exports.read', 'exports.create', 'exports.pii'],
  MANAGER: ['exports.read', 'exports.create', 'exports.pii'],
  FINANCE: ['exports.read', 'exports.create'],
  AGENT: ['exports.read', 'exports.create'],
  GUIDE: []
};

export function hasPermission(role: Role | undefined | null, action: ResourceAction): boolean {
  if (!role) return false;
  const permissions = RBAC_MATRIX[role];
  if (!permissions) return false;
  return permissions.includes(action);
}
