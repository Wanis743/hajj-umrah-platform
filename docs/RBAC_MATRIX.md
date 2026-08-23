# RBAC Matrix

Authoritative permission evaluation occurs in PostgreSQL through RLS, `has_permission`, role checks and `row_in_staff_scope`.

## Required security test matrix
- Agency A user → Agency B row: DENY
- Branch A user → Branch B row: DENY
- Employee → admin-only object: DENY
- Manager → other tenant object: DENY
- User → hidden/private document: DENY
- User → payment outside branch: DENY

Any deviation blocks release.
