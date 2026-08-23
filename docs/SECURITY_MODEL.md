# Security Model

Sensitive workflow state is authoritative in PostgreSQL. Direct status updates are blocked by triggers and exposed transitions are role/scope checked.

Security Definer rules:
- `search_path` must be locked to `public,pg_catalog` for release-created functions.
- Public/anonymous EXECUTE is revoked on sensitive functions.
- Tenant/branch scope is checked through `row_in_staff_scope`.
- Posted accounting entries and lines are immutable.

Required live tests:
- cross-agency BOLA
- cross-branch BOLA
- private storage denial
- financial mutation denial
- state transition authorization
