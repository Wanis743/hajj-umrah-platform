# Agency — 10/10 Remediation Implementation Matrix

## Implemented and verified
- Edge-only public reservation intake; anonymous direct INSERT/SELECT/RPC disabled.
- Tenant/branch scoping for sensitive operational data; current production check reports 0 unscoped rows.
- RLS hardening and legacy permissive policy removal in the fresh-install chain.
- Transactional payments, immutable reversals, invoice numbering, booking cancellation/confirmation workflows.
- Double-entry primitives: chart of accounts, fiscal periods, journal entries/lines, AR/AP aging views, bank reconciliation tables.
- Booking optimistic locking/versioning and state-transition RPC.
- Package versioning and booking-time price snapshots.
- Notification/workflow queues and CRM follow-up primitives.
- Hajj timeline, manifest/data-quality/missing-pilgrim primitives.
- Document metadata, document access audit, passport masking helper.
- Server-side admin MFA enforcement for protected operations through JWT AAL2.
- One-time admin bootstrap state and hardened `create-admin` Edge Function.
- Security headers, CI checks, source/migration/architecture verification.
- Enterprise FK indexes and operational indexes.

## Implemented structurally, but provider/UAT dependent
- Notification delivery architecture is provider-agnostic and queue-backed; final delivery remains credential/UAT dependent.
- Sentry/observability integration requires project DSN/provider configuration.
- PITR/restore remains platform-setting and exercise dependent; the DR runbook and staging gate are included.
- airline/bank integrations require approved external APIs/credentials.
- Fresh-DB replay is now an automated GitHub Actions gate using Supabase Local; browser E2E remains dependency/test-credential dependent.

## Remaining release gates
1. `npm ci`, `typecheck`, `lint`, `build` must pass in GitHub Actions.
2. Fresh database replay workflow must pass in CI.
3. RLS role-matrix and full E2E workflow tests require staging credentials and execution.
4. Supabase Auth leaked-password protection should be enabled at project level.
5. Provider credentials/sandbox UAT are required for external delivery integrations.
6. Staging → production deployment gate and restore drill must be completed.
