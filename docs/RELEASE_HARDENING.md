# Release Hardening Acceptance

A release is not certified until all of the following are true:
1. Migration timestamps are unique.
2. Fresh Supabase replay succeeds.
3. Financial summaries are server authoritative.
4. Sensitive status mutations are RPC/state-machine controlled.
5. Notification providers have authenticated delivery tests.
6. Observability sink is functional.
7. Realtime is centralized and scoped.
8. Cursor pagination exists for large datasets.
9. Critical layers contain no `any`.
10. Generated/database typing is present.
11. Security/RBAC/BOLA tests pass.
12. Integration UAT evidence exists.
13. Backup/restore drill evidence exists.
14. Build, lint and typecheck are green.
15. Release artifact contains no development-tooling artifacts.
